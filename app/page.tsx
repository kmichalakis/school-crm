import { AttendanceBoard } from "@/app/attendance-board";
import { LoginForm } from "@/app/login-form";
import { prisma } from "@/lib/prisma";
import { parseSessionToken, sessionCookieName } from "@/lib/session";
import { schoolHours, weekDays } from "@/lib/school-time";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

type HomeProps = {
  searchParams: Promise<{
    classId?: string;
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
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Athens",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date());
  const weekday = parts.find((part) => part.type === "weekday")?.value;
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

  if (!day || !Number.isFinite(hour) || !Number.isFinite(minute)) {
    return { day: "MONDAY", hour: 1 };
  }

  const minutes = hour * 60 + minute;
  const schoolHour = schoolHours.find((slot) => {
    const [startHour, startMinute] = slot.starts.split(":").map(Number);
    const [endHour, endMinute] = slot.ends.split(":").map(Number);
    const start = startHour * 60 + startMinute;
    const end = endHour * 60 + endMinute;

    return minutes >= start && minutes <= end;
  });

  return { day, hour: schoolHour?.hour ?? 1 };
}

function initialDay(day: string | undefined) {
  return day && weekDays.some((weekDay) => weekDay.value === day) ? day : currentGreekSchoolSelection().day;
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
          schoolYear: classRecord.schoolYear.name
        }))
      : teacherClasses.length > 0
        ? teacherClasses.map((classRecord) => ({
            id: classRecord.id,
            name: classRecord.name,
            grade: classRecord.year === "B" ? "Β" : classRecord.year === "C" ? "Γ" : "Α",
            schoolYear: classRecord.schoolYear.name
          }))
      : user.class
        ? [
            {
              id: user.class.id,
              name: user.class.name,
              grade: user.class.year === "B" ? "Β" : user.class.year === "C" ? "Γ" : "Α",
              schoolYear: user.class.schoolYear.name
            }
          ]
        : [
            {
              id: "class-a1",
              name: "Α1",
              grade: "Α",
              schoolYear: "2026-2027"
            }
          ];
  const userLabel = user.teacher ? `${user.teacher.name} ${user.teacher.surname}` : user.class ? `Τάξη ${user.class.name}` : user.username;
  const requestedClass = availableClasses.find((classRecord) => classRecord.id === params.classId);
  const initialClassId = requestedClass?.id ?? user.classId ?? availableClasses[0]?.id ?? "class-a1";

  return (
    <AttendanceBoard
      initialMode={isClassTablet ? "tablet" : "teacher"}
      userLabel={userLabel}
      initialClassId={initialClassId}
      initialDay={initialDay(params.day)}
      initialHour={validInitialHour(params.hour)}
      availableClasses={availableClasses}
      username={user.username}
      isAdmin={user.role === "ADMIN"}
    />
  );
}
