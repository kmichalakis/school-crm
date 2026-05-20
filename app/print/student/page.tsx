import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AbsenceStatus } from "@prisma/client";
import { PrintButton } from "@/app/print/print-button";
import { prisma } from "@/lib/prisma";
import { absenceStatusLabel, hourLabel, weekDayLabel } from "@/lib/report-helpers";
import { parseSessionToken, sessionCookieName } from "@/lib/session";

type PrintStudentPageProps = {
  searchParams: Promise<{
    studentId?: string;
  }>;
};

function todayLabel() {
  return new Intl.DateTimeFormat("el-GR", {
    dateStyle: "long"
  }).format(new Date());
}

export default async function PrintStudentPage({ searchParams }: PrintStudentPageProps) {
  const cookieStore = await cookies();
  const session = parseSessionToken(cookieStore.get(sessionCookieName)?.value);

  if (!session || (session.role !== "ADMIN" && session.role !== "TEACHER")) {
    redirect("/");
  }

  if (session.mustChangePassword) {
    redirect("/account/password");
  }

  const params = await searchParams;
  if (!params.studentId) {
    redirect("/print");
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

  const student = await prisma.student.findUnique({
    where: { id: params.studentId },
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
        orderBy: [{ sheet: { day: "asc" } }, { sheet: { hour: "asc" } }]
      }
    }
  });

  if (!student) {
    redirect("/print");
  }

  if (allowedClassIds && !allowedClassIds.includes(student.classId)) {
    redirect("/");
  }

  const markedCount = student.sheetAbsences.filter((absence) => absence.status === AbsenceStatus.MARKED).length;
  const excusedCount = student.sheetAbsences.filter((absence) => absence.status === AbsenceStatus.EXCUSED).length;

  return (
    <main className="print-shell">
      <header className="print-toolbar no-print">
        <Link className="secondary-button" href="/print">
          Εκτυπώσεις
        </Link>
        <PrintButton />
      </header>

      <article className="print-document">
        <header className="print-document-header">
          <div>
            <span>ΣΧΟΛΙΚΗ ΜΟΝΑΔΑ</span>
            <h1>Ατομική κατάσταση απουσιών</h1>
          </div>
          <div>
            <strong>{todayLabel()}</strong>
            <span>Έκδοση από Σχολικό CRM</span>
          </div>
        </header>

        <section className="print-meta-grid">
          <div>
            <span>Μαθητής/Μαθήτρια</span>
            <strong>
              {student.surname} {student.name}
            </strong>
          </div>
          <div>
            <span>Τμήμα</span>
            <strong>{student.class.name}</strong>
          </div>
          <div>
            <span>ΑΜ</span>
            <strong>{student.am}</strong>
          </div>
          <div>
            <span>Πατρώνυμο</span>
            <strong>{student.patronymic}</strong>
          </div>
          <div>
            <span>Σχολικό έτος</span>
            <strong>{student.class.schoolYear.name}</strong>
          </div>
          <div>
            <span>Γονέας/Κηδεμόνας</span>
            <strong>{student.parent ? `${student.parent.surname} ${student.parent.name}` : "Δεν έχει συνδεθεί"}</strong>
          </div>
        </section>

        <section className="summary-grid print-summary">
          <div className="panel metric">
            <span>Σύνολο</span>
            <strong>{student.sheetAbsences.length}</strong>
          </div>
          <div className="panel metric">
            <span>Αδικαιολόγητες</span>
            <strong>{markedCount}</strong>
          </div>
          <div className="panel metric">
            <span>Δικαιολογημένες</span>
            <strong>{excusedCount}</strong>
          </div>
          <div className="panel metric">
            <span>Email γονέα</span>
            <strong>{student.parent?.email ?? "-"}</strong>
          </div>
        </section>

        <section className="print-section">
          <h2>Αναλυτικές απουσίες</h2>
          <table className="print-table">
            <thead>
              <tr>
                <th>Ημέρα</th>
                <th>Ώρα</th>
                <th>Μάθημα</th>
                <th>Κατάσταση</th>
                <th>Παρατήρηση</th>
              </tr>
            </thead>
            <tbody>
              {student.sheetAbsences.map((absence) => (
                <tr key={`${absence.sheetId}-${absence.studentId}`}>
                  <td>{weekDayLabel(absence.sheet.day)}</td>
                  <td>{hourLabel(absence.sheet.hour)}</td>
                  <td>{absence.sheet.course.name}</td>
                  <td>{absenceStatusLabel(absence.status)}</td>
                  <td>{absence.excusedReason ?? ""}</td>
                </tr>
              ))}
              {student.sheetAbsences.length === 0 ? (
                <tr>
                  <td colSpan={5}>Δεν υπάρχουν καταχωρισμένες απουσίες.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>

        <section className="print-signatures">
          <div>
            <span>Ο/Η υπεύθυνος/η τμήματος</span>
          </div>
          <div>
            <span>Η διεύθυνση</span>
          </div>
        </section>
      </article>
    </main>
  );
}
