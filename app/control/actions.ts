"use server";

import { AbsenceStatus, EmailTrigger, ParentNotificationStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sendSystemEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { studentParents } from "@/lib/family";
import { hourLabel, weekDayLabel } from "@/lib/report-helpers";
import { dateToWeekDay } from "@/lib/school-time";
import { parseSessionToken, sessionCookieName } from "@/lib/session";

async function requireAdmin() {
  const cookieStore = await cookies();
  const session = parseSessionToken(cookieStore.get(sessionCookieName)?.value);

  if (!session || session.role !== "ADMIN" || session.mustChangePassword) {
    redirect("/");
  }

  return session;
}

function controlPath(message: string, type: "success" | "error" = "success") {
  const params = new URLSearchParams({
    notice: message,
    noticeType: type
  });

  return `/control?${params.toString()}`;
}

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function dateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function greekDateLabel(date: Date) {
  return new Intl.DateTimeFormat("el-GR", {
    dateStyle: "full",
    timeZone: "Europe/Athens"
  }).format(date);
}

export async function sendTodayFirstHourAbsenceEmailsAction(formData: FormData) {
  await requireAdmin();
  const dateValue = text(formData, "date");
  const schoolYearId = text(formData, "schoolYearId");
  const day = dateToWeekDay(dateValue);

  if (!dateValue || !day) {
    redirect(controlPath("Η ημερομηνία πρέπει να είναι εργάσιμη ημέρα Δευτέρα έως Παρασκευή.", "error"));
  }

  const schoolYear = schoolYearId
    ? await prisma.schoolYear.findUnique({ where: { id: schoolYearId }, include: { calendarDays: true } })
    : await prisma.schoolYear.findFirst({ where: { status: "ACTIVE" }, include: { calendarDays: true } });

  if (!schoolYear) {
    redirect(controlPath("Δεν βρέθηκε ενεργό σχολικό έτος.", "error"));
  }

  const selectedDate = dateOnly(dateValue);
  if (selectedDate < schoolYear.startsOn || selectedDate > schoolYear.endsOn) {
    redirect(controlPath("Η ημερομηνία είναι εκτός ορίων του σχολικού έτους.", "error"));
  }

  const calendarException = schoolYear.calendarDays.find((calendarDay) => calendarDay.date.toISOString().slice(0, 10) === dateValue);
  if (calendarException?.isWorkingDay === false) {
    redirect(controlPath("Η ημερομηνία έχει δηλωθεί αργία. Δεν δημιουργήθηκαν emails.", "error"));
  }

  const absences = await prisma.attendanceSheetAbsence.findMany({
    where: {
      absent: true,
      status: { not: AbsenceStatus.REMOVED },
      sheet: {
        date: selectedDate,
        hour: 1,
        class: { schoolYearId: schoolYear.id }
      },
      student: { OR: [{ parentId: { not: null } }, { secondParentId: { not: null } }] }
    },
    include: {
      student: {
        include: {
          parent: true,
          secondParent: true,
          class: true
        }
      },
      sheet: {
        include: {
          course: true,
          courses: {
            include: {
              course: true
            },
            orderBy: { position: "asc" }
          }
        }
      }
    },
    orderBy: [{ student: { class: { name: "asc" } } }, { student: { surname: "asc" } }, { student: { name: "asc" } }]
  });

  if (absences.length === 0) {
    redirect(controlPath("Δεν βρέθηκαν απουσίες πρώτης ώρας για την επιλεγμένη ημερομηνία."));
  }

  let queued = 0;
  let sent = 0;
  let failed = 0;
  let missingEmail = 0;
  const failures: string[] = [];

  for (const absence of absences) {
    const parents = studentParents(absence.student).filter((parent) => parent.email.trim());
    if (parents.length === 0) {
      missingEmail += 1;
      continue;
    }

    const studentName = `${absence.student.surname} ${absence.student.name}`;
    const courseNames = absence.sheet.courses.length > 0
      ? absence.sheet.courses.map((courseLink) => courseLink.course.name).join(" / ")
      : absence.sheet.course.name;
    const subject = `Απουσία πρώτης ώρας - ${studentName}`;
    const body = [
      `Σας ενημερώνουμε ότι ο/η μαθητής/μαθήτρια ${studentName} καταχωρίστηκε απών/απούσα την πρώτη ώρα.`,
      `Ημερομηνία: ${greekDateLabel(selectedDate)}.`,
      `Τμήμα: ${absence.student.class.name}.`,
      `Ώρα: ${hourLabel(absence.sheet.hour)} (${weekDayLabel(absence.sheet.day)}).`,
      `Μάθημα: ${courseNames}.`
    ].join("\n");

    for (const parent of parents) {
      const notification = await prisma.parentNotification.upsert({
        where: {
          parentId_studentId_sheetId_type: {
            parentId: parent.id,
            studentId: absence.studentId,
            sheetId: absence.sheetId,
            type: EmailTrigger.FIRST_HOUR_ABSENCE
          }
        },
        update: {
          subject,
          body,
          status: ParentNotificationStatus.QUEUED,
          sentAt: null
        },
        create: {
          parentId: parent.id,
          studentId: absence.studentId,
          sheetId: absence.sheetId,
          type: EmailTrigger.FIRST_HOUR_ABSENCE,
          subject,
          body
        }
      });
      queued += 1;

      const result = await sendSystemEmail(parent.email, subject, body);
      if (result.sent) {
        sent += 1;
        await prisma.parentNotification.update({
          where: { id: notification.id },
          data: {
            status: ParentNotificationStatus.SENT,
            sentAt: new Date()
          }
        });
      } else {
        failed += 1;
        if (failures.length < 2) {
          failures.push(result.reason);
        }
      }
    }
  }

  revalidatePath("/control");
  revalidatePath("/notifications");

  const details = failures.length > 0 ? ` (${failures.join(" · ")})` : "";
  redirect(controlPath(`Δημιουργήθηκαν ${queued} ενημερώσεις. Στάλθηκαν ${sent}, έμειναν σε ουρά ${failed}, χωρίς email γονέα ${missingEmail}.${details}`, failed > 0 ? "error" : "success"));
}
