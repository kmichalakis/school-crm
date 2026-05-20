import { NextRequest, NextResponse } from "next/server";
import { WeekDay } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseSessionToken, sessionCookieName } from "@/lib/session";
import type { AttendanceSheetPayload, SaveAttendanceRequest } from "@/lib/attendance-types";

function isWeekDay(value: string | null): value is WeekDay {
  return value !== null && Object.values(WeekDay).includes(value as WeekDay);
}

function courseAutoAa(courseName: string) {
  const hash = Array.from(courseName).reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 100000, 17);
  return `AUTO-${String(hash).padStart(5, "0")}`;
}

async function buildSheetPayload(classId: string, day: WeekDay, hour: number): Promise<AttendanceSheetPayload> {
  const classRecord = await prisma.class.findUnique({
    where: { id: classId },
    include: {
      responsibleTeacher: true,
      students: {
        orderBy: [{ surname: "asc" }, { name: "asc" }]
      },
      courses: {
        orderBy: [{ isNoCourse: "asc" }, { name: "asc" }]
      }
    }
  });

  if (!classRecord) {
    throw new Error("Η τάξη δεν βρέθηκε.");
  }

  const sheet = await prisma.attendanceSheet.findUnique({
    where: {
      classId_day_hour: {
        classId,
        day,
        hour
      }
    },
    include: {
      absences: true,
      course: true
    }
  });

  const scheduledSlots = await prisma.scheduleSlot.findMany({
    where: {
      classId,
      day,
      hour
    },
    include: {
      course: {
        include: {
          teachers: {
            include: {
              teacher: true
            }
          }
        }
      }
    },
    orderBy: [{ course: { name: "asc" } }]
  });

  const scheduledCourseNames = scheduledSlots.map((slot) => slot.course.name);
  const scheduledTeacherNames = scheduledSlots
    .map((slot) => slot.course.teachers[0]?.teacher)
    .filter(Boolean)
    .map((teacher) => `${teacher!.name} ${teacher!.surname}`);
  const fallbackCourse = classRecord.courses.find((course) => !course.isNoCourse) ?? classRecord.courses[0];
  const responsibleTeacher = classRecord.responsibleTeacher
    ? `${classRecord.responsibleTeacher.name} ${classRecord.responsibleTeacher.surname}`
    : "Μαρία Παπαδοπούλου";
  const defaultTeacher = scheduledTeacherNames.length > 0 ? Array.from(new Set(scheduledTeacherNames)).join(" / ") : responsibleTeacher;
  const absentStudentIds = new Set(sheet?.absences.filter((absence) => absence.absent).map((absence) => absence.studentId) ?? []);

  return {
    day,
    hour,
    course: scheduledCourseNames.length > 0 ? scheduledCourseNames.join(" / ") : sheet?.course.name ?? fallbackCourse?.name ?? "ΚΕΝΟ",
    courses: classRecord.courses.map((course) => course.name),
    teacherName: sheet?.teacherName ?? defaultTeacher,
    students: classRecord.students.map((student) => ({
      id: student.id,
      code: student.am,
      name: student.name,
      surname: student.surname,
      absent: absentStudentIds.has(student.id)
    })),
    signedAt: sheet?.signedAt?.toISOString() ?? null,
    savedAt: sheet?.savedAt?.toISOString() ?? null,
    dirty: false
  };
}

export async function GET(request: NextRequest) {
  const session = parseSessionToken(request.cookies.get(sessionCookieName)?.value);
  const searchParams = request.nextUrl.searchParams;
  const classId = searchParams.get("classId");
  const day = searchParams.get("day");
  const hour = Number(searchParams.get("hour"));

  if (!session || session.mustChangePassword) {
    return NextResponse.json({ error: "Απαιτείται σύνδεση." }, { status: 401 });
  }

  if (!classId || !isWeekDay(day) || !Number.isInteger(hour) || hour < 1 || hour > 7) {
    return NextResponse.json({ error: "Μη έγκυρα στοιχεία απουσιολογίου." }, { status: 400 });
  }

  if (session.role === "CLASS_TABLET" && session.classId !== classId) {
    return NextResponse.json({ error: "Δεν υπάρχει πρόσβαση σε αυτή την τάξη." }, { status: 403 });
  }

  try {
    const payload = await buildSheetPayload(classId, day, hour);
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Αποτυχία φόρτωσης απουσιολογίου." },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const session = parseSessionToken(request.cookies.get(sessionCookieName)?.value);
  const body = (await request.json()) as SaveAttendanceRequest;

  if (!session || session.mustChangePassword) {
    return NextResponse.json({ error: "Απαιτείται σύνδεση." }, { status: 401 });
  }

  if (!body.classId || !isWeekDay(body.day) || !Number.isInteger(body.hour) || body.hour < 1 || body.hour > 7) {
    return NextResponse.json({ error: "Μη έγκυρα στοιχεία απουσιολογίου." }, { status: 400 });
  }

  if (session.role === "CLASS_TABLET" && session.classId !== body.classId) {
    return NextResponse.json({ error: "Δεν υπάρχει πρόσβαση σε αυτή την τάξη." }, { status: 403 });
  }

  if (session.role === "CLASS_TABLET" && body.action === "sign") {
    return NextResponse.json({ error: "Το τάμπλετ τάξης δεν μπορεί να υπογράψει." }, { status: 403 });
  }

  try {
    const day = body.day;
    const now = new Date();
    const scheduledSlots = await prisma.scheduleSlot.findMany({
      where: {
        classId: body.classId,
        day,
        hour: body.hour
      },
      include: {
        course: true
      }
    });
    const course =
      scheduledSlots[0]?.course ??
      (await prisma.course.upsert({
        where: {
          classId_name: {
            classId: body.classId,
            name: body.course
          }
        },
        update: {
          isNoCourse: body.course === "ΚΕΝΟ"
        },
        create: {
          aa: courseAutoAa(body.course),
          classId: body.classId,
          name: body.course,
          isNoCourse: body.course === "ΚΕΝΟ"
        }
      }));

    const teacher = await prisma.teacher.findFirst({
      where: {
        homeClassId: body.classId
      }
    });

    await prisma.$transaction(async (tx) => {
      const sheet = await tx.attendanceSheet.upsert({
        where: {
          classId_day_hour: {
            classId: body.classId,
            day,
            hour: body.hour
          }
        },
        update: {
          courseId: course.id,
          teacherName: body.teacherName,
          savedAt: now,
          signedAt: body.action === "sign" ? now : body.signedAt ? new Date(body.signedAt) : null,
          signedByTeacherId: body.action === "sign" ? teacher?.id ?? null : null
        },
        create: {
          classId: body.classId,
          courseId: course.id,
          day,
          hour: body.hour,
          teacherName: body.teacherName,
          savedAt: now,
          signedAt: body.action === "sign" ? now : body.signedAt ? new Date(body.signedAt) : null,
          signedByTeacherId: body.action === "sign" ? teacher?.id ?? null : null
        }
      });

      const previousAbsences = await tx.attendanceSheetAbsence.findMany({
        where: {
          sheetId: sheet.id
        }
      });
      const previousAbsenceByStudentId = new Map(previousAbsences.map((absence) => [absence.studentId, absence]));

      await tx.attendanceSheetAbsence.deleteMany({
        where: {
          sheetId: sheet.id
        }
      });

      const absentStudents = body.students.filter((student) => student.absent);
      if (absentStudents.length > 0) {
        await tx.attendanceSheetAbsence.createMany({
          data: absentStudents.map((student) => ({
            sheetId: sheet.id,
            studentId: student.id,
            absent: true,
            status: previousAbsenceByStudentId.get(student.id)?.status ?? "MARKED",
            excusedReason: previousAbsenceByStudentId.get(student.id)?.excusedReason ?? null,
            excusedAt: previousAbsenceByStudentId.get(student.id)?.excusedAt ?? null
          }))
        });
      }
    });

    const payload = await buildSheetPayload(body.classId, day, body.hour);
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Αποτυχία αποθήκευσης απουσιολογίου." },
      { status: 500 }
    );
  }
}
