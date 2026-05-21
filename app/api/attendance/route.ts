import { NextRequest, NextResponse } from "next/server";
import { WeekDay } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseSessionToken, sessionCookieName } from "@/lib/session";
import { verifyPassword } from "@/lib/password";
import type { AttendanceCourseEntry, AttendanceCourseOption, AttendanceSheetPayload, SaveAttendanceRequest } from "@/lib/attendance-types";

function isWeekDay(value: string | null): value is WeekDay {
  return value !== null && Object.values(WeekDay).includes(value as WeekDay);
}

function courseAutoAa(courseName: string) {
  const hash = Array.from(courseName).reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 100000, 17);
  return `AUTO-${String(hash).padStart(5, "0")}`;
}

function teacherName(teacher: { name: string; surname: string } | null | undefined) {
  return teacher ? `${teacher.name} ${teacher.surname}` : "Δεν έχει οριστεί εκπαιδευτικός";
}

function fullySignedAt(courseEntries: AttendanceCourseEntry[]) {
  if (courseEntries.length === 0 || courseEntries.some((entry) => !entry.signedAt)) {
    return null;
  }

  return courseEntries
    .map((entry) => entry.signedAt)
    .filter((signedAt): signedAt is string => signedAt !== null)
    .sort()
    .at(-1) ?? null;
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
        include: {
          teachers: {
            include: {
              teacher: true
            }
          }
        },
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
      course: true,
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
        },
        orderBy: { position: "asc" }
      }
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

  const courseOptions: AttendanceCourseOption[] = classRecord.courses.map((course) => {
    const teacher = course.teachers[0]?.teacher;
    return {
      courseId: course.id,
      name: course.name,
      teacherId: teacher?.id ?? null,
      teacherName: teacherName(teacher)
    };
  });
  const fallbackCourse = classRecord.courses.find((course) => !course.isNoCourse) ?? classRecord.courses[0];
  const responsibleTeacher = classRecord.responsibleTeacher
    ? teacherName(classRecord.responsibleTeacher)
    : "Μαρία Παπαδοπούλου";
  const absentStudentIds = new Set(sheet?.absences.filter((absence) => absence.absent).map((absence) => absence.studentId) ?? []);
  const storedCourseEntries: AttendanceCourseEntry[] =
    sheet?.courses.map((entry) => ({
      position: entry.position,
      courseId: entry.courseId,
      name: entry.course.name,
      teacherId: entry.teacherId,
      teacherName: entry.teacher ? teacherName(entry.teacher) : teacherName(entry.course.teachers[0]?.teacher),
      signedAt: entry.signedAt?.toISOString() ?? null
    })) ?? [];
  const scheduledCourseEntries: AttendanceCourseEntry[] = scheduledSlots.slice(0, 2).map((slot, index) => {
    const teacher = slot.course.teachers[0]?.teacher;
    return {
      position: index,
      courseId: slot.course.id,
      name: slot.course.name,
      teacherId: teacher?.id ?? null,
      teacherName: teacherName(teacher),
      signedAt: null
    };
  });
  const legacyCourseOption =
    sheet?.course && !storedCourseEntries.length
      ? courseOptions.find((option) => option.courseId === sheet.courseId) ?? {
          courseId: sheet.courseId,
          name: sheet.course.name,
          teacherId: sheet.signedByTeacherId ?? null,
          teacherName: sheet.teacherName
        }
      : null;
  const fallbackCourseEntry = fallbackCourse
    ? {
        position: 0,
        courseId: fallbackCourse.id,
        name: fallbackCourse.name,
        teacherId: fallbackCourse.teachers[0]?.teacher.id ?? null,
        teacherName: teacherName(fallbackCourse.teachers[0]?.teacher),
        signedAt: null
      }
    : null;
  const courseEntries =
    storedCourseEntries.length > 0
      ? storedCourseEntries
      : legacyCourseOption
        ? [{ ...legacyCourseOption, position: 0, signedAt: sheet?.signedAt?.toISOString() ?? null }]
        : scheduledCourseEntries.length > 0
          ? scheduledCourseEntries
          : fallbackCourseEntry
            ? [fallbackCourseEntry]
            : [];
  const teacherNames = Array.from(new Set(courseEntries.map((entry) => entry.teacherName).filter(Boolean)));

  return {
    day,
    hour,
    course: courseEntries.map((entry) => entry.name).join(" / ") || sheet?.course.name || fallbackCourse?.name || "ΚΕΝΟ",
    courses: classRecord.courses.map((course) => course.name),
    courseOptions,
    courseEntries,
    teacherName: teacherNames.length > 0 ? teacherNames.join(" / ") : sheet?.teacherName ?? responsibleTeacher,
    students: classRecord.students.map((student) => ({
      id: student.id,
      code: student.am,
      name: student.name,
      surname: student.surname,
      absent: absentStudentIds.has(student.id)
    })),
    signedAt: fullySignedAt(courseEntries) ?? sheet?.signedAt?.toISOString() ?? null,
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

  try {
    const day = body.day;
    const now = new Date();
    const requestedCourseIds = Array.from(
      new Set(
        (body.courseEntries ?? [])
          .slice(0, 2)
          .map((entry) => entry.courseId)
          .filter(Boolean)
      )
    );

    if ((body.courseEntries?.length ?? 0) > 2 || requestedCourseIds.length > 2) {
      return NextResponse.json({ error: "Μπορούν να δηλωθούν μέχρι δύο μαθήματα για την ίδια ώρα." }, { status: 400 });
    }

    const courseInclude = {
      teachers: {
        include: {
          teacher: {
            include: {
              user: true
            }
          }
        }
      }
    };
    let courseRecords = requestedCourseIds.length
      ? await prisma.course.findMany({
          where: {
            id: { in: requestedCourseIds },
            classId: body.classId
          },
          include: courseInclude
        })
      : [];

    if (requestedCourseIds.length > 0 && courseRecords.length !== requestedCourseIds.length) {
      return NextResponse.json({ error: "Τα μαθήματα πρέπει να ανήκουν στο τμήμα του απουσιολογίου." }, { status: 400 });
    }

    if (courseRecords.length === 0) {
      const fallbackCourse = await prisma.course.upsert({
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
        },
        include: courseInclude
      });
      courseRecords = [fallbackCourse];
    }

    const courseById = new Map(courseRecords.map((course) => [course.id, course]));
    const selectedCourseIds = requestedCourseIds.length > 0 ? requestedCourseIds : [courseRecords[0].id];
    const selectedEntries = selectedCourseIds.map((courseId, position) => {
      const course = courseById.get(courseId);
      if (!course) {
        throw new Error("Το μάθημα δεν βρέθηκε.");
      }

      const teacher = course.teachers[0]?.teacher ?? null;
      const requestedEntry = body.courseEntries?.find((entry) => entry.courseId === courseId);
      return {
        course,
        teacher,
        position,
        signedAt: requestedEntry?.signedAt ? new Date(requestedEntry.signedAt) : null
      };
    });
    const signatureByCourseId = new Map<string, Date>();

    let signingTeacher =
      body.action === "sign" && (session.role === "TEACHER" || session.role === "ADMIN")
        ? await prisma.teacher.findUnique({ where: { userId: session.userId } })
        : null;

    if (body.action === "sign" && session.role === "CLASS_TABLET") {
      for (const entry of selectedEntries) {
        const password = (body.signaturePasswords?.[entry.course.id] ?? body.signaturePassword ?? "").trim();
        if (!password) {
          continue;
        }

        if (!entry.teacher) {
          return NextResponse.json({ error: `Δεν έχει οριστεί εκπαιδευτικός για το μάθημα ${entry.course.name}.` }, { status: 403 });
        }

        if (!verifyPassword(password, entry.teacher.user.passwordHash)) {
          return NextResponse.json(
            { error: `Ο κωδικός δεν αντιστοιχεί στον/στην εκπαιδευτικό ${teacherName(entry.teacher)}.` },
            { status: 403 }
          );
        }

        signatureByCourseId.set(entry.course.id, now);
        signingTeacher = entry.teacher;
      }

      if (signatureByCourseId.size === 0) {
        return NextResponse.json({ error: "Συμπληρώστε τουλάχιστον έναν κωδικό εκπαιδευτικού." }, { status: 400 });
      }
    }

    if (body.action === "sign" && session.role !== "CLASS_TABLET" && !signingTeacher) {
      return NextResponse.json({ error: "Δεν βρέθηκε εκπαιδευτικός για υπογραφή." }, { status: 403 });
    }

    if (body.action === "sign" && signingTeacher && session.role !== "CLASS_TABLET") {
      for (const entry of selectedEntries) {
        if (entry.teacher?.id === signingTeacher.id) {
          signatureByCourseId.set(entry.course.id, now);
        }
      }

      if (signatureByCourseId.size === 0) {
        return NextResponse.json({ error: "Ο συνδεδεμένος εκπαιδευτικός δεν αντιστοιχεί στα μαθήματα της ώρας." }, { status: 403 });
      }
    }

    const sheetTeacherName = Array.from(new Set(selectedEntries.map((entry) => teacherName(entry.teacher)))).join(" / ");
    let sheetCourseRows: Array<{ signedAt: Date | null; teacherId: string | null }> = [];

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
          courseId: selectedEntries[0].course.id,
          teacherName: sheetTeacherName,
          savedAt: now,
          signedAt: null,
          signedByTeacherId: null
        },
        create: {
          classId: body.classId,
          courseId: selectedEntries[0].course.id,
          day,
          hour: body.hour,
          teacherName: sheetTeacherName,
          savedAt: now,
          signedAt: null,
          signedByTeacherId: null
        }
      });

      const previousCourseRows = await tx.attendanceSheetCourse.findMany({
        where: { sheetId: sheet.id }
      });
      const previousCourseRowByCourseId = new Map(previousCourseRows.map((entry) => [entry.courseId, entry]));

      await tx.attendanceSheetCourse.deleteMany({
        where: { sheetId: sheet.id }
      });

      sheetCourseRows = selectedEntries.map((entry) => {
        const signedAt =
          signatureByCourseId.get(entry.course.id) ??
          previousCourseRowByCourseId.get(entry.course.id)?.signedAt ??
          entry.signedAt ??
          null;

        return {
          signedAt,
          teacherId: entry.teacher?.id ?? null
        };
      });

      await tx.attendanceSheetCourse.createMany({
        data: selectedEntries.map((entry, index) => ({
          sheetId: sheet.id,
          courseId: entry.course.id,
          teacherId: entry.teacher?.id ?? null,
          position: index,
          signedAt: sheetCourseRows[index].signedAt
        }))
      });

      const fullSignedAt =
        sheetCourseRows.length > 0 && sheetCourseRows.every((entry) => entry.signedAt)
          ? sheetCourseRows
              .map((entry) => entry.signedAt)
              .filter((signedAt): signedAt is Date => signedAt !== null)
              .sort((first, second) => first.getTime() - second.getTime())
              .at(-1) ?? null
          : null;

      await tx.attendanceSheet.update({
        where: { id: sheet.id },
        data: {
          signedAt: fullSignedAt,
          signedByTeacherId: fullSignedAt && selectedEntries.length === 1 ? sheetCourseRows[0].teacherId : null
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
