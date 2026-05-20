import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AbsenceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hourLabel, weekDayLabel } from "@/lib/report-helpers";
import { weekDays } from "@/lib/school-time";
import { parseSessionToken, sessionCookieName } from "@/lib/session";

function percent(value: number, total: number) {
  if (total === 0) return 0;

  return Math.round((value / total) * 100);
}

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const session = parseSessionToken(cookieStore.get(sessionCookieName)?.value);

  if (!session || (session.role !== "ADMIN" && session.role !== "TEACHER")) {
    redirect("/");
  }

  if (session.mustChangePassword) {
    redirect("/account/password");
  }

  const teacher =
    session.role === "TEACHER"
      ? await prisma.teacher.findUnique({
          where: { userId: session.userId },
          include: {
            courses: {
              include: { course: true }
            }
          }
        })
      : null;

  const allowedClassIds =
    session.role === "ADMIN"
      ? undefined
      : Array.from(
          new Set([
            ...(teacher?.homeClassId ? [teacher.homeClassId] : []),
            ...(teacher?.courses.map((courseLink) => courseLink.course.classId) ?? [])
          ])
        );

  const [classes, absences, sheets, scheduleSlots] = await Promise.all([
    prisma.class.findMany({
      where: allowedClassIds ? { id: { in: allowedClassIds } } : undefined,
      include: {
        schoolYear: true,
        students: true
      },
      orderBy: [{ schoolYear: { startsOn: "desc" } }, { name: "asc" }]
    }),
    prisma.attendanceSheetAbsence.findMany({
      where: {
        absent: true,
        status: { not: AbsenceStatus.REMOVED },
        sheet: allowedClassIds ? { classId: { in: allowedClassIds } } : undefined
      },
      include: {
        student: {
          include: {
            class: {
              include: { schoolYear: true }
            }
          }
        },
        sheet: {
          include: {
            class: {
              include: { schoolYear: true }
            },
            course: true
          }
        }
      }
    }),
    prisma.attendanceSheet.findMany({
      where: allowedClassIds ? { classId: { in: allowedClassIds } } : undefined
    }),
    prisma.scheduleSlot.findMany({
      where: allowedClassIds ? { classId: { in: allowedClassIds } } : undefined,
      include: {
        course: {
          include: {
            class: {
              include: { schoolYear: true }
            }
          }
        }
      },
      orderBy: [{ day: "asc" }, { hour: "asc" }]
    })
  ]);

  const activeYear = classes[0]?.schoolYear.name ?? "Χωρίς ενεργό έτος";
  const studentCount = classes.reduce((total, classRecord) => total + classRecord.students.length, 0);
  const markedCount = absences.filter((absence) => absence.status === AbsenceStatus.MARKED).length;
  const excusedCount = absences.filter((absence) => absence.status === AbsenceStatus.EXCUSED).length;
  const signedSheets = sheets.filter((sheet) => sheet.signedAt).length;
  const draftSheets = sheets.filter((sheet) => sheet.savedAt && !sheet.signedAt).length;
  const sheetKeySet = new Set(sheets.map((sheet) => `${sheet.classId}-${sheet.day}-${sheet.hour}`));
  const scheduledHourKeys = Array.from(new Set(scheduleSlots.map((slot) => `${slot.classId}-${slot.day}-${slot.hour}`)));
  const unsignedScheduledHours = scheduledHourKeys.filter((key) => {
    const [classId, day, hour] = key.split("-");
    const sheet = sheets.find((item) => item.classId === classId && item.day === day && item.hour === Number(hour));
    return !sheet?.signedAt;
  });
  const untouchedScheduledHours = scheduledHourKeys.filter((key) => !sheetKeySet.has(key));
  const pendingScheduleRows = unsignedScheduledHours
    .map((key) => {
      const [classId, day, hour] = key.split("-");
      const slots = scheduleSlots.filter((slot) => slot.classId === classId && slot.day === day && slot.hour === Number(hour));
      const firstSlot = slots[0];

      return firstSlot
        ? {
            key,
            className: firstSlot.course.class.name,
            schoolYear: firstSlot.course.class.schoolYear.name,
            day: firstSlot.day,
            hour: firstSlot.hour,
            courses: slots.map((slot) => slot.course.name).join(" / "),
            untouched: untouchedScheduledHours.includes(key)
          }
        : null;
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  const classRows = classes.map((classRecord) => {
    const classAbsences = absences.filter((absence) => absence.sheet.classId === classRecord.id);
    const classMarked = classAbsences.filter((absence) => absence.status === AbsenceStatus.MARKED).length;
    const classExcused = classAbsences.filter((absence) => absence.status === AbsenceStatus.EXCUSED).length;

    return {
      id: classRecord.id,
      name: classRecord.name,
      schoolYear: classRecord.schoolYear.name,
      students: classRecord.students.length,
      total: classAbsences.length,
      marked: classMarked,
      excused: classExcused
    };
  });

  const dayRows = weekDays.map((day) => {
    const dayAbsences = absences.filter((absence) => absence.sheet.day === day.value);

    return {
      day: day.label,
      total: dayAbsences.length,
      marked: dayAbsences.filter((absence) => absence.status === AbsenceStatus.MARKED).length
    };
  });

  const byStudent = new Map<
    string,
    {
      name: string;
      className: string;
      schoolYear: string;
      total: number;
      marked: number;
      excused: number;
    }
  >();

  for (const absence of absences) {
    const existing =
      byStudent.get(absence.studentId) ??
      {
        name: `${absence.student.surname} ${absence.student.name}`,
        className: absence.student.class.name,
        schoolYear: absence.student.class.schoolYear.name,
        total: 0,
        marked: 0,
        excused: 0
      };

    existing.total += 1;
    if (absence.status === AbsenceStatus.EXCUSED) {
      existing.excused += 1;
    } else {
      existing.marked += 1;
    }
    byStudent.set(absence.studentId, existing);
  }

  const topStudents = Array.from(byStudent.values())
    .sort((first, second) => second.marked - first.marked || second.total - first.total || first.name.localeCompare(second.name, "el"))
    .slice(0, 8);
  const attentionStudents = topStudents.filter((student) => student.marked >= 2);
  const latestAbsences = [...absences]
    .sort((first, second) => {
      const firstTime = first.sheet.savedAt?.getTime() ?? first.updatedAt.getTime();
      const secondTime = second.sheet.savedAt?.getTime() ?? second.updatedAt.getTime();
      return secondTime - firstTime;
    })
    .slice(0, 6);

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <div className="brand">
          <div className="brand-mark">ΣΧ</div>
          <div>
            <h1>Dashboard</h1>
            <span>Στατιστικά απουσιών, τάσεων και εκκρεμοτήτων</span>
          </div>
        </div>
        <div className="status-row">
          <Link className="secondary-button" href="/">
            Απουσιολόγιο
          </Link>
          <Link className="secondary-button" href="/teacher">
            Σήμερα
          </Link>
          <Link className="secondary-button" href="/reports">
            Αναφορές
          </Link>
          <Link className="secondary-button" href="/print">
            Εκτυπώσεις
          </Link>
          {session.role === "ADMIN" ? (
            <Link className="secondary-button" href="/admin">
              Διαχείριση
            </Link>
          ) : null}
        </div>
      </header>

      <div className="summary-grid">
        <div className="panel metric">
          <span>Σχολικό έτος</span>
          <strong>{activeYear}</strong>
        </div>
        <div className="panel metric">
          <span>Μαθητές</span>
          <strong>{studentCount}</strong>
        </div>
        <div className="panel metric">
          <span>Αδικαιολόγητες</span>
          <strong>{markedCount}</strong>
        </div>
        <div className="panel metric">
          <span>Εκκρεμείς ώρες</span>
          <strong>{unsignedScheduledHours.length}</strong>
        </div>
      </div>

      <section className="dashboard-grid">
        <article className="admin-section">
          <div className="admin-section-title">
            <h2>Εικόνα απουσιών</h2>
            <p>Σύνολα για τα τμήματα που έχει πρόσβαση ο συνδεδεμένος χρήστης.</p>
          </div>
          <div className="dashboard-bars">
            <div className="dashboard-bar-row">
              <span>Αδικαιολόγητες</span>
              <div className="dashboard-bar">
                <i style={{ width: `${percent(markedCount, absences.length)}%` }} />
              </div>
              <strong>{markedCount}</strong>
            </div>
            <div className="dashboard-bar-row">
              <span>Δικαιολογημένες</span>
              <div className="dashboard-bar">
                <i style={{ width: `${percent(excusedCount, absences.length)}%` }} />
              </div>
              <strong>{excusedCount}</strong>
            </div>
            <div className="dashboard-bar-row">
              <span>Υπογεγραμμένα φύλλα</span>
              <div className="dashboard-bar">
                <i style={{ width: `${percent(signedSheets, Math.max(sheets.length, 1))}%` }} />
              </div>
              <strong>{signedSheets}</strong>
            </div>
            <div className="dashboard-bar-row">
              <span>Πρόχειρα φύλλα</span>
              <div className="dashboard-bar">
                <i style={{ width: `${percent(draftSheets, Math.max(sheets.length, 1))}%` }} />
              </div>
              <strong>{draftSheets}</strong>
            </div>
          </div>
        </article>

        <article className="admin-section">
          <div className="admin-section-title">
            <h2>Προσοχή</h2>
            <p>Μαθητές που χρειάζονται παρακολούθηση λόγω αδικαιολόγητων απουσιών.</p>
          </div>
          <div className="attention-list">
            {attentionStudents.length > 0 ? (
              attentionStudents.map((student) => (
                <div className="attention-row" key={`${student.schoolYear}-${student.className}-${student.name}`}>
                  <div>
                    <strong>{student.name}</strong>
                    <span>
                      {student.className} ({student.schoolYear})
                    </span>
                  </div>
                  <span className="sync-pill">{student.marked} αδικαιολόγητες</span>
                </div>
              ))
            ) : (
              <div className="empty-state">Δεν υπάρχουν μαθητές πάνω από το όριο προσοχής.</div>
            )}
          </div>
        </article>
      </section>

      <section className="admin-section">
        <div className="admin-section-title">
          <h2>Τμήματα</h2>
          <p>Σύνολα και ποσοτική εικόνα ανά τμήμα.</p>
        </div>
        <div className="report-table">
          <div className="dashboard-row report-head">
            <span>Τμήμα</span>
            <span>Μαθητές</span>
            <span>Σύνολο</span>
            <span>Αδικαιολόγητες</span>
            <span>Δικαιολογημένες</span>
          </div>
          {classRows.map((classRecord) => (
            <div className="dashboard-row" key={classRecord.id}>
              <strong>
                {classRecord.name} ({classRecord.schoolYear})
              </strong>
              <span>{classRecord.students}</span>
              <span>{classRecord.total}</span>
              <span>{classRecord.marked}</span>
              <span>{classRecord.excused}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="dashboard-grid">
        <article className="admin-section">
          <div className="admin-section-title">
            <h2>Απουσίες ανά ημέρα</h2>
            <p>Γρήγορη ένδειξη για ημέρες που εμφανίζουν μεγαλύτερη συγκέντρωση.</p>
          </div>
          <div className="dashboard-bars">
            {dayRows.map((day) => (
              <div className="dashboard-bar-row" key={day.day}>
                <span>{day.day}</span>
                <div className="dashboard-bar">
                  <i style={{ width: `${percent(day.total, Math.max(absences.length, 1))}%` }} />
                </div>
                <strong>{day.total}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="admin-section">
          <div className="admin-section-title">
            <h2>Τελευταίες απουσίες</h2>
            <p>Οι πιο πρόσφατες εγγραφές που παραμένουν ενεργές.</p>
          </div>
          <div className="attention-list">
            {latestAbsences.map((absence) => (
              <div className="attention-row" key={`${absence.sheetId}-${absence.studentId}`}>
                <div>
                  <strong>
                    {absence.student.surname} {absence.student.name}
                  </strong>
                  <span>
                    {absence.sheet.class.name}, {weekDayLabel(absence.sheet.day)}, {hourLabel(absence.sheet.hour)} · {absence.sheet.course.name}
                  </span>
                </div>
                <span className={absence.status === AbsenceStatus.EXCUSED ? "sync-pill ready" : "sync-pill"}>
                  {absence.status === AbsenceStatus.EXCUSED ? "Δικαιολογημένη" : "Αδικαιολόγητη"}
                </span>
              </div>
            ))}
            {latestAbsences.length === 0 ? <div className="empty-state">Δεν υπάρχουν απουσίες.</div> : null}
          </div>
        </article>
      </section>

      <section className="admin-section">
        <div className="admin-section-title">
          <h2>Εκκρεμότητες προγράμματος</h2>
          <p>Ώρες που έχουν οριστεί στο πρόγραμμα αλλά δεν έχουν υπογεγραμμένο απουσιολόγιο.</p>
        </div>
        <div className="attention-list">
          {pendingScheduleRows.slice(0, 8).map((row) => (
            <div className="attention-row" key={row.key}>
              <div>
                <strong>
                  {row.className}, {weekDayLabel(row.day)}, {hourLabel(row.hour)}
                </strong>
                <span>
                  {row.courses} · {row.schoolYear}
                </span>
              </div>
              <span className="sync-pill">{row.untouched ? "Δεν άνοιξε" : "Δεν υπογράφηκε"}</span>
            </div>
          ))}
          {pendingScheduleRows.length === 0 ? <div className="empty-state">Δεν υπάρχουν εκκρεμότητες προγράμματος.</div> : null}
        </div>
      </section>
    </main>
  );
}
