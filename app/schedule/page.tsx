import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { WeekDay } from "@prisma/client";
import { AppNavigation } from "@/app/app-navigation";
import { saveDailyScheduleAction, toggleScheduleHolidayAction } from "@/app/schedule/actions";
import { HolidayToggleForm } from "@/app/schedule/holiday-toggle-form";
import { ScheduleDatePicker } from "@/app/schedule/schedule-date-picker";
import { dateInputValue, isAllowedSchoolDate, isWeekdayDate, isWithinSchoolYear } from "@/lib/school-calendar";
import { prisma } from "@/lib/prisma";
import { hourLabel } from "@/lib/report-helpers";
import { dateToWeekDay, formatDateInput, schoolHours, weekDays } from "@/lib/school-time";
import { parseSessionToken, sessionCookieName } from "@/lib/session";

export const dynamic = "force-dynamic";

type SchedulePageProps = {
  searchParams: Promise<{
    classId?: string;
    date?: string;
    notice?: string;
    noticeType?: string;
  }>;
};

function dayFromDate(date: Date): WeekDay | null {
  const dayIndex = date.getDay();
  const match = weekDays.find((day) => day.number === dayIndex);
  return match?.value ?? null;
}

function currentHour(date: Date) {
  const minutes = date.getHours() * 60 + date.getMinutes();

  return schoolHours.find((slot) => {
    const [startHour, startMinute] = slot.starts.split(":").map(Number);
    const [endHour, endMinute] = slot.ends.split(":").map(Number);
    const start = startHour * 60 + startMinute;
    const end = endHour * 60 + endMinute;

    return minutes >= start && minutes <= end;
  })?.hour;
}

function validDateParam(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return "";
  }

  return value;
}

function teacherLabel(course: {
  teachers: Array<{
    teacher: {
      name: string;
      surname: string;
    };
  }>;
}) {
  return course.teachers.map((link) => `${link.teacher.surname} ${link.teacher.name}`).join(", ");
}

function courseOptionLabel(course: {
  name: string;
  isSubstitution?: boolean;
  teachers: Array<{
    teacher: {
      name: string;
      surname: string;
    };
  }>;
}) {
  const teachers = teacherLabel(course);
  if (course.isSubstitution) {
    return "ΑΝΑΠΛΗΡΩΣΗ";
  }
  return teachers ? `${course.name} · ${teachers}` : course.name;
}

export default async function SchedulePage({ searchParams }: SchedulePageProps) {
  const cookieStore = await cookies();
  const session = parseSessionToken(cookieStore.get(sessionCookieName)?.value);

  if (!session || session.role === "PARENT") {
    redirect("/");
  }

  if (session.mustChangePassword) {
    redirect("/account/password");
  }

  const params = await searchParams;
  const selectedDate = validDateParam(params.date);
  const selectedDay = dateToWeekDay(selectedDate) as WeekDay | null;
  const notice = params.notice ?? "";
  const noticeType = params.noticeType === "error" ? "error" : "success";
  const teacher =
    session.role === "TEACHER"
      ? await prisma.teacher.findUnique({
          where: { userId: session.userId },
          include: {
            courses: {
              include: {
                course: true
              }
            }
          }
        })
      : null;
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { teacher: true }
  });
  const userLabel = user?.teacher ? `${user.teacher.name} ${user.teacher.surname}` : user?.username ?? "Χρήστης";

  const allowedClassIds =
    session.role === "ADMIN"
      ? undefined
      : session.role === "CLASS_TABLET"
        ? session.classId
          ? [session.classId]
          : []
        : Array.from(
            new Set([
              ...(teacher?.homeClassId ? [teacher.homeClassId] : []),
              ...(teacher?.courses.map((courseLink) => courseLink.course.classId) ?? [])
            ])
          );

  const classes = await prisma.class.findMany({
    where: allowedClassIds ? { id: { in: allowedClassIds } } : undefined,
    include: {
      schoolYear: true
    },
    orderBy: [{ schoolYear: { startsOn: "desc" } }, { name: "asc" }]
  });

  const selectedClass = classes.find((classRecord) => classRecord.id === params.classId) ?? classes[0] ?? null;
  if (selectedClass && session.role === "ADMIN") {
    await prisma.course.upsert({
      where: {
        classId_name: {
          classId: selectedClass.id,
          name: "ΑΝΑΠΛΗΡΩΣΗ"
        }
      },
      update: { isSubstitution: true },
      create: {
        aa: `ANAPL-${selectedClass.id.slice(-6)}`,
        classId: selectedClass.id,
        name: "ΑΝΑΠΛΗΡΩΣΗ",
        isSubstitution: true
      }
    });
  }
  const [scheduleSlots, courseOptions, dailySheets] = selectedClass
    ? await Promise.all([
        prisma.scheduleSlot.findMany({
        where: { classId: selectedClass.id },
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
        orderBy: [{ day: "asc" }, { hour: "asc" }]
        }),
        prisma.course.findMany({
          where: {
            classId: selectedClass.id,
            isNoCourse: false
          },
          include: {
            teachers: {
              include: {
                teacher: true
              }
            }
          },
          orderBy: [{ name: "asc" }]
        }),
        selectedDate
          ? prisma.attendanceSheet.findMany({
              where: {
                classId: selectedClass.id,
                date: new Date(`${selectedDate}T00:00:00.000Z`)
              },
              include: {
                courses: {
                  include: {
                    teacher: true,
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
                  orderBy: { position: "asc" }
                }
              }
            })
          : Promise.resolve([])
      ])
    : [[], [], []];

  const slotsByDayHour = new Map<string, typeof scheduleSlots>();
  for (const slot of scheduleSlots) {
    const key = `${slot.day}-${slot.hour}`;
    slotsByDayHour.set(key, [...(slotsByDayHour.get(key) ?? []), slot]);
  }
  const dailySheetByHour = new Map(dailySheets.map((sheet) => [sheet.hour, sheet]));
  const today = new Date();
  const activeDay = dayFromDate(today);
  const activeHour = currentHour(today);
  const selectedClassBounds = selectedClass
    ? {
        startsOn: dateInputValue(selectedClass.schoolYear.startsOn),
        endsOn: dateInputValue(selectedClass.schoolYear.endsOn)
      }
    : null;
  const calendarExceptions =
    selectedClass?.schoolYearId
      ? (
          await prisma.schoolCalendarDay.findMany({
            where: { schoolYearId: selectedClass.schoolYearId }
          })
        ).map((calendarDay) => ({
          date: dateInputValue(calendarDay.date),
          isWorkingDay: calendarDay.isWorkingDay
        }))
      : [];
  const teachers = await prisma.teacher.findMany({
    orderBy: [{ surname: "asc" }, { name: "asc" }]
  });
  const todayDate = formatDateInput(today);
  const minScheduleDate =
    selectedClassBounds && selectedClassBounds.startsOn > todayDate ? selectedClassBounds.startsOn : todayDate;
  const selectedDateAllowed =
    selectedDate && selectedClassBounds
      ? isAllowedSchoolDate(selectedDate, selectedClassBounds, calendarExceptions) && selectedDate >= todayDate
      : false;
  const selectedDateSelectable =
    selectedDate && selectedClassBounds
      ? isWithinSchoolYear(selectedDate, selectedClassBounds) && isWeekdayDate(selectedDate) && selectedDate >= todayDate
      : false;
  const selectedCalendarException = calendarExceptions.find((calendarDay) => calendarDay.date === selectedDate);
  const selectedDateIsHoliday = selectedCalendarException?.isWorkingDay === false;

  return (
    <AppNavigation
      active="schedule"
      role={session.role}
      title="Πρόγραμμα"
      subtitle="Εβδομαδιαία εικόνα μαθημάτων ανά τμήμα"
      userLabel={userLabel}
    >
      {notice ? (
        <div className={`admin-notice ${noticeType}`} role="status">
          {notice}
        </div>
      ) : null}

      <section className="admin-section">
        <div className="admin-section-title">
          <h2>Τμήμα</h2>
          <p>Επιλογή τμήματος για προβολή του προγράμματος της εβδομάδας.</p>
        </div>

        <div className="class-tabs">
          {classes.map((classRecord) => {
            const classParams = new URLSearchParams({ classId: classRecord.id });
            if (selectedDate) {
              classParams.set("date", selectedDate);
            }

            return (
              <Link
                className={selectedClass?.id === classRecord.id ? "class-tab active" : "class-tab"}
                href={`/schedule?${classParams.toString()}`}
                key={classRecord.id}
                prefetch={false}
              >
                {classRecord.name}
                <span>{classRecord.schoolYear.name}</span>
              </Link>
            );
          })}
        </div>
      </section>

      {selectedClass ? (
        <>
          {session.role === "ADMIN" && selectedClassBounds ? (
            <section className="admin-section">
              <div className="admin-section-title">
                <h2>Ημερήσια αλλαγή προγράμματος</h2>
                <p>Αφήστε κενή την ημερομηνία για απλή προβολή του εβδομαδιαίου προγράμματος.</p>
              </div>
              <ScheduleDatePicker
                classId={selectedClass.id}
                maxDate={selectedClassBounds.endsOn}
                minDate={minScheduleDate}
                schoolYearBounds={selectedClassBounds}
                selectedDate={selectedDate}
              />
            </section>
          ) : null}

          {selectedDate ? (
            <section className="admin-section">
              <div className="admin-section-title">
                <h2>
                  Πρόγραμμα {selectedClass.name} για {new Intl.DateTimeFormat("el-GR", { dateStyle: "long" }).format(new Date(`${selectedDate}T12:00:00`))}
                </h2>
                <p>
                  {selectedDateAllowed
                    ? "Αλλάξτε τα μαθήματα κάθε ώρας και αποθηκεύστε ολόκληρο το ημερήσιο πρόγραμμα."
                    : "Η ημερομηνία δεν είναι διαθέσιμη για έκτακτη αλλαγή προγράμματος."}
                </p>
              </div>

              {session.role === "ADMIN" && selectedDateSelectable ? (
                <HolidayToggleForm
                  action={toggleScheduleHolidayAction}
                  classId={selectedClass.id}
                  date={selectedDate}
                  isHoliday={selectedDateIsHoliday}
                />
              ) : null}

              {session.role === "ADMIN" && selectedDateAllowed && selectedDay ? (
                <form action={saveDailyScheduleAction} className="daily-schedule-form" key={`${selectedClass.id}-${selectedDate}`}>
                  <input name="classId" type="hidden" value={selectedClass.id} />
                  <input name="date" type="hidden" value={selectedDate} />
                  {schoolHours.map((schoolHour) => {
                    const sheet = dailySheetByHour.get(schoolHour.hour);
                    const storedCourseIds = sheet?.courses.map((entry) => entry.courseId) ?? [];
                    const weeklySlots = slotsByDayHour.get(`${selectedDay}-${schoolHour.hour}`) ?? [];
                    const defaultCourseIds = storedCourseIds.length > 0 ? storedCourseIds : weeklySlots.map((slot) => slot.courseId);
                    const firstCourseId = defaultCourseIds[0] ?? "";
                    const secondCourseId = defaultCourseIds[1] ?? "";
                    const firstTeacherId = sheet?.courses[0]?.teacherId ?? "";
                    const secondTeacherId = sheet?.courses[1]?.teacherId ?? "";

                    return (
                      <div className="daily-schedule-row" key={`${selectedClass.id}-${selectedDate}-${schoolHour.hour}`}>
                        <div className="schedule-hour">
                          <strong>{hourLabel(schoolHour.hour)}</strong>
                          <span>
                            {schoolHour.starts}-{schoolHour.ends}
                          </span>
                        </div>
                        <label>
                          Μάθημα 1
                          <select
                            defaultValue={firstCourseId}
                            key={`${selectedClass.id}-${selectedDate}-${schoolHour.hour}-course-0`}
                            name={`hour-${schoolHour.hour}-course-0`}
                          >
                            <option value="">ΚΕΝΟ / χωρίς μάθημα</option>
                            {courseOptions.map((course) => (
                              <option key={course.id} value={course.id}>
                                {courseOptionLabel(course)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Εκπαιδευτικός 1
                          <select
                            defaultValue={firstTeacherId}
                            key={`${selectedClass.id}-${selectedDate}-${schoolHour.hour}-teacher-0`}
                            name={`hour-${schoolHour.hour}-teacher-0`}
                          >
                            <option value="">Μόνο για αναπλήρωση</option>
                            {teachers.map((teacher) => (
                              <option key={teacher.id} value={teacher.id}>
                                {teacher.surname} {teacher.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Μάθημα 2
                          <select
                            defaultValue={secondCourseId}
                            key={`${selectedClass.id}-${selectedDate}-${schoolHour.hour}-course-1`}
                            name={`hour-${schoolHour.hour}-course-1`}
                          >
                            <option value="">Χωρίς δεύτερο μάθημα</option>
                            {courseOptions.map((course) => (
                              <option key={course.id} value={course.id}>
                                {courseOptionLabel(course)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Εκπαιδευτικός 2
                          <select
                            defaultValue={secondTeacherId}
                            key={`${selectedClass.id}-${selectedDate}-${schoolHour.hour}-teacher-1`}
                            name={`hour-${schoolHour.hour}-teacher-1`}
                          >
                            <option value="">Μόνο για αναπλήρωση</option>
                            {teachers.map((teacher) => (
                              <option key={teacher.id} value={teacher.id}>
                                {teacher.surname} {teacher.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    );
                  })}
                  <div className="teacher-actions">
                    <button className="primary-button" type="submit">
                      Αποθήκευση ημερήσιου προγράμματος
                    </button>
                  </div>
                </form>
              ) : (
                <div className="empty-state">Επιλέξτε εργάσιμη ημερομηνία από σήμερα και μετά.</div>
              )}
            </section>
          ) : (
            <section className="admin-section">
              <div className="admin-section-title">
                <h2>
                  Πρόγραμμα {selectedClass.name} ({selectedClass.schoolYear.name})
                </h2>
                <p>Τα κενά εμφανίζονται ως μη ορισμένες ώρες μέχρι να συμπληρωθούν από τη διαχείριση.</p>
              </div>

              <div className="schedule-grid">
                <div className="schedule-head">Ώρα</div>
                {weekDays.map((day) => (
                  <div className="schedule-head" key={day.value}>
                    {day.label}
                  </div>
                ))}

                {schoolHours.map((schoolHour) => (
                  <div className="schedule-row" key={schoolHour.hour}>
                    <div className="schedule-hour">
                      <strong>{hourLabel(schoolHour.hour)}</strong>
                      <span>
                        {schoolHour.starts}-{schoolHour.ends}
                      </span>
                    </div>
                    {weekDays.map((day) => {
                      const slots = slotsByDayHour.get(`${day.value}-${schoolHour.hour}`) ?? [];
                      const isCurrent = activeDay === day.value && activeHour === schoolHour.hour;

                      return (
                        <div className={isCurrent ? "schedule-cell current" : "schedule-cell"} key={`${day.value}-${schoolHour.hour}`}>
                          {slots.length > 0 ? (
                            slots.map((slot) => {
                              const teachers = teacherLabel(slot.course);

                              return (
                                <div className="schedule-cell-course" key={slot.id}>
                                  <strong>{slot.course.name}</strong>
                                  <span>{teachers || "Χωρίς εκπαιδευτικό"}</span>
                                </div>
                              );
                            })
                          ) : (
                            <span>Δεν έχει οριστεί</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      ) : (
        <section className="admin-section">
          <div className="empty-state">Δεν υπάρχουν διαθέσιμα τμήματα για τον συνδεδεμένο χρήστη.</div>
        </section>
      )}
    </AppNavigation>
  );
}
