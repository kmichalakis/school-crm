CREATE TABLE "SchoolSetting" (
  "id" TEXT NOT NULL,
  "screenManagerEmail" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SchoolSetting_pkey" PRIMARY KEY ("id")
);
