import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AbsenceStatus, type WeekDay } from "@prisma/client";
import { PrintButton } from "@/app/print/print-button";
import { appTitle, schoolName } from "@/app/school-brand";
import { dateInputValue } from "@/lib/school-calendar";
import { prisma } from "@/lib/prisma";
import { absenceStatusLabel, hourLabel, weekDayLabel } from "@/lib/report-helpers";
import { parseSessionToken, sessionCookieName } from "@/lib/session";

type ParentAbsencesReportPageProps = {
  searchParams: Promise<{
    studentId?: string;
  }>;
};

function todayLabel() {
  return new Intl.DateTimeFormat("el-GR", {
    dateStyle: "long"
  }).format(new Date());
}

function shortDateLabel(dateValue: string) {
  return new Intl.DateTimeFormat("el-GR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(new Date(`${dateValue}T12:00:00`));
}

function fullDateLabel(dateValue: string, day: WeekDay) {
  return `${weekDayLabel(day)} ${shortDateLabel(dateValue)}`;
}

export default async function ParentAbsencesReportPage({ searchParams }: ParentAbsencesReportPageProps) {
  const cookieStore = await cookies();
  const session = parseSessionToken(cookieStore.get(sessionCookieName)?.value);

  if (!session || session.role !== "PARENT") {
    redirect("/");
  }

  if (session.mustChangePassword) {
    redirect("/account/password");
  }

  const params = await searchParams;
  const parent = await prisma.parent.findUnique({
    where: { userId: session.userId },
    include: {
      students: {
        include: {
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
            orderBy: [{ sheet: { date: "desc" } }, { sheet: { hour: "asc" } }]
          }
        },
        orderBy: [{ surname: "asc" }, { name: "asc" }]
      }
    }
  });

  if (!parent) {
    redirect("/");
  }

  const reportStudents = params.studentId ? parent.students.filter((student) => student.id === params.studentId) : parent.students;

  if (params.studentId && reportStudents.length === 0) {
    redirect("/parent?view=absences");
  }

  return (
    <main className="print-shell">
      <header className="print-toolbar no-print">
        <Link className="secondary-button" href="/parent?view=absences">
          Απουσίες
        </Link>
        <PrintButton />
      </header>

      <article className="print-document">
        <header className="print-document-header">
          <div>
            <span>{schoolName}</span>
            <h1>Αναφορά απουσιών γονέα</h1>
          </div>
          <div>
            <strong>{todayLabel()}</strong>
            <span>Έκδοση από {appTitle}</span>
          </div>
        </header>

        <section className="print-meta-grid">
          <div>
            <span>Γονέας/Κηδεμόνας</span>
            <strong>
              {parent.surname} {parent.name}
            </strong>
          </div>
          <div>
            <span>Email</span>
            <strong>{parent.email}</strong>
          </div>
          <div>
            <span>Μαθητές αναφοράς</span>
            <strong>{reportStudents.length}</strong>
          </div>
          <div>
            <span>Σύνολο απουσιών</span>
            <strong>{reportStudents.reduce((total, student) => total + student.sheetAbsences.length, 0)}</strong>
          </div>
        </section>

        {reportStudents.map((student) => {
          const markedCount = student.sheetAbsences.filter((absence) => absence.status === AbsenceStatus.MARKED).length;
          const excusedCount = student.sheetAbsences.filter((absence) => absence.status === AbsenceStatus.EXCUSED).length;
          const groupedAbsences = new Map<string, typeof student.sheetAbsences>();

          for (const absence of student.sheetAbsences) {
            const sheetDate = dateInputValue(absence.sheet.date);
            groupedAbsences.set(sheetDate, [...(groupedAbsences.get(sheetDate) ?? []), absence]);
          }

          return (
            <section className="print-section parent-report-student" key={student.id}>
              <h2>
                {student.surname} {student.name}
              </h2>
              <section className="print-meta-grid">
                <div>
                  <span>Τμήμα</span>
                  <strong>{student.class.name}</strong>
                </div>
                <div>
                  <span>Σχολικό έτος</span>
                  <strong>{student.class.schoolYear.name}</strong>
                </div>
                <div>
                  <span>ΑΜ</span>
                  <strong>{student.am}</strong>
                </div>
                <div>
                  <span>Πατρώνυμο</span>
                  <strong>{student.patronymic}</strong>
                </div>
              </section>

              <section className="summary-grid print-summary">
                <div className="panel metric">
                  <span>Σύνολο</span>
                  <strong>{student.sheetAbsences.length}</strong>
                </div>
                <div className="panel metric">
                  <span>Καταχωρισμένες</span>
                  <strong>{markedCount}</strong>
                </div>
                <div className="panel metric">
                  <span>Δικαιολογημένες</span>
                  <strong>{excusedCount}</strong>
                </div>
                <div className="panel metric">
                  <span>Ημέρες με απουσίες</span>
                  <strong>{groupedAbsences.size}</strong>
                </div>
              </section>

              <table className="print-table">
                <thead>
                  <tr>
                    <th>Ημερομηνία</th>
                    <th>Απουσίες</th>
                    <th>Αναλυτικά</th>
                    <th>Κατάσταση</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(groupedAbsences, ([date, dayAbsences]) => (
                    <tr key={`${student.id}-${date}`}>
                      <td>{fullDateLabel(date, dayAbsences[0].sheet.day)}</td>
                      <td>{dayAbsences.length}</td>
                      <td>
                        {dayAbsences.map((absence) => (
                          <div key={`${absence.sheetId}-${absence.studentId}`}>
                            {hourLabel(absence.sheet.hour)} {absence.sheet.course.name}
                            {absence.isHourlyExpulsion ? " · Ωριαία αποβολή" : ""}
                            {absence.excusedReason ? ` · ${absence.excusedReason}` : ""}
                          </div>
                        ))}
                      </td>
                      <td>
                        {Array.from(new Set(dayAbsences.map((absence) => absence.status)))
                          .map((status) => absenceStatusLabel(status))
                          .join(", ")}
                      </td>
                    </tr>
                  ))}
                  {student.sheetAbsences.length === 0 ? (
                    <tr>
                      <td colSpan={4}>Δεν υπάρχουν καταχωρισμένες απουσίες.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </section>
          );
        })}
      </article>
    </main>
  );
}
