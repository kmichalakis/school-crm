import { AppointmentStatus, type WeekDay } from "@prisma/client";
import { dateInputValue, isAllowedSchoolDate } from "@/lib/school-calendar";
import { prisma } from "@/lib/prisma";
import { hourLabel, weekDayLabel } from "@/lib/report-helpers";
import { dateToWeekDay, formatDateInput } from "@/lib/school-time";

export function appointmentDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

export function shortAppointmentDate(value: string) {
  return new Intl.DateTimeFormat("el-GR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(new Date(`${value}T12:00:00`));
}

export function appointmentDateLabel(value: string, day?: WeekDay | null) {
  const derivedDay = day ?? (dateToWeekDay(value) as WeekDay | null);
  return `${derivedDay ? weekDayLabel(derivedDay) : "Αργία"} ${shortAppointmentDate(value)}`;
}

export function nextWeekdayDate(fromDate = new Date()) {
  const candidate = new Date(fromDate);
  for (let offset = 0; offset < 14; offset += 1) {
    const value = formatDateInput(candidate);
    if (dateToWeekDay(value)) {
      return value;
    }
    candidate.setDate(candidate.getDate() + 1);
  }
  return formatDateInput(fromDate);
}

export async function getAppointmentSetting() {
  const existing = await prisma.appointmentSetting.findFirst({ orderBy: { createdAt: "asc" } });
  if (existing) {
    return existing;
  }

  return prisma.appointmentSetting.create({
    data: {
      maxPerTeacherSlot: 1
    }
  });
}

export async function isAppointmentDateAllowed(dateValue: string) {
  const day = dateToWeekDay(dateValue) as WeekDay | null;
  if (!day) {
    return { allowed: false, day, message: "Η ημερομηνία είναι Σαββατοκύριακο." };
  }

  const activeSchoolYear = await prisma.schoolYear.findFirst({
    where: { status: "ACTIVE" },
    include: { calendarDays: true },
    orderBy: { startsOn: "desc" }
  });

  if (!activeSchoolYear) {
    return { allowed: true, day, message: "" };
  }

  const bounds = {
    startsOn: dateInputValue(activeSchoolYear.startsOn),
    endsOn: dateInputValue(activeSchoolYear.endsOn)
  };
  const exceptions = activeSchoolYear.calendarDays.map((calendarDay) => ({
    date: dateInputValue(calendarDay.date),
    isWorkingDay: calendarDay.isWorkingDay
  }));

  if (!isAllowedSchoolDate(dateValue, bounds, exceptions)) {
    return { allowed: false, day, message: "Η ημερομηνία είναι αργία ή εκτός σχολικού έτους." };
  }

  return { allowed: true, day, message: "" };
}

export function appointmentStatusLabel(status: AppointmentStatus) {
  if (status === AppointmentStatus.CANCELLED_BY_PARENT) {
    return "Ακυρώθηκε από γονέα";
  }
  if (status === AppointmentStatus.CANCELLED_BY_ADMIN) {
    return "Ακυρώθηκε από το σχολείο";
  }
  return "Κρατημένο";
}

export function appointmentSlotLabel(dateValue: string, day: WeekDay, hour: number) {
  return `${appointmentDateLabel(dateValue, day)} · ${hourLabel(hour)}`;
}

export async function sendAppointmentEmail(to: string, subject: string, body: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    return { sent: false, reason: "Δεν έχουν οριστεί RESEND_API_KEY και EMAIL_FROM." };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      text: body
    })
  });

  if (!response.ok) {
    return { sent: false, reason: await response.text() };
  }

  return { sent: true, reason: "" };
}

export async function notifyCancelledAppointments(appointmentIds: string[], reason: string) {
  if (appointmentIds.length === 0) {
    return;
  }

  const appointments = await prisma.parentTeacherAppointment.findMany({
    where: { id: { in: appointmentIds } },
    include: {
      parent: true,
      student: true,
      teacher: true
    }
  });

  for (const appointment of appointments) {
    const dateValue = dateInputValue(appointment.date);
    const subject = "Ακύρωση ραντεβού με εκπαιδευτικό";
    const body = [
      `Το ραντεβού για τον/τη μαθητή/μαθήτρια ${appointment.student.surname} ${appointment.student.name} ακυρώθηκε.`,
      `Εκπαιδευτικός: ${appointment.teacher.surname} ${appointment.teacher.name}`,
      `Χρόνος: ${appointmentSlotLabel(dateValue, appointment.day, appointment.hour)}`,
      reason ? `Αιτία: ${reason}` : ""
    ]
      .filter(Boolean)
      .join("\n");

    const result = await sendAppointmentEmail(appointment.parent.email, subject, body);
    if (result.sent) {
      await prisma.parentTeacherAppointment.update({
        where: { id: appointment.id },
        data: { notifiedAt: new Date() }
      });
    }
  }
}
