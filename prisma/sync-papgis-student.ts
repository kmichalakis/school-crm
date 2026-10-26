import * as XLSX from "xlsx";
import { prisma } from "../lib/prisma";

const workbookPath = process.argv[2];
const apply = process.argv.includes("--apply");

if (!workbookPath) {
  throw new Error("Δώστε τη διαδρομή του rptList.xlsx.");
}

async function main() {
  const workbook = XLSX.readFile(workbookPath);
  const row = XLSX.utils
    .sheet_to_json<unknown[]>(workbook.Sheets.Sheet2, { header: 1, defval: "" })
    .find((values) => String(values[2]).trim() === "ΠΑΠΓΗΣ" && String(values[3]).trim() === "ΠΑΝΑΓΙΩΤΗΣ");
  if (!row) throw new Error("Δεν βρέθηκε ο ΠΑΠΓΗΣ ΠΑΝΑΓΙΩΤΗΣ στο Excel.");

  const email = String(row[6]).trim().toLowerCase();
  const secondEmail = String(row[7]).trim().toLowerCase();
  if (!email || email !== secondEmail) {
    throw new Error("Τα δύο email της γραμμής πρέπει να είναι ίδια και μη κενά.");
  }

  const year = await prisma.schoolYear.findFirstOrThrow({ where: { name: "2026-2027" } });
  const schoolClass = await prisma.class.findUniqueOrThrow({
    where: { schoolYearId_name: { schoolYearId: year.id, name: "Α3" } }
  });
  const parent = await prisma.parent.findFirstOrThrow({
    where: { email: { equals: email, mode: "insensitive" } }
  });
  const existing = await prisma.student.findUnique({
    where: { schoolYearId_am: { schoolYearId: year.id, am: "4241" } }
  });
  const expected = {
    am: "4241",
    name: String(row[3]).trim(),
    surname: String(row[2]).trim(),
    patronymic: String(row[5]).trim(),
    classId: schoolClass.id,
    schoolYearId: year.id,
    parentId: parent.id
  };

  if (existing) {
    const matches = Object.entries(expected).every(([key, value]) => existing[key as keyof typeof expected] === value);
    if (!matches || existing.secondParentId) {
      throw new Error("Ο ΑΜ 4241 υπάρχει ήδη με διαφορετικά στοιχεία. Δεν έγινε αλλαγή.");
    }
    console.log("Ο μαθητής 4241 υπάρχει ήδη με τα σωστά στοιχεία.");
    return;
  }

  const duplicateName = await prisma.student.findFirst({
    where: { schoolYearId: year.id, name: expected.name, surname: expected.surname }
  });
  if (duplicateName) {
    throw new Error(`Ο μαθητής υπάρχει ήδη με ΑΜ ${duplicateName.am}. Δεν έγινε αλλαγή.`);
  }

  if (!apply) {
    console.log("Έτοιμο για δημιουργία: ΠΑΠΓΗΣ ΠΑΝΑΓΙΩΤΗΣ, ΑΜ 4241, Α3, υπάρχων γονέας.");
    return;
  }

  await prisma.student.create({ data: expected });
  console.log("Δημιουργήθηκε ο μαθητής 4241 στο Α3.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
