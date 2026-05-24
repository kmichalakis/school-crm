import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppNavigation } from "@/app/app-navigation";
import { deleteCalendarDayAction, upsertCalendarDayAction } from "@/app/admin/actions";
import { dateInputValue, isWeekdayDate } from "@/lib/school-calendar";
import { prisma } from "@/lib/prisma";
import { parseSessionToken, sessionCookieName } from "@/lib/session";

type CalendarPageProps = {
  searchParams: Promise<{
    schoolYearId?: string;
    notice?: string;
    noticeType?: string;
  }>;
};

function dateLabel(date: Date) {
  return new Intl.DateTimeFormat("el-GR", {
    dateStyle: "long"
  }).format(date);
}

export default async function CalendarPage({ searchParams }: CalendarPageProps) {
  const cookieStore = await cookies();
  const session = parseSessionToken(cookieStore.get(sessionCookieName)?.value);

  if (!session) {
    redirect("/");
  }

  if (session.mustChangePassword) {
    redirect("/account/password");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { teacher: true }
  });

  if (!user || user.role !== "ADMIN") {
    redirect("/");
  }

  const params = await searchParams;
  const schoolYears = await prisma.schoolYear.findMany({
    include: {
      calendarDays: {
        orderBy: { date: "asc" }
      }
    },
    orderBy: [{ status: "asc" }, { startsOn: "desc" }]
  });
  const selectedYear =
    schoolYears.find((schoolYear) => schoolYear.id === params.schoolYearId) ??
    schoolYears.find((schoolYear) => schoolYear.status === "ACTIVE") ??
    schoolYears[0] ??
    null;
  const noticeType = params.noticeType === "error" ? "error" : "success";
  const userLabel = user.teacher ? `${user.teacher.name} ${user.teacher.surname}` : user.username;

  return (
    <AppNavigation
      active="schedule"
      role={user.role}
      title="Εξαιρέσεις ημερών"
      subtitle="Εργάσιμες ημέρες και εξαιρέσεις σχολικού έτους"
      userLabel={userLabel}
    >
      {params.notice ? (
        <div className={`admin-notice ${noticeType}`} role="status">
          {params.notice}
        </div>
      ) : null}

      <section className="admin-section">
        <div className="admin-section-title">
          <h2>Σχολικό έτος</h2>
          <p>Το ημερολόγιο είναι κοινό για όλα τα τμήματα. Από προεπιλογή οι καθημερινές είναι εργάσιμες.</p>
        </div>
        <div className="calendar-year-list">
          {schoolYears.map((schoolYear) => (
            <Link
              className={selectedYear?.id === schoolYear.id ? "calendar-year-card active" : "calendar-year-card"}
              href={`/calendar?schoolYearId=${schoolYear.id}`}
              key={schoolYear.id}
            >
              <strong>{schoolYear.name}</strong>
              <span>{dateInputValue(schoolYear.startsOn)} έως {dateInputValue(schoolYear.endsOn)}</span>
              <em>{schoolYear.status === "ACTIVE" ? "Ενεργό" : "Αρχείο"}</em>
            </Link>
          ))}
        </div>
      </section>

      {selectedYear ? (
        <>
          <section className="admin-section">
            <div className="admin-section-title">
              <h2>Ορισμός ημέρας</h2>
              <p>Καταχωρίζονται μόνο οι εξαιρέσεις: αργίες καθημερινών ή ειδικές εργάσιμες ημέρες.</p>
            </div>
            <form action={upsertCalendarDayAction} className="admin-form grid-form">
              <input name="schoolYearId" type="hidden" value={selectedYear.id} />
              <input
                aria-label="Ημερομηνία"
                min={dateInputValue(selectedYear.startsOn)}
                max={dateInputValue(selectedYear.endsOn)}
                name="date"
                required
                type="date"
              />
              <select name="isWorkingDay" defaultValue="false">
                <option value="false">Μη εργάσιμη</option>
                <option value="true">Εργάσιμη</option>
              </select>
              <input name="note" placeholder="Σημείωση π.χ. αργία, εκδρομή, ειδικό μάθημα" />
              <button className="primary-button" type="submit">
                Αποθήκευση ημέρας
              </button>
            </form>
          </section>

          <section className="admin-section">
            <div className="admin-section-title">
              <h2>Εξαιρέσεις ημερολογίου</h2>
              <p>Οι ημερομηνίες εδώ υπερισχύουν του προεπιλεγμένου κανόνα Δευτέρα-Παρασκευή.</p>
            </div>
            <div className="admin-table">
              {selectedYear.calendarDays.length > 0 ? (
                selectedYear.calendarDays.map((calendarDay) => (
                  <form action={deleteCalendarDayAction} className="admin-row editable-row" key={calendarDay.id}>
                    <input name="id" type="hidden" value={calendarDay.id} />
                    <strong>{dateLabel(calendarDay.date)}</strong>
                    <span>{calendarDay.isWorkingDay ? "Εργάσιμη" : "Μη εργάσιμη"}</span>
                    <span>{isWeekdayDate(dateInputValue(calendarDay.date)) ? "Καθημερινή" : "Σαββατοκύριακο"}</span>
                    <span>{calendarDay.note ?? "-"}</span>
                    <button className="secondary-button danger" type="submit">
                      Αφαίρεση
                    </button>
                  </form>
                ))
              ) : (
                <div className="empty-state">Δεν υπάρχουν εξαιρέσεις. Ισχύει ο προεπιλεγμένος κανόνας καθημερινών.</div>
              )}
            </div>
          </section>
        </>
      ) : (
        <div className="empty-state">Δεν υπάρχει σχολικό έτος. Δημιουργήστε πρώτα ένα έτος από τη Διαχείριση.</div>
      )}
    </AppNavigation>
  );
}
