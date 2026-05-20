"use server";

import { AbsenceStatus, ParentJustificationStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { parseSessionToken, sessionCookieName } from "@/lib/session";

async function requireStaff() {
  const cookieStore = await cookies();
  const session = parseSessionToken(cookieStore.get(sessionCookieName)?.value);

  if (!session || session.mustChangePassword || (session.role !== "ADMIN" && session.role !== "TEACHER")) {
    redirect("/");
  }

  return session;
}

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function ensureStaffCanManageAbsence(sheetId: string) {
  const session = await requireStaff();

  if (session.role === "ADMIN") {
    return;
  }

  const teacher = await prisma.teacher.findUnique({
    where: {
      userId: session.userId
    },
    include: {
      courses: true
    }
  });

  const sheet = await prisma.attendanceSheet.findUnique({
    where: { id: sheetId }
  });

  if (!teacher || !sheet) {
    redirect("/");
  }

  const teachesCourse = teacher.courses.some((courseLink) => courseLink.courseId === sheet.courseId);
  if (teacher.homeClassId !== sheet.classId && !teachesCourse) {
    redirect("/");
  }
}

export async function excuseAbsenceAction(formData: FormData) {
  const sheetId = text(formData, "sheetId");
  const studentId = text(formData, "studentId");
  const reason = text(formData, "reason") || "Δικαιολογήθηκε από το σχολείο";

  await ensureStaffCanManageAbsence(sheetId);

  await prisma.attendanceSheetAbsence.update({
    where: {
      sheetId_studentId: {
        sheetId,
        studentId
      }
    },
    data: {
      status: AbsenceStatus.EXCUSED,
      excusedReason: reason,
      excusedAt: new Date()
    }
  });

  revalidatePath("/reports");
  revalidatePath("/parent");
}

export async function markAbsenceAction(formData: FormData) {
  const sheetId = text(formData, "sheetId");
  const studentId = text(formData, "studentId");

  await ensureStaffCanManageAbsence(sheetId);

  await prisma.attendanceSheetAbsence.update({
    where: {
      sheetId_studentId: {
        sheetId,
        studentId
      }
    },
    data: {
      status: AbsenceStatus.MARKED,
      excusedReason: null,
      excusedAt: null
    }
  });

  revalidatePath("/reports");
  revalidatePath("/parent");
}

export async function removeAbsenceAction(formData: FormData) {
  const sheetId = text(formData, "sheetId");
  const studentId = text(formData, "studentId");

  await ensureStaffCanManageAbsence(sheetId);

  await prisma.attendanceSheetAbsence.update({
    where: {
      sheetId_studentId: {
        sheetId,
        studentId
      }
    },
    data: {
      absent: false,
      status: AbsenceStatus.REMOVED,
      excusedReason: "Αφαιρέθηκε από αναφορά",
      excusedAt: new Date()
    }
  });

  revalidatePath("/reports");
  revalidatePath("/parent");
}

export async function approveParentJustificationRequestAction(formData: FormData) {
  const requestId = text(formData, "requestId");
  const response = text(formData, "response") || "Το αίτημα δικαιολόγησης εγκρίθηκε από το σχολείο.";

  const request = await prisma.parentJustificationRequest.findUnique({
    where: { id: requestId }
  });

  if (!request) {
    redirect("/reports");
  }

  await ensureStaffCanManageAbsence(request.sheetId);

  await prisma.$transaction([
    prisma.parentJustificationRequest.update({
      where: { id: request.id },
      data: {
        status: ParentJustificationStatus.APPROVED,
        schoolResponse: response,
        reviewedAt: new Date()
      }
    }),
    prisma.attendanceSheetAbsence.update({
      where: {
        sheetId_studentId: {
          sheetId: request.sheetId,
          studentId: request.studentId
        }
      },
      data: {
        status: AbsenceStatus.EXCUSED,
        excusedReason: `Αίτημα γονέα: ${request.reason}`,
        excusedAt: new Date()
      }
    })
  ]);

  revalidatePath("/reports");
  revalidatePath("/parent");
}

export async function rejectParentJustificationRequestAction(formData: FormData) {
  const requestId = text(formData, "requestId");
  const response = text(formData, "response") || "Το αίτημα δεν εγκρίθηκε από το σχολείο.";

  const request = await prisma.parentJustificationRequest.findUnique({
    where: { id: requestId }
  });

  if (!request) {
    redirect("/reports");
  }

  await ensureStaffCanManageAbsence(request.sheetId);

  await prisma.parentJustificationRequest.update({
    where: { id: request.id },
    data: {
      status: ParentJustificationStatus.REJECTED,
      schoolResponse: response,
      reviewedAt: new Date()
    }
  });

  revalidatePath("/reports");
  revalidatePath("/parent");
}
