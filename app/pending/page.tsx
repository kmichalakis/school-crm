import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppNavigation } from "@/app/app-navigation";
import { PendingList } from "@/app/pending/pending-list";
import { getPendingAttendanceItems } from "@/lib/pending-attendance";
import { prisma } from "@/lib/prisma";
import { parseSessionToken, sessionCookieName } from "@/lib/session";

type PendingPageProps = {
  searchParams: Promise<{
    scope?: string;
  }>;
};

function checkedUntilLabel(dateValue: string | null) {
  if (!dateValue) {
    return "Δεν υπάρχουν προηγούμενες εργάσιμες ημέρες στο σχολικό έτος.";
  }

  return new Intl.DateTimeFormat("el-GR", {
    dateStyle: "long"
  }).format(new Date(`${dateValue}T12:00:00`));
}

export default async function PendingPage({ searchParams }: PendingPageProps) {
  const cookieStore = await cookies();
  const session = parseSessionToken(cookieStore.get(sessionCookieName)?.value);

  if (!session) {
    redirect("/");
  }

  if (session.mustChangePassword) {
    redirect("/account/password");
  }

  if (session.role === "PARENT" || session.role === "CLASS_TABLET") {
    redirect("/");
  }

  const params = await searchParams;
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { teacher: true }
  });
  const teacher = user?.teacher ?? null;
  const isAdmin = session.role === "ADMIN";
  const showAllTeachers = isAdmin && params.scope === "all";
  const ownPending = await getPendingAttendanceItems({ teacherId: teacher?.id ?? null });
  const allPending = showAllTeachers ? await getPendingAttendanceItems({ allTeachers: true }) : null;
  const activeResult = allPending ?? ownPending;
  const userLabel = teacher ? `${teacher.name} ${teacher.surname}` : user?.username ?? "Χρήστης";

  return (
    <AppNavigation
      active="pending"
      role={session.role}
      title="Εκκρεμότητες"
      subtitle="Απουσιολόγια προηγούμενων εργάσιμων ημερών που δεν έχουν υπογραφεί"
      userLabel={userLabel}
    >
      <section className="admin-section">
        <div className="admin-section-title">
          <h2>{showAllTeachers ? "Όλες οι εκκρεμότητες" : "Οι εκκρεμότητές μου"}</h2>
          <p>
            Σχολικό έτος {activeResult.schoolYearName ?? "χωρίς ενεργό έτος"} · Έλεγχος έως {checkedUntilLabel(activeResult.checkedUntil)}
          </p>
        </div>

        {isAdmin ? (
          <div className="pending-scope-actions">
            <Link className={showAllTeachers ? "secondary-button" : "primary-button"} href="/pending">
              Οι δικές μου
            </Link>
            <Link className={showAllTeachers ? "primary-button" : "secondary-button"} href="/pending?scope=all">
              Όλων των εκπαιδευτικών
            </Link>
          </div>
        ) : null}
      </section>

      <div className="summary-grid">
        <div className="panel metric">
          <span>{showAllTeachers ? "Σύνολο εκκρεμοτήτων" : "Εκκρεμότητες"}</span>
          <strong>{activeResult.items.length}</strong>
        </div>
        <div className="panel metric">
          <span>Σχολικό έτος</span>
          <strong>{activeResult.schoolYearName ?? "-"}</strong>
        </div>
      </div>

      <section className="admin-section">
        <div className="admin-section-title">
          <h2>Λίστα απουσιολογίων</h2>
          <p>
            {showAllTeachers
              ? "Ο διαχειριστής βλέπει όλες τις εκκρεμότητες για ενημέρωση των εκπαιδευτικών."
              : "Πατήστε υπογραφή για να κλείσει άμεσα το απουσιολόγιο που αντιστοιχεί στο μάθημά σας."}
          </p>
        </div>

        <PendingList
          canMarkBlank={showAllTeachers}
          emptyMessage={
            showAllTeachers
              ? "Δεν υπάρχουν εκκρεμότητες υπογραφής για κανέναν εκπαιδευτικό."
              : "Δεν υπάρχουν εκκρεμότητες υπογραφής για τα μαθήματά σας."
          }
          items={activeResult.items}
        />
      </section>
    </AppNavigation>
  );
}
