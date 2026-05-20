"use server";

import { AbsenceStatus, ParentJustificationStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { parseSessionToken, sessionCookieName } from "@/lib/session";

async function requireParent() {
  const cookieStore = await cookies();
  const session = parseSessionToken(cookieStore.get(sessionCookieName)?.value);

  if (!session || session.mustChangePassword || session.role !== "PARENT") {
    redirect("/");
  }

  const parent = await prisma.parent.findUnique({
    where: { userId: session.userId }
  });

  if (!parent) {
    redirect("/");
  }

  return parent;
}

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function requestAbsenceJustificationAction(formData: FormData) {
  const parent = await requireParent();
  const sheetId = text(formData, "sheetId");
  const studentId = text(formData, "studentId");
  const reason = text(formData, "reason");

  if (!reason) {
    revalidatePath("/parent");
    return;
  }

  const absence = await prisma.attendanceSheetAbsence.findFirst({
    where: {
      sheetId,
      studentId,
      absent: true,
      status: AbsenceStatus.MARKED,
      student: {
        parentId: parent.id
      }
    }
  });

  if (!absence) {
    redirect("/parent");
  }

  await prisma.parentJustificationRequest.upsert({
    where: {
      parentId_studentId_sheetId: {
        parentId: parent.id,
        studentId,
        sheetId
      }
    },
    update: {
      reason,
      status: ParentJustificationStatus.PENDING,
      schoolResponse: null,
      reviewedAt: null
    },
    create: {
      parentId: parent.id,
      studentId,
      sheetId,
      reason
    }
  });

  revalidatePath("/parent");
  revalidatePath("/reports");
}
