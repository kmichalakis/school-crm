import { NextRequest, NextResponse } from "next/server";
import { WeekDay } from "@prisma/client";
import { dateInputValue, isAllowedSchoolDate } from "@/lib/school-calendar";
import { dateToWeekDay } from "@/lib/school-time";
import { prisma } from "@/lib/prisma";
import { parseSessionToken, sessionCookieName } from "@/lib/session";

type BlankPendingRequest = {
  classId?: string;
  date?: string;
  hour?: number;
};

function attendanceDate(dateValue: string) {
  return new Date(`${dateValue}T00:00:00.000Z`);
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

export async function POST(request: NextRequest) {
  const session = parseSessionToken(request.cookies.get(sessionCookieName)?.value);

  if (!session || session.mustChangePassword) {
    return NextResponse.json({ error: "Απαιτείται σύνδεση." }, { status: 401 });
  }

  if (session.role !== "ADMIN") {
    return NextResponse.json({ error: "Μόνο ο admin μπορεί να ορίσει εκκρεμότητα ως ΚΕΝΟ." }, { status: 403 });
  }

  const body = (await request.json()) as BlankPendingRequest;
  const classId = body.classId;
  const date = body.date ?? "";
  const day = dateToWeekDay(date) as WeekDay | null;
  const hour = Number(body.hour);

  if (!classId || !day || !Number.isInteger(hour) || hour < 1 || hour > 7) {
    return NextResponse.json({ error: "Μη έγκυρα στοιχεία εκκρεμότητας." }, { status: 400 });
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
    return NextResponse.json({ error: "Το τμήμα δεν βρέθηκε." }, { status: 404 });
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
    return NextResponse.json({ error: "Η ημερομηνία είναι εκτός σχολικού έτους ή μη εργάσιμη." }, { status: 400 });
  }

  const now = new Date();

  try {
    const existingNoCourse = await prisma.course.findFirst({
      where: {
        classId,
        OR: [{ isNoCourse: true }, { name: "ΚΕΝΟ" }]
      },
      orderBy: { createdAt: "asc" }
    });
    const noCourseAa = existingNoCourse ? null : await nextNoCourseAa(classId);

    await prisma.$transaction(async (tx) => {
      const noCourse =
        existingNoCourse
          ? await tx.course.update({
              where: { id: existingNoCourse.id },
              data: { isNoCourse: true }
            })
          : await tx.course.upsert({
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
                aa: noCourseAa ?? "KENO",
                classId,
                name: "ΚΕΝΟ",
                isNoCourse: true
              }
            });

      const sheet = await tx.attendanceSheet.upsert({
        where: {
          classId_date_hour: {
            classId,
            date: attendanceDate(date),
            hour
          }
        },
        update: {
          courseId: noCourse.id,
          day,
          teacherName: "ΚΕΝΟ",
          savedAt: now,
          signedAt: now,
          signedByTeacherId: null
        },
        create: {
          classId,
          courseId: noCourse.id,
          date: attendanceDate(date),
          day,
          hour,
          teacherName: "ΚΕΝΟ",
          savedAt: now,
          signedAt: now,
          signedByTeacherId: null
        }
      });

      await tx.attendanceSheetAbsence.deleteMany({ where: { sheetId: sheet.id } });
      await tx.attendanceSheetCourse.deleteMany({ where: { sheetId: sheet.id } });
      await tx.attendanceSheetCourse.create({
        data: {
          sheetId: sheet.id,
          courseId: noCourse.id,
          teacherId: null,
          position: 0,
          signedAt: now
        }
      });
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Αποτυχία ορισμού της ώρας ως ΚΕΝΟ." }, { status: 500 });
  }
}
