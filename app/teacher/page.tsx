import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { WeekDay } from "@prisma/client";
import { AppNavigation } from "@/app/app-navigation";
import { TeacherDatePicker } from "@/app/teacher/teacher-date-picker";
import { clampToSchoolYear, dateInputValue, isAllowedSchoolDate } from "@/lib/school-calendar";
import { prisma } from "@/lib/prisma";
import { hourLabel, weekDayLabel } from "@/lib/report-helpers";
import { dateToWeekDay, formatDateInput, getCurrentSchoolHour, schoolHours } from "@/lib/school-time";
import { parseSessionToken, sessionCookieName } from "@/lib/session";

type TeacherDayPageProps = {
  searchParams: Promise<{
    date?: string;
  }>;
};

function validDateParam(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  return value;
}

function attendanceDate(dateValue: string) {
  return new Date(`${dateValue}T00:00:00.000Z`);
}

function selectedDateLabel(dateValue: string) {
  return new Intl.DateTimeFormat("el-GR", {
    dateStyle: "long"
  }).format(new Date(`${dateValue}T12:00:00`));
}

function attendanceLink(classId: string, date: string, day: WeekDay, hour: number) {
  const params = new URLSearchParams({
    classId,
    date,
    day,
    hour: String(hour)
  });

  return `/?${params.toString()}`;
}

export default async function TeacherDayPage({ searchParams }: TeacherDayPageProps) {
  const cookieStore = await cookies();
  const session = parseSessionToken(cookieStore.get(sessionCookieName)?.value);

  if (!session) {
    redirect("/");
  }

  if (session.mustChangePassword) {
    redirect("/account/password");
  }

  if (session.role === "PARENT" || session.role === "CLASS_TABLET") {
    redirect("/");
  }

  const params = await searchParams;
  const activeYear = await prisma.schoolYear.findFirst({
    where: { status: "ACTIVE" },
    include: { calendarDays: true },
    orderBy: { startsOn: "desc" }
  });
  const schoolYearBounds = activeYear
    ? {
        startsOn: dateInputValue(activeYear.startsOn),
        endsOn: dateInputValue(activeYear.endsOn)
      }
    : null;
  const calendarExceptions = activeYear
    ? activeYear.calendarDays.map((calendarDay) => ({
        date: dateInputValue(calendarDay.date),
        isWorkingDay: calendarDay.isWorkingDay
      }))
    : [];
  const today = new Date();
  const todayDate = clampToSchoolYear(formatDateInput(today), schoolYearBounds);
  const todayDay = dateToWeekDay(todayDate) as WeekDay | null;
  const selectedDate = clampToSchoolYear(validDateParam(params.date) ?? todayDate, schoolYearBounds);
  const selectedDay = isAllowedSchoolDate(selectedDate, schoolYearBounds, calendarExceptions)
    ? (dateToWeekDay(selectedDate) as WeekDay | null)
    : null;
  const currentHour = getCurrentSchoolHour(today).hour;
  const teacher =
    session.role === "TEACHER" || session.role === "ADMIN"
      ? await prisma.teacher.findUnique({
          where: { userId: session.userId }
        })
      : null;
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { teacher: true }
  });
  const userLabel = user?.teacher ? `${user.teacher.name} ${user.teacher.surname}` : user?.username ?? "Χρήστης";

  if (session.role === "TEACHER" && !teacher) {
    redirect("/");
  }

  const weeklyScheduleSlots = selectedDay
    ? await prisma.scheduleSlot.findMany({
        where:
          session.role === "ADMIN" && !teacher
            ? { day: selectedDay }
            : {
                day: selectedDay,
                course: {
                  teachers: {
                    some: {
                      teacherId: teacher?.id
                    }
                  }
                }
              },
        include: {
          course: {
            include: {
              class: {
                include: {
                  schoolYear: true
                }
              },
              teachers: {
                include: {
                  teacher: true
                }
              }
            }
          }
        },
        orderBy: [{ hour: "asc" }, { classId: "asc" }]
      })
    : [];
  const dailyOverrideSheets = selectedDay
    ? await prisma.attendanceSheet.findMany({
        where: {
          date: attendanceDate(selectedDate),
          class: activeYear
            ? {
                schoolYearId: activeYear.id
              }
            : undefined,
          courses:
            session.role === "ADMIN" && !teacher
              ? {
                  some: {
                    course: {
                      isNoCourse: false
                    }
                  }
                }
              : {
                  some: {
                    teacherId: teacher?.id,
                    course: {
                      isNoCourse: false
                    }
                  }
                }
        },
        include: {
          courses: {
            include: {
              course: {
                include: {
                  class: {
                    include: {
                      schoolYear: true
                    }
                  },
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
      })
    : [];
  const overriddenClassHourKeys = new Set(dailyOverrideSheets.map((sheet) => `${sheet.classId}-${sheet.hour}`));
  const dailyScheduleItems = dailyOverrideSheets.flatMap((sheet) =>
    sheet.courses
      .filter((entry) => !entry.course.isNoCourse && (session.role === "ADMIN" && !teacher ? true : entry.teacherId === teacher?.id))
      .map((entry) => ({
        id: `${sheet.id}-${entry.id}`,
        classId: sheet.classId,
        hour: sheet.hour,
        course: entry.course
      }))
  );
  const scheduleSlots = [
    ...dailyScheduleItems,
    ...weeklyScheduleSlots.filter((slot) => !overriddenClassHourKeys.has(`${slot.classId}-${slot.hour}`))
  ].sort((first, second) => first.hour - second.hour || first.classId.localeCompare(second.classId));

  const sheets =
    scheduleSlots.length > 0
      ? await prisma.attendanceSheet.findMany({
          where: {
            date: attendanceDate(selectedDate),
            OR: scheduleSlots.map((slot) => ({
              classId: slot.classId,
              hour: slot.hour
            }))
          },
          include: {
            absences: true
          }
        })
      : [];
  const sheetByClassHour = new Map(sheets.map((sheet) => [`${sheet.classId}-${sheet.hour}`, sheet]));
  const signedSlotCount = scheduleSlots.filter((slot) => sheetByClassHour.get(`${slot.classId}-${slot.hour}`)?.signedAt).length;
  const pendingCount = Math.max(scheduleSlots.length - signedSlotCount, 0);
  const absenceCount = sheets.reduce(
    (total, sheet) => total + sheet.absences.filter((absence) => absence.absent && absence.status !== "REMOVED").length,
    0
  );

  return (
    <AppNavigation
      active="teacher"
      role={session.role}
      title="Μαθήματα"
      subtitle="Ώρες διδασκαλίας και άνοιγμα απουσιολογίων ανά ημερομηνία"
      userLabel={userLabel}
    >

      <section className="admin-section">
        <div className="admin-section-title">
          <h2>Ημερομηνία εργασίας</h2>
          <p>Επιλέξτε ημερομηνία και ανοίξτε απευθείας το απουσιολόγιο της σωστής ώρας.</p>
        </div>

        <TeacherDatePicker
          selectedDate={selectedDate}
          minDate={schoolYearBounds?.startsOn}
          maxDate={schoolYearBounds?.endsOn}
          hint={selectedDay ? `${weekDayLabel(selectedDay)} · ${selectedDateLabel(selectedDate)}` : "Μη εργάσιμη ημερομηνία"}
        />
      </section>

      <div className="summary-grid">
        <div className="panel metric">
          <span>Μαθήματα</span>
          <strong>{scheduleSlots.length}</strong>
        </div>
        <div className="panel metric">
          <span>Υπογεγραμμένα</span>
          <strong>{signedSlotCount}</strong>
        </div>
        <div className="panel metric">
          <span>Εκκρεμότητες</span>
          <strong>{pendingCount}</strong>
        </div>
        <div className="panel metric">
          <span>Απουσίες ημέρας</span>
          <strong>{absenceCount}</strong>
        </div>
      </div>

      <section className="admin-section">
        <div className="admin-section-title">
          <h2>Μαθήματα {selectedDay ? weekDayLabel(selectedDay) : "ημερομηνίας"}</h2>
          <p>Η τρέχουσα ώρα τονίζεται όταν συμπίπτει με τη σημερινή ημερομηνία.</p>
        </div>

        {scheduleSlots.length > 0 ? (
          <div className="teacher-day-list">
            {scheduleSlots.map((slot) => {
              const sheet = sheetByClassHour.get(`${slot.classId}-${slot.hour}`);
              const teachers = slot.course.teachers.map((link) => `${link.teacher.surname} ${link.teacher.name}`).join(", ");
              const status = sheet?.signedAt ? "Υπογεγραμμένο" : sheet?.savedAt ? "Πρόχειρο" : "Εκκρεμεί";
              const activeNow = selectedDate === todayDate && selectedDay === todayDay && slot.hour === currentHour;
              const slotTime = schoolHours.find((schoolHour) => schoolHour.hour === slot.hour);
              const slotAbsences = sheet?.absences.filter((absence) => absence.absent && absence.status !== "REMOVED").length ?? 0;

              return (
                <article className={activeNow ? "teacher-day-card current" : "teacher-day-card"} key={slot.id}>
                  <div className="teacher-day-time">
                    <strong>{hourLabel(slot.hour)}</strong>
                    <span>
                      {slotTime?.starts}-{slotTime?.ends}
                    </span>
                  </div>
                  <div className="teacher-day-main">
                    <strong>{slot.course.name}</strong>
                    <span>
                      {slot.course.class.name} ({slot.course.class.schoolYear.name})
                    </span>
                    <span>{teachers || "Χωρίς εκπαιδευτικό"}</span>
                  </div>
                  <div className="teacher-day-status">
                    <span className={sheet?.signedAt ? "pill signed-pill" : "pill"}>{status}</span>
                    <span className="student-directory-detail">{slotAbsences} απουσίες</span>
                  </div>
                  <Link className="primary-button" href={attendanceLink(slot.classId, selectedDate, selectedDay ?? WeekDay.MONDAY, slot.hour)}>
                    Άνοιγμα
                  </Link>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">Δεν υπάρχουν μαθήματα για την επιλεγμένη ημερομηνία.</div>
        )}
      </section>
    </AppNavigation>
  );
}
