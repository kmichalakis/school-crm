"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { WeekDay } from "@prisma/client";
import { dateInputValue, isAllowedSchoolDate, isWeekdayDate, isWithinSchoolYear } from "@/lib/school-calendar";
import { formatDateInput, dateToWeekDay } from "@/lib/school-time";
import { prisma } from "@/lib/prisma";
import { parseSessionToken, sessionCookieName } from "@/lib/session";
import { cookies } from "next/headers";

function attendanceDate(dateValue: string) {
  return new Date(`${dateValue}T00:00:00.000Z`);
}

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function requireAdmin() {
  const cookieStore = await cookies();
  const session = parseSessionToken(cookieStore.get(sessionCookieName)?.value);

  if (!session || session.role !== "ADMIN" || session.mustChangePassword) {
    redirect("/");
  }

  return session;
}

function finishScheduleAction(classId: string, date: string, message: string, type: "success" | "error" = "success"): never {
  const params = new URLSearchParams({
    classId,
    date,
    notice: message,
    noticeType: type
  });

  redirect(`/schedule?${params.toString()}`);
}

async function nextNoCourseAa(classId: string) {
  const baseAa = "KENO";
  const existingCourses = await prisma.course.findMany({
    where: {
      classId,
      aa: {
        startsWith: baseAa
      }
    },
    select: { aa: true }
  });
  const existingAas = new Set(existingCourses.map((course) => course.aa));

  if (!existingAas.has(baseAa)) {
    return baseAa;
  }

  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${baseAa}-${index}`;
    if (!existingAas.has(candidate)) {
      return candidate;
    }
  }

  return `${baseAa}-${Date.now()}`;
}

async function ensureNoCourse(classId: string) {
  const existingNoCourse = await prisma.course.findFirst({
    where: {
      classId,
      OR: [{ isNoCourse: true }, { name: "ΚΕΝΟ" }]
    },
    orderBy: { createdAt: "asc" }
  });

  if (existingNoCourse) {
    return prisma.course.update({
      where: { id: existingNoCourse.id },
      data: { isNoCourse: true },
      include: {
        teachers: {
          include: {
            teacher: true
          }
        }
      }
    });
  }

  return prisma.course.create({
    data: {
      aa: await nextNoCourseAa(classId),
      classId,
      name: "ΚΕΝΟ",
      isNoCourse: true
    },
    include: {
      teachers: {
        include: {
          teacher: true
        }
      }
    }
  });
}

async function nextSubstitutionAa(classId: string) {
  const baseAa = "ANAPL";
  const existingCourses = await prisma.course.findMany({
    where: {
      classId,
      aa: {
        startsWith: baseAa
      }
    },
    select: { aa: true }
  });
  const existingAas = new Set(existingCourses.map((course) => course.aa));

  if (!existingAas.has(baseAa)) {
    return baseAa;
  }

  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${baseAa}-${index}`;
    if (!existingAas.has(candidate)) {
      return candidate;
    }
  }

  return `${baseAa}-${Date.now()}`;
}

async function ensureSubstitutionCourse(classId: string) {
  const existingSubstitutionCourse = await prisma.course.findFirst({
    where: {
      classId,
      OR: [{ isSubstitution: true }, { name: "ΑΝΑΠΛΗΡΩΣΗ" }]
    },
    orderBy: { createdAt: "asc" }
  });

  if (existingSubstitutionCourse) {
    return prisma.course.update({
      where: { id: existingSubstitutionCourse.id },
      data: { isSubstitution: true },
      include: {
        teachers: {
          include: {
            teacher: true
          }
        }
      }
    });
  }

  return prisma.course.create({
    data: {
      aa: await nextSubstitutionAa(classId),
      classId,
      name: "ΑΝΑΠΛΗΡΩΣΗ",
      isSubstitution: true
    },
    include: {
      teachers: {
        include: {
          teacher: true
        }
      }
    }
  });
}

export async function saveDailyScheduleAction(formData: FormData) {
  await requireAdmin();
  const classId = text(formData, "classId");
  const date = text(formData, "date");
  const day = dateToWeekDay(date) as WeekDay | null;

  if (!classId || !date || !day) {
    finishScheduleAction(classId, date, "Επιλέξτε έγκυρη εργάσιμη ημερομηνία.", "error");
  }

  const classRecord = await prisma.class.findUnique({
    where: { id: classId },
    include: {
      schoolYear: {
        include: {
          calendarDays: true
        }
      }
    }
  });

  if (!classRecord) {
    finishScheduleAction(classId, date, "Το τμήμα δεν βρέθηκε.", "error");
  }

  const today = formatDateInput(new Date());
  if (date < today) {
    finishScheduleAction(classId, date, "Οι έκτακτες αλλαγές προγράμματος γίνονται μόνο για σήμερα ή επόμενες ημέρες.", "error");
  }

  const bounds = {
    startsOn: dateInputValue(classRecord.schoolYear.startsOn),
    endsOn: dateInputValue(classRecord.schoolYear.endsOn)
  };
  const calendarExceptions = classRecord.schoolYear.calendarDays.map((calendarDay) => ({
    date: dateInputValue(calendarDay.date),
    isWorkingDay: calendarDay.isWorkingDay
  }));

  if (!isAllowedSchoolDate(date, bounds, calendarExceptions)) {
    finishScheduleAction(classId, date, "Η ημερομηνία είναι αργία, Σαββατοκύριακο ή εκτός σχολικού έτους.", "error");
  }

  const selectedCourseIdsByHour = new Map<number, string[]>();
  const selectedTeacherIdsByHourPosition = new Map<string, string>();
  const allCourseIds = new Set<string>();

  for (let hour = 1; hour <= 7; hour += 1) {
    const courseIds = [text(formData, `hour-${hour}-course-0`), text(formData, `hour-${hour}-course-1`)].filter(Boolean);
    const uniqueCourseIds = Array.from(new Set(courseIds));

    if (uniqueCourseIds.length > 2) {
      finishScheduleAction(classId, date, "Μπορούν να οριστούν μέχρι δύο μαθήματα ανά ώρα.", "error");
    }

    selectedCourseIdsByHour.set(hour, uniqueCourseIds);
    [0, 1].forEach((position) => {
      const teacherId = text(formData, `hour-${hour}-teacher-${position}`);
      if (teacherId) {
        selectedTeacherIdsByHourPosition.set(`${hour}-${position}`, teacherId);
      }
    });
    for (const courseId of uniqueCourseIds) {
      allCourseIds.add(courseId);
    }
  }

  const courses = await prisma.course.findMany({
    where: { id: { in: Array.from(allCourseIds) } },
    include: {
      teachers: {
        include: {
          teacher: true
        }
      }
    }
  });
  const courseById = new Map(courses.map((course) => [course.id, course]));

  for (const courseId of allCourseIds) {
    const course = courseById.get(courseId);
    if (!course || course.classId !== classId || course.isNoCourse) {
      finishScheduleAction(classId, date, "Όλα τα μαθήματα πρέπει να ανήκουν στο επιλεγμένο τμήμα.", "error");
    }
  }

  const [noCourse, substitutionCourse] = await Promise.all([ensureNoCourse(classId), ensureSubstitutionCourse(classId)]);
  courseById.set(substitutionCourse.id, substitutionCourse);
  const existingSheets = await prisma.attendanceSheet.findMany({
    where: {
      classId,
      date: attendanceDate(date)
    },
    include: {
      absences: true,
      courses: true
    }
  });

  for (const sheet of existingSheets) {
    const hasAttendanceData =
      sheet.absences.length > 0 || Boolean(sheet.signedAt) || sheet.courses.some((course) => Boolean(course.signedAt));
    if (hasAttendanceData) {
      finishScheduleAction(
        classId,
        date,
        "Δεν μπορεί να αλλάξει πρόγραμμα σε ώρα που έχει ήδη απουσίες ή υπογραφή.",
        "error"
      );
    }
  }

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    for (let hour = 1; hour <= 7; hour += 1) {
      const selectedCourseIds = selectedCourseIdsByHour.get(hour) ?? [];
      const effectiveCourseIds = selectedCourseIds.length > 0 ? selectedCourseIds : [noCourse.id];
      const selectedCourses = effectiveCourseIds.map((courseId) => courseById.get(courseId) ?? noCourse);
      const isNoCourseHour = selectedCourses.every((course) => course.isNoCourse);
      const selectedCourseTeachers = await Promise.all(
        selectedCourses.map(async (course, position) => {
          const selectedTeacherId = selectedTeacherIdsByHourPosition.get(`${hour}-${position}`);
          if (course.isSubstitution) {
            if (!selectedTeacherId) {
              finishScheduleAction(classId, date, "Στην ΑΝΑΠΛΗΡΩΣΗ πρέπει να οριστεί εκπαιδευτικός.", "error");
            }

            const teacher = await tx.teacher.findUnique({ where: { id: selectedTeacherId } });
            if (!teacher) {
              finishScheduleAction(classId, date, "Ο εκπαιδευτικός αναπλήρωσης δεν βρέθηκε.", "error");
            }
            return teacher;
          }

          return course.teachers[0]?.teacher ?? null;
        })
      );
      const teacherNames = Array.from(
        new Set(selectedCourseTeachers.filter(Boolean).map((teacher) => `${teacher.name} ${teacher.surname}`))
      );
      const sheet = await tx.attendanceSheet.upsert({
        where: {
          classId_date_hour: {
            classId,
            date: attendanceDate(date),
            hour
          }
        },
        update: {
          courseId: selectedCourses[0].id,
          day,
          teacherName: isNoCourseHour ? "ΚΕΝΟ" : teacherNames.join(" / "),
          savedAt: now,
          signedAt: isNoCourseHour ? now : null,
          signedByTeacherId: null
        },
        create: {
          classId,
          courseId: selectedCourses[0].id,
          date: attendanceDate(date),
          day,
          hour,
          teacherName: isNoCourseHour ? "ΚΕΝΟ" : teacherNames.join(" / "),
          savedAt: now,
          signedAt: isNoCourseHour ? now : null,
          signedByTeacherId: null
        }
      });

      await tx.attendanceSheetCourse.deleteMany({ where: { sheetId: sheet.id } });
      await tx.attendanceSheetCourse.createMany({
        data: selectedCourses.map((course, position) => ({
          sheetId: sheet.id,
          courseId: course.id,
          teacherId: selectedCourseTeachers[position]?.id ?? null,
          position,
          signedAt: course.isNoCourse ? now : null
        }))
      });
    }
  });

  revalidatePath("/schedule");
  revalidatePath("/");
  revalidatePath("/teacher");
  revalidatePath("/pending");
  finishScheduleAction(classId, date, "Το ημερήσιο πρόγραμμα αποθηκεύτηκε.");
}

export async function toggleScheduleHolidayAction(formData: FormData) {
  await requireAdmin();
  const classId = text(formData, "classId");
  const date = text(formData, "date");
  const isHoliday = formData.get("isHoliday") === "on";

  if (!classId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    finishScheduleAction(classId, date, "Επιλέξτε έγκυρη ημερομηνία.", "error");
  }

  const classRecord = await prisma.class.findUnique({
    where: { id: classId },
    include: { schoolYear: true }
  });

  if (!classRecord) {
    finishScheduleAction(classId, date, "Το τμήμα δεν βρέθηκε.", "error");
  }

  const bounds = {
    startsOn: dateInputValue(classRecord.schoolYear.startsOn),
    endsOn: dateInputValue(classRecord.schoolYear.endsOn)
  };

  if (!isWithinSchoolYear(date, bounds) || !isWeekdayDate(date)) {
    finishScheduleAction(classId, date, "Οι αργίες από το πρόγραμμα ορίζονται μόνο για καθημερινές μέσα στο σχολικό έτος.", "error");
  }

  const calendarDate = attendanceDate(date);
  if (isHoliday) {
    await prisma.schoolCalendarDay.upsert({
      where: {
        schoolYearId_date: {
          schoolYearId: classRecord.schoolYearId,
          date: calendarDate
        }
      },
      update: {
        isWorkingDay: false,
        note: "Αργία από το πρόγραμμα"
      },
      create: {
        schoolYearId: classRecord.schoolYearId,
        date: calendarDate,
        isWorkingDay: false,
        note: "Αργία από το πρόγραμμα"
      }
    });
  } else {
    await prisma.schoolCalendarDay.deleteMany({
      where: {
        schoolYearId: classRecord.schoolYearId,
        date: calendarDate,
        isWorkingDay: false
      }
    });
  }

  revalidatePath("/schedule");
  revalidatePath("/");
  revalidatePath("/teacher");
  revalidatePath("/pending");
  revalidatePath("/print");
  finishScheduleAction(classId, date, isHoliday ? "Η ημερομηνία ορίστηκε ως αργία." : "Η ημερομηνία ορίστηκε ως εργάσιμη.");
}
