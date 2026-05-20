import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { weekDays } from "@/lib/school-time";
import { parseSessionToken, sessionCookieName } from "@/lib/session";

export default async function PrintCenterPage() {
  const cookieStore = await cookies();
  const session = parseSessionToken(cookieStore.get(sessionCookieName)?.value);

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
            courses: {
              include: { course: true }
            }
          }
        })
      : null;

  const allowedClassIds =
    session.role === "ADMIN"
      ? undefined
      : Array.from(
          new Set([
            ...(teacher?.homeClassId ? [teacher.homeClassId] : []),
            ...(teacher?.courses.map((courseLink) => courseLink.course.classId) ?? [])
          ])
        );

  const [classes, students] = await Promise.all([
    prisma.class.findMany({
      where: allowedClassIds ? { id: { in: allowedClassIds } } : undefined,
      include: { schoolYear: true },
      orderBy: [{ schoolYear: { startsOn: "desc" } }, { name: "asc" }]
    }),
    prisma.student.findMany({
      where: allowedClassIds ? { classId: { in: allowedClassIds } } : undefined,
      include: {
        class: {
          include: { schoolYear: true }
        }
      },
      orderBy: [{ class: { name: "asc" } }, { surname: "asc" }, { name: "asc" }]
    })
  ]);

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <div className="brand">
          <div className="brand-mark">ΣΧ</div>
          <div>
            <h1>Εκτυπώσεις</h1>
            <span>Επίσημα έγγραφα και εκτυπώσιμες καταστάσεις</span>
          </div>
        </div>
        <div className="status-row">
          <Link className="secondary-button" href="/dashboard">
            Dashboard
          </Link>
          <Link className="secondary-button" href="/reports">
            Αναφορές
          </Link>
          <Link className="secondary-button" href="/">
            Απουσιολόγιο
          </Link>
        </div>
      </header>

      <section className="admin-section">
        <div className="admin-section-title">
          <h2>Ημερήσιο απουσιολόγιο τμήματος</h2>
          <p>Εκτύπωση παρουσιολογίου/απουσιολογίου ανά τμήμα και ημέρα.</p>
        </div>
        <div className="print-link-grid">
          {classes.map((classRecord) =>
            weekDays.map((day) => (
              <Link className="print-link-card" href={`/print/attendance?classId=${classRecord.id}&day=${day.value}`} key={`${classRecord.id}-${day.value}`}>
                <strong>
                  {classRecord.name} · {day.label}
                </strong>
                <span>{classRecord.schoolYear.name}</span>
              </Link>
            ))
          )}
        </div>
      </section>

      <section className="admin-section">
        <div className="admin-section-title">
          <h2>Ατομική κατάσταση μαθητή</h2>
          <p>Επίσημη κατάσταση απουσιών ανά μαθητή με στοιχεία τμήματος και γονέα όπου υπάρχουν.</p>
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
    </main>
  );
}
