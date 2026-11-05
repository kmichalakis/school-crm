import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { changePasswordAction, confirmParentPasswordChangeAction, requestParentPasswordChangeAction } from "@/app/account/actions";
import { LogoutButton } from "@/app/logout-button";
import { SchoolBrand } from "@/app/school-brand";
import { prisma } from "@/lib/prisma";
import { parseSessionToken, sessionCookieName } from "@/lib/session";

type PasswordPageProps = {
  searchParams: Promise<{
    notice?: string;
    noticeType?: string;
  }>;
};

export default async function PasswordPage({ searchParams }: PasswordPageProps) {
  const cookieStore = await cookies();
  const session = parseSessionToken(cookieStore.get(sessionCookieName)?.value);

  if (!session) {
    redirect("/");
  }

  const params = await searchParams;
  const noticeType = params.noticeType === "error" ? "error" : "success";
  const isParent = session.role === "PARENT";
  const pendingRequest = isParent
    ? await prisma.passwordChangeRequest.findUnique({ where: { userId: session.userId } })
    : null;
  const canConfirm = pendingRequest && pendingRequest.expiresAt > new Date() && pendingRequest.attempts < 5;

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <SchoolBrand
          title="Αλλαγή κωδικού"
          subtitle={session.mustChangePassword ? "Απαιτείται νέος κωδικός" : "Ασφάλεια λογαριασμού"}
        />
        <div className="status-row">
          {!session.mustChangePassword ? (
            <Link className="secondary-button" href="/">
              Επιστροφή
            </Link>
          ) : null}
          <LogoutButton />
        </div>
      </header>

      {params.notice ? (
        <div className={`admin-notice ${noticeType}`} role="status">
          {params.notice}
        </div>
      ) : null}

      <section className="admin-section">
        <div className="admin-section-title">
          <h2>{isParent ? "Αλλαγή κωδικού γονέα" : "Νέος κωδικός"}</h2>
          <p>
            {isParent
              ? "Πληκτρολογήστε τον τρέχοντα και τον νέο κωδικό. Θα στείλουμε κωδικό επιβεβαίωσης στο email σας."
              : "Ο κωδικός μπορεί να είναι σύντομος ή αριθμητικό PIN, αρκεί να μην περιέχει το username."}
          </p>
        </div>
        <form action={isParent ? requestParentPasswordChangeAction : changePasswordAction} className="admin-form compact-form password-form">
          <div className="field">
            <label htmlFor="currentPassword">Τρέχων κωδικός</label>
            <input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
          </div>
          <div className="field">
            <label htmlFor="newPassword">Νέος κωδικός</label>
            <input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required />
          </div>
          <div className="field">
            <label htmlFor="confirmPassword">Επιβεβαίωση νέου κωδικού</label>
            <input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required />
          </div>
          <button className="primary-button" type="submit">
            {isParent ? "Αποστολή κωδικού επιβεβαίωσης" : "Αλλαγή κωδικού"}
          </button>
        </form>
        {isParent && canConfirm ? (
          <form action={confirmParentPasswordChangeAction} className="admin-form compact-form password-form">
            <div className="field">
              <label htmlFor="verificationCode">Κωδικός επιβεβαίωσης από το email</label>
              <input
                id="verificationCode"
                name="verificationCode"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                autoComplete="one-time-code"
                required
              />
            </div>
            <button className="primary-button" type="submit">Επιβεβαίωση αλλαγής</button>
          </form>
        ) : null}
      </section>
    </main>
  );
}
