import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppointmentStatus } from "@prisma/client";
import { PrintButton } from "@/app/print/print-button";
import { appTitle, schoolName } from "@/app/school-brand";
import { appointmentDate, appointmentDateLabel, appointmentStatusLabel } from "@/lib/appointments";
import { dateInputValue } from "@/lib/school-calendar";
import { prisma } from "@/lib/prisma";
import { hourLabel } from "@/lib/report-helpers";
import { parseSessionToken, sessionCookieName } from "@/lib/session";

function todayLabel() {
  return new Intl.DateTimeFormat("el-GR", {
    dateStyle: "long"
  }).format(new Date());
}

export default async function ParentAppointmentsReportPage() {
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
      },
      appointments: {
        where: {
          date: { gte: appointmentDate(dateInputValue(new Date())) }
        },
        include: {
          student: {
            include: { class: true }
          },
          teacher: true
        },
        orderBy: [{ date: "asc" }, { hour: "asc" }, { teacher: { surname: "asc" } }]
      }
    }
  });

  if (!parent) {
    redirect("/");
  }

  const bookedAppointments = parent.appointments.filter((appointment) => appointment.status === AppointmentStatus.BOOKED);
  const cancelledAppointments = parent.appointments.filter((appointment) => appointment.status !== AppointmentStatus.BOOKED);

  return (
    <main className="print-shell">
      <header className="print-toolbar no-print">
        <Link className="secondary-button" href="/parent?view=appointments">
          Ραντεβού
        </Link>
        <PrintButton />
      </header>

      <article className="print-document">
        <header className="print-document-header">
          <div>
            <span>{schoolName}</span>
            <h1>Αναφορά ραντεβού γονέα</h1>
          </div>
          <div>
            <strong>{todayLabel()}</strong>
            <span>Έκδοση από {appTitle}</span>
          </div>
        </header>

        <section className="print-meta-grid">
          <div>
            <span>Γονέας/Κηδεμόνας</span>
            <strong>
              {parent.surname} {parent.name}
            </strong>
          </div>
          <div>
            <span>Email</span>
            <strong>{parent.email}</strong>
          </div>
          <div>
            <span>Περίοδος</span>
            <strong>Σήμερα και μελλοντικά</strong>
          </div>
          <div>
            <span>Σύνολο</span>
            <strong>{parent.appointments.length}</strong>
          </div>
        </section>

        <section className="summary-grid print-summary">
          <div className="panel metric">
            <span>Κρατημένα</span>
            <strong>{bookedAppointments.length}</strong>
          </div>
          <div className="panel metric">
            <span>Ακυρωμένα</span>
            <strong>{cancelledAppointments.length}</strong>
          </div>
          <div className="panel metric">
            <span>Μαθητές</span>
            <strong>{parent.students.length}</strong>
          </div>
        </section>

        <section className="print-section">
          <h2>Αναλυτική λίστα</h2>
          <table className="print-table">
            <thead>
              <tr>
                <th>Ημερομηνία</th>
                <th>Ώρα</th>
                <th>Εκπαιδευτικός</th>
                <th>Μαθητής/τρια</th>
                <th>Κατάσταση</th>
              </tr>
            </thead>
            <tbody>
              {parent.appointments.length > 0 ? (
                parent.appointments.map((appointment) => {
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
                  <td colSpan={5}>Δεν υπάρχουν σημερινά ή μελλοντικά ραντεβού.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </article>
    </main>
  );
}
