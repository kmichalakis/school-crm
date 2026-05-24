import { NextRequest, NextResponse } from "next/server";
import { AbsenceStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { absenceStatusLabel, csvEscape, hourLabel, weekDayLabel } from "@/lib/report-helpers";
import { parseSessionToken, sessionCookieName } from "@/lib/session";

export async function GET(request: NextRequest) {
  const session = parseSessionToken(request.cookies.get(sessionCookieName)?.value);

  if (!session || session.mustChangePassword || !["ADMIN", "TEACHER", "PARENT"].includes(session.role)) {
    return NextResponse.json({ error: "Απαιτείται σύνδεση." }, { status: 401 });
  }

  const where: Prisma.AttendanceSheetAbsenceWhereInput = {
    absent: true,
    status: { not: AbsenceStatus.REMOVED }
  };

  if (session.role === "PARENT") {
    const parent = await prisma.parent.findUnique({
      where: { userId: session.userId },
      include: { students: true }
    });
    const studentIds = parent?.students.map((student) => student.id) ?? [];
    where.studentId = { in: studentIds };
  }

  if (session.role === "TEACHER") {
    const teacher = await prisma.teacher.findUnique({
      where: { userId: session.userId },
      include: {
        courses: {
          include: { course: true }
        }
      }
    });
    const allowedClassIds = Array.from(
      new Set([
        ...(teacher?.homeClassId ? [teacher.homeClassId] : []),
        ...(teacher?.courses.map((courseLink) => courseLink.course.classId) ?? [])
      ])
    );
    where.sheet = { classId: { in: allowedClassIds } };
  }

  const absences = await prisma.attendanceSheetAbsence.findMany({
    where,
    include: {
      student: {
        include: {
          class: {
            include: { schoolYear: true }
          }
        }
      },
      sheet: {
        include: {
          class: {
            include: { schoolYear: true }
          },
          course: true
        }
      }
    },
    orderBy: [{ student: { surname: "asc" } }, { sheet: { day: "asc" } }, { sheet: { hour: "asc" } }]
  });

  const header = ["Σχολικό έτος", "Τμήμα", "Μαθητής", "Ημέρα", "Ώρα", "Μάθημα", "Κατάσταση", "Ωριαία αποβολή", "Λόγος δικαιολόγησης", "Αποθηκεύτηκε"];
  const rows = absences.map((absence) => [
    absence.sheet.class.schoolYear.name,
    absence.sheet.class.name,
    `${absence.student.surname} ${absence.student.name}`,
    weekDayLabel(absence.sheet.day),
    hourLabel(absence.sheet.hour),
    absence.sheet.course.name,
    absenceStatusLabel(absence.status),
    absence.isHourlyExpulsion ? "Ναι" : "Όχι",
    absence.excusedReason ?? "",
    absence.sheet.savedAt ? new Intl.DateTimeFormat("el-GR", { dateStyle: "short", timeStyle: "short" }).format(absence.sheet.savedAt) : ""
  ]);

  const csv = `\uFEFF${[header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n")}`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="apousies.csv"'
    }
  });
}
