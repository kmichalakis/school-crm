import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppNavigation } from "@/app/app-navigation";
import {
  addBlockedDayAction,
  addTeacherUnavailableDayAction,
  deleteBlockedDayAction,
  deleteTeacherUnavailableDayAction,
  saveAppointmentCapacityAction,
  saveOfficeHoursAction
} from "@/app/appointment-settings/actions";
import { appointmentDateLabel } from "@/lib/appointments";
import { dateInputValue } from "@/lib/school-calendar";
import { prisma } from "@/lib/prisma";
import { hourLabel } from "@/lib/report-helpers";
import { parseSessionToken, sessionCookieName } from "@/lib/session";
import { schoolHours, weekDays } from "@/lib/school-time";

type AppointmentSettingsPageProps = {
  searchParams: Promise<{
    history?: string;
    notice?: string;
    noticeType?: string;
    tab?: string;
  }>;
};

export const dynamic = "force-dynamic";

type AppointmentSettingsTab = "general" | "hours" | "absences" | "cancellations";

function validTab(value: string | undefined, isAdmin: boolean): AppointmentSettingsTab {
  if (!isAdmin) {
    return "hours";
  }
  if (value === "hours" || value === "absences" || value === "cancellations") {
    return value;
  }
  return "general";
}

export default async function AppointmentSettingsPage({ searchParams }: AppointmentSettingsPageProps) {
  const cookieStore = await cookies();
  const session = parseSessionToken(cookieStore.get(sessionCookieName)?.value);

  if (!session || session.mustChangePassword || (session.role !== "ADMIN" && session.role !== "TEACHER")) {
    redirect("/");
  }

  const params = await searchParams;
  const notice = params.notice ?? "";
  const noticeType = params.noticeType === "error" ? "error" : "success";
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { teacher: true }
  });
  const currentTeacher = user?.teacher ?? null;
  const userLabel = currentTeacher ? `${currentTeacher.name} ${currentTeacher.surname}` : user?.username ?? "Χρήστης";
  const isAdmin = session.role === "ADMIN";
  const activeTab = validTab(params.tab, isAdmin);
  const historyMode = params.history ?? "";
  const [setting, teachers, unavailableDays, blockedDays] = await Promise.all([
    isAdmin && activeTab === "general" ? prisma.appointmentSetting.findFirst({ orderBy: { createdAt: "asc" } }) : Promise.resolve(null),
    activeTab === "hours" || activeTab === "absences"
      ? prisma.teacher.findMany({
          where: isAdmin ? undefined : currentTeacher ? { id: currentTeacher.id } : { id: "__missing__" },
          include: {
            officeHours: {
              orderBy: [{ day: "asc" }, { hour: "asc" }]
            }
          },
          orderBy: [{ surname: "asc" }, { name: "asc" }]
        })
      : Promise.resolve([]),
    isAdmin && activeTab === "absences"
      ? prisma.teacherUnavailableDay.findMany({
          include: { teacher: true },
          orderBy: [{ date: "desc" }, { teacher: { surname: "asc" } }]
        })
      : Promise.resolve([]),
    isAdmin && activeTab === "cancellations"
      ? prisma.appointmentBlockedDay.findMany({
          orderBy: { date: "desc" }
        })
      : Promise.resolve([])
  ]);

  const maxPerTeacherSlot = setting?.maxPerTeacherSlot ?? 1;
  const today = dateInputValue(new Date());
  const futureUnavailableDays = unavailableDays.filter((day) => dateInputValue(day.date) >= today);
  const pastUnavailableDays = unavailableDays.filter((day) => dateInputValue(day.date) < today);
  const futureBlockedDays = blockedDays.filter((day) => dateInputValue(day.date) >= today);
  const pastBlockedDays = blockedDays.filter((day) => dateInputValue(day.date) < today);

  return (
    <AppNavigation
      active="appointment-settings"
      role={session.role}
      title="Ώρες γονέων"
      subtitle="Ορισμός διαθεσιμότητας εκπαιδευτικών για ραντεβού"
      userLabel={userLabel}
    >
      {notice ? (
        <div className={noticeType === "error" ? "status-message error" : "status-message success"}>
          <span className="status-message-main">
            <strong>{noticeType === "error" ? "Σφάλμα" : "Ενημέρωση"}</strong>
            {notice}
          </span>
        </div>
      ) : null}

      {isAdmin ? (
        <nav className="admin-tabs" aria-label="Κατηγορίες ωρών γονέων">
          <Link className={activeTab === "general" ? "admin-tab active" : "admin-tab"} href="/appointment-settings?tab=general">
            Γενικές ρυθμίσεις
          </Link>
          <Link className={activeTab === "hours" ? "admin-tab active" : "admin-tab"} href="/appointment-settings?tab=hours">
            Ώρες γονέων
          </Link>
          <Link className={activeTab === "absences" ? "admin-tab active" : "admin-tab"} href="/appointment-settings?tab=absences">
            Απουσίες εκπαιδευτικών
          </Link>
          <Link className={activeTab === "cancellations" ? "admin-tab active" : "admin-tab"} href="/appointment-settings?tab=cancellations">
            Ακυρώσεις
          </Link>
        </nav>
      ) : null}

      {isAdmin && activeTab === "general" ? (
        <section className="admin-section">
          <div className="admin-section-title">
            <h2>Γενικές ρυθμίσεις</h2>
            <p>Το όριο ισχύει για κάθε εκπαιδευτικό και κάθε δεσμευμένη ώρα γονέων.</p>
          </div>
          <form action={saveAppointmentCapacityAction} className="admin-form compact-form">
            <input name="tab" type="hidden" value="general" />
            <label>
              Ραντεβού ανά εκπαιδευτικό/ώρα
              <input min="1" max="20" name="maxPerTeacherSlot" type="number" defaultValue={maxPerTeacherSlot} />
            </label>
            <button className="primary-button" type="submit">
              Αποθήκευση
            </button>
          </form>
        </section>
      ) : null}

      {activeTab === "hours" ? (
      <section className="admin-section">
        <div className="admin-section-title">
          <h2>{isAdmin ? "Εκπαιδευτικοί και ώρες γονέων" : "Οι ώρες γονέων μου"}</h2>
          <p>Οι διαθέσιμες επιλογές είναι οι ίδιες με τις ώρες μαθημάτων και ισχύουν εβδομαδιαία.</p>
        </div>
        <div className="office-hours-list">
          {teachers.map((teacher) => {
            const selectedSlots = new Set(teacher.officeHours.map((slot) => `${slot.day}:${slot.hour}`));
            return (
              <form action={saveOfficeHoursAction} className="office-hours-card" key={teacher.id}>
                <input name="tab" type="hidden" value="hours" />
                <input name="teacherId" type="hidden" value={teacher.id} />
                <div className="office-hours-card-title">
                  <strong>
                    {teacher.surname} {teacher.name}
                  </strong>
                  <span>ΑΜ {teacher.am}</span>
                </div>
                <div className="office-hours-grid">
                  {weekDays.map((day) => (
                    <div className="office-hours-day" key={day.value}>
                      <strong>{day.label}</strong>
                      <div>
                        {schoolHours.map((slot) => {
                          const value = `${day.value}:${slot.hour}`;
                          return (
                            <label className="checkbox-pill" key={value}>
                              <input defaultChecked={selectedSlots.has(value)} name="slot" type="checkbox" value={value} />
                              {hourLabel(slot.hour)}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="section-actions">
                  <button className="primary-button" type="submit">
                    Αποθήκευση ωρών
                  </button>
                </div>
              </form>
            );
          })}
        </div>
      </section>
      ) : null}

      {isAdmin && activeTab === "absences" ? (
          <section className="admin-section">
            <div className="admin-section-title">
              <h2>Απουσίες εκπαιδευτικών</h2>
              <p>Ο εκπαιδευτικός φαίνεται στους γονείς με διακριτή διαγραφή και δεν μπορεί να επιλεγεί.</p>
            </div>
            <form action={addTeacherUnavailableDayAction} className="admin-form grid-form">
              <input name="tab" type="hidden" value="absences" />
              <label>
                Εκπαιδευτικός
                <select name="teacherId" required>
                  {teachers.map((teacher) => (
                    <option key={teacher.id} value={teacher.id}>
                      {teacher.surname} {teacher.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Ημερομηνία
                <input name="date" type="date" required />
              </label>
              <label>
                Αιτία
                <input name="reason" placeholder="π.χ. άδεια, επιμόρφωση" />
              </label>
              <button className="primary-button" type="submit">
                Δήλωση απουσίας
              </button>
            </form>
            <div className="appointment-list">
              {futureUnavailableDays.length > 0 ? (
                futureUnavailableDays.map((day) => (
                  <article className="appointment-row" key={day.id}>
                    <div>
                      <strong>{appointmentDateLabel(dateInputValue(day.date))}</strong>
                      <span>
                        {day.teacher.surname} {day.teacher.name}
                      </span>
                    </div>
                    <span>{day.reason || "Χωρίς αιτία"}</span>
                    <form action={deleteTeacherUnavailableDayAction}>
                      <input name="tab" type="hidden" value="absences" />
                      <input name="id" type="hidden" value={day.id} />
                      <button className="secondary-button danger" type="submit">
                        Διαγραφή
                      </button>
                    </form>
                  </article>
                ))
              ) : (
                <div className="empty-state">Δεν υπάρχουν μελλοντικές απουσίες εκπαιδευτικών.</div>
              )}
            </div>
            <div className="section-actions">
              <Link
                className="secondary-button"
                href={historyMode === "absences" ? "/appointment-settings?tab=absences" : "/appointment-settings?tab=absences&history=absences"}
              >
                {historyMode === "absences" ? "Απόκρυψη ιστορικού" : "Ιστορικό"}
              </Link>
            </div>
            {historyMode === "absences" ? (
              <div className="appointment-list">
                {pastUnavailableDays.length > 0 ? (
                  pastUnavailableDays.map((day) => (
                    <article className="appointment-row cancelled" key={day.id}>
                      <div>
                        <strong>{appointmentDateLabel(dateInputValue(day.date))}</strong>
                        <span>
                          {day.teacher.surname} {day.teacher.name}
                        </span>
                      </div>
                      <span>{day.reason || "Χωρίς αιτία"}</span>
                      <span className="sync-pill">Ιστορικό</span>
                    </article>
                  ))
                ) : (
                  <div className="empty-state">Δεν υπάρχει παλιό ιστορικό απουσιών εκπαιδευτικών.</div>
                )}
              </div>
            ) : null}
          </section>
      ) : null}

      {isAdmin && activeTab === "cancellations" ? (
          <section className="admin-section">
            <div className="admin-section-title">
              <h2>Ακύρωση ημέρας ραντεβού</h2>
              <p>Χρήσιμο για εκδρομές, αργίες ή ημέρες που δεν θα γίνουν καθόλου ραντεβού.</p>
            </div>
            <form action={addBlockedDayAction} className="admin-form grid-form">
              <input name="tab" type="hidden" value="cancellations" />
              <label>
                Ημερομηνία
                <input name="date" type="date" required />
              </label>
              <label>
                Αιτία
                <input name="reason" placeholder="π.χ. εκδρομή" />
              </label>
              <button className="primary-button" type="submit">
                Ακύρωση ημέρας
              </button>
            </form>
            <div className="appointment-list">
              {futureBlockedDays.length > 0 ? (
                futureBlockedDays.map((day) => (
                  <article className="appointment-row" key={day.id}>
                    <div>
                      <strong>{appointmentDateLabel(dateInputValue(day.date))}</strong>
                      <span>{day.reason || "Χωρίς αιτία"}</span>
                    </div>
                    <span className="sync-pill">Ολόκληρη ημέρα</span>
                    <form action={deleteBlockedDayAction}>
                      <input name="tab" type="hidden" value="cancellations" />
                      <input name="id" type="hidden" value={day.id} />
                      <button className="secondary-button danger" type="submit">
                        Διαγραφή
                      </button>
                    </form>
                  </article>
                ))
              ) : (
                <div className="empty-state">Δεν υπάρχουν μελλοντικές ακυρωμένες ημέρες ραντεβού.</div>
              )}
            </div>
            <div className="section-actions">
              <Link
                className="secondary-button"
                href={historyMode === "cancellations" ? "/appointment-settings?tab=cancellations" : "/appointment-settings?tab=cancellations&history=cancellations"}
              >
                {historyMode === "cancellations" ? "Απόκρυψη ιστορικού" : "Ιστορικό"}
              </Link>
            </div>
            {historyMode === "cancellations" ? (
              <div className="appointment-list">
                {pastBlockedDays.length > 0 ? (
                  pastBlockedDays.map((day) => (
                    <article className="appointment-row cancelled" key={day.id}>
                      <div>
                        <strong>{appointmentDateLabel(dateInputValue(day.date))}</strong>
                        <span>{day.reason || "Χωρίς αιτία"}</span>
                      </div>
                      <span className="sync-pill">Ιστορικό</span>
                    </article>
                  ))
                ) : (
                  <div className="empty-state">Δεν υπάρχει παλιό ιστορικό ακυρωμένων ημερών.</div>
                )}
              </div>
            ) : null}
          </section>
      ) : null}
    </AppNavigation>
  );
}
