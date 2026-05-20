"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
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

export async function changePasswordAction(formData: FormData) {
  const cookieStore = await cookies();
  const session = parseSessionToken(cookieStore.get(sessionCookieName)?.value);

  if (!session) {
    redirect("/");
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
