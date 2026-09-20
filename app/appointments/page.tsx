import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppointmentStatus, type WeekDay } from "@prisma/client";
import { AppNavigation } from "@/app/app-navigation";
import { cancelAppointmentByAdminAction } from "@/app/appointments/actions";
import { appointmentDate, appointmentDateLabel, appointmentStatusLabel, getAppointmentSetting, nextWeekdayDate } from "@/lib/appointments";
import { appointmentWhereForSession, loadAppointmentRows, type AppointmentRow, validAppointmentDate } from "@/lib/appointment-queries";
import { dateInputValue } from "@/lib/school-calendar";
import { prisma } from "@/lib/prisma";
import { hourLabel } from "@/lib/report-helpers";
import { parseSessionToken, sessionCookieName } from "@/lib/session";
import { dateToWeekDay } from "@/lib/school-time";

type AppointmentsPageProps = {
  searchParams: Promise<{
    date?: string;
    tab?: string;
    teacherId?: string;
    notice?: string;
    noticeType?: string;
  }>;
};

export const dynamic = "force-dynamic";

export default async function AppointmentsPage({ searchParams }: AppointmentsPageProps) {
  const cookieStore = await cookies();
  const session = parseSessionToken(cookieStore.get(sessionCookieName)?.value);

  if (!session || session.mustChangePassword || !["ADMIN", "TEACHER", "SCHOOL_OFFICE"].includes(session.role)) {
    redirect("/");
  }

  const params = await searchParams;
  const selectedDate = validAppointmentDate(params.date, nextWeekdayDate());
  const activeAdminTab = params.tab === "dashboard" ? "dashboard" : "appointments";
  const notice = params.notice ?? "";
  const noticeType = params.noticeType === "error" ? "error" : "success";
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { teacher: true }
  });
  const currentTeacher = user?.teacher ?? null;
  const userLabel = currentTeacher ? `${currentTeacher.name} ${currentTeacher.surname}` : user?.username ?? "Χρήστης";
  const isAdmin = session.role === "ADMIN";
  const isSchoolOffice = session.role === "SCHOOL_OFFICE";
  const isTeacherOverviewAccount = isSchoolOffice && user?.username === "teachers";
  const usesAdminAppointmentView = isAdmin || isTeacherOverviewAccount;
  const canSelectTeacher = isAdmin || isSchoolOffice;
  const teachers = canSelectTeacher
    ? await prisma.teacher.findMany({ orderBy: [{ surname: "asc" }, { name: "asc" }] })
    : [];
  const selectedTeacherId = canSelectTeacher ? params.teacherId ?? "" : currentTeacher?.id ?? "";
  const showAllDaysForTeacher = canSelectTeacher && Boolean(selectedTeacherId);
  const today = dateInputValue(new Date());
  const selectedDay = dateToWeekDay(selectedDate) as WeekDay | null;

  if (session.role === "TEACHER" && !currentTeacher) {
    redirect("/");
  }

  const appointmentQuery = await appointmentWhereForSession({
    date: selectedDate,
    role: session.role,
    selectedTeacherId,
    sessionUserId: session.userId,
    today
  });
  const appointmentExportParams = new URLSearchParams({ date: selectedDate });
  if (selectedTeacherId) {
    appointmentExportParams.set("teacherId", selectedTeacherId);
  }
  const appointments = canSelectTeacher ? await loadAppointmentRows(appointmentQuery.where, appointmentQuery.showAllDaysForTeacher) : [];
  const teacherAppointments = !canSelectTeacher && currentTeacher ? await loadAppointmentRows(appointmentQuery.where, false) : [];
  const todayTeacherAppointments = teacherAppointments.filter((appointment) => dateInputValue(appointment.date) === today);
  const upcomingTeacherAppointments = teacherAppointments.filter((appointment) => dateInputValue(appointment.date) > today);
  const groupedAppointmentsByHour = new Map<number, AppointmentRow[]>();
  for (const appointment of appointments) {
    groupedAppointmentsByHour.set(appointment.hour, [...(groupedAppointmentsByHour.get(appointment.hour) ?? []), appointment]);
  }
  const groupedAppointmentsByDate = new Map<string, AppointmentRow[]>();
  for (const appointment of appointments) {
    const dateValue = dateInputValue(appointment.date);
    groupedAppointmentsByDate.set(dateValue, [...(groupedAppointmentsByDate.get(dateValue) ?? []), appointment]);
  }

  const [appointmentSetting, dashboardOfficeHours, dashboardCounts, dashboardUnavailableDays, dashboardBlockedDay] =
    usesAdminAppointmentView && !showAllDaysForTeacher && selectedDay
      ? await Promise.all([
          getAppointmentSetting(),
          prisma.teacherOfficeHour.findMany({
            where: { day: selectedDay },
            include: { teacher: true },
            orderBy: [{ teacher: { surname: "asc" } }, { teacher: { name: "asc" } }, { hour: "asc" }]
          }),
          prisma.parentTeacherAppointment.groupBy({
            by: ["teacherId", "hour"],
            where: {
              date: appointmentDate(selectedDate),
              status: AppointmentStatus.BOOKED
            },
            _count: { _all: true }
          }),
          prisma.teacherUnavailableDay.findMany({
            where: { date: appointmentDate(selectedDate) }
          }),
          prisma.appointmentBlockedDay.findUnique({
            where: { date: appointmentDate(selectedDate) }
          })
        ])
      : [null, [], [], [], null];
  const dashboardCountBySlot = new Map(dashboardCounts.map((entry) => [`${entry.teacherId}:${entry.hour}`, entry._count._all]));
  const unavailableTeacherIds = new Set(dashboardUnavailableDays.map((day) => day.teacherId));
  const capacityPerSlot = appointmentSetting?.maxPerTeacherSlot ?? 1;
  const dashboardStats = Array.from(
    dashboardOfficeHours.reduce((map, officeHour) => {
      const current = map.get(officeHour.teacherId) ?? {
        teacherId: officeHour.teacherId,
        teacherName: `${officeHour.teacher.surname} ${officeHour.teacher.name}`,
        hours: [] as number[],
        booked: 0,
        capacity: 0,
        fullSlots: 0,
        unavailable: unavailableTeacherIds.has(officeHour.teacherId)
      };
      const booked = dashboardCountBySlot.get(`${officeHour.teacherId}:${officeHour.hour}`) ?? 0;
      current.hours.push(officeHour.hour);
      if (!current.unavailable && !dashboardBlockedDay) {
        current.booked += booked;
        current.capacity += capacityPerSlot;
        current.fullSlots += booked >= capacityPerSlot ? 1 : 0;
      }
      map.set(officeHour.teacherId, current);
      return map;
    }, new Map<string, { teacherId: string; teacherName: string; hours: number[]; booked: number; capacity: number; fullSlots: number; unavailable: boolean }>())
  ).map(([, stat]) => stat);
  const totalCapacity = dashboardStats.reduce((sum, stat) => sum + stat.capacity, 0);
  const totalBooked = dashboardStats.reduce((sum, stat) => sum + stat.booked, 0);
  const fullSlots = dashboardStats.reduce((sum, stat) => sum + stat.fullSlots, 0);
  const availableSlots = Math.max(0, totalCapacity - totalBooked);
  const fullnessPercent = totalCapacity > 0 ? Math.round((totalBooked / totalCapacity) * 100) : 0;
  const title = isTeacherOverviewAccount ? "Ραντεβού εκπαιδευτικών" : isSchoolOffice ? "Ραντεβού σχολείου" : "Ραντεβού";

  function adminTabHref(tab: "appointments" | "dashboard") {
    const tabParams = new URLSearchParams();
    if (tab === "dashboard") {
      tabParams.set("tab", "dashboard");
    }
    tabParams.set("date", selectedDate);
    if (selectedTeacherId) {
      tabParams.set("teacherId", selectedTeacherId);
    }
    return `/appointments?${tabParams.toString()}`;
  }

  function renderAppointment(appointment: AppointmentRow, allowAdminCancel: boolean) {
    const dateValue = dateInputValue(appointment.date);
    const isCancelled = appointment.status !== AppointmentStatus.BOOKED;
    return (
      <article className={isCancelled ? "appointment-row cancelled" : "appointment-row"} key={appointment.id}>
        <div>
          <strong>
            {appointmentDateLabel(dateValue, appointment.day)} · {hourLabel(appointment.hour)}
          </strong>
          <span>
            Εκπαιδευτικός: {appointment.teacher.surname} {appointment.teacher.name}
          </span>
          <span>
            Μαθητής/τρια: {appointment.student.surname} {appointment.student.name} · {appointment.student.class.name}
          </span>
          <span>
            Γονέας: {appointment.parent.surname} {appointment.parent.name} · {appointment.parent.email}
          </span>
          {appointment.cancellationReason ? <span>{appointment.cancellationReason}</span> : null}
        </div>
        <span className={isCancelled ? "sync-pill" : "sync-pill ready"}>{appointmentStatusLabel(appointment.status)}</span>
        {allowAdminCancel && !isCancelled ? (
          <form action={cancelAppointmentByAdminAction} className="appointment-cancel-form">
            <input name="id" type="hidden" value={appointment.id} />
            <input name="date" type="hidden" value={selectedDate} />
            <input name="teacherId" type="hidden" value={selectedTeacherId} />
            <input name="reason" placeholder="Αιτία ακύρωσης" />
            <button className="secondary-button danger" type="submit">
              Ακύρωση
            </button>
          </form>
        ) : null}
      </article>
    );
  }

  return (
    <AppNavigation
      active="appointments"
      role={session.role}
      title={title}
      subtitle={showAllDaysForTeacher ? "Όλα τα ραντεβού του επιλεγμένου εκπαιδευτικού" : "Ραντεβού επιλεγμένης ημέρας"}
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

      {usesAdminAppointmentView ? (
        <>
          <nav className="admin-tabs" aria-label="Προβολές ραντεβού">
            <Link className={activeAdminTab === "appointments" ? "admin-tab active" : "admin-tab"} href={adminTabHref("appointments")}>
              Ραντεβού
            </Link>
            <Link className={activeAdminTab === "dashboard" ? "admin-tab active" : "admin-tab"} href={adminTabHref("dashboard")}>
              Dashboard
            </Link>
          </nav>

          {activeAdminTab === "appointments" ? (
            <>
              <section className="admin-section">
                <div className="admin-section-title">
                  <h2>{showAllDaysForTeacher ? "Ραντεβού εκπαιδευτικού" : appointmentDateLabel(selectedDate, selectedDay)}</h2>
                  <p>{appointments.length} εγγραφές</p>
                </div>
                <div className="appointment-list">
                  {appointments.length > 0 ? appointments.map((appointment) => renderAppointment(appointment, isAdmin)) : <div className="empty-state">Δεν υπάρχουν ραντεβού με τα επιλεγμένα φίλτρα.</div>}
                </div>
              </section>

              <section className="admin-section">
                <div className="admin-section-title">
                  <h2>Φίλτρα</h2>
                  <p>Επιλέξτε ημερομηνία για την ημερήσια εικόνα ή εκπαιδευτικό για όλα τα ραντεβού του.</p>
                </div>
                <form className="admin-form grid-form" method="get">
                  <label>
                    Ημερομηνία
                    <input name="date" type="date" defaultValue={selectedDate} />
                  </label>
                  <label>
                    Εκπαιδευτικός
                    <select name="teacherId" defaultValue={selectedTeacherId}>
                      <option value="">Όλοι στην ημερομηνία</option>
                      {teachers.map((teacher) => (
                        <option key={teacher.id} value={teacher.id}>
                          {teacher.surname} {teacher.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="primary-button" type="submit">
                    Προβολή
                  </button>
                </form>
              </section>
            </>
          ) : (
            <section className="admin-section">
              <div className="admin-section-title">
                <h2>Dashboard πληρότητας</h2>
                <p>
                  {dashboardBlockedDay
                    ? `Η ημέρα έχει ακυρωθεί${dashboardBlockedDay.reason ? `: ${dashboardBlockedDay.reason}` : "."}`
                    : `Πληρότητα για ${appointmentDateLabel(selectedDate, selectedDay)}.`}
                </p>
              </div>
              <div className="appointment-dashboard-grid">
                <article className="appointment-dashboard-card">
                  <span>Κρατήσεις</span>
                  <strong>{totalBooked}</strong>
                </article>
                <article className="appointment-dashboard-card">
                  <span>Διαθέσιμες θέσεις</span>
                  <strong>{availableSlots}</strong>
                </article>
                <article className="appointment-dashboard-card">
                  <span>Πληρότητα</span>
                  <strong>{fullnessPercent}%</strong>
                </article>
                <article className="appointment-dashboard-card">
                  <span>Πλήρεις ώρες</span>
                  <strong>{fullSlots}</strong>
                </article>
              </div>
              <div className="appointment-fullness-list">
                {dashboardStats.length > 0 ? (
                  dashboardStats.map((stat) => (
                    <article className="appointment-fullness-row" key={stat.teacherId}>
                      <div>
                        <strong>{stat.teacherName}</strong>
                        <span>{stat.hours.map(hourLabel).join(", ")}</span>
                      </div>
                      {stat.unavailable ? (
                        <span className="sync-pill">Μη διαθέσιμος/η</span>
                      ) : (
                        <>
                          <span>{stat.booked}/{stat.capacity}</span>
                          <progress max={stat.capacity || 1} value={stat.booked} />
                        </>
                      )}
                    </article>
                  ))
                ) : (
                  <div className="empty-state">{selectedDay ? "Δεν έχουν οριστεί ώρες γονέων για αυτή την ημέρα." : "Η ημερομηνία δεν είναι εργάσιμη ημέρα."}</div>
                )}
              </div>
            </section>
          )}
        </>
      ) : isSchoolOffice ? (
        <>
          <section className="admin-section">
            <div className="admin-section-title">
              <h2>Ημερήσια εικόνα γραμματείας</h2>
              <p>Ομαδοποίηση ανά ώρα για γρήγορη υποδοχή γονέων.</p>
            </div>
            <form className="admin-form grid-form" method="get">
              <label>
                Ημερομηνία
                <input name="date" type="date" defaultValue={selectedDate} />
              </label>
              <label>
                Εκπαιδευτικός
                <select name="teacherId" defaultValue={selectedTeacherId}>
                  <option value="">Όλοι στην ημερομηνία</option>
                  {teachers.map((teacher) => (
                    <option key={teacher.id} value={teacher.id}>
                      {teacher.surname} {teacher.name}
                    </option>
                  ))}
                </select>
              </label>
              <button className="primary-button" type="submit">
                Προβολή
              </button>
            </form>
            <div className="section-actions">
              <Link className="secondary-button" href={`/print/appointments?${appointmentExportParams.toString()}`}>
                Εκτύπωση / PDF
              </Link>
              <Link className="secondary-button" href={`/api/appointments/export?${appointmentExportParams.toString()}`}>
                CSV εξαγωγή
              </Link>
            </div>
          </section>

          {showAllDaysForTeacher ? (
            <section className="admin-section">
              <div className="admin-section-title">
                <h2>Ραντεβού εκπαιδευτικού</h2>
                <p>{appointments.length} εγγραφές σε όλες τις ημέρες.</p>
              </div>
              <div className="appointment-group-list">
                {groupedAppointmentsByDate.size > 0 ? (
                  Array.from(groupedAppointmentsByDate, ([date, dateAppointments]) => (
                    <section className="appointment-group" key={date}>
                      <h3>{appointmentDateLabel(date, dateAppointments[0]?.day)}</h3>
                      <div className="appointment-list">{dateAppointments.map((appointment) => renderAppointment(appointment, false))}</div>
                    </section>
                  ))
                ) : (
                  <div className="empty-state">Δεν υπάρχουν ραντεβού για τον επιλεγμένο εκπαιδευτικό.</div>
                )}
              </div>
            </section>
          ) : (
            <section className="admin-section">
              <div className="admin-section-title">
                <h2>{appointmentDateLabel(selectedDate, selectedDay)}</h2>
                <p>{appointments.length} ραντεβού ημέρας</p>
              </div>
              <div className="appointment-group-list">
                {groupedAppointmentsByHour.size > 0 ? (
                  Array.from(groupedAppointmentsByHour, ([hour, hourAppointments]) => (
                    <section className="appointment-group" key={hour}>
                      <h3>{hourLabel(hour)}</h3>
                      <div className="appointment-list">{hourAppointments.map((appointment) => renderAppointment(appointment, false))}</div>
                    </section>
                  ))
                ) : (
                  <div className="empty-state">Δεν υπάρχουν ραντεβού για την επιλεγμένη ημέρα.</div>
                )}
              </div>
            </section>
          )}
        </>
      ) : (
        <>
          <section className="admin-section">
            <div className="admin-section-title">
              <h2>Σήμερα</h2>
              <p>{appointmentDateLabel(today)}</p>
            </div>
            <div className="appointment-list">
              {todayTeacherAppointments.length > 0 ? todayTeacherAppointments.map((appointment) => renderAppointment(appointment, false)) : <div className="empty-state">Δεν έχετε ραντεβού σήμερα.</div>}
            </div>
          </section>
          <section className="admin-section">
            <div className="admin-section-title">
              <h2>Επόμενα ραντεβού</h2>
              <p>Μελλοντικές κρατήσεις από γονείς.</p>
            </div>
            <div className="appointment-list">
              {upcomingTeacherAppointments.length > 0 ? (
                upcomingTeacherAppointments.map((appointment) => renderAppointment(appointment, false))
              ) : (
                <div className="empty-state">Δεν υπάρχουν μελλοντικά ραντεβού.</div>
              )}
            </div>
          </section>
        </>
      )}
    </AppNavigation>
  );
}
