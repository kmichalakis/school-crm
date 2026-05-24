import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { EmailTrigger, ParentNotificationStatus } from "@prisma/client";
import { AppNavigation } from "@/app/app-navigation";
import {
  generateParentNotificationsAction,
  markAllQueuedSentAction,
  setNotificationStatusAction,
  upsertEmailRuleAction
} from "@/app/notifications/actions";
import { prisma } from "@/lib/prisma";
import { emailTriggerLabel, notificationStatusLabel } from "@/lib/report-helpers";
import { parseSessionToken, sessionCookieName } from "@/lib/session";

function dateLabel(date: Date | null) {
  if (!date) return "-";

  return new Intl.DateTimeFormat("el-GR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(date);
}

export default async function NotificationsPage() {
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
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { teacher: true }
  });
  const userLabel = user?.teacher ? `${user.teacher.name} ${user.teacher.surname}` : user?.username ?? "Χρήστης";

  const allowedClassIds =
    session.role === "ADMIN"
      ? undefined
      : Array.from(
          new Set([
            ...(teacher?.homeClassId ? [teacher.homeClassId] : []),
            ...(teacher?.courses.map((courseLink) => courseLink.course.classId) ?? [])
          ])
        );

  const [notifications, rules] = await Promise.all([
    prisma.parentNotification.findMany({
      where: allowedClassIds ? { student: { classId: { in: allowedClassIds } } } : undefined,
      include: {
        parent: true,
        student: {
          include: {
            class: {
              include: { schoolYear: true }
            }
          }
        }
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }]
    }),
    prisma.emailRule.findMany({
      orderBy: [{ enabled: "desc" }, { createdAt: "asc" }]
    })
  ]);

  const queuedCount = notifications.filter((notification) => notification.status === ParentNotificationStatus.QUEUED).length;
  const sentCount = notifications.filter((notification) => notification.status === ParentNotificationStatus.SENT).length;
  const dismissedCount = notifications.filter((notification) => notification.status === ParentNotificationStatus.DISMISSED).length;

  return (
    <AppNavigation
      active="notifications"
      role={session.role}
      title="Ειδοποιήσεις γονέων"
      subtitle="Προεπισκόπηση και παρακολούθηση ενημερώσεων απουσιών"
      userLabel={userLabel}
    >

      <div className="summary-grid">
        <div className="panel metric">
          <span>Σε αναμονή</span>
          <strong>{queuedCount}</strong>
        </div>
        <div className="panel metric">
          <span>Στάλθηκαν</span>
          <strong>{sentCount}</strong>
        </div>
        <div className="panel metric">
          <span>Παραλείφθηκαν</span>
          <strong>{dismissedCount}</strong>
        </div>
        <div className="panel metric">
          <span>Κανόνες</span>
          <strong>{rules.length}</strong>
        </div>
      </div>

      <section className="admin-section">
        <div className="admin-section-title">
          <h2>Παραγωγή ειδοποιήσεων</h2>
          <p>Δημιουργεί εγγραφές από τις τρέχουσες απουσίες και τους ενεργούς κανόνες, χωρίς διπλοεγγραφές.</p>
        </div>
        <div className="teacher-actions">
          <form action={generateParentNotificationsAction}>
            <button className="primary-button" type="submit">
              Δημιουργία ειδοποιήσεων
            </button>
          </form>
          <form action={markAllQueuedSentAction}>
            <button className="secondary-button" type="submit">
              Σήμανση όλων ως στάλθηκαν
            </button>
          </form>
        </div>
      </section>

      {session.role === "ADMIN" ? (
        <section className="admin-section">
          <div className="admin-section-title">
            <h2>Κανόνες ειδοποιήσεων</h2>
            <p>Οι κανόνες καθορίζουν πότε μπαίνει μια ενημέρωση στην ουρά.</p>
          </div>

          <form action={upsertEmailRuleAction} className="admin-form grid-form">
            <input name="name" placeholder="Όνομα κανόνα" required />
            <select name="trigger" defaultValue={EmailTrigger.FIRST_HOUR_ABSENCE}>
              {Object.values(EmailTrigger).map((trigger) => (
                <option key={trigger} value={trigger}>
                  {emailTriggerLabel(trigger)}
                </option>
              ))}
            </select>
            <input min="1" name="thresholdCount" placeholder="όριο, αν χρειάζεται" type="number" />
            <label className="check-field">
              <input name="enabled" type="checkbox" defaultChecked />
              Ενεργός
            </label>
            <button className="primary-button" type="submit">
              Προσθήκη κανόνα
            </button>
          </form>

          <div className="admin-table">
            {rules.map((rule) => (
              <form action={upsertEmailRuleAction} className="admin-row editable-row" key={rule.id}>
                <input name="id" type="hidden" value={rule.id} />
                <input name="name" defaultValue={rule.name} required />
                <select name="trigger" defaultValue={rule.trigger}>
                  {Object.values(EmailTrigger).map((trigger) => (
                    <option key={trigger} value={trigger}>
                      {emailTriggerLabel(trigger)}
                    </option>
                  ))}
                </select>
                <input min="1" name="thresholdCount" defaultValue={rule.thresholdCount ?? ""} placeholder="όριο" type="number" />
                <label className="check-field">
                  <input name="enabled" type="checkbox" defaultChecked={rule.enabled} />
                  Ενεργός
                </label>
                <span>{dateLabel(rule.updatedAt)}</span>
                <button className="secondary-button" type="submit">
                  Αποθήκευση
                </button>
              </form>
            ))}
          </div>
        </section>
      ) : null}

      <section className="admin-section">
        <div className="admin-section-title">
          <h2>Ουρά ειδοποιήσεων</h2>
          <p>Η πραγματική αποστολή email θα συνδεθεί αργότερα. Προς το παρόν κρατάμε καθαρό ιστορικό.</p>
        </div>

        <div className="absence-card-list">
          {notifications.length > 0 ? (
            notifications.map((notification) => (
              <article className="absence-card" key={notification.id}>
                <div className="absence-card-main">
                  <div>
                    <strong>{notification.subject}</strong>
                    <span>
                      Προς: {notification.parent.email} · {notification.parent.surname} {notification.parent.name}
                    </span>
                  </div>
                  <div>
                    <strong>
                      {notification.student.surname} {notification.student.name}
                    </strong>
                    <span>
                      {notification.student.class.name} ({notification.student.class.schoolYear.name})
                    </span>
                  </div>
                  <span className={notification.status === ParentNotificationStatus.SENT ? "sync-pill ready" : "sync-pill"}>
                    {notificationStatusLabel(notification.status)}
                  </span>
                </div>
                <p className="absence-reason">{notification.body}</p>
                <div className="absence-actions">
                  <form action={setNotificationStatusAction}>
                    <input name="id" type="hidden" value={notification.id} />
                    <input name="status" type="hidden" value="SENT" />
                    <button className="secondary-button" type="submit">
                      Στάλθηκε
                    </button>
                  </form>
                  <form action={setNotificationStatusAction}>
                    <input name="id" type="hidden" value={notification.id} />
                    <input name="status" type="hidden" value="QUEUED" />
                    <button className="secondary-button" type="submit">
                      Αναμονή
                    </button>
                  </form>
                  <form action={setNotificationStatusAction}>
                    <input name="id" type="hidden" value={notification.id} />
                    <input name="status" type="hidden" value="DISMISSED" />
                    <button className="secondary-button danger" type="submit">
                      Παράλειψη
                    </button>
                  </form>
                  <span className="pill">Δημιουργήθηκε {dateLabel(notification.createdAt)}</span>
                </div>
              </article>
            ))
          ) : (
            <div className="empty-state">Δεν υπάρχουν ειδοποιήσεις στην ουρά.</div>
          )}
        </div>
      </section>
    </AppNavigation>
  );
}
