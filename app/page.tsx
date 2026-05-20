import { AttendanceBoard } from "@/app/attendance-board";
import { LoginForm } from "@/app/login-form";
import { prisma } from "@/lib/prisma";
import { parseSessionToken, sessionCookieName } from "@/lib/session";
import { getCurrentSchoolHour, weekDays } from "@/lib/school-time";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

type HomeProps = {
  searchParams: Promise<{
    classId?: string;
    day?: string;
    hour?: string;
  }>;
};

function validInitialDay(day: string | undefined): string {
  return day && weekDays.some((weekDay) => weekDay.value === day) ? day : "MONDAY";
}

function validInitialHour(hour: string | undefined) {
  const parsedHour = Number(hour);

  if (Number.isInteger(parsedHour) && parsedHour >= 1 && parsedHour <= 7) {
    return parsedHour;
  }

  return getCurrentSchoolHour().hour;
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
      initialDay={validInitialDay(params.day)}
      initialHour={validInitialHour(params.hour)}
      availableClasses={availableClasses}
      username={user.username}
      isAdmin={user.role === "ADMIN"}
    />
  );
}
