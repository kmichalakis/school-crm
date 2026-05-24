import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AbsenceStatus, ParentJustificationStatus } from "@prisma/client";
import { AppNavigation } from "@/app/app-navigation";
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

type ReportsPageProps = {
  searchParams: Promise<{
    classId?: string;
  }>;
};

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const cookieStore = await cookies();
  const session = parseSessionToken(cookieStore.get(sessionCookieName)?.value);
  const params = await searchParams;

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
            responsibleClasses: {
              include: { schoolYear: true },
              orderBy: [{ schoolYear: { startsOn: "desc" } }, { name: "asc" }]
            }
          }
        })
      : null;
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { teacher: true }
  });
  const userLabel = user?.teacher ? `${user.teacher.name} ${user.teacher.surname}` : user?.username ?? "Χρήστης";

  const classChoices =
    session.role === "ADMIN"
      ? await prisma.class.findMany({
          include: { schoolYear: true },
          orderBy: [{ schoolYear: { startsOn: "desc" } }, { name: "asc" }]
        })
      : teacher?.responsibleClasses ?? [];
  const selectedClass =
    session.role === "TEACHER" && classChoices.length === 1 && !params.classId
      ? classChoices[0]
      : classChoices.find((classRecord) => classRecord.id === params.classId) ?? null;
  const shouldShowClassPicker = session.role === "ADMIN" || classChoices.length > 1;

  const [classes, absences, justificationRequests] = await Promise.all([
    selectedClass
      ? prisma.class.findMany({
          where: { id: selectedClass.id },
          include: {
            schoolYear: true,
            students: true
          },
          orderBy: [{ schoolYear: { startsOn: "desc" } }, { name: "asc" }]
        })
      : Promise.resolve([]),
    selectedClass
      ? prisma.attendanceSheetAbsence.findMany({
          where: {
            absent: true,
            status: { not: AbsenceStatus.REMOVED },
            sheet: { classId: selectedClass.id }
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
        })
      : Promise.resolve([]),
    selectedClass
      ? prisma.parentJustificationRequest.findMany({
          where: {
            sheet: { classId: selectedClass.id }
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
      : Promise.resolve([])
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
    <AppNavigation
      active="reports"
      role={session.role}
      title="Αναφορές απουσιών"
      subtitle="Σύνολα, δικαιολογήσεις και εξαγωγές ανά μαθητή"
      userLabel={userLabel}
    >
      {shouldShowClassPicker ? (
        <section className="admin-section">
          <div className="admin-section-title">
            <h2>Τμήμα</h2>
            <p>
              {session.role === "ADMIN"
                ? "Επιλέξτε τμήμα για προβολή αναφορών."
                : "Εμφανίζονται μόνο τμήματα στα οποία είστε υπεύθυνος/η."}
            </p>
          </div>
          <div className="class-tabs">
            {classChoices.map((classRecord) => (
              <Link
                className={selectedClass?.id === classRecord.id ? "class-tab active" : "class-tab"}
                href={`/reports?classId=${classRecord.id}`}
                key={classRecord.id}
              >
                {classRecord.name}
                <span>{classRecord.schoolYear.name}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {classChoices.length === 0 ? <div className="empty-state">Δεν είστε υπεύθυνος/η σε κάποιο τμήμα.</div> : null}

      {classChoices.length > 0 && !selectedClass ? (
        <div className="empty-state">Επιλέξτε τμήμα για να εμφανιστούν οι αναφορές.</div>
      ) : null}

      {selectedClass ? (
      <>
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
                  <span>
                    {dateLabel(absence.sheet.savedAt)}
                    {absence.isHourlyExpulsion ? " · Ωριαία αποβολή" : ""}
                  </span>
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
      </>
      ) : null}
    </AppNavigation>
  );
}
