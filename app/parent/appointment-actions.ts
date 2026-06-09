"use server";

import { AppointmentStatus, WeekDay } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { appointmentDate, getAppointmentSetting, isAppointmentDateAllowed } from "@/lib/appointments";
import { prisma } from "@/lib/prisma";
import { parseSessionToken, sessionCookieName } from "@/lib/session";

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function parentRedirect(message: string, type: "success" | "error" = "success", date?: string, studentId?: string): never {
  const params = new URLSearchParams({
    view: "appointments",
    notice: message,
    noticeType: type
  });
  if (date) {
    params.set("date", date);
  }
  if (studentId) {
    params.set("studentId", studentId);
  }
  redirect(`/parent?${params.toString()}`);
}

async function requireParent() {
  const cookieStore = await cookies();
  const session = parseSessionToken(cookieStore.get(sessionCookieName)?.value);

  if (!session || session.role !== "PARENT" || session.mustChangePassword) {
    redirect("/");
  }

  const parent = await prisma.parent.findUnique({
    where: { userId: session.userId },
    include: { students: true }
  });

  if (!parent) {
    redirect("/");
  }

  return parent;
}

function parseChoice(choice: string) {
  const [teacherId, hourValue] = choice.split(":");
  const hour = Number(hourValue);
  if (!teacherId || !Number.isInteger(hour) || hour < 1 || hour > 7) {
    return null;
  }
  return { teacherId, hour };
}

export async function bookParentAppointmentsAction(formData: FormData) {
  const parent = await requireParent();
  const date = text(formData, "date");
  const studentId = text(formData, "studentId");
  const selectedStudent = parent.students.find((student) => student.id === studentId) ?? parent.students[0] ?? null;
  const choices = formData.getAll("slot").filter((value): value is string => typeof value === "string").map(parseChoice).filter(Boolean) as Array<{
    teacherId: string;
    hour: number;
  }>;

  if (!selectedStudent || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    parentRedirect("Επιλέξτε μαθητή και έγκυρη ημερομηνία.", "error", date, studentId);
  }

  if (choices.length === 0) {
    parentRedirect("Επιλέξτε τουλάχιστον ένα διαθέσιμο ραντεβού.", "error", date, selectedStudent.id);
  }

  const allowedDate = await isAppointmentDateAllowed(date);
  if (!allowedDate.allowed || !allowedDate.day) {
    parentRedirect(allowedDate.message || "Η ημερομηνία δεν είναι διαθέσιμη για ραντεβού.", "error", date, selectedStudent.id);
  }

  const blockedDay = await prisma.appointmentBlockedDay.findUnique({ where: { date: appointmentDate(date) } });
  if (blockedDay) {
    parentRedirect(`Η ημέρα ραντεβού έχει ακυρωθεί${blockedDay.reason ? `: ${blockedDay.reason}` : "."}`, "error", date, selectedStudent.id);
  }

  const setting = await getAppointmentSetting();
  const uniqueChoices = Array.from(new Map(choices.map((choice) => [choice.teacherId, choice])).values());
  if (uniqueChoices.length < choices.length) {
    parentRedirect("Μπορείτε να κλείσετε μόνο ένα ραντεβού με κάθε εκπαιδευτικό την ίδια ημέρα.", "error", date, selectedStudent.id);
  }
  let createdCount = 0;

  for (const choice of uniqueChoices) {
    const officeHour = await prisma.teacherOfficeHour.findUnique({
      where: {
        teacherId_day_hour: {
          teacherId: choice.teacherId,
          day: allowedDate.day as WeekDay,
          hour: choice.hour
        }
      }
    });
    if (!officeHour) {
      continue;
    }

    const unavailable = await prisma.teacherUnavailableDay.findUnique({
      where: {
        teacherId_date: {
          teacherId: choice.teacherId,
          date: appointmentDate(date)
        }
      }
    });
    if (unavailable) {
      continue;
    }

    const bookedCount = await prisma.parentTeacherAppointment.count({
      where: {
        teacherId: choice.teacherId,
        date: appointmentDate(date),
        hour: choice.hour,
        status: AppointmentStatus.BOOKED
      }
    });
    if (bookedCount >= setting.maxPerTeacherSlot) {
      continue;
    }

    const existingAppointmentWithTeacher = await prisma.parentTeacherAppointment.findFirst({
      where: {
        parentId: parent.id,
        teacherId: choice.teacherId,
        date: appointmentDate(date),
        status: AppointmentStatus.BOOKED
      },
      select: { id: true }
    });
    if (existingAppointmentWithTeacher) {
      continue;
    }

    await prisma.parentTeacherAppointment.upsert({
      where: {
        parentId_studentId_teacherId_date_hour: {
          parentId: parent.id,
          studentId: selectedStudent.id,
          teacherId: choice.teacherId,
          date: appointmentDate(date),
          hour: choice.hour
        }
      },
      update: {
        status: AppointmentStatus.BOOKED,
        cancellationReason: null,
        cancelledAt: null,
        notifiedAt: null,
        day: allowedDate.day as WeekDay
      },
      create: {
        parentId: parent.id,
        studentId: selectedStudent.id,
        teacherId: choice.teacherId,
        date: appointmentDate(date),
        day: allowedDate.day as WeekDay,
        hour: choice.hour
      }
    });
    createdCount += 1;
  }

  if (createdCount === 0) {
    parentRedirect("Δεν κρατήθηκε ραντεβού. Οι επιλεγμένες ώρες δεν είναι πλέον διαθέσιμες.", "error", date, selectedStudent.id);
  }

  revalidatePath("/parent");
  parentRedirect(`Κρατήθηκαν ${createdCount} ραντεβού.`, "success", date, selectedStudent.id);
}

export async function cancelParentAppointmentAction(formData: FormData) {
  const parent = await requireParent();
  const id = text(formData, "id");
  const date = text(formData, "date");
  const studentId = text(formData, "studentId");

  const appointment = await prisma.parentTeacherAppointment.findFirst({
    where: {
      id,
      parentId: parent.id,
      status: AppointmentStatus.BOOKED
    }
  });

  if (!appointment) {
    parentRedirect("Το ραντεβού δεν βρέθηκε ή έχει ήδη ακυρωθεί.", "error", date, studentId);
  }

  await prisma.parentTeacherAppointment.update({
    where: { id },
    data: {
      status: AppointmentStatus.CANCELLED_BY_PARENT,
      cancellationReason: "Ακύρωση από γονέα.",
      cancelledAt: new Date()
    }
  });

  revalidatePath("/parent");
  parentRedirect("Το ραντεβού ακυρώθηκε.", "success", date, studentId);
}
