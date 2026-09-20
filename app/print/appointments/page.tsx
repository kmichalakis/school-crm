import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PrintButton } from "@/app/print/print-button";
import { appointmentDateLabel, appointmentStatusLabel, nextWeekdayDate } from "@/lib/appointments";
import { appointmentWhereForSession, loadAppointmentRows, validAppointmentDate } from "@/lib/appointment-queries";
import { dateInputValue } from "@/lib/school-calendar";
import { hourLabel } from "@/lib/report-helpers";
import { parseSessionToken, sessionCookieName } from "@/lib/session";

type PrintAppointmentsPageProps = {
  searchParams: Promise<{
    date?: string;
    teacherId?: string;
  }>;
};

function todayLabel() {
  return new Intl.DateTimeFormat("el-GR", {
    dateStyle: "long"
  }).format(new Date());
}

export default async function PrintAppointmentsPage({ searchParams }: PrintAppointmentsPageProps) {
  const cookieStore = await cookies();
  const session = parseSessionToken(cookieStore.get(sessionCookieName)?.value);

  if (!session || session.mustChangePassword || !["ADMIN", "TEACHER", "SCHOOL_OFFICE"].includes(session.role)) {
    redirect("/");
  }

  const params = await searchParams;
  const selectedDate = validAppointmentDate(params.date, nextWeekdayDate());
  const selectedTeacherId = session.role === "ADMIN" || session.role === "SCHOOL_OFFICE" ? params.teacherId : undefined;
  const query = await appointmentWhereForSession({
    date: selectedDate,
    role: session.role,
    selectedTeacherId,
    sessionUserId: session.userId
  });
  const appointments = await loadAppointmentRows(query.where, query.showAllDaysForTeacher);
  const title = query.scope === "teacher" || query.scope === "teacher-upcoming" ? "Ραντεβού εκπαιδευτικού" : "Ημερήσια κατάσταση ραντεβού";
  const scopeLabel =
    query.scope === "teacher-upcoming"
      ? "Σημερινά και μελλοντικά ραντεβού"
      : query.scope === "teacher"
        ? "Όλες οι ημέρες για τον επιλεγμένο εκπαιδευτικό"
        : appointmentDateLabel(selectedDate);

  return (
    <main className="print-shell">
      <header className="print-toolbar no-print">
        <Link className="secondary-button" href={`/appointments?date=${selectedDate}${selectedTeacherId ? `&teacherId=${selectedTeacherId}` : ""}`}>
          Ραντεβού
        </Link>
        <PrintButton />
      </header>

      <article className="print-document">
        <header className="print-document-header">
          <div>
            <span>1ο Πρότυπο Γυμνάσιο Μυτιλήνης</span>
            <h1>{title}</h1>
          </div>
          <div>
            <strong>{todayLabel()}</strong>
            <span>Έκδοση από 1ο Πρότυπο Γυμνάσιο Μυτιλήνης &quot;Βύρων Σιβολαπένκο&quot;</span>
          </div>
        </header>

        <section className="print-meta-grid">
          <div>
            <span>Περίοδος</span>
            <strong>{scopeLabel}</strong>
          </div>
          <div>
            <span>Σύνολο</span>
            <strong>{appointments.length}</strong>
          </div>
        </section>

        <section className="print-section">
          <h2>Λίστα ραντεβού</h2>
          <table className="print-table">
            <thead>
              <tr>
                <th>Ημερομηνία</th>
                <th>Ώρα</th>
                <th>Εκπαιδευτικός</th>
                <th>Μαθητής/τρια</th>
                <th>Γονέας</th>
                <th>Κατάσταση</th>
              </tr>
            </thead>
            <tbody>
              {appointments.length > 0 ? (
                appointments.map((appointment) => {
                  const dateValue = dateInputValue(appointment.date);
                  return (
                    <tr key={appointment.id}>
                      <td>{appointmentDateLabel(dateValue, appointment.day)}</td>
                      <td>{hourLabel(appointment.hour)}</td>
                      <td>
                        {appointment.teacher.surname} {appointment.teacher.name}
                      </td>
                      <td>
                        {appointment.student.surname} {appointment.student.name}
                        <br />
                        <span>{appointment.student.class.name}</span>
                      </td>
                      <td>
                        {appointment.parent.surname} {appointment.parent.name}
                        <br />
                        <span>{appointment.parent.email}</span>
                      </td>
                      <td>
                        {appointmentStatusLabel(appointment.status)}
                        {appointment.cancellationReason ? (
                          <>
                            <br />
                            <span>{appointment.cancellationReason}</span>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6}>Δεν υπάρχουν ραντεβού για τα επιλεγμένα φίλτρα.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </article>
    </main>
  );
}
