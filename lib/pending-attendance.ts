import { WeekDay } from "@prisma/client";
import { dateInputValue, isAllowedSchoolDate } from "@/lib/school-calendar";
import { dateToWeekDay, formatDateInput } from "@/lib/school-time";
import { hourLabel, weekDayLabel } from "@/lib/report-helpers";
import { prisma } from "@/lib/prisma";

export type PendingAttendanceItem = {
  id: string;
  classId: string;
  className: string;
  courseId: string;
  courseName: string;
  date: string;
  dateLabel: string;
  day: WeekDay;
  dayLabel: string;
  hour: number;
  hourLabel: string;
  teacherId: string;
  teacherName: string;
};

export type PendingAttendanceResult = {
  items: PendingAttendanceItem[];
  schoolYearName: string | null;
  checkedUntil: string | null;
};

function attendanceDate(dateValue: string) {
  return new Date(`${dateValue}T00:00:00.000Z`);
}

function nextDateInput(dateValue: string) {
  const date = new Date(`${dateValue}T12:00:00`);
  date.setDate(date.getDate() + 1);
  return formatDateInput(date);
}

function previousDateInput(date: Date) {
  const previousDate = new Date(date);
  previousDate.setDate(previousDate.getDate() - 1);
  return formatDateInput(previousDate);
}

function minDateInput(first: string, second: string) {
  return first < second ? first : second;
}

function greekDateLabel(dateValue: string) {
  return new Intl.DateTimeFormat("el-GR", {
    dateStyle: "medium"
  }).format(new Date(`${dateValue}T12:00:00`));
}

function workingDatesByDay(startsOn: string, endsOn: string, exceptions: { date: string; isWorkingDay: boolean }[]) {
  const datesByDay = new Map<WeekDay, string[]>();
  let currentDate = startsOn;

  while (currentDate <= endsOn) {
    const day = dateToWeekDay(currentDate) as WeekDay | null;

    if (day && isAllowedSchoolDate(currentDate, { startsOn, endsOn }, exceptions)) {
      const dates = datesByDay.get(day) ?? [];
      dates.push(currentDate);
      datesByDay.set(day, dates);
    }

    currentDate = nextDateInput(currentDate);
  }

  return datesByDay;
}

export async function getPendingAttendanceItems({
  allTeachers = false,
  teacherId = null
}: {
  allTeachers?: boolean;
  teacherId?: string | null;
}): Promise<PendingAttendanceResult> {
  const activeYear = await prisma.schoolYear.findFirst({
    where: { status: "ACTIVE" },
    include: { calendarDays: true },
    orderBy: { startsOn: "desc" }
  });

  if (!activeYear) {
    return { items: [], schoolYearName: null, checkedUntil: null };
  }

  const startsOn = dateInputValue(activeYear.startsOn);
  const schoolYearEndsOn = dateInputValue(activeYear.endsOn);
  const yesterday = previousDateInput(new Date());
  const endsOn = minDateInput(schoolYearEndsOn, yesterday);

  if (endsOn < startsOn) {
    return { items: [], schoolYearName: activeYear.name, checkedUntil: null };
  }

  if (!allTeachers && !teacherId) {
    return { items: [], schoolYearName: activeYear.name, checkedUntil: endsOn };
  }

  const calendarExceptions = activeYear.calendarDays.map((calendarDay) => ({
    date: dateInputValue(calendarDay.date),
    isWorkingDay: calendarDay.isWorkingDay
  }));
  const datesByDay = workingDatesByDay(startsOn, endsOn, calendarExceptions);

  const scheduleSlots = await prisma.scheduleSlot.findMany({
    where: {
      course: {
        isNoCourse: false,
        class: {
          schoolYearId: activeYear.id
        }
      }
    },
    include: {
      course: {
        include: {
          class: true,
          teachers: {
            include: {
              teacher: true
            }
          }
        }
      }
    }
  });

  const sheets = await prisma.attendanceSheet.findMany({
    where: {
      class: {
        schoolYearId: activeYear.id
      },
      date: {
        gte: attendanceDate(startsOn),
        lte: attendanceDate(endsOn)
      }
    },
    include: {
      class: true,
      course: {
        include: {
          teachers: {
            include: {
              teacher: true
            }
          }
        }
      },
      courses: {
        include: {
          course: {
            include: {
              teachers: {
                include: {
                  teacher: true
                }
              }
            }
          },
          teacher: true
        }
      }
    }
  });
  const sheetByClassDateHour = new Map(sheets.map((sheet) => [`${sheet.classId}-${dateInputValue(sheet.date)}-${sheet.hour}`, sheet]));
  const handledSheetKeys = new Set<string>();

  const items: PendingAttendanceItem[] = [];

  for (const slot of scheduleSlots) {
    const slotDates = datesByDay.get(slot.day) ?? [];
    const teacher = allTeachers
      ? slot.course.teachers[0]?.teacher
      : slot.course.teachers.find((link) => link.teacherId === teacherId)?.teacher;

    if (slotDates.length === 0) {
      continue;
    }

    for (const date of slotDates) {
      const sheetKey = `${slot.classId}-${date}-${slot.hour}`;
      const sheet = sheetByClassDateHour.get(sheetKey);
      const isBlankSheet = sheet?.course.isNoCourse || sheet?.courses.some((course) => course.course.isNoCourse);

      if (isBlankSheet) {
        continue;
      }

      if (sheet && sheet.courses.length > 0) {
        if (!handledSheetKeys.has(sheetKey)) {
          handledSheetKeys.add(sheetKey);

          for (const sheetCourse of sheet.courses) {
            const sheetTeacher = sheetCourse.teacher ?? sheetCourse.course.teachers[0]?.teacher;

            if (
              sheetCourse.course.isNoCourse ||
              sheetCourse.signedAt ||
              !sheetTeacher ||
              (!allTeachers && sheetTeacher.id !== teacherId)
            ) {
              continue;
            }

            items.push({
              id: `${date}-${slot.classId}-${slot.hour}-${sheetCourse.courseId}-${sheetTeacher.id}`,
              classId: slot.classId,
              className: slot.course.class.name,
              courseId: sheetCourse.courseId,
              courseName: sheetCourse.course.name,
              date,
              dateLabel: greekDateLabel(date),
              day: slot.day,
              dayLabel: weekDayLabel(slot.day),
              hour: slot.hour,
              hourLabel: hourLabel(slot.hour),
              teacherId: sheetTeacher.id,
              teacherName: `${sheetTeacher.surname} ${sheetTeacher.name}`
            });
          }
        }

        continue;
      }

      const legacyTeacher = sheet?.course.teachers[0]?.teacher;
      if (sheet && sheet.courseId !== slot.courseId) {
        if (!sheet.signedAt && legacyTeacher && (allTeachers || legacyTeacher.id === teacherId)) {
          items.push({
            id: `${date}-${slot.classId}-${slot.hour}-${sheet.courseId}-${legacyTeacher.id}`,
            classId: slot.classId,
            className: slot.course.class.name,
            courseId: sheet.courseId,
            courseName: sheet.course.name,
            date,
            dateLabel: greekDateLabel(date),
            day: slot.day,
            dayLabel: weekDayLabel(slot.day),
            hour: slot.hour,
            hourLabel: hourLabel(slot.hour),
            teacherId: legacyTeacher.id,
            teacherName: `${legacyTeacher.surname} ${legacyTeacher.name}`
          });
        }

        continue;
      }

      if (!teacher || sheet?.signedAt || (!allTeachers && teacher.id !== teacherId)) {
        continue;
      }

      items.push({
        id: `${date}-${slot.classId}-${slot.hour}-${slot.courseId}-${teacher.id}`,
        classId: slot.classId,
        className: slot.course.class.name,
        courseId: slot.courseId,
        courseName: slot.course.name,
        date,
        dateLabel: greekDateLabel(date),
        day: slot.day,
        dayLabel: weekDayLabel(slot.day),
        hour: slot.hour,
        hourLabel: hourLabel(slot.hour),
        teacherId: teacher.id,
        teacherName: `${teacher.surname} ${teacher.name}`
      });
    }
  }

  for (const sheet of sheets) {
    const date = dateInputValue(sheet.date);
    const sheetKey = `${sheet.classId}-${date}-${sheet.hour}`;

    if (handledSheetKeys.has(sheetKey) || sheet.course.isNoCourse || sheet.courses.some((course) => course.course.isNoCourse)) {
      continue;
    }

    for (const sheetCourse of sheet.courses) {
      const sheetTeacher = sheetCourse.teacher ?? sheetCourse.course.teachers[0]?.teacher;

      if (sheetCourse.signedAt || !sheetTeacher || (!allTeachers && sheetTeacher.id !== teacherId)) {
        continue;
      }

      items.push({
        id: `${date}-${sheet.classId}-${sheet.hour}-${sheetCourse.courseId}-${sheetTeacher.id}`,
        classId: sheet.classId,
        className: sheet.class.name,
        courseId: sheetCourse.courseId,
        courseName: sheetCourse.course.name,
        date,
        dateLabel: greekDateLabel(date),
        day: sheet.day,
        dayLabel: weekDayLabel(sheet.day),
        hour: sheet.hour,
        hourLabel: hourLabel(sheet.hour),
        teacherId: sheetTeacher.id,
        teacherName: `${sheetTeacher.surname} ${sheetTeacher.name}`
      });
    }
  }

  items.sort((first, second) => {
    const dateOrder = first.date.localeCompare(second.date);
    if (dateOrder !== 0) return dateOrder;
    if (first.hour !== second.hour) return first.hour - second.hour;
    const classOrder = first.className.localeCompare(second.className, "el");
    if (classOrder !== 0) return classOrder;
    return first.teacherName.localeCompare(second.teacherName, "el");
  });

  return { items, schoolYearName: activeYear.name, checkedUntil: endsOn };
}
