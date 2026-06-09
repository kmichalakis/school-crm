import { type Prisma } from "@prisma/client";
import { appointmentDate } from "@/lib/appointments";
import { dateInputValue } from "@/lib/school-calendar";
import { prisma } from "@/lib/prisma";

export type AppointmentQueryScope = "date" | "teacher" | "teacher-upcoming";

export function validAppointmentDate(value: string | undefined, fallback: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return fallback;
  }
  return value;
}

export async function loadAppointmentRows(where: Prisma.ParentTeacherAppointmentWhereInput, showAllDaysForTeacher: boolean) {
  return prisma.parentTeacherAppointment.findMany({
    where,
    include: {
      parent: true,
      student: {
        include: { class: true }
      },
      teacher: true
    },
    orderBy: [{ date: showAllDaysForTeacher ? "desc" : "asc" }, { hour: "asc" }, { teacher: { surname: "asc" } }]
  });
}

export async function appointmentWhereForSession(args: {
  date: string;
  role: string;
  selectedTeacherId?: string;
  sessionUserId: string;
  today?: string;
}) {
  const today = args.today ?? dateInputValue(new Date());

  if (args.role === "TEACHER") {
    const teacher = await prisma.teacher.findUnique({ where: { userId: args.sessionUserId } });
    if (!teacher) {
      return { where: { id: "__missing__" }, scope: "teacher-upcoming" as AppointmentQueryScope, showAllDaysForTeacher: false };
    }

    return {
      where: {
        teacherId: teacher.id,
        date: { gte: appointmentDate(today) }
      },
      scope: "teacher-upcoming" as AppointmentQueryScope,
      showAllDaysForTeacher: false
    };
  }

  if (args.selectedTeacherId) {
    return {
      where: { teacherId: args.selectedTeacherId },
      scope: "teacher" as AppointmentQueryScope,
      showAllDaysForTeacher: true
    };
  }

  return {
    where: { date: appointmentDate(args.date) },
    scope: "date" as AppointmentQueryScope,
    showAllDaysForTeacher: false
  };
}

export type AppointmentRow = Awaited<ReturnType<typeof loadAppointmentRows>>[number];
