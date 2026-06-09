import { NextRequest, NextResponse } from "next/server";
import { appointmentDateLabel, appointmentStatusLabel, nextWeekdayDate } from "@/lib/appointments";
import { appointmentWhereForSession, loadAppointmentRows, validAppointmentDate } from "@/lib/appointment-queries";
import { dateInputValue } from "@/lib/school-calendar";
import { csvEscape, hourLabel } from "@/lib/report-helpers";
import { parseSessionToken, sessionCookieName } from "@/lib/session";

export async function GET(request: NextRequest) {
  const session = parseSessionToken(request.cookies.get(sessionCookieName)?.value);

  if (!session || session.mustChangePassword || !["ADMIN", "TEACHER", "SCHOOL_OFFICE"].includes(session.role)) {
    return NextResponse.json({ error: "Απαιτείται σύνδεση." }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const selectedDate = validAppointmentDate(searchParams.get("date") ?? undefined, nextWeekdayDate());
  const selectedTeacherId = session.role === "ADMIN" || session.role === "SCHOOL_OFFICE" ? searchParams.get("teacherId") ?? undefined : undefined;
  const query = await appointmentWhereForSession({
    date: selectedDate,
    role: session.role,
    selectedTeacherId,
    sessionUserId: session.userId
  });
  const appointments = await loadAppointmentRows(query.where, query.showAllDaysForTeacher);
  const header = ["Ημερομηνία", "Ώρα", "Κατάσταση", "Εκπαιδευτικός", "Μαθητής/τρια", "Τμήμα", "Γονέας", "Email γονέα", "Αιτία ακύρωσης"];
  const rows = appointments.map((appointment) => {
    const dateValue = dateInputValue(appointment.date);
    return [
      appointmentDateLabel(dateValue, appointment.day),
      hourLabel(appointment.hour),
      appointmentStatusLabel(appointment.status),
      `${appointment.teacher.surname} ${appointment.teacher.name}`,
      `${appointment.student.surname} ${appointment.student.name}`,
      appointment.student.class.name,
      `${appointment.parent.surname} ${appointment.parent.name}`,
      appointment.parent.email,
      appointment.cancellationReason ?? ""
    ];
  });
  const csv = `\uFEFF${[header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n")}`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="rantevou.csv"'
    }
  });
}
