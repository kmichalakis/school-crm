"use server";

import { AbsenceStatus, EmailTrigger, ParentNotificationStatus, UserRole, WeekDay } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { emailTriggerLabel, hourLabel, weekDayLabel } from "@/lib/report-helpers";
import { schoolHours } from "@/lib/school-time";
import { parseSessionToken, sessionCookieName } from "@/lib/session";

async function requireStaff() {
  const cookieStore = await cookies();
  const session = parseSessionToken(cookieStore.get(sessionCookieName)?.value);

  if (!session || session.mustChangePassword || (session.role !== "ADMIN" && session.role !== "TEACHER")) {
    redirect("/");
  }

  return session;
}

async function staffClassFilter() {
  const session = await requireStaff();

  if (session.role === "ADMIN") {
    return undefined;
  }

  const teacher = await prisma.teacher.findUnique({
    where: { userId: session.userId },
    include: {
      courses: {
        include: { course: true }
      }
    }
  });

  return Array.from(
    new Set([...(teacher?.homeClassId ? [teacher.homeClassId] : []), ...(teacher?.courses.map((link) => link.course.classId) ?? [])])
  );
}

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function checked(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

function parseEmailTrigger(value: string): EmailTrigger {
  if (value === "LAST_HOUR_ABSENCE") return EmailTrigger.LAST_HOUR_ABSENCE;
  if (value === "DAILY_THRESHOLD") return EmailTrigger.DAILY_THRESHOLD;
  if (value === "WEEKLY_THRESHOLD") return EmailTrigger.WEEKLY_THRESHOLD;
  return EmailTrigger.FIRST_HOUR_ABSENCE;
}

function buildNotificationText(absence: {
  sheet: { day: WeekDay; hour: number; course: { name: string }; class: { name: string; schoolYear: { name: string } } };
  student: { name: string; surname: string };
}, trigger: EmailTrigger) {
  const studentName = `${absence.student.surname} ${absence.student.name}`;
  const subject = `${emailTriggerLabel(trigger)} - ${studentName}`;
  const body = [
    `Ο/Η μαθητής/μαθήτρια ${studentName} καταχωρίστηκε απών/απούσα.`,
    `Τμήμα: ${absence.sheet.class.name}, σχολικό έτος ${absence.sheet.class.schoolYear.name}.`,
    `Ώρα: ${weekDayLabel(absence.sheet.day)}, ${hourLabel(absence.sheet.hour)}.`,
    `Μάθημα: ${absence.sheet.course.name}.`
  ].join("\n");

  return { subject, body };
}

function dailyKey(studentId: string, day: WeekDay) {
  return `${studentId}:${day}`;
}

export async function generateParentNotificationsAction() {
  const allowedClassIds = await staffClassFilter();
  const rules = await prisma.emailRule.findMany({
    where: { enabled: true }
  });

  if (rules.length === 0) {
    revalidatePath("/notifications");
    return;
  }

  const absences = await prisma.attendanceSheetAbsence.findMany({
    where: {
      absent: true,
      status: { not: AbsenceStatus.REMOVED },
      student: { parentId: { not: null } },
      sheet: allowedClassIds ? { classId: { in: allowedClassIds } } : undefined
    },
    include: {
      student: {
        include: { parent: true }
      },
      sheet: {
        include: {
          class: {
            include: { schoolYear: true }
          },
          course: true
        }
      }
    }
  });

  const dailyCounts = new Map<string, number>();
  const weeklyCounts = new Map<string, number>();

  for (const absence of absences) {
    dailyCounts.set(dailyKey(absence.studentId, absence.sheet.day), (dailyCounts.get(dailyKey(absence.studentId, absence.sheet.day)) ?? 0) + 1);
    weeklyCounts.set(absence.studentId, (weeklyCounts.get(absence.studentId) ?? 0) + 1);
  }

  const lastHour = schoolHours[schoolHours.length - 1]?.hour ?? 7;

  await prisma.$transaction(async (tx) => {
    for (const absence of absences) {
      if (!absence.student.parent) {
        continue;
      }

      for (const rule of rules) {
        const matches =
          (rule.trigger === EmailTrigger.FIRST_HOUR_ABSENCE && absence.sheet.hour === 1) ||
          (rule.trigger === EmailTrigger.LAST_HOUR_ABSENCE && absence.sheet.hour === lastHour) ||
          (rule.trigger === EmailTrigger.DAILY_THRESHOLD &&
            (dailyCounts.get(dailyKey(absence.studentId, absence.sheet.day)) ?? 0) >= (rule.thresholdCount ?? 1)) ||
          (rule.trigger === EmailTrigger.WEEKLY_THRESHOLD && (weeklyCounts.get(absence.studentId) ?? 0) >= (rule.thresholdCount ?? 1));

        if (!matches) {
          continue;
        }

        const message = buildNotificationText(absence, rule.trigger);
        await tx.parentNotification.upsert({
          where: {
            parentId_studentId_sheetId_type: {
              parentId: absence.student.parent.id,
              studentId: absence.studentId,
              sheetId: absence.sheetId,
              type: rule.trigger
            }
          },
          update: {
            subject: message.subject,
            body: message.body
          },
          create: {
            parentId: absence.student.parent.id,
            studentId: absence.studentId,
            sheetId: absence.sheetId,
            type: rule.trigger,
            subject: message.subject,
            body: message.body
          }
        });
      }
    }
  });

  revalidatePath("/notifications");
}

export async function setNotificationStatusAction(formData: FormData) {
  await requireStaff();
  const id = text(formData, "id");
  const statusText = text(formData, "status");
  const status =
    statusText === "SENT"
      ? ParentNotificationStatus.SENT
      : statusText === "DISMISSED"
        ? ParentNotificationStatus.DISMISSED
        : ParentNotificationStatus.QUEUED;

  await prisma.parentNotification.update({
    where: { id },
    data: {
      status,
      sentAt: status === ParentNotificationStatus.SENT ? new Date() : null
    }
  });

  revalidatePath("/notifications");
}

export async function markAllQueuedSentAction() {
  await requireStaff();
  await prisma.parentNotification.updateMany({
    where: { status: ParentNotificationStatus.QUEUED },
    data: {
      status: ParentNotificationStatus.SENT,
      sentAt: new Date()
    }
  });

  revalidatePath("/notifications");
}

export async function upsertEmailRuleAction(formData: FormData) {
  const session = await requireStaff();
  if (session.role !== UserRole.ADMIN) {
    redirect("/");
  }

  const id = text(formData, "id");
  const thresholdValue = text(formData, "thresholdCount");
  const thresholdCount = thresholdValue ? Number(thresholdValue) : null;
  const data = {
    name: text(formData, "name"),
    trigger: parseEmailTrigger(text(formData, "trigger")),
    enabled: checked(formData, "enabled"),
    thresholdCount: Number.isFinite(thresholdCount) ? thresholdCount : null
  };

  if (id) {
    await prisma.emailRule.update({ where: { id }, data });
  } else {
    await prisma.emailRule.create({ data });
  }

  revalidatePath("/notifications");
}
