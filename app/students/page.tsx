import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AbsenceStatus } from "@prisma/client";
import { AppNavigation } from "@/app/app-navigation";
import { prisma } from "@/lib/prisma";
import { absenceStatusLabel, hourLabel, weekDayLabel } from "@/lib/report-helpers";
import { parseSessionToken, sessionCookieName } from "@/lib/session";

type StudentsPageProps = {
  searchParams: Promise<{
    classId?: string;
  }>;
};

export default async function StudentsPage({ searchParams }: StudentsPageProps) {
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
            responsibleClasses: {
              include: { schoolYear: true },
              orderBy: [{ schoolYear: { startsOn: "desc" } }, { name: "asc" }]
            }
          }
        })
      : null;
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { teacher: true }
  });
  const userLabel = user?.teacher ? `${user.teacher.name} ${user.teacher.surname}` : user?.username ?? "Χρήστης";

  const classChoices =
    session.role === "ADMIN"
      ? await prisma.class.findMany({
          include: { schoolYear: true },
          orderBy: [{ schoolYear: { startsOn: "desc" } }, { name: "asc" }]
        })
      : teacher?.responsibleClasses ?? [];
  const selectedClass =
    session.role === "TEACHER" && classChoices.length === 1 && !params.classId
      ? classChoices[0]
      : classChoices.find((classRecord) => classRecord.id === params.classId) ?? null;
  const shouldShowClassPicker = session.role === "ADMIN" || classChoices.length > 1;

  const students = selectedClass
    ? await prisma.student.findMany({
        where: { classId: selectedClass.id },
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
        orderBy: [{ surname: "asc" }, { name: "asc" }]
      })
    : [];

  const totalAbsences = students.reduce((sum, student) => sum + student.sheetAbsences.length, 0);
  const totalUnexcused = students.reduce(
    (sum, student) => sum + student.sheetAbsences.filter((absence) => absence.status === AbsenceStatus.MARKED).length,
    0
  );
  const studentsWithParent = students.filter((student) => student.parent).length;

  return (
    <AppNavigation
      active="students"
      role={session.role}
      title="Μαθητές"
      subtitle="Μαθητολόγιο, στοιχεία γονέα και εικόνα απουσιών"
      userLabel={userLabel}
    >
      {shouldShowClassPicker ? (
        <section className="admin-section">
          <div className="admin-section-title">
            <h2>Τμήμα</h2>
            <p>
              {session.role === "ADMIN"
                ? "Επιλέξτε τμήμα για προβολή μαθητών."
                : "Εμφανίζονται μόνο τμήματα στα οποία είστε υπεύθυνος/η."}
            </p>
          </div>
          <div className="class-tabs">
            {classChoices.map((classRecord) => (
              <Link
                className={selectedClass?.id === classRecord.id ? "class-tab active" : "class-tab"}
                href={`/students?classId=${classRecord.id}`}
                key={classRecord.id}
              >
                {classRecord.name}
                <span>{classRecord.schoolYear.name}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {classChoices.length === 0 ? <div className="empty-state">Δεν είστε υπεύθυνος/η σε κάποιο τμήμα.</div> : null}

      {classChoices.length > 0 && !selectedClass ? (
        <div className="empty-state">Επιλέξτε τμήμα για να εμφανιστούν οι μαθητές.</div>
      ) : null}

      {selectedClass ? (
      <>
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
          <p>Η λίστα αφορά μόνο το τμήμα {selectedClass.name}.</p>
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
                    {latestAbsence.isHourlyExpulsion ? " · Ωριαία αποβολή" : ""}
                  </div>
                ) : (
                  <div className="student-directory-detail">Δεν υπάρχουν απουσίες.</div>
                )}
              </article>
            );
          })}
        </div>
      </section>
      </>
      ) : null}
    </AppNavigation>
  );
}
