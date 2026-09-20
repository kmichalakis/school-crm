import Link from "next/link";
import { CalendarClock, ShieldCheck, Users } from "lucide-react";
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
  const canManageAppointmentSettings = role === "ADMIN";

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
              <Link className={active === "appointments" ? "nav-button active" : "nav-button"} href="/appointments">
                <Users size={18} />
                Ραντεβού
              </Link>
              {canManageAppointmentSettings ? (
                <Link className={active === "appointment-settings" ? "nav-button active" : "nav-button"} href="/appointment-settings">
                  <CalendarClock size={18} />
                  Ώρες γονέων
                </Link>
              ) : null}
            </>
          ) : (
            <Link className={active === "appointments" ? "nav-button active" : "nav-button"} href="/appointments">
              <Users size={18} />
              Ραντεβού
            </Link>
          )}
          {isAdmin ? (
            <>
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
