import Link from "next/link";
import { CalendarClock, ClipboardCheck, MailCheck, Printer, ShieldCheck, Users } from "lucide-react";
import type { ReactNode } from "react";
import type { UserRole } from "@prisma/client";
import { LogoutButton } from "@/app/logout-button";
import { SchoolBrand } from "@/app/school-brand";

type AppNavigationProps = {
  active:
    | "attendance"
    | "students"
    | "teacher"
    | "pending"
    | "reports"
    | "print"
    | "schedule"
    | "dashboard"
    | "notifications"
    | "control"
    | "appointments"
    | "appointment-settings"
    | "admin";
  children: ReactNode;
  role: UserRole;
  title: string;
  subtitle: string;
  userLabel: string;
};

export function AppNavigation({ active, children, role, title, subtitle, userLabel }: AppNavigationProps) {
  const isAdmin = role === "ADMIN";
  const isSchoolOffice = role === "SCHOOL_OFFICE";

  return (
    <main className="app-shell">
      <header className="topbar">
        <SchoolBrand title={title} subtitle={subtitle} />
        <div className="user-chip">
          <ShieldCheck size={17} />
          {userLabel}
        </div>
        <LogoutButton />
      </header>

      <div className="workspace">
        <nav className="sidebar" aria-label="Κύρια πλοήγηση">
          {!isSchoolOffice ? (
            <>
              <Link className={active === "attendance" ? "nav-button active" : "nav-button"} href="/">
                <ClipboardCheck size={18} />
                Απουσιολόγιο
              </Link>
              <Link className={active === "teacher" ? "nav-button active" : "nav-button"} href="/teacher">
                <CalendarClock size={18} />
                Μαθήματα
              </Link>
              <Link className={active === "pending" ? "nav-button active" : "nav-button"} href="/pending">
                <ClipboardCheck size={18} />
                Εκκρεμότητες
              </Link>
              <Link className={active === "appointments" ? "nav-button active" : "nav-button"} href="/appointments">
                <Users size={18} />
                Ραντεβού
              </Link>
              <Link className={active === "appointment-settings" ? "nav-button active" : "nav-button"} href="/appointment-settings">
                <CalendarClock size={18} />
                Ώρες γονέων
              </Link>
              <Link className={active === "reports" ? "nav-button active" : "nav-button"} href="/reports">
                <ClipboardCheck size={18} />
                Τμήματα
              </Link>
              <Link className={active === "print" ? "nav-button active" : "nav-button"} href="/print">
                <Printer size={18} />
                Εκτυπώσεις
              </Link>
            </>
          ) : (
            <Link className={active === "appointments" ? "nav-button active" : "nav-button"} href="/appointments">
              <Users size={18} />
              Ραντεβού
            </Link>
          )}
          {isAdmin ? (
            <>
              <Link className={active === "dashboard" ? "nav-button active" : "nav-button"} href="/dashboard">
                <ClipboardCheck size={18} />
                Dashboard
              </Link>
              <Link className="nav-button" href="/api/reports/export">
                <Printer size={18} />
                Εξαγωγές
              </Link>
              <Link className={active === "notifications" ? "nav-button active" : "nav-button"} href="/notifications">
                <ShieldCheck size={18} />
                Κανόνες ειδοποιήσεων
              </Link>
              <Link className={active === "control" ? "nav-button active" : "nav-button"} href="/control">
                <MailCheck size={18} />
                Έλεγχος
              </Link>
              <Link className={active === "schedule" ? "nav-button active" : "nav-button"} href="/schedule">
                <CalendarClock size={18} />
                Πρόγραμμα
              </Link>
              <Link className={active === "admin" ? "nav-button active" : "nav-button"} href="/admin">
                <ShieldCheck size={18} />
                Διαχείριση
              </Link>
            </>
          ) : null}
        </nav>

        <section className="main-grid">{children}</section>
      </div>
    </main>
  );
}
