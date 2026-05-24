import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AbsenceStatus, SchoolYearStatus, type WeekDay } from "@prisma/client";
import { AppNavigation } from "@/app/app-navigation";
import { sendTodayFirstHourAbsenceEmailsAction } from "@/app/control/actions";
import { prisma } from "@/lib/prisma";
import { hourLabel, weekDayLabel } from "@/lib/report-helpers";
import { dateInputValue } from "@/lib/school-calendar";
import { parseSessionToken, sessionCookieName } from "@/lib/session";

export const maxDuration = 60;

type ControlPageProps = {
  searchParams: Promise<{
    notice?: string;
    noticeType?: string;
    analyze?: string;
    range?: string;
    start?: string;
    end?: string;
    classId?: string;
    studentId?: string;
    minCount?: string;
  }>;
};

type Insight = {
  title: string;
  detail: string;
  count: number;
  severity: "high" | "medium" | "low";
};

function athensTodayInput() {
  const parts = new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Athens",
    year: "numeric"
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";

  return `${value("year")}-${value("month")}-${value("day")}`;
}

function addDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  return nextDate;
}

function parseDateInput(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function greekDateLabel(date: Date) {
  return new Intl.DateTimeFormat("el-GR", {
    dateStyle: "short",
    timeZone: "Europe/Athens"
  }).format(date);
}

function percent(count: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((count / total) * 100);
}

function pushInsight(insights: Insight[], title: string, detail: string, count: number, share: number, minCount: number) {
  if (count < minCount) return;

  insights.push({
    title,
    detail,
    count,
    severity: count >= minCount + 3 || share >= 70 ? "high" : share >= 45 ? "medium" : "low"
  });
}

export default async function ControlPage({ searchParams }: ControlPageProps) {
  const cookieStore = await cookies();
  const session = parseSessionToken(cookieStore.get(sessionCookieName)?.value);

  if (!session || session.role !== "ADMIN") {
    redirect("/");
  }

  if (session.mustChangePassword) {
    redirect("/account/password");
  }

  const params = await searchParams;
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { teacher: true }
  });
  const userLabel = user?.teacher ? `${user.teacher.name} ${user.teacher.surname}` : user?.username ?? "Admin";
  const todayValue = athensTodayInput();

  const [schoolYears, classes, students] = await Promise.all([
    prisma.schoolYear.findMany({
      orderBy: [{ status: "asc" }, { startsOn: "desc" }]
    }),
    prisma.class.findMany({
      include: { schoolYear: true },
      orderBy: [{ schoolYear: { startsOn: "desc" } }, { name: "asc" }]
    }),
    prisma.student.findMany({
      include: {
        class: {
          include: { schoolYear: true }
        }
      },
      orderBy: [{ class: { name: "asc" } }, { surname: "asc" }, { name: "asc" }]
    })
  ]);

  const activeYear = schoolYears.find((schoolYear) => schoolYear.status === SchoolYearStatus.ACTIVE) ?? schoolYears[0] ?? null;
  const activeClasses = activeYear ? classes.filter((classRecord) => classRecord.schoolYearId === activeYear.id) : [];
  const activeStudents = activeYear ? students.filter((student) => student.schoolYearId === activeYear.id) : [];
  const selectedRange = params.range ?? "week";
  const minCount = Math.max(2, Number(params.minCount ?? "3") || 3);
  const selectedClassId = params.classId ?? "";
  const selectedStudentId = params.studentId ?? "";

  const todayDate = parseDateInput(todayValue);
  const defaultStart =
    selectedRange === "month"
      ? addDays(todayDate, -30)
      : selectedRange === "custom"
        ? parseDateInput(params.start || todayValue)
        : addDays(todayDate, -7);
  const defaultEnd = selectedRange === "custom" ? parseDateInput(params.end || todayValue) : todayDate;
  const startValue = params.start || dateInputValue(defaultStart);
  const endValue = params.end || dateInputValue(defaultEnd);
  const shouldAnalyze = params.analyze === "1";
  const noticeType = params.noticeType === "error" ? "error" : "success";

  let insights: Insight[] = [];
  let analyzedAbsenceCount = 0;

  if (shouldAnalyze && activeYear) {
    const absences = await prisma.attendanceSheetAbsence.findMany({
      where: {
        absent: true,
        status: { not: AbsenceStatus.REMOVED },
        studentId: selectedStudentId || undefined,
        student: {
          classId: selectedClassId || undefined,
          schoolYearId: activeYear.id
        },
        sheet: {
          date: {
            gte: parseDateInput(startValue),
            lte: parseDateInput(endValue)
          }
        }
      },
      include: {
        student: {
          include: {
            class: true
          }
        },
        sheet: {
          include: {
            course: true,
            courses: {
              include: {
                course: true
              },
              orderBy: { position: "asc" }
            }
          }
        }
      }
    });

    analyzedAbsenceCount = absences.length;
    const totalsByStudent = new Map<string, number>();
    const byCourse = new Map<string, { count: number; studentId: string; student: string; className: string; label: string }>();
    const byHour = new Map<string, { count: number; studentId: string; student: string; className: string; hour: number }>();
    const byDay = new Map<string, { count: number; studentId: string; student: string; className: string; day: WeekDay }>();
    const fullDayCandidates = new Map<string, { count: number; student: string; className: string; date: Date }>();

    for (const absence of absences) {
      const studentName = `${absence.student.surname} ${absence.student.name}`;
      const className = absence.student.class.name;
      totalsByStudent.set(absence.studentId, (totalsByStudent.get(absence.studentId) ?? 0) + 1);

      const courses = absence.sheet.courses.length > 0
        ? absence.sheet.courses.map((courseLink) => courseLink.course.name)
        : [absence.sheet.course.name];

      for (const courseName of courses) {
        const key = `${absence.studentId}:course:${courseName}`;
        const existing = byCourse.get(key) ?? { count: 0, studentId: absence.studentId, student: studentName, className, label: courseName };
        existing.count += 1;
        byCourse.set(key, existing);
      }

      const hourKey = `${absence.studentId}:hour:${absence.sheet.hour}`;
      const existingHour = byHour.get(hourKey) ?? { count: 0, studentId: absence.studentId, student: studentName, className, hour: absence.sheet.hour };
      existingHour.count += 1;
      byHour.set(hourKey, existingHour);

      const dayKey = `${absence.studentId}:day:${absence.sheet.day}`;
      const existingDay = byDay.get(dayKey) ?? { count: 0, studentId: absence.studentId, student: studentName, className, day: absence.sheet.day };
      existingDay.count += 1;
      byDay.set(dayKey, existingDay);

      const fullDayKey = `${absence.studentId}:date:${dateInputValue(absence.sheet.date)}`;
      const existingFullDay = fullDayCandidates.get(fullDayKey) ?? { count: 0, student: studentName, className, date: absence.sheet.date };
      existingFullDay.count += 1;
      fullDayCandidates.set(fullDayKey, existingFullDay);
    }

    for (const item of byCourse.values()) {
      const total = totalsByStudent.get(item.studentId) ?? 0;
      const share = percent(item.count, total);
      pushInsight(insights, `Μοτίβο σε μάθημα: ${item.label}`, `${item.student} (${item.className}) έχει ${item.count} απουσίες στο ίδιο μάθημα, ${share}% των απουσιών του διαστήματος.`, item.count, share, minCount);
    }

    for (const item of byHour.values()) {
      const studentTotal = totalsByStudent.get(item.studentId) ?? 0;
      const share = percent(item.count, studentTotal);
      pushInsight(insights, `Μοτίβο σε ώρα: ${hourLabel(item.hour)}`, `${item.student} (${item.className}) έχει ${item.count} απουσίες στην ίδια ώρα, ${share}% των απουσιών του διαστήματος.`, item.count, share, minCount);
    }

    for (const item of byDay.values()) {
      const studentTotal = totalsByStudent.get(item.studentId) ?? 0;
      const share = percent(item.count, studentTotal);
      pushInsight(insights, `Μοτίβο σε ημέρα: ${weekDayLabel(item.day)}`, `${item.student} (${item.className}) έχει ${item.count} απουσίες την ίδια ημέρα εβδομάδας, ${share}% των απουσιών του διαστήματος.`, item.count, share, minCount);
    }

    for (const item of fullDayCandidates.values()) {
      pushInsight(insights, "Πολλές απουσίες ίδιας ημέρας", `${item.student} (${item.className}) έχει ${item.count} απουσίες στις ${greekDateLabel(item.date)}.`, item.count, 100, Math.max(4, minCount));
    }

    insights = insights
      .sort((first, second) => second.count - first.count || first.title.localeCompare(second.title, "el"))
      .slice(0, 30);
  }

  return (
    <AppNavigation
      active="control"
      role={session.role}
      title="Έλεγχος"
      subtitle="Άμεσες ενημερώσεις γονέων και έξυπνος έλεγχος μοτίβων απουσιών"
      userLabel={userLabel}
    >
      {params.notice ? (
        <div className={`admin-notice ${noticeType}`} role="status">
          {params.notice}
        </div>
      ) : null}

      <section className="admin-section">
        <div className="admin-section-title">
          <h2>Πρώτη ώρα σήμερα</h2>
          <p>Δημιουργεί και, αν έχει ρυθμιστεί email provider, στέλνει email στους γονείς για απουσίες πρώτης ώρας.</p>
        </div>
        <form action={sendTodayFirstHourAbsenceEmailsAction} className="admin-form control-email-form">
          <input name="schoolYearId" type="hidden" value={activeYear?.id ?? ""} />
          <div className="field">
            <label htmlFor="emailDate">Ημερομηνία</label>
            <input id="emailDate" name="date" type="date" defaultValue={todayValue} min={activeYear ? dateInputValue(activeYear.startsOn) : undefined} max={activeYear ? dateInputValue(activeYear.endsOn) : undefined} required />
          </div>
          <button className="primary-button" type="submit">
            Αποστολή email γονέων
          </button>
        </form>
        <p className="form-hint">
          Αν δεν υπάρχουν `RESEND_API_KEY` και `EMAIL_FROM` στο Vercel, οι ενημερώσεις μένουν στην ουρά ειδοποιήσεων για χειροκίνητο έλεγχο.
        </p>
      </section>

      <section className="admin-section">
        <div className="admin-section-title">
          <h2>Έλεγχος περίεργων μοτίβων</h2>
          <p>Εντοπίζει επαναλαμβανόμενες απουσίες ανά μαθητή, μάθημα, ώρα, ημέρα ή πλήρη ημέρα μέσα στο επιλεγμένο διάστημα.</p>
        </div>

        <form className="admin-form control-analysis-form" method="get">
          <input name="analyze" type="hidden" value="1" />
          <div className="field">
            <label htmlFor="range">Διάστημα</label>
            <select id="range" name="range" defaultValue={selectedRange}>
              <option value="week">Τελευταία εβδομάδα</option>
              <option value="month">Τελευταίος μήνας</option>
              <option value="custom">Προσαρμοσμένο</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="start">Από</label>
            <input id="start" name="start" type="date" defaultValue={startValue} min={activeYear ? dateInputValue(activeYear.startsOn) : undefined} max={activeYear ? dateInputValue(activeYear.endsOn) : undefined} />
          </div>
          <div className="field">
            <label htmlFor="end">Έως</label>
            <input id="end" name="end" type="date" defaultValue={endValue} min={activeYear ? dateInputValue(activeYear.startsOn) : undefined} max={activeYear ? dateInputValue(activeYear.endsOn) : undefined} />
          </div>
          <div className="field">
            <label htmlFor="classId">Τμήμα</label>
            <select id="classId" name="classId" defaultValue={selectedClassId}>
              <option value="">Όλα τα τμήματα</option>
              {activeClasses.map((classRecord) => (
                <option key={classRecord.id} value={classRecord.id}>
                  {classRecord.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="studentId">Μαθητής</label>
            <select id="studentId" name="studentId" defaultValue={selectedStudentId}>
              <option value="">Όλοι οι μαθητές</option>
              {activeStudents.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.class.name} - {student.surname} {student.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="minCount">Ελάχιστες εμφανίσεις</label>
            <input id="minCount" min="2" name="minCount" type="number" defaultValue={minCount} />
          </div>
          <button className="primary-button" type="submit">
            Έλεγχος μοτίβων
          </button>
        </form>
      </section>

      {shouldAnalyze ? (
        <section className="admin-section">
          <div className="admin-section-title">
            <h2>Αποτελέσματα ελέγχου</h2>
            <p>
              Ελέγχθηκαν {analyzedAbsenceCount} απουσίες για το διάστημα {greekDateLabel(parseDateInput(startValue))} - {greekDateLabel(parseDateInput(endValue))}.
            </p>
          </div>

          {insights.length > 0 ? (
            <div className="control-insight-list">
              {insights.map((insight) => (
                <article className={`control-insight ${insight.severity}`} key={`${insight.title}-${insight.detail}`}>
                  <div>
                    <strong>{insight.title}</strong>
                    <p>{insight.detail}</p>
                  </div>
                  <span className="sync-pill">{insight.count} εμφανίσεις</span>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">Δεν εντοπίστηκαν έντονα μοτίβα με τα τρέχοντα όρια.</div>
          )}
        </section>
      ) : null}
    </AppNavigation>
  );
}
