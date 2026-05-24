import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

function sheet(rows: Record<string, string | number>[]) {
  return XLSX.utils.json_to_sheet(rows);
}

export async function GET() {
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    workbook,
    sheet([
      {
        "σχολικό έτος": "2025-2026",
        έναρξη: "2025-09-01",
        λήξη: "2026-06-30",
        ενεργό: "ναι"
      }
    ]),
    "Σχολικά έτη"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    sheet([
      {
        "σχολικό έτος": "2025-2026",
        τμήμα: "Α1",
        τάξη: "Α",
        admin: "T001",
        login: "a1-new",
        κωδικός: "School2027!"
      }
    ]),
    "Τμήματα"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    sheet([
      {
        ΑΜ: "T001",
        username: "n.teacher",
        κωδικός: "Teacher2027!",
        όνομα: "Νίκος",
        επώνυμο: "Δασκαλάκης",
        admin: "όχι"
      }
    ]),
    "Εκπαιδευτικοί"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    sheet([
      {
        username: "parent2",
        κωδικός: "Parent2027!",
        όνομα: "Ελένη",
        επώνυμο: "Παπαδοπούλου",
        email: "parent2@example.edu"
      }
    ]),
    "Γονείς"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    sheet([
      {
        ΑΜ: "S001",
        "σχολικό έτος": "2025-2026",
        τμήμα: "Α1",
        όνομα: "Μαρία",
        επώνυμο: "Παπαδοπούλου",
        πατρώνυμο: "Γεώργιος",
        γονέας: "parent2"
      }
    ]),
    "Μαθητές"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    sheet([
      {
        ΑΑ: "M001",
        "σχολικό έτος": "2025-2026",
        τμήμα: "Α1",
        μάθημα: "Πληροφορική",
        εκπαιδευτικός: "T001",
        κενό: "όχι"
      },
      {
        ΑΑ: "M002",
        "σχολικό έτος": "2025-2026",
        τμήμα: "Α1",
        μάθημα: "Τεχνολογία",
        εκπαιδευτικός: "T001",
        κενό: "όχι"
      }
    ]),
    "Μαθήματα"
  );

  XLSX.utils.book_append_sheet(
    workbook,
    sheet([
      {
        "σχολικό έτος": "2025-2026",
        τμήμα: "Α1",
        ημέρα: "Δευτέρα",
        ώρα: 2,
        "ΑΑ μαθήματος": "M001;M002"
      }
    ]),
    "Πρόγραμμα"
  );

  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const body = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(body).set(buffer);

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="school-import-template.xlsx"'
    }
  });
}
