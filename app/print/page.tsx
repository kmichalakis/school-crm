import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppNavigation } from "@/app/app-navigation";
import { PrintAttendanceForm } from "@/app/print/print-attendance-form";
import { PrintClassPicker } from "@/app/print/print-class-picker";
import { clampToSchoolYear, dateInputValue } from "@/lib/school-calendar";
import { prisma } from "@/lib/prisma";
import { formatDateInput } from "@/lib/school-time";
import { parseSessionToken, sessionCookieName } from "@/lib/session";

type PrintCenterPageProps = {
  searchParams: Promise<{
    classId?: string;
  }>;
};

export default async function PrintCenterPage({ searchParams }: PrintCenterPageProps) {
  const cookieStore = await cookies();
  const session = parseSessionToken(cookieStore.get(sessionCookieName)?.value);
  const params = await searchParams;

  if (!session || (session.role !== "ADMIN" && session.role !== "TEACHER")) {
    redirect("/");
  }

  if (session.mustChangePassword) {
    redirect("/account/password");
  }

  const teacher =
    session.role === "TEACHER"
      ? await prisma.teacher.findUnique({
          where: { userId: session.userId },
          include: {
            responsibleClasses: true
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
      : teacher?.responsibleClasses.map((classRecord) => classRecord.id) ?? [];

  const classes = await prisma.class.findMany({
    where: allowedClassIds ? { id: { in: allowedClassIds } } : undefined,
    include: {
      schoolYear: {
        include: {
          calendarDays: true
        }
      }
    },
    orderBy: [{ schoolYear: { startsOn: "desc" } }, { name: "asc" }]
  });
  const selectedClass = classes.find((classRecord) => classRecord.id === params.classId) ?? classes[0] ?? null;
  const students = selectedClass
    ? await prisma.student.findMany({
        where: { classId: selectedClass.id },
        include: {
          class: {
            include: { schoolYear: true }
          }
        },
        orderBy: [{ surname: "asc" }, { name: "asc" }]
      })
    : [];
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
  const defaultDate = clampToSchoolYear(formatDateInput(new Date()), schoolYearBounds);

  return (
    <AppNavigation
      active="print"
      role={session.role}
      title="Εκτυπώσεις"
      subtitle="Επίσημα έγγραφα και εκτυπώσιμες καταστάσεις"
      userLabel={userLabel}
    >
      {selectedClass ? (
        <section className="admin-section">
          <div className="admin-section-title">
            <h2>Τμήμα</h2>
            <p>Το επιλεγμένο τμήμα χρησιμοποιείται για το ημερήσιο απουσιολόγιο και τη λίστα μαθητών.</p>
          </div>
          <PrintClassPicker
            selectedClassId={selectedClass.id}
            classes={classes.map((classRecord) => ({
              id: classRecord.id,
              label: `${classRecord.name} · ${classRecord.schoolYear.name}`
            }))}
          />
        </section>
      ) : null}

      <section className="admin-section">
        <div className="admin-section-title">
          <h2>Ημερήσιο απουσιολόγιο τμήματος</h2>
          <p>Εκτύπωση παρουσιολογίου/απουσιολογίου ανά τμήμα και ημερομηνία.</p>
        </div>
        {selectedClass ? (
          <PrintAttendanceForm
            calendarExceptions={calendarExceptions}
            classId={selectedClass.id}
            defaultDate={defaultDate}
            schoolYearBounds={schoolYearBounds}
          />
        ) : (
          <div className="empty-state">Δεν υπάρχουν διαθέσιμα τμήματα για εκτύπωση.</div>
        )}
      </section>

      <section className="admin-section">
        <div className="admin-section-title">
          <h2>Ατομική κατάσταση μαθητή</h2>
          <p>
            Επίσημη κατάσταση απουσιών για μαθητές του τμήματος {selectedClass?.name ?? "-"}.
          </p>
        </div>
        <div className="print-link-grid">
          {students.map((student) => (
            <Link className="print-link-card" href={`/print/student?studentId=${student.id}`} key={student.id}>
              <strong>
                {student.surname} {student.name}
              </strong>
              <span>
                {student.class.name} · {student.class.schoolYear.name}
              </span>
            </Link>
          ))}
        </div>
      </section>
    </AppNavigation>
  );
}
