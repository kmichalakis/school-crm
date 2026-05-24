import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AbsenceStatus } from "@prisma/client";
import { PrintButton } from "@/app/print/print-button";
import { prisma } from "@/lib/prisma";
import { absenceStatusLabel, hourLabel, weekDayLabel } from "@/lib/report-helpers";
import { dateToWeekDay, schoolHours } from "@/lib/school-time";
import { parseSessionToken, sessionCookieName } from "@/lib/session";

type PrintAttendancePageProps = {
  searchParams: Promise<{
    classId?: string;
    date?: string;
  }>;
};

function todayLabel() {
  return new Intl.DateTimeFormat("el-GR", {
    dateStyle: "long"
  }).format(new Date());
}

function printDateLabel(dateValue: string) {
  return new Intl.DateTimeFormat("el-GR", {
    dateStyle: "long"
  }).format(new Date(`${dateValue}T12:00:00`));
}

function attendanceDate(dateValue: string) {
  return new Date(`${dateValue}T00:00:00.000Z`);
}

export default async function PrintAttendancePage({ searchParams }: PrintAttendancePageProps) {
  const cookieStore = await cookies();
  const session = parseSessionToken(cookieStore.get(sessionCookieName)?.value);

  if (!session || (session.role !== "ADMIN" && session.role !== "TEACHER")) {
    redirect("/");
  }

  if (session.mustChangePassword) {
    redirect("/account/password");
  }

  const params = await searchParams;
  const day = params.date ? dateToWeekDay(params.date) : null;

  if (!params.classId || !params.date || !day) {
    redirect("/print");
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

  const allowedClassIds =
    session.role === "ADMIN"
      ? undefined
      : teacher?.responsibleClasses.map((classRecord) => classRecord.id) ?? [];

  if (allowedClassIds && !allowedClassIds.includes(params.classId)) {
    redirect("/");
  }

  const classRecord = await prisma.class.findUnique({
    where: { id: params.classId },
    include: {
      schoolYear: true,
      students: {
        orderBy: [{ surname: "asc" }, { name: "asc" }]
      }
    }
  });

  if (!classRecord) {
    redirect("/print");
  }

  const sheets = await prisma.attendanceSheet.findMany({
    where: {
      classId: classRecord.id,
      date: attendanceDate(params.date)
    },
    include: {
      course: true,
      absences: {
        include: {
          student: true
        }
      }
    },
    orderBy: { hour: "asc" }
  });
  const sheetByHour = new Map(sheets.map((sheet) => [sheet.hour, sheet]));

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
            <span>1ο Πρότυπο Γυμνάσιο Μυτιλήνης</span>
            <h1>Ημερήσιο απουσιολόγιο τμήματος</h1>
          </div>
          <div>
            <strong>{todayLabel()}</strong>
            <span>Έκδοση από Mytilene Scholaris</span>
          </div>
        </header>

        <section className="print-meta-grid">
          <div>
            <span>Σχολικό έτος</span>
            <strong>{classRecord.schoolYear.name}</strong>
          </div>
          <div>
            <span>Τμήμα</span>
            <strong>{classRecord.name}</strong>
          </div>
          <div>
            <span>Ημέρα</span>
            <strong>{weekDayLabel(day)}</strong>
          </div>
          <div>
            <span>Ημερομηνία</span>
            <strong>{printDateLabel(params.date)}</strong>
          </div>
          <div>
            <span>Μαθητές</span>
            <strong>{classRecord.students.length}</strong>
          </div>
        </section>

        <section className="print-section">
          <h2>Καταχωρίσεις ανά ώρα</h2>
          <table className="print-table">
            <thead>
              <tr>
                <th>Ώρα</th>
                <th>Μάθημα</th>
                <th>Εκπαιδευτικός</th>
                <th>Απόντες</th>
                <th>Υπογραφή</th>
              </tr>
            </thead>
            <tbody>
              {schoolHours.map((hour) => {
                const sheet = sheetByHour.get(hour.hour);
                const activeAbsences =
                  sheet?.absences.filter((absence) => absence.absent && absence.status !== AbsenceStatus.REMOVED) ?? [];

                return (
                  <tr key={hour.hour}>
                    <td>
                      {hourLabel(hour.hour)}
                      <br />
                      <span>
                        {hour.starts}-{hour.ends}
                      </span>
                    </td>
                    <td>{sheet?.course.name ?? "Δεν έχει καταχωριστεί"}</td>
                    <td>{sheet?.teacherName ?? ""}</td>
                    <td>
                      {activeAbsences.length > 0
                        ? activeAbsences
                            .map((absence) => `${absence.student.surname} ${absence.student.name} (${absenceStatusLabel(absence.status)})`)
                            .join(", ")
                        : "Καμία"}
                    </td>
                    <td>{sheet?.signedAt ? "Υπογεγραμμένο" : "Εκκρεμεί"}</td>
                  </tr>
                );
              })}
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
