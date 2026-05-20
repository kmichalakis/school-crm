import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AbsenceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { absenceStatusLabel, hourLabel, weekDayLabel } from "@/lib/report-helpers";
import { parseSessionToken, sessionCookieName } from "@/lib/session";

export default async function StudentsPage() {
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

  const students = await prisma.student.findMany({
    where: allowedClassIds ? { classId: { in: allowedClassIds } } : undefined,
    include: {
      parent: true,
      class: {
        include: { schoolYear: true }
      },
      sheetAbsences: {
        where: {
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
        orderBy: [{ updatedAt: "desc" }]
      },
      notifications: true
    },
    orderBy: [{ class: { schoolYear: { startsOn: "desc" } } }, { class: { name: "asc" } }, { surname: "asc" }, { name: "asc" }]
  });

  const totalAbsences = students.reduce((sum, student) => sum + student.sheetAbsences.length, 0);
  const totalUnexcused = students.reduce(
    (sum, student) => sum + student.sheetAbsences.filter((absence) => absence.status === AbsenceStatus.MARKED).length,
    0
  );
  const studentsWithParent = students.filter((student) => student.parent).length;

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <div className="brand">
          <div className="brand-mark">ΣΧ</div>
          <div>
            <h1>Μαθητές</h1>
            <span>Μαθητολόγιο, στοιχεία γονέα και εικόνα απουσιών</span>
          </div>
        </div>
        <div className="status-row">
          <Link className="secondary-button" href="/">
            Απουσιολόγιο
          </Link>
          <Link className="secondary-button" href="/schedule">
            Πρόγραμμα
          </Link>
          <Link className="secondary-button" href="/reports">
            Αναφορές
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

      <div className="summary-grid">
        <div className="panel metric">
          <span>Μαθητές</span>
          <strong>{students.length}</strong>
        </div>
        <div className="panel metric">
          <span>Με γονέα</span>
          <strong>{studentsWithParent}</strong>
        </div>
        <div className="panel metric">
          <span>Σύνολο απουσιών</span>
          <strong>{totalAbsences}</strong>
        </div>
        <div className="panel metric">
          <span>Αδικαιολόγητες</span>
          <strong>{totalUnexcused}</strong>
        </div>
      </div>

      <section className="admin-section">
        <div className="admin-section-title">
          <h2>Κατάλογος μαθητών</h2>
          <p>Η λίστα περιορίζεται αυτόματα στα τμήματα του εκπαιδευτικού ή σε όλα τα τμήματα για admin.</p>
        </div>

        <div className="report-table">
          <div className="student-directory-row report-head">
            <span>Μαθητής</span>
            <span>Τμήμα</span>
            <span>Γονέας</span>
            <span>Απουσίες</span>
            <span>Ειδοποιήσεις</span>
          </div>
          {students.map((student) => {
            const unexcused = student.sheetAbsences.filter((absence) => absence.status === AbsenceStatus.MARKED).length;
            const excused = student.sheetAbsences.filter((absence) => absence.status === AbsenceStatus.EXCUSED).length;
            const latestAbsence = student.sheetAbsences[0];

            return (
              <article className="student-directory-row" key={student.id}>
                <div>
                  <strong>
                    {student.surname} {student.name}
                  </strong>
                  <span>
                    ΑΜ {student.am} · Πατρώνυμο {student.patronymic} · {student.class.schoolYear.name}
                  </span>
                </div>
                <span>{student.class.name}</span>
                <span>
                  {student.parent ? `${student.parent.surname} ${student.parent.name}` : "Δεν έχει συνδεθεί"}
                  {student.parent?.email ? ` · ${student.parent.email}` : ""}
                </span>
                <div>
                  <strong>{student.sheetAbsences.length}</strong>
                  <span>
                    {unexcused} αδικαιολόγητες · {excused} δικαιολογημένες
                  </span>
                </div>
                <span>{student.notifications.length}</span>
                {latestAbsence ? (
                  <div className="student-directory-detail">
                    Τελευταία απουσία: {weekDayLabel(latestAbsence.sheet.day)}, {hourLabel(latestAbsence.sheet.hour)}, {latestAbsence.sheet.course.name} ·{" "}
                    {absenceStatusLabel(latestAbsence.status)}
                  </div>
                ) : (
                  <div className="student-directory-detail">Δεν υπάρχουν απουσίες.</div>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
