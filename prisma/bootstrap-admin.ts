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

  const schoolUsername = (process.env.SCHOOL_OFFICE_USERNAME ?? "school").trim().toLowerCase();
  const schoolPassword = (process.env.SCHOOL_OFFICE_PASSWORD ?? "school").trim();

  await prisma.user.upsert({
    where: { username: schoolUsername },
    update: {
      passwordHash: hashPassword(schoolPassword),
      role: UserRole.SCHOOL_OFFICE,
      mustChangePassword: false,
      failedLoginCount: 0,
      lockedUntil: null
    },
    create: {
      username: schoolUsername,
      passwordHash: hashPassword(schoolPassword),
      role: UserRole.SCHOOL_OFFICE,
      mustChangePassword: false
    }
  });

  console.log(`School office user is ready: ${schoolUsername}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
