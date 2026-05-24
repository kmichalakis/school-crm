"use server";

import { ClassYear, SchoolYearStatus, UserRole, WeekDay } from "@prisma/client";
import * as XLSX from "xlsx";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { hashPassword, validatePasswordPolicy } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { parseSessionToken, sessionCookieName } from "@/lib/session";

async function requireAdmin() {
  const cookieStore = await cookies();
  const session = parseSessionToken(cookieStore.get(sessionCookieName)?.value);

  if (!session || session.role !== "ADMIN" || session.mustChangePassword) {
    redirect("/");
  }

  return session;
}

function adminPath(message: string, type: "success" | "error" = "success") {
  const params = new URLSearchParams({
    notice: message,
    noticeType: type
  });

  return `/admin?${params.toString()}`;
}

function calendarPath(message: string, type: "success" | "error" = "success") {
  const params = new URLSearchParams({
    notice: message,
    noticeType: type
  });

  return `/calendar?${params.toString()}`;
}

function finishAdminAction(message: string, type: "success" | "error" = "success"): never {
  revalidatePath("/admin");
  redirect(adminPath(message, type));
}

function finishCalendarAction(message: string, type: "success" | "error" = "success"): never {
  revalidatePath("/calendar");
  revalidatePath("/");
  revalidatePath("/teacher");
  revalidatePath("/print");
  redirect(calendarPath(message, type));
}

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function requiredText(formData: FormData, key: string, label: string) {
  const value = text(formData, key);
  if (!value) {
    finishAdminAction(`Συμπληρώστε το πεδίο: ${label}.`, "error");
  }

  return value;
}

function optionalText(formData: FormData, key: string) {
  const value = text(formData, key);
  return value.length > 0 ? value : null;
}

function checked(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

function dateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function validateAdminPassword(password: string, username: string) {
  const issues = validatePasswordPolicy(password, username);
  if (issues.length > 0) {
    finishAdminAction(issues[0], "error");
  }
}

function parseClassYear(value: string): ClassYear {
  const normalized = value.trim().toUpperCase();
  if (normalized === "B" || normalized === "Β" || normalized === "ΤΑΞΗ Β") return ClassYear.B;
  if (normalized === "C" || normalized === "Γ" || normalized === "ΤΑΞΗ Γ") return ClassYear.C;
  return ClassYear.A;
}

function normalizedGreekText(value: string) {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function parseWeekDay(value: string): WeekDay {
  const normalized = normalizedGreekText(value);
  if (normalized === "MONDAY" || normalized === "ΔΕΥΤΕΡΑ" || normalized === "ΔΕ") return WeekDay.MONDAY;
  if (normalized === "TUESDAY" || normalized === "ΤΡΙΤΗ" || normalized === "ΤΡ") return WeekDay.TUESDAY;
  if (normalized === "WEDNESDAY" || normalized === "ΤΕΤΑΡΤΗ" || normalized === "ΤΕ") return WeekDay.WEDNESDAY;
  if (normalized === "THURSDAY" || normalized === "ΠΕΜΠΤΗ" || normalized === "ΠΕ") return WeekDay.THURSDAY;
  if (normalized === "FRIDAY" || normalized === "ΠΑΡΑΣΚΕΥΗ" || normalized === "ΠΑ") return WeekDay.FRIDAY;
  return WeekDay.MONDAY;
}

function nextClassYear(year: ClassYear) {
  if (year === ClassYear.A) return ClassYear.B;
  if (year === ClassYear.B) return ClassYear.C;
  return null;
}

function promotedClassName(name: string, nextYear: ClassYear) {
  const suffix = name.slice(1);
  const greekPrefix = nextYear === ClassYear.B ? "Β" : nextYear === ClassYear.C ? "Γ" : "Α";
  return `${greekPrefix}${suffix}`;
}

function classLoginName(className: string, year: ClassYear) {
  const suffix = className.slice(1).toLowerCase();
  return `${year.toLowerCase()}${suffix}`;
}

export async function createSchoolYearAction(formData: FormData) {
  await requireAdmin();
  const isActive = checked(formData, "active");
  const name = requiredText(formData, "name", "σχολικό έτος");
  const startsOn = dateOnly(requiredText(formData, "startsOn", "έναρξη"));
  const endsOn = dateOnly(requiredText(formData, "endsOn", "λήξη"));

  if (startsOn >= endsOn) {
    finishAdminAction("Η λήξη του σχολικού έτους πρέπει να είναι μετά την έναρξη.", "error");
  }

  if (isActive) {
    await prisma.schoolYear.updateMany({
      where: { status: SchoolYearStatus.ACTIVE },
      data: { status: SchoolYearStatus.ARCHIVED }
    });
  }

  await prisma.schoolYear.create({
    data: {
      name,
      startsOn,
      endsOn,
      status: isActive ? SchoolYearStatus.ACTIVE : SchoolYearStatus.ARCHIVED
    }
  });

  finishAdminAction("Το σχολικό έτος προστέθηκε.");
}

export async function updateSchoolYearAction(formData: FormData) {
  await requireAdmin();
  const id = requiredText(formData, "id", "σχολικό έτος");
  const name = requiredText(formData, "name", "σχολικό έτος");
  const startsOn = dateOnly(requiredText(formData, "startsOn", "έναρξη"));
  const endsOn = dateOnly(requiredText(formData, "endsOn", "λήξη"));
  const isActive = checked(formData, "active");

  if (startsOn >= endsOn) {
    finishAdminAction("Η λήξη του σχολικού έτους πρέπει να είναι μετά την έναρξη.", "error");
  }

  await prisma.$transaction(async (tx) => {
    if (isActive) {
      await tx.schoolYear.updateMany({
        where: { status: SchoolYearStatus.ACTIVE, id: { not: id } },
        data: { status: SchoolYearStatus.ARCHIVED }
      });
    }

    await tx.schoolYear.update({
      where: { id },
      data: {
        name,
        startsOn,
        endsOn,
        status: isActive ? SchoolYearStatus.ACTIVE : SchoolYearStatus.ARCHIVED
      }
    });
  });

  finishAdminAction("Το σχολικό έτος ενημερώθηκε.");
}

export async function upsertCalendarDayAction(formData: FormData) {
  await requireAdmin();
  const schoolYearId = requiredText(formData, "schoolYearId", "σχολικό έτος");
  const dateValue = requiredText(formData, "date", "ημερομηνία");
  const isWorkingDay = requiredText(formData, "isWorkingDay", "κατάσταση") === "true";
  const note = optionalText(formData, "note");
  const schoolYear = await prisma.schoolYear.findUnique({ where: { id: schoolYearId } });

  if (!schoolYear) {
    finishCalendarAction("Δεν βρέθηκε το σχολικό έτος.", "error");
  }

  const date = dateOnly(dateValue);
  if (date < schoolYear.startsOn || date > schoolYear.endsOn) {
    finishCalendarAction("Η ημερομηνία πρέπει να είναι μέσα στα όρια του σχολικού έτους.", "error");
  }

  await prisma.schoolCalendarDay.upsert({
    where: {
      schoolYearId_date: {
        schoolYearId,
        date
      }
    },
    update: {
      isWorkingDay,
      note
    },
    create: {
      schoolYearId,
      date,
      isWorkingDay,
      note
    }
  });

  finishCalendarAction("Η ημερομηνία ενημερώθηκε στο ημερολόγιο.");
}

export async function deleteCalendarDayAction(formData: FormData) {
  await requireAdmin();
  const id = requiredText(formData, "id", "ημερομηνία ημερολογίου");

  await prisma.schoolCalendarDay.delete({ where: { id } });

  finishCalendarAction("Η εξαίρεση ημερολογίου αφαιρέθηκε.");
}

export async function upsertClassAction(formData: FormData) {
  await requireAdmin();
  const id = optionalText(formData, "id");
  const schoolYearId = requiredText(formData, "schoolYearId", "σχολικό έτος");
  const name = requiredText(formData, "name", "τμήμα");
  const year = parseClassYear(text(formData, "year"));
  const responsibleTeacherId = optionalText(formData, "responsibleTeacherId");
  const username = optionalText(formData, "username");
  const password = optionalText(formData, "password");
  const mustChangePassword = checked(formData, "mustChangePassword");

  const classRecord = id
    ? await prisma.class.update({
        where: { id },
        data: { name, year, schoolYearId, responsibleTeacherId }
      })
    : await prisma.class.create({
        data: { name, year, schoolYearId, responsibleTeacherId }
      });

  if (username) {
    const existingUser = await prisma.user.findUnique({ where: { username: username.toLowerCase() } });
    if (!existingUser && !password) {
      finishAdminAction("Για νέο χρήστη τμήματος χρειάζεται αρχικός κωδικός.", "error");
    }

    if (password) {
      validateAdminPassword(password, username);
    }

    await prisma.user.upsert({
      where: { username: username.toLowerCase() },
      update: {
        ...(password ? { passwordHash: hashPassword(password) } : {}),
        role: UserRole.CLASS_TABLET,
        classId: classRecord.id,
        mustChangePassword
      },
      create: {
        username: username.toLowerCase(),
        passwordHash: hashPassword(password ?? ""),
        role: UserRole.CLASS_TABLET,
        classId: classRecord.id,
        mustChangePassword
      }
    });
  }

  revalidatePath("/admin");
}

export async function upsertTeacherAction(formData: FormData) {
  await requireAdmin();
  const id = optionalText(formData, "id");
  const userId = optionalText(formData, "userId");
  const username = requiredText(formData, "username", "username").toLowerCase();
  const password = optionalText(formData, "password");
  const am = codeValue(requiredText(formData, "am", "ΑΜ εκπαιδευτικού"));
  const name = requiredText(formData, "name", "όνομα");
  const surname = requiredText(formData, "surname", "επώνυμο");
  const isAdmin = checked(formData, "isAdmin");
  const homeClassId = optionalText(formData, "homeClassId");
  const mustChangePassword = checked(formData, "mustChangePassword");

  if (!userId && !password) {
    finishAdminAction("Για νέο εκπαιδευτικό χρειάζεται αρχικός κωδικός.", "error");
  }

  if (password) {
    validateAdminPassword(password, username);
  }

  const user = userId
    ? await prisma.user.update({
        where: { id: userId },
        data: {
          username,
          role: isAdmin ? UserRole.ADMIN : UserRole.TEACHER,
          mustChangePassword,
          ...(password ? { passwordHash: hashPassword(password) } : {})
        }
      })
    : await prisma.user.create({
        data: {
          username,
          passwordHash: hashPassword(password ?? ""),
          role: isAdmin ? UserRole.ADMIN : UserRole.TEACHER,
          mustChangePassword
        }
      });

  if (id) {
    await prisma.teacher.update({
      where: { id },
      data: { am, name, surname, isAdmin, homeClassId }
    });
  } else {
    await prisma.teacher.create({
      data: { am, name, surname, isAdmin, homeClassId, userId: user.id }
    });
  }

  revalidatePath("/admin");
}

export async function upsertParentAction(formData: FormData) {
  await requireAdmin();
  const id = optionalText(formData, "id");
  const userId = optionalText(formData, "userId");
  const username = requiredText(formData, "username", "username").toLowerCase();
  const password = optionalText(formData, "password");
  const name = requiredText(formData, "name", "όνομα");
  const surname = requiredText(formData, "surname", "επώνυμο");
  const email = requiredText(formData, "email", "email");
  const mustChangePassword = checked(formData, "mustChangePassword");

  if (!userId && !password) {
    finishAdminAction("Για νέο γονέα χρειάζεται αρχικός κωδικός.", "error");
  }

  if (password) {
    validateAdminPassword(password, username);
  }

  const user = userId
    ? await prisma.user.update({
        where: { id: userId },
        data: {
          username,
          role: UserRole.PARENT,
          mustChangePassword,
          ...(password ? { passwordHash: hashPassword(password) } : {})
        }
      })
    : await prisma.user.create({
        data: {
          username,
          passwordHash: hashPassword(password ?? ""),
          role: UserRole.PARENT,
          mustChangePassword
        }
      });

  if (id) {
    await prisma.parent.update({
      where: { id },
      data: { name, surname, email }
    });
  } else {
    await prisma.parent.create({
      data: { name, surname, email, userId: user.id }
    });
  }

  revalidatePath("/admin");
}

export async function upsertStudentAction(formData: FormData) {
  await requireAdmin();
  const id = optionalText(formData, "id");
  const classId = requiredText(formData, "classId", "τμήμα");
  const classRecord = await prisma.class.findUniqueOrThrow({
    where: { id: classId }
  });
  const data = {
    am: codeValue(requiredText(formData, "am", "ΑΜ μαθητή")),
    name: requiredText(formData, "name", "όνομα"),
    surname: requiredText(formData, "surname", "επώνυμο"),
    patronymic: requiredText(formData, "patronymic", "πατρώνυμο"),
    classId,
    schoolYearId: classRecord.schoolYearId,
    parentId: optionalText(formData, "parentId")
  };

  if (id) {
    await prisma.student.update({ where: { id }, data });
  } else {
    await prisma.student.create({ data });
  }

  revalidatePath("/admin");
}

export async function upsertCourseAction(formData: FormData) {
  await requireAdmin();
  const id = optionalText(formData, "id");
  const classId = requiredText(formData, "classId", "τμήμα");
  const aa = codeValue(requiredText(formData, "aa", "ΑΑ μαθήματος"));
  const name = requiredText(formData, "name", "μάθημα");
  const teacherId = optionalText(formData, "teacherId");
  const isNoCourse = checked(formData, "isNoCourse");

  if (!isNoCourse && !teacherId) {
    finishAdminAction("Κάθε μάθημα χρειάζεται έναν εκπαιδευτικό.", "error");
  }

  const course = id
    ? await prisma.course.update({
        where: { id },
        data: {
          name,
          aa,
          classId,
          isNoCourse
        }
      })
    : await prisma.course.create({
        data: {
          name,
          aa,
          classId,
          isNoCourse
        }
      });

  await prisma.courseTeacher.deleteMany({ where: { courseId: course.id } });

  if (teacherId) {
    await prisma.courseTeacher.create({
      data: { courseId: course.id, teacherId }
    });
  }

  revalidatePath("/admin");
}

export async function setScheduleSlotAction(formData: FormData) {
  await requireAdmin();
  const classId = requiredText(formData, "classId", "τμήμα");
  const day = parseWeekDay(text(formData, "day"));
  const hour = Number(text(formData, "hour"));
  const courseIds = formData
    .getAll("courseIds")
    .concat(formData.getAll("courseId"))
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  if (!Number.isInteger(hour) || hour < 1 || hour > 7) {
    finishAdminAction("Η ώρα προγράμματος δεν είναι έγκυρη.", "error");
  }

  if (courseIds.length === 0) {
    finishAdminAction("Επιλέξτε τουλάχιστον ένα μάθημα για την ώρα.", "error");
  }

  const uniqueCourseIds = Array.from(new Set(courseIds));
  const courses = await prisma.course.findMany({
    where: { id: { in: uniqueCourseIds } }
  });

  if (courses.length !== uniqueCourseIds.length || courses.some((course) => course.classId !== classId)) {
    finishAdminAction("Όλα τα μαθήματα πρέπει να ανήκουν στο επιλεγμένο τμήμα.", "error");
  }

  await prisma.$transaction(async (tx) => {
    const existingSlots = await tx.scheduleSlot.findMany({
      where: { classId, day, hour },
      select: { id: true }
    });
    const existingSlotIds = existingSlots.map((slot) => slot.id);

    await tx.absence.deleteMany({ where: { scheduleSlotId: { in: existingSlotIds } } });
    await tx.attendanceSignature.deleteMany({ where: { scheduleSlotId: { in: existingSlotIds } } });
    await tx.scheduleSlot.deleteMany({
      where: { id: { in: existingSlotIds } }
    });

    await tx.scheduleSlot.createMany({
      data: uniqueCourseIds.map((courseId) => ({ classId, day, hour, courseId })),
      skipDuplicates: true
    });
  });

  revalidatePath("/admin");
}

export async function deleteScheduleSlotAction(formData: FormData) {
  await requireAdmin();
  const id = requiredText(formData, "id", "ώρα προγράμματος");

  await prisma.$transaction(async (tx) => {
    await tx.absence.deleteMany({ where: { scheduleSlotId: id } });
    await tx.attendanceSignature.deleteMany({ where: { scheduleSlotId: id } });
    await tx.scheduleSlot.delete({ where: { id } });
  });

  finishAdminAction("Η ώρα αφαιρέθηκε από το πρόγραμμα.");
}

export async function deleteStudentAction(formData: FormData) {
  await requireAdmin();
  const id = requiredText(formData, "id", "μαθητής");

  await prisma.$transaction(async (tx) => {
    await tx.parentNotification.deleteMany({ where: { studentId: id } });
    await tx.parentJustificationRequest.deleteMany({ where: { studentId: id } });
    await tx.attendanceSheetAbsence.deleteMany({ where: { studentId: id } });
    await tx.absence.deleteMany({ where: { studentId: id } });
    await tx.student.delete({ where: { id } });
  });

  finishAdminAction("Ο μαθητής διαγράφηκε.");
}

export async function deleteParentAction(formData: FormData) {
  await requireAdmin();
  const id = requiredText(formData, "id", "γονέας");
  const userId = requiredText(formData, "userId", "χρήστης γονέα");
  const [notificationCount, requestCount] = await Promise.all([
    prisma.parentNotification.count({ where: { parentId: id } }),
    prisma.parentJustificationRequest.count({ where: { parentId: id } })
  ]);

  if (notificationCount > 0 || requestCount > 0) {
    finishAdminAction("Ο γονέας έχει ιστορικό ενημερώσεων ή αιτημάτων και δεν διαγράφεται. Μπορείτε να αλλάξετε τα στοιχεία του.", "error");
  }

  await prisma.$transaction(async (tx) => {
    await tx.student.updateMany({ where: { parentId: id }, data: { parentId: null } });
    await tx.parent.delete({ where: { id } });
    await tx.user.delete({ where: { id: userId } });
  });

  finishAdminAction("Ο γονέας διαγράφηκε και αποσυνδέθηκε από τους μαθητές.");
}

export async function deleteTeacherAction(formData: FormData) {
  const session = await requireAdmin();
  const id = requiredText(formData, "id", "εκπαιδευτικός");
  const userId = requiredText(formData, "userId", "χρήστης εκπαιδευτικού");

  if (session.userId === userId) {
    finishAdminAction("Δεν μπορείτε να διαγράψετε τον λογαριασμό με τον οποίο είστε συνδεδεμένος.", "error");
  }

  const signatureCount = await prisma.attendanceSignature.count({ where: { teacherId: id } });
  if (signatureCount > 0) {
    finishAdminAction("Ο εκπαιδευτικός έχει υπογεγραμμένα απουσιολόγια και δεν διαγράφεται.", "error");
  }

  await prisma.$transaction(async (tx) => {
    await tx.courseTeacher.deleteMany({ where: { teacherId: id } });
    await tx.class.updateMany({ where: { responsibleTeacherId: id }, data: { responsibleTeacherId: null } });
    await tx.teacher.delete({ where: { id } });
    await tx.user.delete({ where: { id: userId } });
  });

  finishAdminAction("Ο εκπαιδευτικός διαγράφηκε.");
}

export async function deleteCourseAction(formData: FormData) {
  await requireAdmin();
  const id = requiredText(formData, "id", "μάθημα");
  const attendanceSheetCount = await prisma.attendanceSheet.count({ where: { courseId: id } });

  if (attendanceSheetCount > 0) {
    finishAdminAction("Το μάθημα έχει απουσιολόγια και δεν διαγράφεται. Μπορείτε να το μετονομάσετε ή να το αποσυνδέσετε από το πρόγραμμα.", "error");
  }

  const slots = await prisma.scheduleSlot.findMany({
    where: { courseId: id },
    select: { id: true }
  });
  const slotIds = slots.map((slot) => slot.id);

  await prisma.$transaction(async (tx) => {
    await tx.courseTeacher.deleteMany({ where: { courseId: id } });
    await tx.absence.deleteMany({ where: { scheduleSlotId: { in: slotIds } } });
    await tx.attendanceSignature.deleteMany({ where: { scheduleSlotId: { in: slotIds } } });
    await tx.scheduleSlot.deleteMany({ where: { courseId: id } });
    await tx.course.delete({ where: { id } });
  });

  finishAdminAction("Το μάθημα διαγράφηκε μαζί με τις αντίστοιχες ώρες προγράμματος.");
}

export async function deleteClassAction(formData: FormData) {
  await requireAdmin();
  const id = requiredText(formData, "id", "τμήμα");
  const [studentCount, courseCount, sheetCount] = await Promise.all([
    prisma.student.count({ where: { classId: id } }),
    prisma.course.count({ where: { classId: id } }),
    prisma.attendanceSheet.count({ where: { classId: id } })
  ]);

  if (studentCount > 0 || courseCount > 0 || sheetCount > 0) {
    finishAdminAction("Το τμήμα έχει μαθητές, μαθήματα ή απουσιολόγια. Διαγράψτε πρώτα τα συνδεδεμένα δεδομένα.", "error");
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.deleteMany({ where: { classId: id, role: UserRole.CLASS_TABLET } });
    await tx.class.delete({ where: { id } });
  });

  finishAdminAction("Το τμήμα διαγράφηκε.");
}

type ExcelRow = Record<string, unknown>;

function sheetRows(workbook: XLSX.WorkBook, names: string[]) {
  const sheetName = names.find((name) => workbook.SheetNames.includes(name));
  if (!sheetName) {
    return [];
  }

  return XLSX.utils.sheet_to_json<ExcelRow>(workbook.Sheets[sheetName], { defval: "" });
}

function cell(row: ExcelRow, aliases: string[]) {
  const entries = Object.entries(row);
  const normalizedAliases = aliases.map((alias) => alias.trim().toLowerCase());
  const match = entries.find(([key]) => normalizedAliases.includes(key.trim().toLowerCase()));

  return String(match?.[1] ?? "").trim();
}

function codeValue(value: string) {
  return value.trim().toUpperCase();
}

function csvCodeList(value: string) {
  return value
    .split(/[;,]/)
    .map((item) => codeValue(item))
    .filter(Boolean);
}

function excelBoolean(value: string) {
  return ["1", "true", "yes", "ναι", "admin", "x", "✓"].includes(value.trim().toLowerCase());
}

function generatedImportPassword(index: number) {
  return `School${2027 + index}!`;
}

function schoolYearDatesFromName(name: string) {
  const [startYear, endYear] = name.split("-").map(Number);
  const safeStartYear = Number.isFinite(startYear) ? startYear : new Date().getFullYear();
  const safeEndYear = Number.isFinite(endYear) ? endYear : safeStartYear + 1;

  return {
    startsOn: new Date(`${safeStartYear}-09-01T00:00:00.000Z`),
    endsOn: new Date(`${safeEndYear}-06-30T00:00:00.000Z`)
  };
}

export async function importSchoolWorkbookAction(formData: FormData) {
  await requireAdmin();
  const file = formData.get("workbook");
  const activeSchoolYearId = optionalText(formData, "activeSchoolYearId") ?? undefined;

  if (!(file instanceof File) || file.size === 0) {
    finishAdminAction("Επιλέξτε αρχείο Excel για εισαγωγή.", "error");
  }

  let importMessage = "";

  try {
    const workbook = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: "buffer" });
    const schoolYearRows = sheetRows(workbook, ["Σχολικά έτη", "SchoolYears"]);
    const teacherRows = sheetRows(workbook, ["Εκπαιδευτικοί", "Teachers"]);
    const parentRows = sheetRows(workbook, ["Γονείς", "Parents"]);
    const classRows = sheetRows(workbook, ["Τμήματα", "Classes"]);
    const studentRows = sheetRows(workbook, ["Μαθητές", "Students"]);
    const courseRows = sheetRows(workbook, ["Μαθήματα", "Courses"]);
    const scheduleRows = sheetRows(workbook, ["Πρόγραμμα", "Schedule"]);

    let teachersImported = 0;
    let parentsImported = 0;
    let classesImported = 0;
    let studentsImported = 0;
    let coursesImported = 0;
    let scheduleImported = 0;
    let schoolYearsImported = 0;

    await prisma.$transaction(async (tx) => {
    const teacherByAm = new Map<string, string>();
    const teacherByUsername = new Map<string, string>();
    const parentByUsername = new Map<string, string>();
    const classByKey = new Map<string, string>();
    const courseByKey = new Map<string, string>();
    async function resolveSchoolYear(name: string) {
      if (name) {
        const existing = await tx.schoolYear.findFirst({ where: { name } });
        if (existing) {
          return existing;
        }

        const dates = schoolYearDatesFromName(name);
        return tx.schoolYear.create({
          data: {
            name,
            startsOn: dates.startsOn,
            endsOn: dates.endsOn
          }
        });
      }

      return activeSchoolYearId
        ? tx.schoolYear.findUnique({ where: { id: activeSchoolYearId } })
        : tx.schoolYear.findFirst({ orderBy: { startsOn: "desc" } });
    }
    async function teacherIdByAm(am: string) {
      if (!am) return undefined;
      const key = codeValue(am);
      const mapped = teacherByAm.get(key);
      if (mapped) return mapped;

      const teacher = await tx.teacher.findUnique({
        where: { am: key }
      });
      if (teacher) {
        teacherByAm.set(key, teacher.id);
        return teacher.id;
      }

      return undefined;
    }
    async function teacherIdByReference(reference: string) {
      if (!reference) return undefined;

      const byAm = await teacherIdByAm(reference);
      if (byAm) return byAm;

      const username = reference.trim().toLowerCase();
      const mapped = teacherByUsername.get(username);
      if (mapped) return mapped;

      const user = await tx.user.findUnique({
        where: { username },
        include: { teacher: true }
      });
      if (user?.teacher) {
        teacherByUsername.set(username, user.teacher.id);
        return user.teacher.id;
      }

      return undefined;
    }

    for (const row of schoolYearRows) {
      const name = cell(row, ["σχολικό έτος", "schoolYear", "έτος", "name"]);
      if (!name) {
        continue;
      }

      const dates = schoolYearDatesFromName(name);
      const startsOnText = cell(row, ["έναρξη", "startsOn"]);
      const endsOnText = cell(row, ["λήξη", "endsOn"]);
      const startsOn = startsOnText ? new Date(startsOnText) : dates.startsOn;
      const endsOn = endsOnText ? new Date(endsOnText) : dates.endsOn;
      const active = excelBoolean(cell(row, ["ενεργό", "active"]));

      if (active) {
        await tx.schoolYear.updateMany({ data: { status: SchoolYearStatus.ARCHIVED } });
      }

      const existingYear = await tx.schoolYear.findFirst({ where: { name } });
      if (existingYear) {
        await tx.schoolYear.update({
          where: { id: existingYear.id },
          data: {
            startsOn,
            endsOn,
            ...(active ? { status: SchoolYearStatus.ACTIVE } : {})
          }
        });
      } else {
        await tx.schoolYear.create({
          data: {
            name,
            startsOn,
            endsOn,
            status: active ? SchoolYearStatus.ACTIVE : SchoolYearStatus.ARCHIVED
          }
        });
      }
      schoolYearsImported += 1;
    }
    async function parentIdByUsername(username: string) {
      if (!username) return undefined;
      const mapped = parentByUsername.get(username);
      if (mapped) return mapped;

      const user = await tx.user.findUnique({
        where: { username },
        include: { parent: true }
      });
      if (user?.parent) {
        parentByUsername.set(username, user.parent.id);
        return user.parent.id;
      }

      return undefined;
    }

    for (const row of teacherRows) {
      const am = codeValue(cell(row, ["ΑΜ", "am", "μητρώο", "κωδικός εκπαιδευτικού"]));
      const username = cell(row, ["username", "χρήστης", "login"]).toLowerCase();
      const name = cell(row, ["όνομα", "name"]);
      const surname = cell(row, ["επώνυμο", "surname"]);
      if (!am || !username || !name || !surname) {
        continue;
      }

      const password = cell(row, ["κωδικός", "password"]) || generatedImportPassword(teachersImported);
      const user = await tx.user.upsert({
        where: { username },
        update: {
          role: excelBoolean(cell(row, ["admin", "διαχειριστής"])) ? UserRole.ADMIN : UserRole.TEACHER,
          passwordHash: hashPassword(password),
          mustChangePassword: true
        },
        create: {
          username,
          passwordHash: hashPassword(password),
          role: excelBoolean(cell(row, ["admin", "διαχειριστής"])) ? UserRole.ADMIN : UserRole.TEACHER,
          mustChangePassword: true
        }
      });

      const teacher = await tx.teacher.upsert({
        where: { am },
        update: {
          userId: user.id,
          name,
          surname,
          isAdmin: user.role === UserRole.ADMIN
        },
        create: {
          am,
          name,
          surname,
          isAdmin: user.role === UserRole.ADMIN,
          userId: user.id
        }
      });
      teacherByAm.set(am, teacher.id);
      teacherByUsername.set(username, teacher.id);
      teachersImported += 1;
    }

    for (const row of parentRows) {
      const username = cell(row, ["username", "χρήστης", "login"]).toLowerCase();
      const name = cell(row, ["όνομα", "name"]);
      const surname = cell(row, ["επώνυμο", "surname"]);
      const email = cell(row, ["email", "mail"]);
      if (!username || !name || !surname || !email) {
        continue;
      }

      const password = cell(row, ["κωδικός", "password"]) || generatedImportPassword(parentsImported + 100);
      const user = await tx.user.upsert({
        where: { username },
        update: {
          role: UserRole.PARENT,
          passwordHash: hashPassword(password),
          mustChangePassword: true
        },
        create: {
          username,
          passwordHash: hashPassword(password),
          role: UserRole.PARENT,
          mustChangePassword: true
        }
      });
      const parent = await tx.parent.upsert({
        where: { userId: user.id },
        update: {
          name,
          surname,
          email
        },
        create: {
          name,
          surname,
          email,
          userId: user.id
        }
      });
      parentByUsername.set(username, parent.id);
      parentsImported += 1;
    }

    for (const row of classRows) {
      const name = cell(row, ["τμήμα", "class", "name"]);
      const schoolYearName = cell(row, ["σχολικό έτος", "schoolYear", "έτος"]);
      const schoolYear = await resolveSchoolYear(schoolYearName);
      if (!name || !schoolYear) {
        continue;
      }

      const responsibleTeacherAm = codeValue(cell(row, ["admin", "ΑΜ εκπαιδευτικού", "υπεύθυνος", "responsibleTeacher", "teacher"]));
      const responsibleTeacherId = await teacherIdByReference(responsibleTeacherAm);
      const classRecord = await tx.class.upsert({
        where: {
          schoolYearId_name: {
            schoolYearId: schoolYear.id,
            name
          }
        },
        update: {
          year: parseClassYear(cell(row, ["τάξη", "year"])),
          responsibleTeacherId
        },
        create: {
          name,
          year: parseClassYear(cell(row, ["τάξη", "year"])),
          schoolYearId: schoolYear.id,
          responsibleTeacherId
        }
      });

      const username = cell(row, ["login", "username", "χρήστης"]).toLowerCase();
      if (username) {
        const password = cell(row, ["κωδικός", "password"]) || generatedImportPassword(classesImported + 200);
        await tx.user.upsert({
          where: { username },
          update: {
            role: UserRole.CLASS_TABLET,
            classId: classRecord.id,
            passwordHash: hashPassword(password),
            mustChangePassword: true
          },
          create: {
            username,
            passwordHash: hashPassword(password),
            role: UserRole.CLASS_TABLET,
            classId: classRecord.id,
            mustChangePassword: true
          }
        });
      }

      classByKey.set(`${schoolYear.name}:${name}`, classRecord.id);
      classesImported += 1;
    }

    for (const row of studentRows) {
      const am = codeValue(cell(row, ["ΑΜ", "am", "μητρώο", "κωδικός μαθητή"]));
      const name = cell(row, ["όνομα", "name"]);
      const surname = cell(row, ["επώνυμο", "surname"]);
      const patronymic = cell(row, ["πατρώνυμο", "patronymic", "πατρωνυμο"]);
      const className = cell(row, ["τμήμα", "class"]);
      const schoolYearName = cell(row, ["σχολικό έτος", "schoolYear", "έτος"]);
      const schoolYear = await resolveSchoolYear(schoolYearName);
      if (!am || !name || !surname || !patronymic || !className || !schoolYear) {
        continue;
      }

      const classId = classByKey.get(`${schoolYear.name}:${className}`) ?? (await tx.class.findUnique({ where: { schoolYearId_name: { schoolYearId: schoolYear.id, name: className } } }))?.id;
      if (!classId) {
        continue;
      }

      const parentUsername = cell(row, ["γονέας", "parent", "parentUsername"]).toLowerCase();
      const parentId = await parentIdByUsername(parentUsername);
      const existingStudent = await tx.student.findFirst({
        where: { am, schoolYearId: schoolYear.id }
      });

      if (existingStudent) {
        await tx.student.update({
          where: { id: existingStudent.id },
          data: { name, surname, patronymic, classId, parentId }
        });
      } else {
        await tx.student.create({
          data: {
            am,
            name,
            surname,
            patronymic,
            classId,
            schoolYearId: schoolYear.id,
            parentId
          }
        });
      }
      studentsImported += 1;
    }

    for (const row of courseRows) {
      const aa = codeValue(cell(row, ["ΑΑ", "aa", "κωδικός μαθήματος"]));
      const name = cell(row, ["μάθημα", "course", "name"]);
      const className = cell(row, ["τμήμα", "class"]);
      const schoolYearName = cell(row, ["σχολικό έτος", "schoolYear", "έτος"]);
      const schoolYear = await resolveSchoolYear(schoolYearName);
      if (!aa || !name || !className || !schoolYear) {
        continue;
      }

      const classId = classByKey.get(`${schoolYear.name}:${className}`) ?? (await tx.class.findUnique({ where: { schoolYearId_name: { schoolYearId: schoolYear.id, name: className } } }))?.id;
      if (!classId) {
        continue;
      }

      const course = await tx.course.upsert({
        where: {
          classId_aa: {
            classId,
            aa
          }
        },
        update: {
          name,
          isNoCourse: excelBoolean(cell(row, ["κενό", "isNoCourse"]))
        },
        create: {
          aa,
          name,
          classId,
          isNoCourse: excelBoolean(cell(row, ["κενό", "isNoCourse"]))
        }
      });

      await tx.courseTeacher.deleteMany({ where: { courseId: course.id } });
      const teacherReference = cell(row, ["εκπαιδευτικός", "εκπαιδευτικοί", "teacher", "teachers", "teacherAm", "teacherAms", "ΑΜ εκπαιδευτικού", "ΑΜ εκπαιδευτικών"]);
      const teacherId = await teacherIdByReference(teacherReference);

      if (teacherId) {
        await tx.courseTeacher.create({
          data: { courseId: course.id, teacherId }
        });
      }
      courseByKey.set(`${schoolYear.name}:${className}:${aa}`, course.id);
      courseByKey.set(`${schoolYear.name}:${className}:${name}`, course.id);
      coursesImported += 1;
    }

    for (const row of scheduleRows) {
      const className = cell(row, ["τμήμα", "class"]);
      const schoolYearName = cell(row, ["σχολικό έτος", "schoolYear", "έτος"]);
      const courseAa = codeValue(cell(row, ["ΑΑ μαθήματος", "ΑΑ", "courseAa", "aa"]));
      const courseName = cell(row, ["μάθημα", "course"]);
      const day = parseWeekDay(cell(row, ["ημέρα", "day"]));
      const hour = Number(cell(row, ["ώρα", "hour"]));
      const schoolYear = await resolveSchoolYear(schoolYearName);

      if (!className || (!courseAa && !courseName) || !schoolYear || !Number.isInteger(hour) || hour < 1 || hour > 7) {
        continue;
      }

      const classId = classByKey.get(`${schoolYear.name}:${className}`) ?? (await tx.class.findUnique({ where: { schoolYearId_name: { schoolYearId: schoolYear.id, name: className } } }))?.id;
      if (!classId) {
        continue;
      }

      const courseIds: string[] = [];
      for (const aa of csvCodeList(courseAa)) {
        const courseId = courseByKey.get(`${schoolYear.name}:${className}:${aa}`) ?? (await tx.course.findUnique({ where: { classId_aa: { classId, aa } } }))?.id;
        if (courseId) {
          courseIds.push(courseId);
        }
      }

      if (courseIds.length === 0 && courseName) {
        const courseId = courseByKey.get(`${schoolYear.name}:${className}:${courseName}`) ?? (await tx.course.findUnique({ where: { classId_name: { classId, name: courseName } } }))?.id;
        if (courseId) {
          courseIds.push(courseId);
        }
      }

      const uniqueCourseIds = Array.from(new Set(courseIds));
      if (uniqueCourseIds.length === 0) {
        continue;
      }

      const existingSlots = await tx.scheduleSlot.findMany({ where: { classId, day, hour }, select: { id: true } });
      const existingSlotIds = existingSlots.map((slot) => slot.id);
      await tx.absence.deleteMany({ where: { scheduleSlotId: { in: existingSlotIds } } });
      await tx.attendanceSignature.deleteMany({ where: { scheduleSlotId: { in: existingSlotIds } } });
      await tx.scheduleSlot.deleteMany({ where: { id: { in: existingSlotIds } } });
      await tx.scheduleSlot.createMany({
        data: uniqueCourseIds.map((courseId) => ({ classId, day, hour, courseId })),
        skipDuplicates: true
      });
      scheduleImported += uniqueCourseIds.length;
    }
    }, { maxWait: 15000, timeout: 60000 });

    importMessage = `Ολοκληρώθηκε εισαγωγή: ${schoolYearsImported} σχολικά έτη, ${classesImported} τμήματα, ${teachersImported} εκπαιδευτικοί, ${parentsImported} γονείς, ${studentsImported} μαθητές, ${coursesImported} μαθήματα, ${scheduleImported} ώρες προγράμματος.`;
  } catch (error) {
    console.error("Excel import failed", error);
    const message = error instanceof Error ? error.message : "Άγνωστο σφάλμα εισαγωγής.";
    finishAdminAction(`Αποτυχία εισαγωγής Excel: ${message.slice(0, 220)}`, "error");
  }

  finishAdminAction(importMessage);
}

export async function promoteSchoolYearAction(formData: FormData) {
  await requireAdmin();
  const sourceSchoolYearId = requiredText(formData, "sourceSchoolYearId", "τρέχον σχολικό έτος");
  const nextName = requiredText(formData, "nextName", "επόμενο σχολικό έτος");
  const startsOn = new Date(requiredText(formData, "startsOn", "έναρξη"));
  const endsOn = new Date(requiredText(formData, "endsOn", "λήξη"));

  if (startsOn >= endsOn) {
    finishAdminAction("Η λήξη του νέου σχολικού έτους πρέπει να είναι μετά την έναρξη.", "error");
  }

  await prisma.$transaction(async (tx) => {
    const sourceYear = await tx.schoolYear.findUniqueOrThrow({
      where: { id: sourceSchoolYearId },
      include: {
        classes: {
          include: {
            students: true,
            courses: {
              include: {
                teachers: true,
                schedules: true
              }
            }
          }
        }
      }
    });

    await tx.schoolYear.updateMany({
      where: { status: SchoolYearStatus.ACTIVE },
      data: { status: SchoolYearStatus.ARCHIVED }
    });

    const nextYear = await tx.schoolYear.create({
      data: {
        name: nextName,
        startsOn,
        endsOn,
        status: SchoolYearStatus.ACTIVE
      }
    });

    const courseMap = new Map<string, string>();

    for (const sourceClass of sourceYear.classes) {
      const targetYear = nextClassYear(sourceClass.year);
      if (!targetYear) {
        continue;
      }

      const targetClass = await tx.class.create({
        data: {
          name: promotedClassName(sourceClass.name, targetYear),
          year: targetYear,
          schoolYearId: nextYear.id,
          responsibleTeacherId: sourceClass.responsibleTeacherId
        }
      });

      const username = classLoginName(targetClass.name, targetYear);
      await tx.user.upsert({
        where: { username },
        update: {
          role: UserRole.CLASS_TABLET,
          classId: targetClass.id,
          passwordHash: hashPassword(username),
          mustChangePassword: true
        },
        create: {
          username,
          passwordHash: hashPassword(username),
          role: UserRole.CLASS_TABLET,
          classId: targetClass.id,
          mustChangePassword: true
        }
      });

      for (const student of sourceClass.students) {
        await tx.student.create({
          data: {
            am: student.am,
            name: student.name,
            surname: student.surname,
            patronymic: student.patronymic,
            parentId: student.parentId,
            classId: targetClass.id,
            schoolYearId: nextYear.id
          }
        });
      }

      for (const sourceCourse of sourceClass.courses) {
        const targetCourse = await tx.course.create({
          data: {
            aa: sourceCourse.aa,
            name: sourceCourse.name,
            classId: targetClass.id,
            isNoCourse: sourceCourse.isNoCourse
          }
        });
        courseMap.set(sourceCourse.id, targetCourse.id);

        for (const teacherLink of sourceCourse.teachers) {
          await tx.courseTeacher.create({
            data: {
              courseId: targetCourse.id,
              teacherId: teacherLink.teacherId
            }
          });
        }
      }

      for (const sourceCourse of sourceClass.courses) {
        const targetCourseId = courseMap.get(sourceCourse.id);
        if (!targetCourseId) {
          continue;
        }

        for (const scheduleSlot of sourceCourse.schedules) {
          await tx.scheduleSlot.create({
            data: {
              classId: targetClass.id,
              courseId: targetCourseId,
              day: scheduleSlot.day,
              hour: scheduleSlot.hour
            }
          });
        }
      }
    }
  });

  revalidatePath("/admin");
}
