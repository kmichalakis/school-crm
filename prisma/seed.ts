import { AbsenceStatus, PrismaClient, UserRole, ClassYear, WeekDay } from "@prisma/client";
import { hashPassword } from "../lib/password";

const prisma = new PrismaClient();

async function main() {
  const classPasswordHash = hashPassword("a1");
  const teacherPasswordHash = hashPassword("teacher");
  const adminPasswordHash = hashPassword("admin");
  const parentPasswordHash = hashPassword("parent");

  const legacyTeacherUser = await prisma.user.findUnique({
    where: { username: "m.papadopoulos" },
    include: { teacher: true }
  });

  if (legacyTeacherUser?.teacher) {
    await prisma.courseTeacher.deleteMany({
      where: { teacherId: legacyTeacherUser.teacher.id }
    });
    await prisma.class.updateMany({
      where: { responsibleTeacherId: legacyTeacherUser.teacher.id },
      data: { responsibleTeacherId: null }
    });
    await prisma.teacher.delete({
      where: { id: legacyTeacherUser.teacher.id }
    });
  }

  if (legacyTeacherUser) {
    await prisma.user.delete({
      where: { id: legacyTeacherUser.id }
    });
  }

  await prisma.user.deleteMany({
    where: { username: "tablet-a1" }
  });

  const schoolYear = await prisma.schoolYear.upsert({
    where: { id: "demo-school-year" },
    update: {},
    create: {
      id: "demo-school-year",
      name: "2025-2026",
      startsOn: new Date("2025-09-01"),
      endsOn: new Date("2026-06-30")
    }
  });

  const classA1 = await prisma.class.upsert({
    where: { id: "class-a1" },
    update: {},
    create: {
      id: "class-a1",
      name: "Α1",
      year: ClassYear.A,
      schoolYearId: schoolYear.id
    }
  });

  const tabletUser = await prisma.user.upsert({
    where: { username: "a1" },
    update: {
      passwordHash: classPasswordHash,
      role: UserRole.CLASS_TABLET,
      classId: classA1.id
    },
    create: {
      username: "a1",
      passwordHash: classPasswordHash,
      role: UserRole.CLASS_TABLET,
      classId: classA1.id
    }
  });

  await prisma.user.upsert({
    where: { username: "admin" },
    update: {
      passwordHash: adminPasswordHash,
      role: UserRole.ADMIN
    },
    create: {
      username: "admin",
      passwordHash: adminPasswordHash,
      role: UserRole.ADMIN
    }
  });

  const teacherUser = await prisma.user.upsert({
    where: { username: "teacher" },
    update: {
      passwordHash: teacherPasswordHash,
      role: UserRole.TEACHER
    },
    create: {
      username: "teacher",
      passwordHash: teacherPasswordHash,
      role: UserRole.TEACHER
    }
  });

  const teacher = await prisma.teacher.upsert({
    where: { userId: teacherUser.id },
    update: {
      am: "T001",
      name: "Μαρία",
      surname: "Παπαδοπούλου",
      isAdmin: false,
      homeClassId: classA1.id
    },
    create: {
      am: "T001",
      name: "Μαρία",
      surname: "Παπαδοπούλου",
      isAdmin: false,
      userId: teacherUser.id,
      homeClassId: classA1.id
    }
  });

  await prisma.class.update({
    where: { id: classA1.id },
    data: { responsibleTeacherId: teacher.id }
  });

  const parentUser = await prisma.user.upsert({
    where: { username: "parent" },
    update: {
      passwordHash: parentPasswordHash,
      role: UserRole.PARENT
    },
    create: {
      username: "parent",
      passwordHash: parentPasswordHash,
      role: UserRole.PARENT
    }
  });

  const parent = await prisma.parent.upsert({
    where: { userId: parentUser.id },
    update: {
      name: "Δήμητρα",
      surname: "Γεωργίου",
      email: "parent@example.edu"
    },
    create: {
      name: "Δήμητρα",
      surname: "Γεωργίου",
      email: "parent@example.edu",
      userId: parentUser.id
    }
  });

  const courses = await Promise.all(
    [
      { aa: "M001", name: "Μαθηματικά" },
      { aa: "M002", name: "Νεοελληνική Γλώσσα" },
      { aa: "M003", name: "Φυσική" },
      { aa: "M004", name: "Ιστορία" },
      { aa: "M005", name: "Φυσική Αγωγή" },
      { aa: "M000", name: "ΚΕΝΟ" }
    ].map((courseSeed) =>
      prisma.course.upsert({
        where: {
          classId_name: {
            classId: classA1.id,
            name: courseSeed.name
          }
        },
        update: {
          aa: courseSeed.aa
        },
        create: {
          id: `course-a1-${courseSeed.name.toLowerCase().replace(/\s+/g, "-")}`,
          aa: courseSeed.aa,
          name: courseSeed.name,
          classId: classA1.id,
          isNoCourse: courseSeed.name === "ΚΕΝΟ"
        }
      })
    )
  );

  const course = courses.find((courseItem) => courseItem.name === "Μαθηματικά");
  if (!course) {
    throw new Error("Δεν βρέθηκε το μάθημα Μαθηματικά στο seed.");
  }

  await prisma.courseTeacher.upsert({
    where: {
      courseId_teacherId: {
        courseId: course.id,
        teacherId: teacher.id
      }
    },
    update: {},
    create: {
      courseId: course.id,
      teacherId: teacher.id
    }
  });

  const demoStudents = [
    { id: "s1", am: "S001", name: "Άννα", surname: "Αντωνίου", patronymic: "Γεώργιος" },
    { id: "s2", am: "S002", name: "Νίκος", surname: "Γεωργίου", patronymic: "Κωνσταντίνος" },
    { id: "s3", am: "S003", name: "Ελένη", surname: "Ιωάννου", patronymic: "Αντώνιος" },
    { id: "s4", am: "S004", name: "Πέτρος", surname: "Κυριάκου", patronymic: "Δημήτριος" },
    { id: "s5", am: "S005", name: "Σοφία", surname: "Μιχαήλ", patronymic: "Νικόλαος" }
  ];

  for (const student of demoStudents) {
    await prisma.student.upsert({
      where: { id: student.id },
      update: {
        am: student.am,
        name: student.name,
        surname: student.surname,
        patronymic: student.patronymic,
        parentId: student.id === "s2" || student.id === "s5" ? parent.id : undefined
      },
      create: {
        id: student.id,
        am: student.am,
        name: student.name,
        surname: student.surname,
        patronymic: student.patronymic,
        classId: classA1.id,
        schoolYearId: schoolYear.id,
        parentId: student.id === "s2" || student.id === "s5" ? parent.id : undefined
      }
    });
  }

  await prisma.scheduleSlot.upsert({
    where: {
      classId_day_hour_courseId: {
        classId: classA1.id,
        day: WeekDay.MONDAY,
        hour: 1,
        courseId: course.id
      }
    },
    update: {},
    create: {
      classId: classA1.id,
      day: WeekDay.MONDAY,
      hour: 1,
      courseId: course.id
    }
  });

  const attendanceSheet = await prisma.attendanceSheet.upsert({
    where: {
      classId_date_hour: {
        classId: classA1.id,
        date: new Date("2026-05-18T00:00:00.000Z"),
        hour: 1
      }
    },
    update: {
      courseId: course.id,
      teacherName: `${teacher.name} ${teacher.surname}`
    },
    create: {
      classId: classA1.id,
      courseId: course.id,
      date: new Date("2026-05-18T00:00:00.000Z"),
      day: WeekDay.MONDAY,
      hour: 1,
      teacherName: `${teacher.name} ${teacher.surname}`
    }
  });

  for (const studentId of ["s2", "s5"]) {
    await prisma.attendanceSheetAbsence.upsert({
      where: {
        sheetId_studentId: {
          sheetId: attendanceSheet.id,
          studentId
        }
      },
      update: {
        absent: true,
        status: studentId === "s5" ? AbsenceStatus.EXCUSED : AbsenceStatus.MARKED,
        excusedReason: studentId === "s5" ? "Ιατρική βεβαίωση" : null,
        excusedAt: studentId === "s5" ? new Date("2026-09-15T09:30:00") : null
      },
      create: {
        sheetId: attendanceSheet.id,
        studentId,
        absent: true,
        status: studentId === "s5" ? AbsenceStatus.EXCUSED : AbsenceStatus.MARKED,
        excusedReason: studentId === "s5" ? "Ιατρική βεβαίωση" : null,
        excusedAt: studentId === "s5" ? new Date("2026-09-15T09:30:00") : null
      }
    });
  }

  await prisma.emailRule.upsert({
    where: { id: "demo-first-hour-email" },
    update: {},
    create: {
      id: "demo-first-hour-email",
      name: "Ενημέρωση γονέα για απουσία την πρώτη ώρα",
      trigger: "FIRST_HOUR_ABSENCE"
    }
  });

  console.log(`Δημιουργήθηκαν δοκιμαστικά δεδομένα για ${schoolYear.name}, ${classA1.name}, χρήστες ${tabletUser.username}/teacher/admin/parent`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
