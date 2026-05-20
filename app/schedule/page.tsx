import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { WeekDay } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hourLabel } from "@/lib/report-helpers";
import { schoolHours, weekDays } from "@/lib/school-time";
import { parseSessionToken, sessionCookieName } from "@/lib/session";

type SchedulePageProps = {
  searchParams: Promise<{
    classId?: string;
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
  const scheduleSlots = selectedClass
    ? await prisma.scheduleSlot.findMany({
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
      })
    : [];

  const slotsByDayHour = new Map<string, typeof scheduleSlots>();
  for (const slot of scheduleSlots) {
    const key = `${slot.day}-${slot.hour}`;
    slotsByDayHour.set(key, [...(slotsByDayHour.get(key) ?? []), slot]);
  }
  const today = new Date();
  const activeDay = dayFromDate(today);
  const activeHour = currentHour(today);

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <div className="brand">
          <div className="brand-mark">ΣΧ</div>
          <div>
            <h1>Πρόγραμμα</h1>
            <span>Εβδομαδιαία εικόνα μαθημάτων ανά τμήμα</span>
          </div>
        </div>
        <div className="status-row">
          <Link className="secondary-button" href="/">
            Απουσιολόγιο
          </Link>
          <Link className="secondary-button" href="/students">
            Μαθητές
          </Link>
          <Link className="secondary-button" href="/teacher">
            Σήμερα
          </Link>
          <Link className="secondary-button" href="/dashboard">
            Dashboard
          </Link>
          <Link className="secondary-button" href="/print">
            Εκτυπώσεις
          </Link>
          {session.role === "ADMIN" ? (
            <Link className="secondary-button" href="/admin">
              Διαχείριση
            </Link>
          ) : null}
        </div>
      </header>

      <section className="admin-section">
        <div className="admin-section-title">
          <h2>Τμήμα</h2>
          <p>Επιλογή τμήματος για προβολή του προγράμματος της εβδομάδας.</p>
        </div>

        <div className="class-tabs">
          {classes.map((classRecord) => (
            <Link
              className={selectedClass?.id === classRecord.id ? "class-tab active" : "class-tab"}
              href={`/schedule?classId=${classRecord.id}`}
              key={classRecord.id}
            >
              {classRecord.name}
              <span>{classRecord.schoolYear.name}</span>
            </Link>
          ))}
        </div>
      </section>

      {selectedClass ? (
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
                          const teachers = slot.course.teachers.map((link) => `${link.teacher.surname} ${link.teacher.name}`).join(", ");

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
      ) : (
        <section className="admin-section">
          <div className="empty-state">Δεν υπάρχουν διαθέσιμα τμήματα για τον συνδεδεμένο χρήστη.</div>
        </section>
      )}
    </main>
  );
}
