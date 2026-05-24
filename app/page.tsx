import { AttendanceBoard } from "@/app/attendance-board";
import { LoginForm } from "@/app/login-form";
import { clampToSchoolYear, dateInputValue, isAllowedSchoolDate, type SchoolCalendarException, type SchoolYearDateBounds } from "@/lib/school-calendar";
import { prisma } from "@/lib/prisma";
import { parseSessionToken, sessionCookieName } from "@/lib/session";
import { dateToWeekDay, formatDateInput, schoolHours, weekDays } from "@/lib/school-time";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

type HomeProps = {
  searchParams: Promise<{
    classId?: string;
    date?: string;
    day?: string;
    hour?: string;
  }>;
};

function validInitialHour(hour: string | undefined) {
  const parsedHour = Number(hour);

  if (Number.isInteger(parsedHour) && parsedHour >= 1 && parsedHour <= 7) {
    return parsedHour;
  }

  return currentGreekSchoolSelection().hour;
}

function currentGreekSchoolSelection() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Athens",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const monthDay = Number(parts.find((part) => part.type === "day")?.value);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  const dayByWeekday: Record<string, string> = {
    Mon: "MONDAY",
    Tue: "TUESDAY",
    Wed: "WEDNESDAY",
    Thu: "THURSDAY",
    Fri: "FRIDAY"
  };
  const day = weekday ? dayByWeekday[weekday] : undefined;
  const greekDate = Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(monthDay)
    ? new Date(year, month - 1, monthDay)
    : new Date();

  function nextSchoolDate(fromDate: Date) {
    const nextDate = new Date(fromDate);
    nextDate.setDate(nextDate.getDate() + 1);
    while (nextDate.getDay() === 0 || nextDate.getDay() === 6) {
      nextDate.setDate(nextDate.getDate() + 1);
    }
    return nextDate;
  }

  if (!day || !Number.isFinite(hour) || !Number.isFinite(minute)) {
    const nextDate = nextSchoolDate(greekDate);
    return { date: formatDateInput(nextDate), day: dateToWeekDay(formatDateInput(nextDate)) ?? "MONDAY", hour: 1 };
  }

  const minutes = hour * 60 + minute;
  const schoolHour = schoolHours.find((slot) => {
    const [startHour, startMinute] = slot.starts.split(":").map(Number);
    const [endHour, endMinute] = slot.ends.split(":").map(Number);
    const start = startHour * 60 + startMinute;
    const end = endHour * 60 + endMinute;

    return minutes >= start && minutes <= end;
  });

  const lastHour = schoolHours.at(-1);
  if (lastHour) {
    const [lastEndHour, lastEndMinute] = lastHour.ends.split(":").map(Number);
    if (minutes > lastEndHour * 60 + lastEndMinute) {
      const nextDate = nextSchoolDate(greekDate);
      return { date: formatDateInput(nextDate), day: dateToWeekDay(formatDateInput(nextDate)) ?? "MONDAY", hour: 1 };
    }
  }

  return { date: formatDateInput(greekDate), day, hour: schoolHour?.hour ?? 1 };
}

function nearestAllowedAttendanceDate(
  dateValue: string,
  bounds: SchoolYearDateBounds | null,
  calendarExceptions: SchoolCalendarException[]
) {
  const startDate = new Date(`${clampToSchoolYear(dateValue, bounds)}T12:00:00`);

  for (let offset = 0; offset <= 370; offset += 1) {
    const nextDate = new Date(startDate);
    nextDate.setDate(nextDate.getDate() + offset);
    const nextValue = formatDateInput(nextDate);
    if (dateToWeekDay(nextValue) && isAllowedSchoolDate(nextValue, bounds, calendarExceptions)) {
      return nextValue;
    }
  }

  for (let offset = 1; offset <= 370; offset += 1) {
    const previousDate = new Date(startDate);
    previousDate.setDate(previousDate.getDate() - offset);
    const previousValue = formatDateInput(previousDate);
    if (dateToWeekDay(previousValue) && isAllowedSchoolDate(previousValue, bounds, calendarExceptions)) {
      return previousValue;
    }
  }

  return clampToSchoolYear(dateValue, bounds);
}

function validInitialDate(
  date: string | undefined,
  bounds: SchoolYearDateBounds | null,
  calendarExceptions: SchoolCalendarException[]
) {
  const candidate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : currentGreekSchoolSelection().date;
  const clampedCandidate = clampToSchoolYear(candidate, bounds);
  if (dateToWeekDay(clampedCandidate) && isAllowedSchoolDate(clampedCandidate, bounds, calendarExceptions)) {
    return clampedCandidate;
  }

  return nearestAllowedAttendanceDate(clampedCandidate, bounds, calendarExceptions);
}

function initialDay(date: string, day: string | undefined) {
  return dateToWeekDay(date) ?? (day && weekDays.some((weekDay) => weekDay.value === day) ? day : currentGreekSchoolSelection().day);
}

export default async function Home({ searchParams }: HomeProps) {
  const cookieStore = await cookies();
  const session = parseSessionToken(cookieStore.get(sessionCookieName)?.value);
  const params = await searchParams;

  if (!session) {
    return <LoginForm />;
  }

  if (session.mustChangePassword) {
    redirect("/account/password");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: {
      class: {
        include: { schoolYear: true }
      },
      teacher: true
    }
  });

  if (!user) {
    return <LoginForm />;
  }

  if (user.role === "PARENT") {
    redirect("/parent");
  }

  const isClassTablet = user.role === "CLASS_TABLET";
  const activeYear = await prisma.schoolYear.findFirst({
    where: { status: "ACTIVE" },
    include: { calendarDays: true },
    orderBy: { startsOn: "desc" }
  });
  const schoolYearBounds = activeYear
    ? {
        startsOn: dateInputValue(activeYear.startsOn),
        endsOn: dateInputValue(activeYear.endsOn)
      }
    : null;
  const calendarExceptions = activeYear
    ? activeYear.calendarDays.map((calendarDay) => ({
        date: dateInputValue(calendarDay.date),
        isWorkingDay: calendarDay.isWorkingDay
      }))
    : [];
  const adminClasses =
    user.role === "ADMIN"
      ? await prisma.class.findMany({
          include: { schoolYear: true },
          orderBy: [{ schoolYear: { startsOn: "desc" } }, { name: "asc" }]
        })
      : [];
  const teacherClasses =
    user.role === "TEACHER" && user.teacher
      ? await prisma.class.findMany({
          where: {
            OR: [
              { responsibleTeacherId: user.teacher.id },
              { teachers: { some: { id: user.teacher.id } } },
              { courses: { some: { teachers: { some: { teacherId: user.teacher.id } } } } }
            ]
          },
          include: { schoolYear: true },
          orderBy: [{ schoolYear: { startsOn: "desc" } }, { name: "asc" }]
        })
      : [];
  if (user.role === "ADMIN" && adminClasses.length === 0) {
    redirect("/admin");
  }

  const availableClasses =
    adminClasses.length > 0
      ? adminClasses.map((classRecord) => ({
          id: classRecord.id,
          name: classRecord.name,
          grade: classRecord.year === "B" ? "Β" : classRecord.year === "C" ? "Γ" : "Α",
          schoolYear: classRecord.schoolYear.name,
          isResponsible: false
        }))
      : teacherClasses.length > 0
        ? teacherClasses.map((classRecord) => ({
            id: classRecord.id,
            name: classRecord.name,
            grade: classRecord.year === "B" ? "Β" : classRecord.year === "C" ? "Γ" : "Α",
            schoolYear: classRecord.schoolYear.name,
            isResponsible: classRecord.responsibleTeacherId === user.teacher?.id
          }))
      : user.class
        ? [
            {
              id: user.class.id,
              name: user.class.name,
              grade: user.class.year === "B" ? "Β" : user.class.year === "C" ? "Γ" : "Α",
              schoolYear: user.class.schoolYear.name,
              isResponsible: false
            }
          ]
        : [
            {
              id: "class-a1",
              name: "Α1",
              grade: "Α",
              schoolYear: "2025-2026",
              isResponsible: false
            }
          ];
  const userLabel = user.teacher ? `${user.teacher.name} ${user.teacher.surname}` : user.class ? `Τάξη ${user.class.name}` : user.username;
  const requestedClass = availableClasses.find((classRecord) => classRecord.id === params.classId);
  const initialClassId = requestedClass?.id ?? user.classId ?? availableClasses[0]?.id ?? "class-a1";
  const selectedDate = validInitialDate(params.date, schoolYearBounds, calendarExceptions);
  const selectedDay = initialDay(selectedDate, params.day);

  return (
    <AttendanceBoard
      initialMode={isClassTablet ? "tablet" : "teacher"}
      userLabel={userLabel}
      initialClassId={initialClassId}
      initialDate={selectedDate}
      initialDay={selectedDay}
      initialHour={validInitialHour(params.hour)}
      availableClasses={availableClasses}
      username={user.username}
      isAdmin={user.role === "ADMIN"}
      currentTeacherId={user.teacher?.id ?? null}
      showClassSelection={user.role === "TEACHER" && !params.classId}
      schoolYearBounds={schoolYearBounds}
      calendarExceptions={calendarExceptions}
    />
  );
}
