import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { changePasswordAction } from "@/app/account/actions";
import { LogoutButton } from "@/app/logout-button";
import { SchoolBrand } from "@/app/school-brand";
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

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <SchoolBrand
          title="Αλλαγή κωδικού"
          subtitle={session.mustChangePassword ? "Απαιτείται νέος ασφαλής κωδικός" : "Ασφάλεια λογαριασμού"}
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
          <h2>Νέος κωδικός</h2>
          <p>Ο κωδικός πρέπει να έχει τουλάχιστον 10 χαρακτήρες, γράμματα και αριθμούς.</p>
        </div>
        <form action={changePasswordAction} className="admin-form compact-form password-form">
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
            Αλλαγή κωδικού
          </button>
        </form>
      </section>
    </main>
  );
}
