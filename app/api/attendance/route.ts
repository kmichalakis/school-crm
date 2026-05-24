import { NextRequest, NextResponse } from "next/server";
import { WeekDay } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseSessionToken, sessionCookieName } from "@/lib/session";
import { verifyPassword } from "@/lib/password";
import { dateInputValue, isAllowedSchoolDate } from "@/lib/school-calendar";
import { formatDateInput } from "@/lib/school-time";
import type { AttendanceCourseEntry, AttendanceCourseOption, AttendanceSheetPayload, SaveAttendanceRequest } from "@/lib/attendance-types";

function isWeekDay(value: string | null): value is WeekDay {
  return value !== null && Object.values(WeekDay).includes(value as WeekDay);
}

function dateValueToWeekDay(value: string | undefined): WeekDay | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T12:00:00`);
  const dayByIndex: Record<number, WeekDay> = {
    1: WeekDay.MONDAY,
    2: WeekDay.TUESDAY,
    3: WeekDay.WEDNESDAY,
    4: WeekDay.THURSDAY,
    5: WeekDay.FRIDAY
  };

  return dayByIndex[date.getDay()] ?? null;
}

function attendanceDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

async function validateAttendanceDate(classId: string, date: string) {
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
    return "Η τάξη δεν βρέθηκε.";
  }

  const bounds = {
    startsOn: dateInputValue(classRecord.schoolYear.startsOn),
    endsOn: dateInputValue(classRecord.schoolYear.endsOn)
  };
  const exceptions = classRecord.schoolYear.calendarDays.map((calendarDay) => ({
    date: dateInputValue(calendarDay.date),
    isWorkingDay: calendarDay.isWorkingDay
  }));

  return isAllowedSchoolDate(date, bounds, exceptions)
    ? null
    : "Η ημερομηνία είναι εκτός σχολικού έτους ή έχει δηλωθεί μη εργάσιμη στο ημερολόγιο.";
}

function courseAutoAa(courseName: string) {
  const hash = Array.from(courseName).reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 100000, 17);
  return `AUTO-${String(hash).padStart(5, "0")}`;
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

async function buildSheetPayload(classId: string, date: string, day: WeekDay, hour: number): Promise<AttendanceSheetPayload> {
  let classRecord = await prisma.class.findUnique({
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

  const existingNoCourse = classRecord.courses.find((course) => course.isNoCourse || course.name === "ΚΕΝΟ");
  if (!existingNoCourse) {
    const noCourse = await prisma.course.upsert({
      where: {
        classId_name: {
          classId,
          name: "ΚΕΝΟ"
        }
      },
      update: {
        isNoCourse: true
      },
      create: {
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
    classRecord = {
      ...classRecord,
      courses: [...classRecord.courses, noCourse]
    };
  } else if (!existingNoCourse.isNoCourse) {
    await prisma.course.update({
      where: { id: existingNoCourse.id },
      data: { isNoCourse: true }
    });
    classRecord = {
      ...classRecord,
      courses: classRecord.courses.map((course) => (course.id === existingNoCourse.id ? { ...course, isNoCourse: true } : course))
    };
  }

  const existingSubstitutionCourse = classRecord.courses.find((course) => course.isSubstitution || course.name === "ΑΝΑΠΛΗΡΩΣΗ");
  if (!existingSubstitutionCourse) {
    const substitutionCourse = await prisma.course.upsert({
      where: {
        classId_name: {
          classId,
          name: "ΑΝΑΠΛΗΡΩΣΗ"
        }
      },
      update: {
        isSubstitution: true
      },
      create: {
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
    classRecord = {
      ...classRecord,
      courses: [...classRecord.courses, substitutionCourse]
    };
  } else if (!existingSubstitutionCourse.isSubstitution) {
    await prisma.course.update({
      where: { id: existingSubstitutionCourse.id },
      data: { isSubstitution: true }
    });
    classRecord = {
      ...classRecord,
      courses: classRecord.courses.map((course) => (course.id === existingSubstitutionCourse.id ? { ...course, isSubstitution: true } : course))
    };
  }

  const sheet = await prisma.attendanceSheet.findUnique({
    where: {
      classId_date_hour: {
        classId,
        date: attendanceDate(date),
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

  const teacherOptions = await prisma.teacher.findMany({
    orderBy: [{ surname: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      surname: true
    }
  });

  const courseOptions: AttendanceCourseOption[] = classRecord.courses.map((course) => {
    const teacher = course.teachers[0]?.teacher;
    return {
      courseId: course.id,
      isNoCourse: course.isNoCourse,
      isSubstitution: course.isSubstitution,
      name: course.name,
      teacherId: course.isSubstitution ? null : teacher?.id ?? null,
      teacherName: course.isNoCourse ? "ΚΕΝΟ" : course.isSubstitution ? "Επιλέξτε εκπαιδευτικό αναπλήρωσης" : teacherName(teacher)
    };
  });
  const fallbackCourse = classRecord.courses.find((course) => !course.isNoCourse) ?? classRecord.courses[0];
  const responsibleTeacher = classRecord.responsibleTeacher
    ? teacherName(classRecord.responsibleTeacher)
    : "Μαρία Παπαδοπούλου";
  const absenceByStudentId = new Map(sheet?.absences.filter((absence) => absence.absent).map((absence) => [absence.studentId, absence]) ?? []);
  const storedCourseEntries: AttendanceCourseEntry[] =
    sheet?.courses.map((entry) => ({
      position: entry.position,
      courseId: entry.courseId,
      isNoCourse: entry.course.isNoCourse,
      isSubstitution: entry.course.isSubstitution,
      name: entry.course.name,
      teacherId: entry.teacherId,
      teacherName: entry.course.isNoCourse ? "ΚΕΝΟ" : entry.teacher ? teacherName(entry.teacher) : teacherName(entry.course.teachers[0]?.teacher),
      signedAt: entry.signedAt?.toISOString() ?? null
    })) ?? [];
  const scheduledCourseEntries: AttendanceCourseEntry[] = scheduledSlots.slice(0, 2).map((slot, index) => {
    const teacher = slot.course.teachers[0]?.teacher;
    return {
      position: index,
      courseId: slot.course.id,
      isNoCourse: slot.course.isNoCourse,
      isSubstitution: slot.course.isSubstitution,
      name: slot.course.name,
      teacherId: teacher?.id ?? null,
      teacherName: slot.course.isNoCourse ? "ΚΕΝΟ" : teacherName(teacher),
      signedAt: null
    };
  });
  const legacyCourseOption =
    sheet?.course && !storedCourseEntries.length
      ? courseOptions.find((option) => option.courseId === sheet.courseId) ?? {
          courseId: sheet.courseId,
          isNoCourse: sheet.course.isNoCourse,
          isSubstitution: sheet.course.isSubstitution,
          name: sheet.course.name,
          teacherId: sheet.signedByTeacherId ?? null,
          teacherName: sheet.course.isNoCourse ? "ΚΕΝΟ" : sheet.teacherName
        }
      : null;
  const fallbackCourseEntry = fallbackCourse
    ? {
        position: 0,
        courseId: fallbackCourse.id,
        isNoCourse: fallbackCourse.isNoCourse,
        isSubstitution: fallbackCourse.isSubstitution,
        name: fallbackCourse.name,
        teacherId: fallbackCourse.teachers[0]?.teacher.id ?? null,
        teacherName: fallbackCourse.isNoCourse ? "ΚΕΝΟ" : teacherName(fallbackCourse.teachers[0]?.teacher),
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
  const isNoCourseSheet = courseEntries.length > 0 && courseEntries.every((entry) => entry.isNoCourse);

  return {
    date,
    day,
    hour,
    course: courseEntries.map((entry) => entry.name).join(" / ") || sheet?.course.name || fallbackCourse?.name || "ΚΕΝΟ",
    courses: classRecord.courses.map((course) => course.name),
    courseOptions,
    courseEntries,
    teacherOptions: teacherOptions.map((teacher) => ({
      id: teacher.id,
      name: `${teacher.surname} ${teacher.name}`
    })),
    teacherName: isNoCourseSheet ? "ΚΕΝΟ" : teacherNames.length > 0 ? teacherNames.join(" / ") : sheet?.teacherName ?? responsibleTeacher,
    students: classRecord.students.map((student) => ({
      id: student.id,
      code: student.am,
      name: student.name,
      surname: student.surname,
      absent: absenceByStudentId.has(student.id),
      isHourlyExpulsion: absenceByStudentId.get(student.id)?.isHourlyExpulsion ?? false
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
  const date = searchParams.get("date") ?? "";
  const day = dateValueToWeekDay(date) ?? searchParams.get("day");
  const hour = Number(searchParams.get("hour"));

  if (!session || session.mustChangePassword) {
    return NextResponse.json({ error: "Απαιτείται σύνδεση." }, { status: 401 });
  }

  if (!classId || !dateValueToWeekDay(date) || !isWeekDay(day) || !Number.isInteger(hour) || hour < 1 || hour > 7) {
    return NextResponse.json({ error: "Μη έγκυρα στοιχεία απουσιολογίου." }, { status: 400 });
  }

  if (session.role === "CLASS_TABLET" && session.classId !== classId) {
    return NextResponse.json({ error: "Δεν υπάρχει πρόσβαση σε αυτή την τάξη." }, { status: 403 });
  }

  const dateError = await validateAttendanceDate(classId, date);
  if (dateError) {
    return NextResponse.json({ error: dateError }, { status: 400 });
  }

  try {
    const payload = await buildSheetPayload(classId, date, day, hour);
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

  const derivedDay = dateValueToWeekDay(body.date);

  if (!body.classId || !derivedDay || !Number.isInteger(body.hour) || body.hour < 1 || body.hour > 7) {
    return NextResponse.json({ error: "Μη έγκυρα στοιχεία απουσιολογίου." }, { status: 400 });
  }

  if (session.role === "CLASS_TABLET" && session.classId !== body.classId) {
    return NextResponse.json({ error: "Δεν υπάρχει πρόσβαση σε αυτή την τάξη." }, { status: 403 });
  }

  const dateError = await validateAttendanceDate(body.classId, body.date);
  if (dateError) {
    return NextResponse.json({ error: dateError }, { status: 400 });
  }

  if (body.action === "sign" && body.date > formatDateInput(new Date())) {
    return NextResponse.json(
      { error: "Δεν μπορεί να υπογραφεί απουσιολόγιο επόμενης ημερομηνίας." },
      { status: 400 }
    );
  }

  try {
    const day = derivedDay;
    const date = body.date;
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
    const requestedEntryByCourseId = new Map((body.courseEntries ?? []).map((entry) => [entry.courseId, entry]));
    const substitutionTeacherIds = Array.from(
      new Set(
        (body.courseEntries ?? [])
          .filter((entry) => entry.teacherId)
          .map((entry) => entry.teacherId as string)
      )
    );
    const substitutionTeachers = substitutionTeacherIds.length
      ? await prisma.teacher.findMany({
          where: { id: { in: substitutionTeacherIds } },
          include: { user: true }
        })
      : [];
    const substitutionTeacherById = new Map(substitutionTeachers.map((teacher) => [teacher.id, teacher]));
    const selectedCourseIds = requestedCourseIds.length > 0 ? requestedCourseIds : [courseRecords[0].id];
    for (const courseId of selectedCourseIds) {
      const course = courseById.get(courseId);
      const requestedEntry = requestedEntryByCourseId.get(courseId);
      if (course?.isSubstitution && (!requestedEntry?.teacherId || !substitutionTeacherById.has(requestedEntry.teacherId))) {
        return NextResponse.json({ error: "Στην ΑΝΑΠΛΗΡΩΣΗ πρέπει να οριστεί εκπαιδευτικός." }, { status: 400 });
      }
    }
    const selectedEntries = selectedCourseIds.map((courseId, position) => {
      const course = courseById.get(courseId);
      if (!course) {
        throw new Error("Το μάθημα δεν βρέθηκε.");
      }

      const requestedEntry = requestedEntryByCourseId.get(courseId);
      const teacher = course.isSubstitution
        ? requestedEntry?.teacherId
          ? substitutionTeacherById.get(requestedEntry.teacherId) ?? null
          : null
        : course.teachers[0]?.teacher ?? null;

      return {
        course,
        teacher,
        position,
        signedAt: course.isNoCourse ? now : requestedEntry?.signedAt ? new Date(requestedEntry.signedAt) : null
      };
    });
    const isNoCourseSheet = selectedEntries.length > 0 && selectedEntries.every((entry) => entry.course.isNoCourse);
    const hasNoCourseEntry = selectedEntries.some((entry) => entry.course.isNoCourse);

    if (hasNoCourseEntry && !isNoCourseSheet) {
      return NextResponse.json({ error: "Το ΚΕΝΟ δεν μπορεί να συνδυαστεί με άλλο μάθημα στην ίδια ώρα." }, { status: 400 });
    }
    const signatureByCourseId = new Map<string, Date>();
    const unlockedCourseIds = new Set<string>();

    let signingTeacher =
      (body.action === "sign" || body.action === "unlock") && (session.role === "TEACHER" || session.role === "ADMIN")
        ? await prisma.teacher.findUnique({ where: { userId: session.userId } })
        : null;

    if ((body.action === "sign" || body.action === "unlock") && session.role === "CLASS_TABLET") {
      for (const entry of selectedEntries) {
        const password = (body.signaturePasswords?.[entry.course.id] ?? body.signaturePassword ?? "").trim();
        if (!password) {
          continue;
        }

        if (entry.course.isNoCourse) {
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

        if (body.action === "unlock") {
          unlockedCourseIds.add(entry.course.id);
        } else {
          signatureByCourseId.set(entry.course.id, now);
        }
        signingTeacher = entry.teacher;
      }

      if (body.action === "sign" && signatureByCourseId.size === 0) {
        return NextResponse.json({ error: "Συμπληρώστε τουλάχιστον έναν κωδικό εκπαιδευτικού." }, { status: 400 });
      }

      if (body.action === "unlock" && unlockedCourseIds.size === 0) {
        return NextResponse.json({ error: "Συμπληρώστε τουλάχιστον έναν κωδικό εκπαιδευτικού για ακύρωση υπογραφής." }, { status: 400 });
      }
    }

    if ((body.action === "sign" || body.action === "unlock") && session.role !== "CLASS_TABLET" && !signingTeacher) {
      return NextResponse.json({ error: "Δεν βρέθηκε εκπαιδευτικός για υπογραφή." }, { status: 403 });
    }

    if ((body.action === "sign" || body.action === "unlock") && signingTeacher && session.role !== "CLASS_TABLET") {
      for (const entry of selectedEntries) {
        if (entry.course.isNoCourse) {
          continue;
        }

        if (entry.teacher?.id === signingTeacher.id) {
          if (body.action === "unlock") {
            unlockedCourseIds.add(entry.course.id);
          } else {
            signatureByCourseId.set(entry.course.id, now);
          }
        }
      }

      if (body.action === "sign" && signatureByCourseId.size === 0) {
        return NextResponse.json({ error: "Ο συνδεδεμένος εκπαιδευτικός δεν αντιστοιχεί στα μαθήματα της ώρας." }, { status: 403 });
      }

      if (body.action === "unlock" && unlockedCourseIds.size === 0) {
        return NextResponse.json({ error: "Ο συνδεδεμένος εκπαιδευτικός δεν αντιστοιχεί στις υπογραφές της ώρας." }, { status: 403 });
      }
    }

    const sheetTeacherName = isNoCourseSheet ? "ΚΕΝΟ" : Array.from(new Set(selectedEntries.map((entry) => teacherName(entry.teacher)))).join(" / ");
    let sheetCourseRows: Array<{ signedAt: Date | null; teacherId: string | null }> = [];

    await prisma.$transaction(async (tx) => {
      const sheet = await tx.attendanceSheet.upsert({
        where: {
          classId_date_hour: {
            classId: body.classId,
            date: attendanceDate(date),
            hour: body.hour
          }
        },
        update: {
          courseId: selectedEntries[0].course.id,
          teacherName: sheetTeacherName,
          savedAt: now,
          signedAt: isNoCourseSheet ? now : null,
          signedByTeacherId: null
        },
        create: {
          classId: body.classId,
          courseId: selectedEntries[0].course.id,
          date: attendanceDate(date),
          day,
          hour: body.hour,
          teacherName: sheetTeacherName,
          savedAt: now,
          signedAt: isNoCourseSheet ? now : null,
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
          entry.course.isNoCourse
            ? now
            : body.action === "unlock" && unlockedCourseIds.has(entry.course.id)
            ? null
            : signatureByCourseId.get(entry.course.id) ??
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

      const absentStudents = isNoCourseSheet ? [] : body.students.filter((student) => student.absent);
      if (absentStudents.length > 0) {
        await tx.attendanceSheetAbsence.createMany({
          data: absentStudents.map((student) => ({
            sheetId: sheet.id,
            studentId: student.id,
            absent: true,
            isHourlyExpulsion: student.isHourlyExpulsion ?? false,
            status: previousAbsenceByStudentId.get(student.id)?.status ?? "MARKED",
            excusedReason: previousAbsenceByStudentId.get(student.id)?.excusedReason ?? null,
            excusedAt: previousAbsenceByStudentId.get(student.id)?.excusedAt ?? null
          }))
        });
      }
    });

    const payload = await buildSheetPayload(body.classId, date, day, body.hour);
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Αποτυχία αποθήκευσης απουσιολογίου." },
      { status: 500 }
    );
  }
}
