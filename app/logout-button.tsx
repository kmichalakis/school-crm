"use client";

export function LogoutButton() {
  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/";
  }

  return (
    <button className="secondary-button" onClick={logout} type="button">
      Αποσύνδεση
    </button>
  );
}
