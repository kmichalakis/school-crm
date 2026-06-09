"use server";

import { AppointmentStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { notifyCancelledAppointments } from "@/lib/appointments";
import { prisma } from "@/lib/prisma";
import { parseSessionToken, sessionCookieName } from "@/lib/session";

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
  await notifyCancelledAppointments([id], reason);

  revalidatePath("/appointments");
  revalidatePath("/parent");
  appointmentsRedirect("Το ραντεβού ακυρώθηκε και έγινε προσπάθεια ενημέρωσης του γονέα.", "success", date, teacherId);
}
