import nodemailer from "nodemailer";

export type EmailSendResult = {
  reason: string;
  sent: boolean;
  failureKind?: "quota" | "authentication" | "connection" | "configuration" | "recipient" | "other";
};

function gmailFailureKind(error: unknown): NonNullable<EmailSendResult["failureKind"]> {
  const details = (typeof error === "object" && error !== null ? error : {}) as {
    code?: string;
    responseCode?: number;
    response?: string;
    message?: string;
  };
  const message = `${details.response ?? ""} ${details.message ?? ""}`;

  if (/limit|quota|rate.?limit|too many|try again later|5\.4\.5|4\.7\.28/i.test(message)) return "quota";
  if (details.code === "EAUTH" || details.responseCode === 535) return "authentication";
  if (["ECONNECTION", "ESOCKET", "ETIMEDOUT"].includes(details.code ?? "") || /timed? out/i.test(message)) return "connection";
  if (details.code === "EENVELOPE" || /invalid recipient|recipient address rejected/i.test(message)) return "recipient";
  return "other";
}

export async function sendSystemEmail(to: string, subject: string, body: string): Promise<EmailSendResult> {
  const gmailUser = process.env.GMAIL_USER?.trim();
  const gmailAppPassword = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");
  const emailFrom = process.env.EMAIL_FROM?.trim();
  const gmailFrom = emailFrom || gmailUser;

  if (gmailUser && gmailAppPassword && gmailFrom) {
    try {
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: gmailUser,
          pass: gmailAppPassword
        }
      });

      await transporter.sendMail({
        from: gmailFrom,
        to,
        subject,
        text: body
      });

      return { sent: true, reason: "" };
    } catch (error) {
      const failureKind = gmailFailureKind(error);
      const smtpError = (typeof error === "object" && error !== null ? error : {}) as {
        code?: string;
        responseCode?: number;
      };
      console.error("Gmail SMTP send failed", {
        code: smtpError.code,
        responseCode: smtpError.responseCode,
        failureKind
      });
      return {
        sent: false,
        reason: error instanceof Error ? `Αποτυχία Gmail SMTP: ${error.message}` : "Αποτυχία Gmail SMTP.",
        failureKind
      };
    }
  }

  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey || !emailFrom) {
    return {
      sent: false,
      reason: "Δεν έχουν οριστεί GMAIL_USER/GMAIL_APP_PASSWORD ή RESEND_API_KEY/EMAIL_FROM.",
      failureKind: "configuration"
    };
  }

  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: emailFrom,
        to,
        subject,
        text: body
      })
    });
  } catch (error) {
    return {
      sent: false,
      reason: error instanceof Error ? `Αποτυχία Resend: ${error.message}` : "Αποτυχία Resend.",
      failureKind: "connection"
    };
  }

  if (!response.ok) {
    const details = await response.text();
    return {
      sent: false,
      reason: details.slice(0, 180) || "Αποτυχία αποστολής από τον email provider.",
      failureKind: response.status === 429 ? "quota" : [401, 403].includes(response.status) ? "authentication" : response.status >= 500 ? "connection" : "other"
    };
  }

  return { sent: true, reason: "" };
}
