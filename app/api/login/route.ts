import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import { createSessionToken, sessionCookieName } from "@/lib/session";

const sessionDurationMs = 1000 * 60 * 60 * 10;
const lockDurationMs = 1000 * 60 * 15;
const maxFailedAttempts = 5;

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { username?: string; password?: string };
  const username = body.username?.trim().toLowerCase();
  const password = body.password ?? "";

  if (!username || !password) {
    return NextResponse.json({ error: "Λείπουν στοιχεία σύνδεσης." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { username }
  });

  if (!user) {
    return NextResponse.json({ error: "Λάθος όνομα χρήστη ή κωδικός." }, { status: 401 });
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return NextResponse.json({ error: "Ο λογαριασμός είναι προσωρινά κλειδωμένος. Δοκιμάστε αργότερα." }, { status: 423 });
  }

  if (!verifyPassword(password, user.passwordHash)) {
    const failedLoginCount = user.failedLoginCount + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount,
        lockedUntil: failedLoginCount >= maxFailedAttempts ? new Date(Date.now() + lockDurationMs) : null
      }
    });

    return NextResponse.json({ error: "Λάθος όνομα χρήστη ή κωδικός." }, { status: 401 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: new Date()
    }
  });

  const token = createSessionToken({
    userId: user.id,
    username: user.username,
    role: user.role,
    classId: user.classId,
    mustChangePassword: user.mustChangePassword,
    expiresAt: Date.now() + sessionDurationMs
  });

  const response = NextResponse.json({ ok: true, mustChangePassword: user.mustChangePassword });
  response.cookies.set(sessionCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: sessionDurationMs / 1000
  });

  return response;
}
