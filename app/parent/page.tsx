import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AbsenceStatus, ParentJustificationStatus, ParentNotificationStatus } from "@prisma/client";
import { LogoutButton } from "@/app/logout-button";
import { requestAbsenceJustificationAction } from "@/app/parent/actions";
import { prisma } from "@/lib/prisma";
import { absenceStatusLabel, hourLabel, notificationStatusLabel, parentJustificationStatusLabel, weekDayLabel } from "@/lib/report-helpers";
import { parseSessionToken, sessionCookieName } from "@/lib/session";

function dateLabel(date: Date | null) {
  if (!date) return "Δεν έχει αποθηκευτεί";

  return new Intl.DateTimeFormat("el-GR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(date);
}

export default async function ParentPage() {
  const cookieStore = await cookies();
  const session = parseSessionToken(cookieStore.get(sessionCookieName)?.value);

  if (!session || session.role !== "PARENT") {
    redirect("/");
  }

  if (session.mustChangePassword) {
    redirect("/account/password");
  }

  const parent = await prisma.parent.findUnique({
    where: { userId: session.userId },
    include: {
      students: {
        include: {
          class: {
            include: { schoolYear: true }
          }
        },
        orderBy: [{ surname: "asc" }, { name: "asc" }]
      }
    }
  });

  if (!parent) {
    redirect("/");
  }

  const studentIds = parent.students.map((student) => student.id);
  const absences =
    studentIds.length > 0
      ? await prisma.attendanceSheetAbsence.findMany({
          where: {
            studentId: { in: studentIds },
            absent: true,
            status: { not: AbsenceStatus.REMOVED }
          },
          include: {
            student: true,
            sheet: {
              include: {
                class: {
                  include: { schoolYear: true }
                },
                course: true
              }
            }
          },
          orderBy: [{ sheet: { day: "asc" } }, { sheet: { hour: "asc" } }]
        })
      : [];
  const notifications = await prisma.parentNotification.findMany({
    where: { parentId: parent.id },
    include: {
      student: true
    },
    orderBy: [{ createdAt: "desc" }]
  });
  const justificationRequests = await prisma.parentJustificationRequest.findMany({
    where: { parentId: parent.id },
    include: {
      student: true,
      sheet: {
        include: {
          course: true,
          class: {
            include: { schoolYear: true }
          }
        }
      }
    },
    orderBy: [{ createdAt: "desc" }]
  });

  const markedCount = absences.filter((absence) => absence.status === AbsenceStatus.MARKED).length;
  const pendingRequestCount = justificationRequests.filter((request) => request.status === ParentJustificationStatus.PENDING).length;
  const requestByAbsenceKey = new Map(justificationRequests.map((request) => [`${request.sheetId}:${request.studentId}`, request]));
  const studentAbsenceStats = new Map(
    parent.students.map((student) => [
      student.id,
      {
        marked: absences.filter((absence) => absence.studentId === student.id && absence.status === AbsenceStatus.MARKED).length,
        excused: absences.filter((absence) => absence.studentId === student.id && absence.status === AbsenceStatus.EXCUSED).length,
        pending: justificationRequests.filter((request) => request.studentId === student.id && request.status === ParentJustificationStatus.PENDING).length
      }
    ])
  );

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <div className="brand">
          <div className="brand-mark">ΣΧ</div>
          <div>
            <h1>Πύλη γονέα</h1>
            <span>
              {parent.surname} {parent.name}
            </span>
          </div>
        </div>
        <div className="status-row">
          <Link className="primary-button" href="/api/reports/export">
            CSV εξαγωγή
          </Link>
          <LogoutButton />
        </div>
      </header>

      <div className="summary-grid">
        <div className="panel metric">
          <span>Μαθητές</span>
          <strong>{parent.students.length}</strong>
        </div>
        <div className="panel metric">
          <span>Ενεργές απουσίες</span>
          <strong>{absences.length}</strong>
        </div>
        <div className="panel metric">
          <span>Αδικαιολόγητες</span>
          <strong>{markedCount}</strong>
        </div>
        <div className="panel metric">
          <span>Ειδοποιήσεις</span>
          <strong>{notifications.length}</strong>
        </div>
        <div className="panel metric">
          <span>Αιτήματα σε έλεγχο</span>
          <strong>{pendingRequestCount}</strong>
        </div>
      </div>

      <section className="admin-section">
        <div className="admin-section-title">
          <h2>Μαθητές</h2>
          <p>Σύνδεση γονέα με μαθητές και τμήματα του σχολικού έτους.</p>
        </div>
        <div className="parent-student-grid">
          {parent.students.map((student) => (
            <article className="student-mini-card" key={student.id}>
              <div>
                <strong>
                  {student.surname} {student.name}
                </strong>
                <span>
                  {student.class.name} · {student.class.schoolYear.name}
                </span>
              </div>
              <div className="student-mini-stats">
                <span>{studentAbsenceStats.get(student.id)?.marked ?? 0} αδικαιολόγητες</span>
                <span>{studentAbsenceStats.get(student.id)?.excused ?? 0} δικαιολογημένες</span>
                <span>{studentAbsenceStats.get(student.id)?.pending ?? 0} σε έλεγχο</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="admin-section">
        <div className="admin-section-title">
          <h2>Απουσίες</h2>
          <p>Οι δικαιολογημένες απουσίες εμφανίζονται ξεχωριστά για άμεση εικόνα.</p>
        </div>
        <div className="absence-card-list">
          {absences.length > 0 ? (
            absences.map((absence) => {
              const request = requestByAbsenceKey.get(`${absence.sheetId}:${absence.studentId}`);
              return (
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
                  {request ? (
                    <div className="request-status-box">
                      <div>
                        <strong>{parentJustificationStatusLabel(request.status)}</strong>
                        <span>{dateLabel(request.createdAt)}</span>
                      </div>
                      <p>{request.reason}</p>
                      {request.schoolResponse ? <p>Απάντηση σχολείου: {request.schoolResponse}</p> : null}
                    </div>
                  ) : absence.status === AbsenceStatus.MARKED ? (
                    <form action={requestAbsenceJustificationAction} className="parent-request-form">
                      <input name="sheetId" type="hidden" value={absence.sheetId} />
                      <input name="studentId" type="hidden" value={absence.studentId} />
                      <label htmlFor={`reason-${absence.sheetId}-${absence.studentId}`}>Αίτημα δικαιολόγησης</label>
                      <textarea
                        id={`reason-${absence.sheetId}-${absence.studentId}`}
                        name="reason"
                        placeholder="Γράψτε σύντομα τον λόγο και τα δικαιολογητικά που θα προσκομιστούν"
                        required
                      />
                      <button className="secondary-button" type="submit">
                        Αποστολή αιτήματος
                      </button>
                    </form>
                  ) : null}
                </article>
              );
            })
          ) : (
            <div className="empty-state">Δεν υπάρχουν καταχωρισμένες απουσίες.</div>
          )}
        </div>
      </section>

      <section className="admin-section">
        <div className="admin-section-title">
          <h2>Αιτήματα δικαιολόγησης</h2>
          <p>Όλα τα αιτήματα που έχετε στείλει και η απάντηση του σχολείου.</p>
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
                    <span>{dateLabel(request.createdAt)}</span>
                  </div>
                  <span className={request.status === ParentJustificationStatus.APPROVED ? "sync-pill ready" : "sync-pill"}>
                    {parentJustificationStatusLabel(request.status)}
                  </span>
                </div>
                <p className="absence-reason">{request.reason}</p>
                {request.schoolResponse ? <p className="absence-reason">Απάντηση σχολείου: {request.schoolResponse}</p> : null}
              </article>
            ))
          ) : (
            <div className="empty-state">Δεν έχουν σταλεί αιτήματα δικαιολόγησης.</div>
          )}
        </div>
      </section>

      <section className="admin-section">
        <div className="admin-section-title">
          <h2>Ενημερώσεις σχολείου</h2>
          <p>Ιστορικό ενημερώσεων που δημιουργήθηκαν από το σχολείο για τις απουσίες.</p>
        </div>
        <div className="absence-card-list">
          {notifications.length > 0 ? (
            notifications.map((notification) => (
              <article className="absence-card" key={notification.id}>
                <div className="absence-card-main">
                  <div>
                    <strong>{notification.subject}</strong>
                    <span>
                      {notification.student.surname} {notification.student.name}
                    </span>
                  </div>
                  <div>
                    <strong>{dateLabel(notification.createdAt)}</strong>
                    <span>{notification.sentAt ? `Στάλθηκε ${dateLabel(notification.sentAt)}` : "Δεν έχει σημειωθεί ως σταλμένο"}</span>
                  </div>
                  <span className={notification.status === ParentNotificationStatus.SENT ? "sync-pill ready" : "sync-pill"}>
                    {notificationStatusLabel(notification.status)}
                  </span>
                </div>
                <p className="absence-reason">{notification.body}</p>
              </article>
            ))
          ) : (
            <div className="empty-state">Δεν υπάρχουν ενημερώσεις.</div>
          )}
        </div>
      </section>
    </main>
  );
}
