"use client";

import { FormEvent, useState } from "react";
import { LogIn, ShieldCheck } from "lucide-react";

export function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("Σύνδεση με λογαριασμό τάξης ή εκπαιδευτικού.");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage("Γίνεται έλεγχος στοιχείων...");

    const response = await fetch("/api/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ username, password })
    });

    if (!response.ok) {
      setIsSubmitting(false);
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      setMessage(data?.error ?? "Λάθος όνομα χρήστη ή κωδικός.");
      return;
    }

    const data = (await response.json()) as { mustChangePassword?: boolean };
    window.location.href = data.mustChangePassword ? "/account/password" : "/";
  }

  return (
    <main className="login-shell">
      <section className="login-panel">
        <div className="brand login-brand">
          <div className="brand-mark">ΣΧ</div>
          <div>
            <h1>Σχολικό CRM</h1>
            <span>Σύνδεση απουσιολογίου</span>
          </div>
        </div>

        <form className="login-form" onSubmit={submitLogin}>
          <div className="login-title">
            <ShieldCheck size={20} />
            <h2>Είσοδος χρήστη</h2>
          </div>

          <div className="field">
            <label htmlFor="username">Όνομα χρήστη</label>
            <input id="username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
          </div>

          <div className="field">
            <label htmlFor="password">Κωδικός</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </div>

          <button className="primary-button" disabled={isSubmitting || !username || !password} type="submit">
            <LogIn size={18} />
            Σύνδεση
          </button>

          <p className="login-message">{message}</p>
        </form>
      </section>
    </main>
  );
}
