"use server";

import { AppointmentStatus, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { appointmentDateLabel, appointmentNotificationSummary, isAppointmentDateAllowed, notifyCancelledAppointments, sendAppointmentEmail } from "@/lib/appointments";
import { prisma } from "@/lib/prisma";
import { dateInputValue } from "@/lib/school-calendar";
import { parseSessionToken, sessionCookieName } from "@/lib/session";
import { schoolHours } from "@/lib/school-time";

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function appointmentsRedirect(message: string, type: "success" | "error" = "success", date?: string, teacherId?: string): never {
  const params = new URLSearchParams({ notice: message, noticeType: type });
  if (date) {
    params.set("date", date);
  }
  if (teacherId) {
    params.set("teacherId", teacherId);
  }
  redirect(`/appointments?${params.toString()}`);
}

async function requireAppointmentsUser() {
  const cookieStore = await cookies();
  const session = parseSessionToken(cookieStore.get(sessionCookieName)?.value);

  if (!session || session.mustChangePassword || !["ADMIN", "TEACHER", "SCHOOL_OFFICE"].includes(session.role)) {
    redirect("/");
  }

  return session;
}

export async function cancelAppointmentByAdminAction(formData: FormData) {
  const session = await requireAppointmentsUser();
  const id = text(formData, "id");
  const date = text(formData, "date");
  const teacherId = text(formData, "teacherId");
  const reason = text(formData, "reason") || "Ακύρωση από το σχολείο.";

  if (session.role !== "ADMIN") {
    appointmentsRedirect("Μόνο ο admin μπορεί να ακυρώσει ραντεβού.", "error", date, teacherId);
  }

  const appointment = await prisma.parentTeacherAppointment.findUnique({
    where: { id },
    select: { id: true, status: true }
  });

  if (!appointment || appointment.status !== AppointmentStatus.BOOKED) {
    appointmentsRedirect("Το ραντεβού δεν βρέθηκε ή έχει ήδη ακυρωθεί.", "error", date, teacherId);
  }

  await prisma.parentTeacherAppointment.update({
    where: { id },
    data: {
      status: AppointmentStatus.CANCELLED_BY_ADMIN,
      cancellationReason: reason,
      cancelledAt: new Date()
    }
  });
  const notificationResult = await notifyCancelledAppointments([id], reason);

  revalidatePath("/appointments");
  revalidatePath("/parent");
  appointmentsRedirect(`Το ραντεβού ακυρώθηκε. ${appointmentNotificationSummary(notificationResult)}`, "success", date, teacherId);
}

export async function changeAppointmentHourByAdminAction(formData: FormData) {
  const session = await requireAppointmentsUser();
  const id = text(formData, "id");
  const date = text(formData, "date");
  const teacherId = text(formData, "teacherId");
  const newHour = Number(text(formData, "newHour"));

  if (session.role !== "ADMIN") {
    appointmentsRedirect("Μόνο ο admin μπορεί να αλλάξει την ώρα ραντεβού.", "error", date, teacherId);
  }
  const newSlot = schoolHours.find((slot) => slot.hour === newHour);
  if (!id || !newSlot) {
    appointmentsRedirect("Επιλέξτε έγκυρη σχολική ώρα.", "error", date, teacherId);
  }

  const current = await prisma.parentTeacherAppointment.findUnique({
    where: { id },
    select: { date: true, hour: true, status: true }
  });
  if (!current || current.status !== AppointmentStatus.BOOKED) {
    appointmentsRedirect("Το ραντεβού δεν βρέθηκε ή έχει ακυρωθεί.", "error", date, teacherId);
  }
  if (current.hour === newHour) {
    appointmentsRedirect("Το ραντεβού είναι ήδη καταχωρισμένο σε αυτή την ώρα.", "error", date, teacherId);
  }

  const appointmentDateValue = dateInputValue(current.date);
  const allowedDate = await isAppointmentDateAllowed(appointmentDateValue);
  if (!allowedDate.allowed) {
    appointmentsRedirect("Η ημερομηνία του ραντεβού δεν είναι διαθέσιμη.", "error", date, teacherId);
  }

  const performChange = () => prisma.$transaction(async (tx) => {
    const appointment = await tx.parentTeacherAppointment.findUnique({
      where: { id },
      include: { parent: true, student: true, teacher: true }
    });
    if (!appointment || appointment.status !== AppointmentStatus.BOOKED) {
      return { error: "Το ραντεβού δεν βρέθηκε ή έχει ακυρωθεί." };
    }
    if (appointment.hour === newHour) {
      return { error: "Το ραντεβού είναι ήδη καταχωρισμένο σε αυτή την ώρα." };
    }

    const [blockedDay, unavailableDay, setting, bookedCount, duplicate] = await Promise.all([
      tx.appointmentBlockedDay.findUnique({ where: { date: appointment.date } }),
      tx.teacherUnavailableDay.findUnique({ where: { teacherId_date: { teacherId: appointment.teacherId, date: appointment.date } } }),
      tx.appointmentSetting.findFirst({ orderBy: { createdAt: "asc" } }),
      tx.parentTeacherAppointment.count({
        where: { teacherId: appointment.teacherId, date: appointment.date, hour: newHour, status: AppointmentStatus.BOOKED }
      }),
      tx.parentTeacherAppointment.findFirst({
        where: {
          id: { not: appointment.id },
          parentId: appointment.parentId,
          studentId: appointment.studentId,
          teacherId: appointment.teacherId,
          date: appointment.date,
          hour: newHour
        },
        select: { id: true }
      })
    ]);

    if (blockedDay || unavailableDay) {
      return { error: "Ο εκπαιδευτικός ή η ημέρα δεν είναι διαθέσιμα για ραντεβού." };
    }
    if (bookedCount >= (setting?.maxPerTeacherSlot ?? 1)) {
      return { error: "Η επιλεγμένη ώρα έχει συμπληρώσει τις διαθέσιμες θέσεις." };
    }
    if (duplicate) {
      return { error: "Υπάρχει ήδη εγγραφή για τον ίδιο γονέα, μαθητή, εκπαιδευτικό και ώρα." };
    }
    await tx.parentTeacherAppointment.update({ where: { id: appointment.id }, data: { hour: newHour } });
    return { appointment };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  let result: Awaited<ReturnType<typeof performChange>>;
  try {
    result = await performChange();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) {
      appointmentsRedirect("Η διαθεσιμότητα άλλαξε. Ανανεώστε τη σελίδα και δοκιμάστε ξανά.", "error", date, teacherId);
    }
    throw error;
  }
  if (result.error) {
    appointmentsRedirect(result.error, "error", date, teacherId);
  }

  const appointment = result.appointment;
  if (!appointment) {
    appointmentsRedirect("Δεν ήταν δυνατή η αλλαγή ώρας. Δοκιμάστε ξανά.", "error", date, teacherId);
  }
  const oldSlot = schoolHours.find((slot) => slot.hour === appointment.hour);
  const body = [
    "Αγαπητέ/ή γονέα/κηδεμόνα,",
    "",
    "Η ώρα του ραντεβού σας άλλαξε από το σχολείο.",
    `Ημερομηνία: ${appointmentDateLabel(appointmentDateValue, appointment.day)}`,
    `Εκπαιδευτικός: ${appointment.teacher.surname} ${appointment.teacher.name}`,
    `Μαθητής/τρια: ${appointment.student.surname} ${appointment.student.name}`,
    `Προηγούμενη ώρα: ${oldSlot ? `${oldSlot.label} (${oldSlot.starts}-${oldSlot.ends})` : `${appointment.hour}η ώρα`}`,
    `Νέα ώρα: ${newSlot.label} (${newSlot.starts}-${newSlot.ends})`,
    "",
    "Μπορείτε να δείτε το ενημερωμένο ραντεβού στην Πύλη Γονέα."
  ].join("\n");
  const emailResult = await sendAppointmentEmail(appointment.parent.email, "Αλλαγή ώρας ραντεβού με εκπαιδευτικό", body);

  revalidatePath("/appointments");
  revalidatePath("/parent");
  appointmentsRedirect(
    `Το ραντεβού μεταφέρθηκε στη ${newSlot.label}. ${emailResult.sent ? "Ο γονέας ενημερώθηκε με email." : "Το email προς τον γονέα δεν στάλθηκε."}`,
    emailResult.sent ? "success" : "error",
    date,
    teacherId
  );
}
