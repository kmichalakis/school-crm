import * as XLSX from "xlsx";
import { UserRole } from "@prisma/client";
import { hashPassword } from "../lib/password";
import { prisma } from "../lib/prisma";

const filePath = process.argv[2];
const apply = process.argv.includes("--apply");
const schoolYearName = "2026-2027";

if (!filePath) {
  throw new Error("Δώστε τη διαδρομή του αρχείου Excel.");
}

function value(cell: unknown) {
  return String(cell ?? "").trim();
}

function email(cell: unknown) {
  return value(cell).toLowerCase();
}

function personKey(surname: string, name: string) {
  return `${surname} ${name}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleUpperCase("el-GR")
    .replace(/[^A-ZΑ-Ω0-9]/g, "");
}

type SourceRow = {
  sheet: string;
  am: string;
  name: string;
  surname: string;
  firstEmail: string;
  secondEmail: string;
};

function sourceRows(): SourceRow[] {
  const workbook = XLSX.readFile(filePath);
  const rows: SourceRow[] = [];

  for (const sheet of workbook.SheetNames) {
    const table = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheet], { header: 1, defval: "" });
    const headerIndex = table.findIndex((row) => value(row[1]) === "Αριθμός μητρώου" && value(row[7]) === "eMail 2ου κηδεμόνα");
    if (headerIndex < 0) {
      throw new Error(`Δεν βρέθηκαν οι αναμενόμενες στήλες στο ${sheet}.`);
    }

    for (const row of table.slice(headerIndex + 1)) {
      const am = value(row[1]);
      if (!/^\d+$/.test(am)) continue;
      rows.push({
        sheet,
        am,
        surname: value(row[2]),
        name: value(row[3]),
        firstEmail: email(row[6]),
        secondEmail: email(row[7])
      });
    }
  }

  if (workbook.SheetNames.length !== 8) {
    throw new Error(`Αναμένονται 8 φύλλα, βρέθηκαν ${workbook.SheetNames.length}.`);
  }
  return rows;
}

async function main() {
  const rows = sourceRows();
  const year = await prisma.schoolYear.findFirst({ where: { name: schoolYearName } });
  if (!year) throw new Error(`Δεν βρέθηκε το σχολικό έτος ${schoolYearName}.`);

  const [students, parents, users] = await Promise.all([
    prisma.student.findMany({
      where: { schoolYearId: year.id },
      include: { parent: true, secondParent: true }
    }),
    prisma.parent.findMany({ select: { id: true, email: true, userId: true } }),
    prisma.user.findMany({ select: { id: true, username: true, role: true, parent: { select: { id: true } } } })
  ]);
  const studentsByAm = new Map(students.map((student) => [student.am, student]));
  const studentsByName = new Map<string, typeof students>();
  for (const student of students) {
    const key = personKey(student.surname, student.name);
    studentsByName.set(key, [...(studentsByName.get(key) ?? []), student]);
  }

  const unmatched: SourceRow[] = [];
  const assignments = new Map<string, { student: (typeof students)[number]; email: string; sheet: string }>();
  let sameEmail = 0;
  let alreadyLinked = 0;
  let matchedByName = 0;

  for (const row of rows) {
    if (!row.secondEmail) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.secondEmail)) {
      throw new Error(`Μη έγκυρο δεύτερο email στο ${row.sheet}, ΑΜ ${row.am}.`);
    }
    if (row.firstEmail === row.secondEmail) {
      sameEmail += 1;
      continue;
    }

    const key = personKey(row.surname, row.name);
    let student = studentsByAm.get(row.am);
    if (!student || personKey(student.surname, student.name) !== key) {
      const nameMatches = studentsByName.get(key) ?? [];
      if (nameMatches.length !== 1) {
        unmatched.push(row);
        continue;
      }
      student = nameMatches[0];
      matchedByName += 1;
    }

    if (student.parent?.email.trim().toLowerCase() === row.secondEmail || student.secondParent?.email.trim().toLowerCase() === row.secondEmail) {
      alreadyLinked += 1;
      continue;
    }
    if (student.secondParentId) {
      throw new Error(`Ο μαθητής ${student.am} έχει ήδη διαφορετικό δεύτερο γονέα.`);
    }
    if (!student.parentId) {
      throw new Error(`Ο μαθητής ${student.am} δεν έχει πρώτο γονέα στη βάση.`);
    }
    const existing = assignments.get(student.id);
    if (existing && existing.email !== row.secondEmail) {
      throw new Error(`Αντικρουόμενα δεύτερα email για τον μαθητή ${student.am}.`);
    }
    assignments.set(student.id, { student, email: row.secondEmail, sheet: row.sheet });
  }

  const parentByEmail = new Map(parents.map((parent) => [parent.email.trim().toLowerCase(), parent]));
  const userByEmail = new Map(users.map((user) => [user.username.trim().toLowerCase(), user]));
  const newParentEmails = new Set<string>();
  for (const assignment of assignments.values()) {
    if (parentByEmail.has(assignment.email)) continue;
    const existingUser = userByEmail.get(assignment.email);
    if (existingUser) {
      throw new Error(`Το email δεύτερου γονέα χρησιμοποιείται ήδη από άλλον λογαριασμό (${assignment.student.am}).`);
    }
    newParentEmails.add(assignment.email);
  }

  console.log(JSON.stringify({
    sheets: 8,
    sourceStudents: rows.length,
    secondEmails: rows.filter((row) => row.secondEmail).length,
    sameEmail,
    alreadyLinked,
    matchedByName,
    newParentAccounts: newParentEmails.size,
    studentLinks: assignments.size,
    unmatched: unmatched.map((row) => ({ sheet: row.sheet, am: row.am, surname: row.surname, name: row.name }))
  }, null, 2));
  if (!apply) return;

  if (unmatched.length > 0) {
    throw new Error("Υπάρχουν απροσδιόριστες γραμμές. Η εισαγωγή σταμάτησε χωρίς αλλαγές.");
  }

  const initialHashes = new Map<string, string>();
  for (const newEmail of newParentEmails) {
    const children = Array.from(assignments.values())
      .filter((assignment) => assignment.email === newEmail)
      .map((assignment) => assignment.student)
      .sort((a, b) => Number(a.am) - Number(b.am));
    const child = children[0];
    const initialPassword = `${child.surname[0]}${child.name[0]}`.toLocaleUpperCase("el-GR");
    initialHashes.set(newEmail, hashPassword(initialPassword));
  }

  await prisma.$transaction(async (tx) => {
    const resolvedParents = new Map(parentByEmail);
    for (const assignment of assignments.values()) {
      let parent = resolvedParents.get(assignment.email);
      if (!parent) {
        const user = await tx.user.create({
          data: {
            username: assignment.email,
            passwordHash: initialHashes.get(assignment.email)!,
            role: UserRole.PARENT,
            mustChangePassword: false
          }
        });
        parent = await tx.parent.create({ data: { email: assignment.email, userId: user.id } });
        resolvedParents.set(assignment.email, parent);
      }
      await tx.student.update({ where: { id: assignment.student.id }, data: { secondParentId: parent.id } });
    }
  }, { maxWait: 30000, timeout: 120000 });

  console.log(`Ολοκληρώθηκε: ${assignments.size} συνδέσεις δεύτερου γονέα.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
