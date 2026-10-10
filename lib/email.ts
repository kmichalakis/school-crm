import nodemailer from "nodemailer";

export type EmailSendResult = {
  reason: string;
  sent: boolean;
};

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
      return {
        sent: false,
        reason: error instanceof Error ? `Αποτυχία Gmail SMTP: ${error.message}` : "Αποτυχία Gmail SMTP."
      };
    }
  }

  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey || !emailFrom) {
    return {
      sent: false,
      reason: "Δεν έχουν οριστεί GMAIL_USER/GMAIL_APP_PASSWORD ή RESEND_API_KEY/EMAIL_FROM."
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
      reason: error instanceof Error ? `Αποτυχία Resend: ${error.message}` : "Αποτυχία Resend."
    };
  }

  if (!response.ok) {
    const details = await response.text();
    return { sent: false, reason: details.slice(0, 180) || "Αποτυχία αποστολής από τον email provider." };
  }

  return { sent: true, reason: "" };
}
