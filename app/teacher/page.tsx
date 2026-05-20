import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { WeekDay } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hourLabel, weekDayLabel } from "@/lib/report-helpers";
import { getCurrentSchoolHour, schoolHours, weekDays } from "@/lib/school-time";
import { parseSessionToken, sessionCookieName } from "@/lib/session";

type TeacherDayPageProps = {
  searchParams: Promise<{
    day?: string;
  }>;
};

function dayFromDate(date: Date): WeekDay {
  const dayIndex = date.getDay();
  const match = weekDays.find((day) => day.number === dayIndex);

  return (match?.value as WeekDay | undefined) ?? WeekDay.MONDAY;
}

function parseDay(value: string | undefined, fallback: WeekDay) {
  if (value && Object.values(WeekDay).includes(value as WeekDay)) {
    return value as WeekDay;
  }

  return fallback;
}

function attendanceLink(classId: string, day: WeekDay, hour: number) {
  const params = new URLSearchParams({
    classId,
    day,
    hour: String(hour)
  });

  return `/?${params.toString()}`;
}

export default async function TeacherDayPage({ searchParams }: TeacherDayPageProps) {
  const cookieStore = await cookies();
  const session = parseSessionToken(cookieStore.get(sessionCookieName)?.value);

  if (!session) {
    redirect("/");
  }

  if (session.mustChangePassword) {
    redirect("/account/password");
  }

  if (session.role === "PARENT" || session.role === "CLASS_TABLET") {
    redirect("/");
  }

  const params = await searchParams;
  const today = new Date();
  const todayDay = dayFromDate(today);
  const selectedDay = parseDay(params.day, todayDay);
  const currentHour = getCurrentSchoolHour(today).hour;
  const teacher =
    session.role === "TEACHER"
      ? await prisma.teacher.findUnique({
          where: { userId: session.userId }
        })
      : null;

  if (session.role === "TEACHER" && !teacher) {
    redirect("/");
  }

  const scheduleSlots = await prisma.scheduleSlot.findMany({
    where:
      session.role === "ADMIN"
        ? { day: selectedDay }
        : {
            day: selectedDay,
            course: {
              teachers: {
                some: {
                  teacherId: teacher?.id
                }
              }
            }
          },
    include: {
      course: {
        include: {
          class: {
            include: {
              schoolYear: true
            }
          },
          teachers: {
            include: {
              teacher: true
            }
          }
        }
      }
    },
    orderBy: [{ hour: "asc" }, { classId: "asc" }]
  });

  const sheets =
    scheduleSlots.length > 0
      ? await prisma.attendanceSheet.findMany({
          where: {
            day: selectedDay,
            OR: scheduleSlots.map((slot) => ({
              classId: slot.classId,
              hour: slot.hour
            }))
          },
          include: {
            absences: true
          }
        })
      : [];
  const sheetByClassHour = new Map(sheets.map((sheet) => [`${sheet.classId}-${sheet.hour}`, sheet]));
  const signedSlotCount = scheduleSlots.filter((slot) => sheetByClassHour.get(`${slot.classId}-${slot.hour}`)?.signedAt).length;
  const pendingCount = Math.max(scheduleSlots.length - signedSlotCount, 0);
  const absenceCount = sheets.reduce(
    (total, sheet) => total + sheet.absences.filter((absence) => absence.absent && absence.status !== "REMOVED").length,
    0
  );

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <div className="brand">
          <div className="brand-mark">ΣΧ</div>
          <div>
            <h1>Σήμερα</h1>
            <span>Γρήγορη ροή εκπαιδευτικού για μαθήματα και απουσιολόγια</span>
          </div>
        </div>
        <div className="status-row">
          <Link className="secondary-button" href="/">
            Απουσιολόγιο
          </Link>
          <Link className="secondary-button" href="/schedule">
            Πρόγραμμα
          </Link>
          <Link className="secondary-button" href="/dashboard">
            Dashboard
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

      <section className="admin-section">
        <div className="admin-section-title">
          <h2>Ημέρα εργασίας</h2>
          <p>Επιλέξτε ημέρα και ανοίξτε απευθείας το απουσιολόγιο της σωστής ώρας.</p>
        </div>

        <div className="class-tabs">
          {weekDays.map((day) => (
            <Link className={selectedDay === day.value ? "class-tab active" : "class-tab"} href={`/teacher?day=${day.value}`} key={day.value}>
              {day.label}
              <span>{todayDay === day.value ? "Σήμερα" : "Εβδομάδα"}</span>
            </Link>
          ))}
        </div>
      </section>

      <div className="summary-grid">
        <div className="panel metric">
          <span>Μαθήματα</span>
          <strong>{scheduleSlots.length}</strong>
        </div>
        <div className="panel metric">
          <span>Υπογεγραμμένα</span>
          <strong>{signedSlotCount}</strong>
        </div>
        <div className="panel metric">
          <span>Εκκρεμότητες</span>
          <strong>{pendingCount}</strong>
        </div>
        <div className="panel metric">
          <span>Απουσίες ημέρας</span>
          <strong>{absenceCount}</strong>
        </div>
      </div>

      <section className="admin-section">
        <div className="admin-section-title">
          <h2>Μαθήματα {weekDayLabel(selectedDay)}</h2>
          <p>Η τρέχουσα ώρα τονίζεται όταν συμπίπτει με την επιλεγμένη ημέρα.</p>
        </div>

        {scheduleSlots.length > 0 ? (
          <div className="teacher-day-list">
            {scheduleSlots.map((slot) => {
              const sheet = sheetByClassHour.get(`${slot.classId}-${slot.hour}`);
              const teachers = slot.course.teachers.map((link) => `${link.teacher.surname} ${link.teacher.name}`).join(", ");
              const status = sheet?.signedAt ? "Υπογεγραμμένο" : sheet?.savedAt ? "Πρόχειρο" : "Εκκρεμεί";
              const activeNow = selectedDay === todayDay && slot.hour === currentHour;
              const slotTime = schoolHours.find((schoolHour) => schoolHour.hour === slot.hour);
              const slotAbsences = sheet?.absences.filter((absence) => absence.absent && absence.status !== "REMOVED").length ?? 0;

              return (
                <article className={activeNow ? "teacher-day-card current" : "teacher-day-card"} key={slot.id}>
                  <div className="teacher-day-time">
                    <strong>{hourLabel(slot.hour)}</strong>
                    <span>
                      {slotTime?.starts}-{slotTime?.ends}
                    </span>
                  </div>
                  <div className="teacher-day-main">
                    <strong>{slot.course.name}</strong>
                    <span>
                      {slot.course.class.name} ({slot.course.class.schoolYear.name})
                    </span>
                    <span>{teachers || "Χωρίς εκπαιδευτικό"}</span>
                  </div>
                  <div className="teacher-day-status">
                    <span className={sheet?.signedAt ? "pill signed-pill" : "pill"}>{status}</span>
                    <span className="student-directory-detail">{slotAbsences} απουσίες</span>
                  </div>
                  <Link className="primary-button" href={attendanceLink(slot.classId, selectedDay, slot.hour)}>
                    Άνοιγμα
                  </Link>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">Δεν υπάρχουν μαθήματα για την επιλεγμένη ημέρα.</div>
        )}
      </section>
    </main>
  );
}
