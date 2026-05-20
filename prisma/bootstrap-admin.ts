import { UserRole } from "@prisma/client";
import { hashPassword } from "../lib/password";
import { prisma } from "../lib/prisma";

async function main() {
  const username = (process.env.ADMIN_USERNAME ?? "admin").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD?.trim();

  if (!password) {
    console.log("ADMIN_PASSWORD is not set. Skipping admin bootstrap.");
    return;
  }

  await prisma.user.upsert({
    where: { username },
    update: {
      passwordHash: hashPassword(password),
      role: UserRole.ADMIN,
      mustChangePassword: false,
      failedLoginCount: 0,
      lockedUntil: null
    },
    create: {
      username,
      passwordHash: hashPassword(password),
      role: UserRole.ADMIN,
      mustChangePassword: false
    }
  });

  console.log(`Admin user is ready: ${username}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
