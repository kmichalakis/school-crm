"use server";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { sendSystemEmail } from "@/lib/email";
import { hashPassword, validatePasswordPolicy, verifyPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { createSessionToken, parseSessionToken, sessionCookieName } from "@/lib/session";

const sessionDurationMs = 1000 * 60 * 60 * 10;

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function passwordPath(message: string, type: "success" | "error" = "success") {
  const params = new URLSearchParams({ notice: message, noticeType: type });
  return `/account/password?${params.toString()}`;
}

export async function requestParentPasswordChangeAction(formData: FormData) {
  const session = parseSessionToken((await cookies()).get(sessionCookieName)?.value);
  if (!session || session.role !== "PARENT") {
    redirect("/");
  }

  const currentPassword = text(formData, "currentPassword");
  const newPassword = text(formData, "newPassword");
  const confirmPassword = text(formData, "confirmPassword");
  if (!currentPassword || !newPassword || !confirmPassword) {
    redirect(passwordPath("Συμπληρώστε όλα τα πεδία.", "error"));
  }
  if (newPassword !== confirmPassword) {
    redirect(passwordPath("Οι νέοι κωδικοί δεν ταιριάζουν.", "error"));
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: { parent: true, passwordChangeRequest: true }
  });
  if (!user || user.role !== "PARENT" || !user.parent?.email) {
    redirect(passwordPath("Δεν βρέθηκε email για αυτόν τον λογαριασμό.", "error"));
  }
  if (!verifyPassword(currentPassword, user.passwordHash)) {
    redirect(passwordPath("Ο τρέχων κωδικός δεν είναι σωστός.", "error"));
  }
  if (newPassword === currentPassword) {
    redirect(passwordPath("Ο νέος κωδικός πρέπει να διαφέρει από τον τρέχοντα.", "error"));
  }

  const issues = validatePasswordPolicy(newPassword, user.username);
  if (issues.length > 0) {
    redirect(passwordPath(issues[0], "error"));
  }

  const now = new Date();
  if (user.passwordChangeRequest && now.getTime() - user.passwordChangeRequest.lastSentAt.getTime() < 60_000) {
    redirect(passwordPath("Περιμένετε ένα λεπτό πριν ζητήσετε νέο κωδικό επιβεβαίωσης.", "error"));
  }

  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const pendingPasswordHash = hashPassword(newPassword);
  const codeHash = hashPassword(code);
  const requestData = {
    passwordHash: pendingPasswordHash,
    codeHash,
    expiresAt: new Date(now.getTime() + 10 * 60_000),
    attempts: 0,
    lastSentAt: now
  };
  if (user.passwordChangeRequest) {
    const updated = await prisma.passwordChangeRequest.updateMany({
      where: { userId: user.id, lastSentAt: { lte: new Date(now.getTime() - 60_000) } },
      data: requestData
    });
    if (updated.count === 0) {
      redirect(passwordPath("Περιμένετε ένα λεπτό πριν ζητήσετε νέο κωδικό επιβεβαίωσης.", "error"));
    }
  } else {
    try {
      await prisma.passwordChangeRequest.create({ data: { userId: user.id, ...requestData } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        redirect(passwordPath("Περιμένετε ένα λεπτό πριν ζητήσετε νέο κωδικό επιβεβαίωσης.", "error"));
      }
      throw error;
    }
  }

  const result = await sendSystemEmail(
    user.parent.email,
    "Επιβεβαίωση αλλαγής κωδικού",
    `Ο κωδικός επιβεβαίωσης για την αλλαγή κωδικού σας είναι: ${code}\n\nΙσχύει για 10 λεπτά. Αν δεν ζητήσατε εσείς την αλλαγή, αγνοήστε αυτό το μήνυμα.`
  );
  if (!result.sent) {
    await prisma.passwordChangeRequest.deleteMany({ where: { userId: user.id, codeHash } });
    redirect(passwordPath("Δεν ήταν δυνατή η αποστολή email. Δοκιμάστε ξανά αργότερα ή επικοινωνήστε με το σχολείο.", "error"));
  }

  redirect(passwordPath("Στείλαμε εξαψήφιο κωδικό επιβεβαίωσης στο email του λογαριασμού σας."));
}

export async function confirmParentPasswordChangeAction(formData: FormData) {
  const cookieStore = await cookies();
  const session = parseSessionToken(cookieStore.get(sessionCookieName)?.value);
  if (!session || session.role !== "PARENT") {
    redirect("/");
  }

  const code = text(formData, "verificationCode");
  const request = await prisma.passwordChangeRequest.findUnique({ where: { userId: session.userId } });
  if (!request || request.expiresAt <= new Date() || request.attempts >= 5) {
    redirect(passwordPath("Ο κωδικός επιβεβαίωσης έληξε. Ζητήστε νέο κωδικό.", "error"));
  }

  if (!verifyPassword(code, request.codeHash)) {
    await prisma.passwordChangeRequest.updateMany({
      where: { userId: session.userId, codeHash: request.codeHash, attempts: { lt: 5 } },
      data: { attempts: { increment: 1 } }
    });
    redirect(passwordPath("Λάθος κωδικός επιβεβαίωσης. Δοκιμάστε ξανά.", "error"));
  }

  const changed = await prisma.$transaction(async (tx) => {
    const claimed = await tx.passwordChangeRequest.deleteMany({
      where: { userId: session.userId, codeHash: request.codeHash, expiresAt: { gt: new Date() }, attempts: { lt: 5 } }
    });
    if (claimed.count === 0) return false;
    await tx.user.update({
      where: { id: session.userId },
      data: { passwordHash: request.passwordHash, mustChangePassword: false, failedLoginCount: 0, lockedUntil: null }
    });
    return true;
  });
  if (!changed) {
    redirect(passwordPath("Ο κωδικός επιβεβαίωσης έληξε. Ζητήστε νέο κωδικό.", "error"));
  }

  cookieStore.set(sessionCookieName, createSessionToken({
    ...session,
    mustChangePassword: false,
    expiresAt: Date.now() + sessionDurationMs
  }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: sessionDurationMs / 1000
  });

  revalidatePath("/");
  const params = new URLSearchParams({ notice: "Ο κωδικός άλλαξε επιτυχώς." });
  redirect(`/parent?${params.toString()}`);
}

export async function changePasswordAction(formData: FormData) {
  const cookieStore = await cookies();
  const session = parseSessionToken(cookieStore.get(sessionCookieName)?.value);

  if (!session) {
    redirect("/");
  }

  if (session.role === "PARENT") {
    redirect(passwordPath("Η αλλαγή κωδικού γονέα απαιτεί επιβεβαίωση μέσω email.", "error"));
  }

  const currentPassword = text(formData, "currentPassword");
  const newPassword = text(formData, "newPassword");
  const confirmPassword = text(formData, "confirmPassword");

  if (newPassword !== confirmPassword) {
    redirect(passwordPath("Οι νέοι κωδικοί δεν ταιριάζουν.", "error"));
  }

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user) {
    redirect("/");
  }

  if (!verifyPassword(currentPassword, user.passwordHash)) {
    redirect(passwordPath("Ο τρέχων κωδικός δεν είναι σωστός.", "error"));
  }

  const issues = validatePasswordPolicy(newPassword, user.username);
  if (issues.length > 0) {
    redirect(passwordPath(issues[0], "error"));
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: hashPassword(newPassword),
      mustChangePassword: false,
      failedLoginCount: 0,
      lockedUntil: null
    }
  });

  const token = createSessionToken({
    userId: user.id,
    username: user.username,
    role: user.role,
    classId: user.classId,
    mustChangePassword: false,
    expiresAt: Date.now() + sessionDurationMs
  });

  cookieStore.set(sessionCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: sessionDurationMs / 1000
  });

  revalidatePath("/");
  redirect(passwordPath("Ο κωδικός άλλαξε επιτυχώς."));
}
