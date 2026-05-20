import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AbsenceStatus, ParentJustificationStatus } from "@prisma/client";
import {
  approveParentJustificationRequestAction,
  excuseAbsenceAction,
  markAbsenceAction,
  rejectParentJustificationRequestAction,
  removeAbsenceAction
} from "@/app/reports/actions";
import { prisma } from "@/lib/prisma";
import { absenceStatusLabel, hourLabel, parentJustificationStatusLabel, weekDayLabel } from "@/lib/report-helpers";
import { parseSessionToken, sessionCookieName } from "@/lib/session";

function dateLabel(date: Date | null) {
  if (!date) return "Δεν έχει αποθηκευτεί";

  return new Intl.DateTimeFormat("el-GR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(date);
}

export default async function ReportsPage() {
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
              include: {
                course: true
              }
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

  const [classes, absences, justificationRequests] = await Promise.all([
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
      },
      orderBy: [{ sheet: { day: "asc" } }, { sheet: { hour: "asc" } }, { student: { surname: "asc" } }]
    }),
    prisma.parentJustificationRequest.findMany({
      where: {
        sheet: allowedClassIds ? { classId: { in: allowedClassIds } } : undefined
      },
      include: {
        parent: true,
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
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }]
    })
  ]);

  const summaryByStudent = new Map<
    string,
    {
      studentName: string;
      className: string;
      schoolYear: string;
      total: number;
      marked: number;
      excused: number;
    }
  >();

  for (const absence of absences) {
    const existing =
      summaryByStudent.get(absence.studentId) ??
      {
        studentName: `${absence.student.surname} ${absence.student.name}`,
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
    summaryByStudent.set(absence.studentId, existing);
  }

  const studentSummaries = Array.from(summaryByStudent.values()).sort(
    (first, second) => second.total - first.total || first.studentName.localeCompare(second.studentName, "el")
  );
  const markedCount = absences.filter((absence) => absence.status === AbsenceStatus.MARKED).length;
  const excusedCount = absences.filter((absence) => absence.status === AbsenceStatus.EXCUSED).length;
  const pendingRequestCount = justificationRequests.filter((request) => request.status === ParentJustificationStatus.PENDING).length;

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <div className="brand">
          <div className="brand-mark">ΣΧ</div>
          <div>
            <h1>Αναφορές απουσιών</h1>
            <span>Σύνολα, δικαιολογήσεις και εξαγωγές ανά μαθητή</span>
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
          <Link className="primary-button" href="/api/reports/export">
            CSV εξαγωγή
          </Link>
        </div>
      </header>

      <div className="summary-grid">
        <div className="panel metric">
          <span>Τμήματα</span>
          <strong>{classes.length}</strong>
        </div>
        <div className="panel metric">
          <span>Ενεργές απουσίες</span>
          <strong>{absences.length}</strong>
        </div>
        <div className="panel metric">
          <span>Καταχωρισμένες</span>
          <strong>{markedCount}</strong>
        </div>
        <div className="panel metric">
          <span>Δικαιολογημένες</span>
          <strong>{excusedCount}</strong>
        </div>
        <div className="panel metric">
          <span>Αιτήματα γονέων</span>
          <strong>{pendingRequestCount}</strong>
        </div>
      </div>

      <section className="admin-section">
        <div className="admin-section-title">
          <h2>Σύνοψη ανά μαθητή</h2>
          <p>Οι δικαιολογημένες απουσίες παραμένουν ορατές, αλλά ξεχωρίζουν από τις αδικαιολόγητες.</p>
        </div>

        <div className="report-table">
          <div className="report-row report-head">
            <span>Μαθητής</span>
            <span>Τμήμα</span>
            <span>Σύνολο</span>
            <span>Αδικαιολόγητες</span>
            <span>Δικαιολογημένες</span>
          </div>
          {studentSummaries.length > 0 ? (
            studentSummaries.map((summary) => (
              <div className="report-row" key={`${summary.schoolYear}-${summary.className}-${summary.studentName}`}>
                <strong>{summary.studentName}</strong>
                <span>
                  {summary.className} ({summary.schoolYear})
                </span>
                <span>{summary.total}</span>
                <span>{summary.marked}</span>
                <span>{summary.excused}</span>
              </div>
            ))
          ) : (
            <div className="empty-state">Δεν υπάρχουν καταχωρισμένες απουσίες για τα διαθέσιμα τμήματα.</div>
          )}
        </div>
      </section>

      <section className="admin-section">
        <div className="admin-section-title">
          <h2>Αιτήματα γονέων</h2>
          <p>Έλεγχος αιτημάτων δικαιολόγησης που έστειλαν οι γονείς από την πύλη τους.</p>
        </div>

        <div className="absence-card-list">
          {justificationRequests.length > 0 ? (
            justificationRequests.map((request) => (
              <article className="absence-card" key={request.id}>
                <div className="absence-card-main">
                  <div>
                    <strong>
                      {request.student.surname} {request.student.name}
                    </strong>
                    <span>
                      {request.sheet.class.name} ({request.sheet.class.schoolYear.name}) · {weekDayLabel(request.sheet.day)}, {hourLabel(request.sheet.hour)}
                    </span>
                  </div>
                  <div>
                    <strong>{request.sheet.course.name}</strong>
                    <span>
                      Γονέας: {request.parent.surname} {request.parent.name}
                    </span>
                  </div>
                  <span className={request.status === ParentJustificationStatus.APPROVED ? "sync-pill ready" : "sync-pill"}>
                    {parentJustificationStatusLabel(request.status)}
                  </span>
                </div>
                <p className="absence-reason">{request.reason}</p>
                {request.schoolResponse ? <p className="absence-reason">Απάντηση σχολείου: {request.schoolResponse}</p> : null}
                {request.status === ParentJustificationStatus.PENDING ? (
                  <div className="absence-actions">
                    <form action={approveParentJustificationRequestAction} className="inline-form">
                      <input name="requestId" type="hidden" value={request.id} />
                      <input name="response" placeholder="απάντηση προς γονέα" />
                      <button className="secondary-button" type="submit">
                        Έγκριση
                      </button>
                    </form>
                    <form action={rejectParentJustificationRequestAction} className="inline-form">
                      <input name="requestId" type="hidden" value={request.id} />
                      <input name="response" placeholder="λόγος απόρριψης" />
                      <button className="secondary-button danger" type="submit">
                        Απόρριψη
                      </button>
                    </form>
                  </div>
                ) : null}
              </article>
            ))
          ) : (
            <div className="empty-state">Δεν υπάρχουν αιτήματα γονέων.</div>
          )}
        </div>
      </section>

      <section className="admin-section">
        <div className="admin-section-title">
          <h2>Αναλυτικές εγγραφές</h2>
          <p>Από εδώ γίνεται δικαιολόγηση, επαναφορά σε αδικαιολόγητη ή αφαίρεση λανθασμένης απουσίας.</p>
        </div>

        <div className="absence-card-list">
          {absences.map((absence) => (
            <article className="absence-card" key={`${absence.sheetId}-${absence.studentId}`}>
              <div className="absence-card-main">
                <div>
                  <strong>
                    {absence.student.surname} {absence.student.name}
                  </strong>
                  <span>
                    {absence.sheet.class.name} ({absence.sheet.class.schoolYear.name}) · {weekDayLabel(absence.sheet.day)}, {hourLabel(absence.sheet.hour)}
                  </span>
                </div>
                <div>
                  <strong>{absence.sheet.course.name}</strong>
                  <span>{dateLabel(absence.sheet.savedAt)}</span>
                </div>
                <span className={absence.status === AbsenceStatus.EXCUSED ? "sync-pill ready" : "sync-pill"}>
                  {absenceStatusLabel(absence.status)}
                </span>
              </div>
              {absence.excusedReason ? <p className="absence-reason">{absence.excusedReason}</p> : null}
              <div className="absence-actions">
                <form action={excuseAbsenceAction} className="inline-form">
                  <input name="sheetId" type="hidden" value={absence.sheetId} />
                  <input name="studentId" type="hidden" value={absence.studentId} />
                  <input name="reason" placeholder="λόγος δικαιολόγησης" />
                  <button className="secondary-button" type="submit">
                    Δικαιολόγηση
                  </button>
                </form>
                <form action={markAbsenceAction}>
                  <input name="sheetId" type="hidden" value={absence.sheetId} />
                  <input name="studentId" type="hidden" value={absence.studentId} />
                  <button className="secondary-button" type="submit">
                    Αδικαιολόγητη
                  </button>
                </form>
                <form action={removeAbsenceAction}>
                  <input name="sheetId" type="hidden" value={absence.sheetId} />
                  <input name="studentId" type="hidden" value={absence.studentId} />
                  <button className="secondary-button danger" type="submit">
                    Αφαίρεση
                  </button>
                </form>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
