"use server";

import { AppointmentStatus, WeekDay } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import {
  appointmentDate,
  getAppointmentSetting,
  isAppointmentDateAllowed,
  notifyCancelledAppointments
} from "@/lib/appointments";
import { prisma } from "@/lib/prisma";
import { parseSessionToken, sessionCookieName } from "@/lib/session";
import { schoolHours, weekDays } from "@/lib/school-time";

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function settingsRedirect(message: string, type: "success" | "error" = "success", tab = "hours"): never {
  const params = new URLSearchParams({ notice: message, noticeType: type });
  if (tab) {
    params.set("tab", tab);
  }
  redirect(`/appointment-settings?${params.toString()}`);
}

async function requireTeacherOrAdmin() {
  const cookieStore = await cookies();
  const session = parseSessionToken(cookieStore.get(sessionCookieName)?.value);

  if (!session || session.mustChangePassword || (session.role !== "ADMIN" && session.role !== "TEACHER")) {
    redirect("/");
  }

  const teacher = await prisma.teacher.findUnique({ where: { userId: session.userId } });
  return { session, teacher };
}

function parseSlot(value: string) {
  const [dayValue, hourValue] = value.split(":");
  const day = weekDays.some((weekDay) => weekDay.value === dayValue) ? (dayValue as WeekDay) : null;
  const hour = Number(hourValue);
  if (!day || !schoolHours.some((slot) => slot.hour === hour)) {
    return null;
  }
  return { day, hour };
}

export async function saveOfficeHoursAction(formData: FormData) {
  const { session, teacher } = await requireTeacherOrAdmin();
  const tab = text(formData, "tab") || "hours";
  const requestedTeacherId = text(formData, "teacherId");
  const teacherId = session.role === "ADMIN" ? requestedTeacherId : teacher?.id ?? "";

  if (!teacherId) {
    settingsRedirect("Δεν βρέθηκε εκπαιδευτικός για αλλαγή ωρών γονέων.", "error", tab);
  }

  const requestedSlots = formData.getAll("slot").filter((value): value is string => typeof value === "string");
  const slots = requestedSlots.map(parseSlot).filter((slot): slot is { day: WeekDay; hour: number } => Boolean(slot));

  await prisma.$transaction(async (tx) => {
    await tx.teacherOfficeHour.deleteMany({ where: { teacherId } });
    if (slots.length > 0) {
      await tx.teacherOfficeHour.createMany({
        data: slots.map((slot) => ({ teacherId, day: slot.day, hour: slot.hour })),
        skipDuplicates: true
      });
    }
  });

  revalidatePath("/appointment-settings");
  settingsRedirect("Οι ώρες γονέων αποθηκεύτηκαν.", "success", tab);
}

export async function saveAppointmentCapacityAction(formData: FormData) {
  const { session } = await requireTeacherOrAdmin();
  const tab = text(formData, "tab") || "general";
  if (session.role !== "ADMIN") {
    settingsRedirect("Μόνο ο admin μπορεί να αλλάξει το όριο ραντεβού.", "error", tab);
  }

  const maxPerTeacherSlot = Math.max(1, Math.min(20, Number(text(formData, "maxPerTeacherSlot")) || 1));
  const setting = await getAppointmentSetting();
  await prisma.appointmentSetting.update({
    where: { id: setting.id },
    data: { maxPerTeacherSlot }
  });

  revalidatePath("/appointment-settings");
  settingsRedirect("Το όριο ραντεβού ανά ώρα ενημερώθηκε.", "success", tab);
}

export async function addTeacherUnavailableDayAction(formData: FormData) {
  const { session } = await requireTeacherOrAdmin();
  const tab = text(formData, "tab") || "absences";
  if (session.role !== "ADMIN") {
    settingsRedirect("Μόνο ο admin μπορεί να δηλώσει απουσία εκπαιδευτικού.", "error", tab);
  }

  const teacherId = text(formData, "teacherId");
  const date = text(formData, "date");
  const reason = text(formData, "reason");
  if (!teacherId || !validDate(date)) {
    settingsRedirect("Επιλέξτε εκπαιδευτικό και έγκυρη ημερομηνία.", "error", tab);
  }

  const allowed = await isAppointmentDateAllowed(date);
  if (!allowed.day) {
    settingsRedirect("Η ημερομηνία δεν είναι καθημερινή.", "error", tab);
  }

  await prisma.teacherUnavailableDay.upsert({
    where: {
      teacherId_date: {
        teacherId,
        date: appointmentDate(date)
      }
    },
    update: { reason: reason || null },
    create: { teacherId, date: appointmentDate(date), reason: reason || null }
  });

  const appointmentsToCancel = await prisma.parentTeacherAppointment.findMany({
    where: {
      teacherId,
      date: appointmentDate(date),
      status: AppointmentStatus.BOOKED
    },
    select: { id: true }
  });
  await prisma.parentTeacherAppointment.updateMany({
    where: { id: { in: appointmentsToCancel.map((appointment) => appointment.id) } },
    data: {
      status: AppointmentStatus.CANCELLED_BY_ADMIN,
      cancellationReason: reason || "Ο/Η εκπαιδευτικός δεν είναι διαθέσιμος/η.",
      cancelledAt: new Date()
    }
  });
  await notifyCancelledAppointments(appointmentsToCancel.map((appointment) => appointment.id), reason || "Ο/Η εκπαιδευτικός δεν είναι διαθέσιμος/η.");

  revalidatePath("/appointment-settings");
  revalidatePath("/appointments");
  revalidatePath("/parent");
  settingsRedirect("Η απουσία εκπαιδευτικού καταχωρίστηκε και τα υπάρχοντα ραντεβού ακυρώθηκαν.", "success", tab);
}

export async function deleteTeacherUnavailableDayAction(formData: FormData) {
  const { session } = await requireTeacherOrAdmin();
  const tab = text(formData, "tab") || "absences";
  if (session.role !== "ADMIN") {
    settingsRedirect("Μόνο ο admin μπορεί να διαγράψει απουσία εκπαιδευτικού.", "error", tab);
  }

  const id = text(formData, "id");
  if (id) {
    await prisma.teacherUnavailableDay.delete({ where: { id } });
  }

  revalidatePath("/appointment-settings");
  settingsRedirect("Η απουσία εκπαιδευτικού διαγράφηκε.", "success", tab);
}

export async function addBlockedDayAction(formData: FormData) {
  const { session } = await requireTeacherOrAdmin();
  const tab = text(formData, "tab") || "cancellations";
  if (session.role !== "ADMIN") {
    settingsRedirect("Μόνο ο admin μπορεί να ακυρώσει ολόκληρη ημέρα ραντεβού.", "error", tab);
  }

  const date = text(formData, "date");
  const reason = text(formData, "reason");
  if (!validDate(date)) {
    settingsRedirect("Επιλέξτε έγκυρη ημερομηνία.", "error", tab);
  }

  await prisma.appointmentBlockedDay.upsert({
    where: { date: appointmentDate(date) },
    update: { reason: reason || null },
    create: { date: appointmentDate(date), reason: reason || null }
  });

  const appointmentsToCancel = await prisma.parentTeacherAppointment.findMany({
    where: {
      date: appointmentDate(date),
      status: AppointmentStatus.BOOKED
    },
    select: { id: true }
  });
  await prisma.parentTeacherAppointment.updateMany({
    where: { id: { in: appointmentsToCancel.map((appointment) => appointment.id) } },
    data: {
      status: AppointmentStatus.CANCELLED_BY_ADMIN,
      cancellationReason: reason || "Η ημέρα ραντεβού ακυρώθηκε από το σχολείο.",
      cancelledAt: new Date()
    }
  });
  await notifyCancelledAppointments(appointmentsToCancel.map((appointment) => appointment.id), reason || "Η ημέρα ραντεβού ακυρώθηκε από το σχολείο.");

  revalidatePath("/appointment-settings");
  revalidatePath("/appointments");
  revalidatePath("/parent");
  settingsRedirect("Η ημέρα ακυρώθηκε και τα υπάρχοντα ραντεβού ενημερώθηκαν.", "success", tab);
}

export async function deleteBlockedDayAction(formData: FormData) {
  const { session } = await requireTeacherOrAdmin();
  const tab = text(formData, "tab") || "cancellations";
  if (session.role !== "ADMIN") {
    settingsRedirect("Μόνο ο admin μπορεί να διαγράψει ακύρωση ημέρας.", "error", tab);
  }

  const id = text(formData, "id");
  if (id) {
    await prisma.appointmentBlockedDay.delete({ where: { id } });
  }

  revalidatePath("/appointment-settings");
  settingsRedirect("Η ακύρωση ημέρας διαγράφηκε.", "success", tab);
}
