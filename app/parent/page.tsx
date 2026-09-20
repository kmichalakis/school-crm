import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AbsenceStatus, AppointmentStatus, type WeekDay } from "@prisma/client";
import { ShieldCheck, Users } from "lucide-react";
import { LogoutButton } from "@/app/logout-button";
import { ParentAppointmentBookingForm } from "@/app/parent/parent-appointment-booking-form";
import { ParentAppointmentDatePicker } from "@/app/parent/parent-appointment-date-picker";
import { ParentCancelAppointmentForm } from "@/app/parent/parent-cancel-appointment-form";
import { ParentScheduleDatePicker } from "@/app/parent/parent-schedule-date-picker";
import { SchoolBrand } from "@/app/school-brand";
import { appointmentDate, appointmentDateLabel, appointmentStatusLabel, getAppointmentSetting } from "@/lib/appointments";
import { dateInputValue, isAllowedSchoolDate, type SchoolCalendarException, type SchoolYearDateBounds } from "@/lib/school-calendar";
import { prisma } from "@/lib/prisma";
import { hourLabel, weekDayLabel } from "@/lib/report-helpers";
import { parseSessionToken, sessionCookieName } from "@/lib/session";
import { dateToWeekDay, formatDateInput, schoolHours } from "@/lib/school-time";

type ParentPageProps = {
  searchParams: Promise<{
    date?: string;
    history?: string;
    studentId?: string;
    view?: string;
    notice?: string;
    noticeType?: string;
  }>;
};

type ParentView = "absences" | "schedule" | "appointments";

function parentVisibleView(): ParentView {
  return "appointments";
}

function dateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function shortDateLabel(dateValue: string) {
  return new Intl.DateTimeFormat("el-GR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(new Date(`${dateValue}T12:00:00`));
}

function fullDateLabel(dateValue: string) {
  const day = dateToWeekDay(dateValue);
  const dayLabel = day ? weekDayLabel(day as WeekDay) : "Αργία";
  return `${dayLabel} ${shortDateLabel(dateValue)}`;
}

function nextWorkingDate(bounds: SchoolYearDateBounds | null, exceptions: SchoolCalendarException[]) {
  const start = new Date();
  start.setDate(start.getDate() + 1);

  for (let offset = 0; offset <= 370; offset += 1) {
    const candidate = new Date(start);
    candidate.setDate(start.getDate() + offset);
    const value = formatDateInput(candidate);
    if (bounds && value < bounds.startsOn) {
      continue;
    }
    if (bounds && value > bounds.endsOn) {
      return bounds.endsOn;
    }
    if (isAllowedSchoolDate(value, bounds, exceptions)) {
      return value;
    }
  }

  return bounds?.startsOn ?? formatDateInput(start);
}

function validDateParam(value: string | undefined, fallback: string, bounds: SchoolYearDateBounds | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return fallback;
  }

  if (bounds && (value < bounds.startsOn || value > bounds.endsOn)) {
    return fallback;
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

function absenceGroupStatusLabel(statuses: AbsenceStatus[]) {
  const uniqueStatuses = Array.from(new Set(statuses));
  if (uniqueStatuses.length === 1) {
    if (uniqueStatuses[0] === AbsenceStatus.EXCUSED) {
      return "Δικαιολογημένες";
    }
    return "Καταχωρισμένες";
  }

  return "Μικτή κατάσταση";
}

export default async function ParentPage({ searchParams }: ParentPageProps) {
  const cookieStore = await cookies();
  const session = parseSessionToken(cookieStore.get(sessionCookieName)?.value);

  if (!session || session.role !== "PARENT") {
    redirect("/");
  }

  if (session.mustChangePassword) {
    redirect("/account/password");
  }

  const params = await searchParams;
  const view = parentVisibleView();
  const notice = params.notice ?? "";
  const noticeType = params.noticeType === "error" ? "error" : "success";
  const showAppointmentHistory = params.history === "appointments";
  const parent = await prisma.parent.findUnique({
    where: { userId: session.userId },
    include: {
      students: {
        include: {
          class: {
            include: {
              schoolYear: {
                include: { calendarDays: true }
              }
            }
          }
        },
        orderBy: [{ surname: "asc" }, { name: "asc" }]
      }
    }
  });

  if (!parent) {
    redirect("/");
  }

  const selectedStudent = parent.students.find((student) => student.id === params.studentId) ?? parent.students[0] ?? null;
  const selectedClass = selectedStudent?.class ?? null;
  const schoolYearBounds = selectedClass
    ? {
        startsOn: dateInputValue(selectedClass.schoolYear.startsOn),
        endsOn: dateInputValue(selectedClass.schoolYear.endsOn)
      }
    : null;
  const calendarExceptions =
    selectedClass?.schoolYear.calendarDays.map((calendarDay) => ({
      date: dateInputValue(calendarDay.date),
      isWorkingDay: calendarDay.isWorkingDay
    })) ?? [];
  const defaultScheduleDate = nextWorkingDate(schoolYearBounds, calendarExceptions);
  const selectedDate = validDateParam(params.date, defaultScheduleDate, schoolYearBounds);
  const selectedDay = dateToWeekDay(selectedDate) as WeekDay | null;
  const selectedDateIsWorking = selectedDay ? isAllowedSchoolDate(selectedDate, schoolYearBounds, calendarExceptions) : false;
  const studentIds = parent.students.map((student) => student.id);
  const isAbsencesView = view === "absences";
  const isScheduleView = view === "schedule";
  const isAppointmentsView = view === "appointments";
  const absences =
    isAbsencesView && studentIds.length > 0
      ? await prisma.attendanceSheetAbsence.findMany({
          where: {
            studentId: { in: studentIds },
            absent: true,
            status: { not: AbsenceStatus.REMOVED }
          },
          include: {
            sheet: {
              include: {
                course: true
              }
            }
          },
          orderBy: [{ sheet: { date: "desc" } }, { sheet: { hour: "desc" } }]
        })
      : [];

  const scheduleSlots =
    isScheduleView && selectedClass && selectedDay && selectedDateIsWorking
      ? await prisma.scheduleSlot.findMany({
          where: {
            classId: selectedClass.id,
            day: selectedDay
          },
          include: {
            course: {
              include: {
                teachers: {
                  include: { teacher: true }
                }
              }
            }
          },
          orderBy: [{ hour: "asc" }, { course: { name: "asc" } }]
        })
      : [];
  const dailySheets =
    isScheduleView && selectedClass && selectedDateIsWorking
      ? await prisma.attendanceSheet.findMany({
          where: {
            classId: selectedClass.id,
            date: dateOnly(selectedDate)
          },
          include: {
            courses: {
              include: {
                course: {
                  include: {
                    teachers: {
                      include: { teacher: true }
                    }
                  }
                }
              },
              orderBy: { position: "asc" }
            }
          }
        })
      : [];
  const dailySheetByHour = new Map(dailySheets.map((sheet) => [sheet.hour, sheet]));
  const weeklySlotsByHour = new Map<number, typeof scheduleSlots>();
  for (const slot of scheduleSlots) {
    weeklySlotsByHour.set(slot.hour, [...(weeklySlotsByHour.get(slot.hour) ?? []), slot]);
  }

  const absencesByStudent = new Map(parent.students.map((student) => [student.id, absences.filter((absence) => absence.studentId === student.id)]));
  const absenceGroupsByStudent = new Map(
    parent.students.map((student) => {
      const groups = new Map<string, typeof absences>();
      for (const absence of absencesByStudent.get(student.id) ?? []) {
        const sheetDate = dateInputValue(absence.sheet.date);
        groups.set(sheetDate, [...(groups.get(sheetDate) ?? []), absence]);
      }

      return [
        student.id,
        Array.from(groups, ([date, dayAbsences]) => ({
          date,
          absences: [...dayAbsences].sort((first, second) => first.sheet.hour - second.sheet.hour)
        }))
      ];
    })
  );
  const [appointmentSetting, blockedAppointmentDay, parentAppointments, appointmentOfficeHours, appointmentUnavailableDays, appointmentCounts] =
    isAppointmentsView
      ? await Promise.all([
          getAppointmentSetting(),
          prisma.appointmentBlockedDay.findUnique({
            where: { date: appointmentDate(selectedDate) }
          }),
          prisma.parentTeacherAppointment.findMany({
            where: { parentId: parent.id },
            include: {
              student: {
                include: { class: true }
              },
              teacher: true
            },
            orderBy: [{ date: "desc" }, { hour: "asc" }, { teacher: { surname: "asc" } }]
          }),
          selectedDay && selectedDateIsWorking
            ? prisma.teacherOfficeHour.findMany({
                where: { day: selectedDay },
                include: { teacher: true },
                orderBy: [{ hour: "asc" }, { teacher: { surname: "asc" } }, { teacher: { name: "asc" } }]
              })
            : Promise.resolve([]),
          selectedDay && selectedDateIsWorking
            ? prisma.teacherUnavailableDay.findMany({
                where: { date: appointmentDate(selectedDate) }
              })
            : Promise.resolve([]),
          selectedDay && selectedDateIsWorking
            ? prisma.parentTeacherAppointment.groupBy({
                by: ["teacherId", "hour"],
                where: {
                  date: appointmentDate(selectedDate),
                  status: AppointmentStatus.BOOKED
                },
                _count: { _all: true }
              })
            : Promise.resolve([])
        ])
      : [{ maxPerTeacherSlot: 1 }, null, [], [], [], []];
  const unavailableTeacherIds = new Set(appointmentUnavailableDays.map((day) => day.teacherId));
  const bookedCountBySlot = new Map(appointmentCounts.map((entry) => [`${entry.teacherId}:${entry.hour}`, entry._count._all]));
  const parentActiveAppointmentKeys = new Set(
    parentAppointments
      .filter((appointment) => appointment.status === AppointmentStatus.BOOKED && dateInputValue(appointment.date) === selectedDate)
      .map((appointment) => `${appointment.teacherId}:${appointment.hour}`)
  );
  const parentActiveAppointmentTeacherIds = new Set(
    parentAppointments
      .filter((appointment) => appointment.status === AppointmentStatus.BOOKED && dateInputValue(appointment.date) === selectedDate)
      .map((appointment) => appointment.teacherId)
  );
  const today = dateInputValue(new Date());
  const futureParentAppointments = parentAppointments.filter((appointment) => dateInputValue(appointment.date) >= today);
  const pastParentAppointments = parentAppointments.filter((appointment) => dateInputValue(appointment.date) < today);

  function renderParentAppointment(appointment: (typeof parentAppointments)[number], canCancel: boolean) {
    const dateValue = dateInputValue(appointment.date);
    const isCancelled = appointment.status !== AppointmentStatus.BOOKED;
    return (
      <article className={isCancelled ? "appointment-row cancelled" : "appointment-row"} key={appointment.id}>
        <div>
          <strong>{appointmentDateLabel(dateValue, appointment.day)}</strong>
          <span>
            {hourLabel(appointment.hour)} · {appointment.teacher.surname} {appointment.teacher.name}
          </span>
          <span>
            {appointment.student.surname} {appointment.student.name} · {appointment.student.class.name}
          </span>
          {appointment.cancellationReason ? <span>{appointment.cancellationReason}</span> : null}
        </div>
        <span className={isCancelled ? "sync-pill" : "sync-pill ready"}>{appointmentStatusLabel(appointment.status)}</span>
        {canCancel && !isCancelled ? (
          <ParentCancelAppointmentForm appointmentId={appointment.id} date={selectedDate} studentId={selectedStudent?.id ?? ""} />
        ) : null}
      </article>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <SchoolBrand title="Πύλη γονέα" subtitle={`${parent.surname} ${parent.name}`} />
        <div className="user-chip">
          <ShieldCheck size={17} />
          {session.username}
        </div>
        <LogoutButton />
      </header>

      <div className="workspace">
        <nav className="sidebar" aria-label="Πλοήγηση γονέα">
          <Link
            className={view === "appointments" ? "nav-button active" : "nav-button"}
            href={`/parent?view=appointments${selectedStudent ? `&studentId=${selectedStudent.id}` : ""}&date=${selectedDate}`}
          >
            <Users size={18} />
            Ραντεβού
          </Link>
        </nav>

        <section className="main-grid">
          {notice ? (
            <div className={noticeType === "error" ? "status-message error" : "status-message success"}>
              <span className="status-message-main">
                <strong>{noticeType === "error" ? "Σφάλμα" : "Ενημέρωση"}</strong>
                {notice}
              </span>
            </div>
          ) : null}
          {view === "absences" ? (
            <>
              <section className="admin-section">
                <div className="admin-section-title">
                  <h2>Απουσίες</h2>
                  <p>Συνολική εικόνα ανά μαθητή και αναλυτική λίστα από τη νεότερη προς την παλαιότερη ημερομηνία.</p>
                </div>
                <div className="section-actions">
                  <Link className="secondary-button" href="/parent/absences-report">
                    Αναφορά απουσιών
                  </Link>
                </div>
                <div className="parent-student-grid">
                  {parent.students.map((student) => {
                    const studentAbsences = absencesByStudent.get(student.id) ?? [];
                    const excused = studentAbsences.filter((absence) => absence.status === AbsenceStatus.EXCUSED).length;
                    return (
                      <article className="student-mini-card" key={student.id}>
                        <div>
                          <strong>
                            {student.surname} {student.name}
                          </strong>
                          <span>
                            {student.class.name} · {student.class.schoolYear.name}
                          </span>
                        </div>
                        <div className="student-mini-stats">
                          <span>{studentAbsences.length} σύνολο</span>
                          <span>{studentAbsences.length - excused} καταχωρισμένες</span>
                          <span>{excused} δικαιολογημένες</span>
                        </div>
                        <Link className="secondary-button" href={`/parent/absences-report?studentId=${student.id}`}>
                          Αναφορά μαθητή
                        </Link>
                      </article>
                    );
                  })}
                </div>
              </section>

              {parent.students.map((student) => {
                const studentAbsences = absencesByStudent.get(student.id) ?? [];
                const studentAbsenceGroups = absenceGroupsByStudent.get(student.id) ?? [];
                return (
                  <section className="admin-section" key={student.id}>
                    <div className="admin-section-title">
                      <h2>
                        {student.surname} {student.name}
                      </h2>
                      <p>
                        {student.class.name} · {studentAbsences.length} απουσίες συνολικά
                      </p>
                    </div>
                    <div className="absence-card-list">
                      {studentAbsenceGroups.length > 0 ? (
                        studentAbsenceGroups.map((group) => {
                          const statusLabel = absenceGroupStatusLabel(group.absences.map((absence) => absence.status));
                          return (
                            <article className="absence-card parent-absence-day-card" key={`${student.id}-${group.date}`}>
                              <div className="absence-card-main parent-absence-day-main">
                                <div>
                                  <strong>{fullDateLabel(group.date)}</strong>
                                  <span>{group.absences.length} {group.absences.length === 1 ? "απουσία" : "απουσίες"}</span>
                                </div>
                                <div className="parent-absence-lessons">
                                  {group.absences.map((absence) => (
                                    <span key={`${absence.sheetId}-${absence.studentId}`}>
                                      {hourLabel(absence.sheet.hour)} {absence.sheet.course.name}
                                      {absence.isHourlyExpulsion ? " · Ωριαία αποβολή" : ""}
                                    </span>
                                  ))}
                                </div>
                                <span className={group.absences.every((absence) => absence.status === AbsenceStatus.EXCUSED) ? "sync-pill ready" : "sync-pill"}>
                                  {statusLabel}
                                </span>
                              </div>
                              {group.absences.some((absence) => absence.excusedReason) ? (
                                <div className="absence-reason parent-absence-reasons">
                                  {group.absences
                                    .filter((absence) => absence.excusedReason)
                                    .map((absence) => (
                                      <p key={`${absence.sheetId}-${absence.studentId}-reason`}>
                                        {hourLabel(absence.sheet.hour)}: {absence.excusedReason}
                                      </p>
                                    ))}
                                </div>
                              ) : null}
                            </article>
                          );
                        })
                      ) : (
                        <div className="empty-state">Δεν υπάρχουν καταχωρισμένες απουσίες για αυτόν/αυτήν τον/τη μαθητή/μαθήτρια.</div>
                      )}
                    </div>
                  </section>
                );
              })}
            </>
          ) : view === "schedule" ? (
            <section className="admin-section">
              <div className="admin-section-title">
                <h2>Πρόγραμμα</h2>
                <p>Επιλέξτε μαθητή και ημερομηνία για να δείτε το πρόγραμμα του αντίστοιχου τμήματος.</p>
              </div>

              <div className="parent-schedule-controls">
                <div className="class-tabs">
                  {parent.students.map((student) => (
                    <Link
                      className={selectedStudent?.id === student.id ? "class-tab active" : "class-tab"}
                      href={`/parent?view=schedule&studentId=${student.id}&date=${selectedDate}`}
                      key={student.id}
                    >
                      {student.surname} {student.name}
                      <span>{student.class.name}</span>
                    </Link>
                  ))}
                </div>
                {selectedClass && schoolYearBounds ? (
                  <ParentScheduleDatePicker
                    date={selectedDate}
                    maxDate={schoolYearBounds.endsOn}
                    minDate={schoolYearBounds.startsOn}
                    studentId={selectedStudent?.id ?? ""}
                  />
                ) : null}
              </div>

              {selectedClass ? (
                <div className="parent-schedule-heading">
                  <strong>
                    {selectedClass.name} · {fullDateLabel(selectedDate)}
                  </strong>
                  <span>{selectedDateIsWorking ? "Εργάσιμη ημέρα" : "Αργία"}</span>
                </div>
              ) : null}

              {!selectedClass ? (
                <div className="empty-state">Δεν υπάρχουν συνδεδεμένοι μαθητές.</div>
              ) : !selectedDateIsWorking ? (
                <div className="empty-state">Αργία. Δεν υπάρχουν μαθήματα για την επιλεγμένη ημερομηνία.</div>
              ) : (
                <div className="parent-schedule-list">
                  {schoolHours.map((schoolHour) => {
                    const dailySheet = dailySheetByHour.get(schoolHour.hour);
                    const dailyCourses = dailySheet?.courses.map((entry) => entry.course) ?? [];
                    const weeklySlots = weeklySlotsByHour.get(schoolHour.hour) ?? [];
                    const courses = dailyCourses.length > 0 ? dailyCourses : weeklySlots.map((slot) => slot.course);
                    const visibleCourses = courses.filter((course) => !course.isNoCourse);
                    return (
                      <article className="parent-schedule-row" key={schoolHour.hour}>
                        <div className="schedule-hour">
                          <strong>{hourLabel(schoolHour.hour)}</strong>
                          <span>
                            {schoolHour.starts}-{schoolHour.ends}
                          </span>
                        </div>
                        <div className="schedule-cell-course-list">
                          {visibleCourses.length > 0 ? (
                            visibleCourses.map((course) => (
                              <div className="schedule-cell-course" key={course.id}>
                                <strong>{course.name}</strong>
                                <span>{teacherLabel(course) || "Χωρίς εκπαιδευτικό"}</span>
                              </div>
                            ))
                          ) : (
                            <span>ΚΕΝΟ</span>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          ) : (
            <>
              <section className="admin-section">
                <div className="admin-section-title">
                  <h2>Κλείσιμο ραντεβού</h2>
                  <p>Επιλέξτε μαθητή, ημερομηνία και έναν ή περισσότερους διαθέσιμους εκπαιδευτικούς.</p>
                </div>

                <div className="parent-schedule-controls">
                  <div className="class-tabs">
                    {parent.students.map((student) => (
                      <Link
                        className={selectedStudent?.id === student.id ? "class-tab active" : "class-tab"}
                        href={`/parent?view=appointments&studentId=${student.id}&date=${selectedDate}`}
                        key={student.id}
                      >
                        {student.surname} {student.name}
                        <span>{student.class.name}</span>
                      </Link>
                    ))}
                  </div>
                  {selectedClass && schoolYearBounds ? (
                    <ParentAppointmentDatePicker
                      date={selectedDate}
                      maxDate={schoolYearBounds.endsOn}
                      minDate={schoolYearBounds.startsOn}
                      studentId={selectedStudent?.id ?? ""}
                    />
                  ) : null}
                </div>

                <div className="parent-schedule-heading">
                  <strong>{appointmentDateLabel(selectedDate, selectedDay)}</strong>
                  <span>
                    {!selectedDateIsWorking
                      ? "Αργία"
                      : blockedAppointmentDay
                        ? `Ακυρωμένη ημέρα${blockedAppointmentDay.reason ? ` · ${blockedAppointmentDay.reason}` : ""}`
                        : "Διαθέσιμη ημερομηνία"}
                  </span>
                </div>

                {!selectedStudent ? (
                  <div className="empty-state">Δεν υπάρχουν συνδεδεμένοι μαθητές.</div>
                ) : !selectedDateIsWorking ? (
                  <div className="empty-state">Η επιλεγμένη ημερομηνία είναι αργία ή εκτός σχολικού έτους.</div>
                ) : blockedAppointmentDay ? (
                  <div className="empty-state">Η ημέρα ραντεβού έχει ακυρωθεί από το σχολείο.</div>
                ) : appointmentOfficeHours.length === 0 ? (
                  <div className="empty-state">Δεν υπάρχουν διαθέσιμοι εκπαιδευτικοί για αυτή την ημέρα.</div>
                ) : (
                  <ParentAppointmentBookingForm
                    date={selectedDate}
                    studentId={selectedStudent.id}
                    slots={appointmentOfficeHours.map((officeHour) => {
                        const key = `${officeHour.teacherId}:${officeHour.hour}`;
                        const bookedCount = bookedCountBySlot.get(key) ?? 0;
                        const unavailable = unavailableTeacherIds.has(officeHour.teacherId);
                        const full = bookedCount >= appointmentSetting.maxPerTeacherSlot;
                        const alreadyBooked = parentActiveAppointmentTeacherIds.has(officeHour.teacherId) || parentActiveAppointmentKeys.has(key);
                        return {
                          key,
                          teacherId: officeHour.teacherId,
                          teacherName: `${officeHour.teacher.surname} ${officeHour.teacher.name}`,
                          hourLabel: hourLabel(officeHour.hour),
                          disabledReason: unavailable
                            ? "Μη διαθέσιμος/η"
                            : full
                              ? "Πλήρης ώρα"
                              : alreadyBooked
                                ? "Έχετε ήδη ραντεβού με αυτόν/ήν τον/την εκπαιδευτικό."
                                : null
                        };
                      })}
                  />
                )}
              </section>

              <section className="admin-section">
                <div className="admin-section-title">
                  <h2>Τα ραντεβού μου</h2>
                  <p>Εμφανίζονται τα σημερινά και μελλοντικά ραντεβού. Το ιστορικό ανοίγει ξεχωριστά.</p>
                </div>
                <div className="appointment-list">
                  {futureParentAppointments.length > 0 ? (
                    futureParentAppointments.map((appointment) => renderParentAppointment(appointment, true))
                  ) : (
                    <div className="empty-state">Δεν έχετε σημερινά ή μελλοντικά ραντεβού.</div>
                  )}
                </div>
                <div className="section-actions">
                  <Link
                    className="secondary-button"
                    href={
                      showAppointmentHistory
                        ? `/parent?view=appointments${selectedStudent ? `&studentId=${selectedStudent.id}` : ""}&date=${selectedDate}`
                        : `/parent?view=appointments${selectedStudent ? `&studentId=${selectedStudent.id}` : ""}&date=${selectedDate}&history=appointments`
                    }
                  >
                    {showAppointmentHistory ? "Απόκρυψη ιστορικού" : "Ιστορικό"}
                  </Link>
                </div>
                {showAppointmentHistory ? (
                  <div className="appointment-list">
                    {pastParentAppointments.length > 0 ? (
                      pastParentAppointments.map((appointment) => renderParentAppointment(appointment, false))
                    ) : (
                      <div className="empty-state">Δεν υπάρχει παλιό ιστορικό ραντεβού.</div>
                    )}
                  </div>
                ) : null}
              </section>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
