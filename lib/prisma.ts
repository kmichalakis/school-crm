import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

const pooledUrl = process.env.DATABASE_POOL_URL?.trim() || process.env.DATABASE_URL_POOLED?.trim();

export const prisma = globalForPrisma.prisma ?? new PrismaClient(
  pooledUrl ? { datasources: { db: { url: pooledUrl } } } : undefined
);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
