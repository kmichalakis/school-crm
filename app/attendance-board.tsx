"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BarChart3,
  CalendarDays,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  History,
  FileSpreadsheet,
  LockKeyhole,
  Mail,
  Printer,
  Save,
  ShieldCheck,
  UserRound,
  UsersRound
} from "lucide-react";
import { currentContext, demoClass, demoCourses, demoStudents } from "@/lib/demo-data";
import { schoolHours, weekDays } from "@/lib/school-time";
import type { AttendanceSheetPayload, SaveAttendanceAction } from "@/lib/attendance-types";

type UserMode = "tablet" | "teacher";
type DatabaseStatus = "unknown" | "ready" | "fallback";

type AttendanceBoardProps = {
  initialMode: UserMode;
  userLabel: string;
  username: string;
  initialClassId: string;
  initialDay: string;
  initialHour: number;
  availableClasses: Array<{
    id: string;
    name: string;
    grade: string;
    schoolYear: string;
  }>;
  isAdmin: boolean;
};

const storageKey = "school-crm-attendance-sheets-v1";

function formatSavedAt(date: Date) {
  return new Intl.DateTimeFormat("el-GR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

function getSheetKey(classId: string, day: string, hour: number) {
  return `${classId}:${day}:${hour}`;
}

function createDefaultSheet(day: string, hour: number): AttendanceSheetPayload {
  return {
    day,
    hour,
    course: currentContext.course,
    courses: demoCourses,
    teacherName: currentContext.teacher,
    students: demoStudents,
    signedAt: null,
    savedAt: null,
    dirty: false
  };
}

function readStoredSheets() {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const storedValue = window.localStorage.getItem(storageKey);
    if (!storedValue) {
      return {};
    }

    return JSON.parse(storedValue) as Record<string, AttendanceSheetPayload>;
  } catch {
    return {};
  }
}

function writeStoredSheets(sheets: Record<string, AttendanceSheetPayload>) {
  window.localStorage.setItem(storageKey, JSON.stringify(sheets));
}

async function fetchAttendanceSheet(classId: string, day: string, hour: number) {
  const params = new URLSearchParams({
    classId,
    day,
    hour: String(hour)
  });
  const response = await fetch(`/api/attendance?${params.toString()}`);

  if (!response.ok) {
    throw new Error("Η βάση δεν επέστρεψε απουσιολόγιο.");
  }

  return (await response.json()) as AttendanceSheetPayload;
}

async function persistAttendanceSheet(classId: string, sheet: AttendanceSheetPayload, action: SaveAttendanceAction) {
  const response = await fetch("/api/attendance", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      ...sheet,
      classId,
      action
    })
  });

  if (!response.ok) {
    throw new Error("Η βάση δεν αποθήκευσε το απουσιολόγιο.");
  }

  return (await response.json()) as AttendanceSheetPayload;
}

export function AttendanceBoard({
  initialMode,
  userLabel,
  username,
  initialClassId,
  initialDay,
  initialHour,
  availableClasses,
  isAdmin
}: AttendanceBoardProps) {
  const [mode] = useState<UserMode>(initialMode);
  const [selectedClassId, setSelectedClassId] = useState(initialClassId);
  const [selectedDay, setSelectedDay] = useState(initialDay);
  const [selectedHour, setSelectedHour] = useState(initialHour);
  const [sheets, setSheets] = useState<Record<string, AttendanceSheetPayload>>(() => ({
    [getSheetKey(initialClassId, initialDay, initialHour)]: createDefaultSheet(initialDay, initialHour)
  }));
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [databaseStatus, setDatabaseStatus] = useState<DatabaseStatus>("unknown");
  const [isSyncing, setIsSyncing] = useState(false);
  const [message, setMessage] = useState("Δεν υπάρχουν μη αποθηκευμένες αλλαγές.");

  useEffect(() => {
    const storedSheets = readStoredSheets();
    if (Object.keys(storedSheets).length > 0) {
      setSheets(storedSheets);
      setMessage("Φορτώθηκαν τα αποθηκευμένα πρόχειρα από τη συσκευή.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadFromDatabase() {
      setIsSyncing(true);
      try {
        const payload = await fetchAttendanceSheet(selectedClassId, selectedDay, selectedHour);
        if (cancelled) {
          return;
        }

        setSheets((currentSheets) => {
          const nextSheets = {
            ...currentSheets,
            [getSheetKey(selectedClassId, selectedDay, selectedHour)]: payload
          };
          writeStoredSheets(nextSheets);
          return nextSheets;
        });
        setDatabaseStatus("ready");
        setMessage("Το απουσιολόγιο φορτώθηκε από τη βάση δεδομένων.");
      } catch {
        if (cancelled) {
          return;
        }

        setDatabaseStatus("fallback");
        setMessage("Η βάση δεν είναι διαθέσιμη. Προσωρινά χρησιμοποιείται αποθήκευση στη συσκευή.");
      } finally {
        if (!cancelled) {
          setIsSyncing(false);
        }
      }
    }

    void loadFromDatabase();

    return () => {
      cancelled = true;
    };
  }, [selectedClassId, selectedDay, selectedHour]);

  const selectedSheetKey = getSheetKey(selectedClassId, selectedDay, selectedHour);
  const currentSheet = sheets[selectedSheetKey] ?? createDefaultSheet(selectedDay, selectedHour);
  const currentClass = availableClasses.find((classRecord) => classRecord.id === selectedClassId) ?? availableClasses[0] ?? demoClass;
  const courseOptions = useMemo(() => {
    const storedCourses = currentSheet.courses && currentSheet.courses.length > 0 ? currentSheet.courses : demoCourses;
    return Array.from(new Set([currentSheet.course, ...storedCourses, "ΚΕΝΟ"].filter(Boolean)));
  }, [currentSheet.course, currentSheet.courses]);

  const selectedDayLabel = useMemo(
    () => weekDays.find((day) => day.value === selectedDay)?.label ?? "Δευτέρα",
    [selectedDay]
  );
  const selectedHourLabel = useMemo(
    () => schoolHours.find((slot) => slot.hour === selectedHour)?.label ?? "1η ώρα",
    [selectedHour]
  );
  const absentCount = currentSheet.students.filter((student) => student.absent).length;
  const isTeacher = mode === "teacher";
  const isSigned = currentSheet.signedAt !== null;
  const canEdit = !isSigned || isTeacher;
  const signedAtDate = currentSheet.signedAt ? new Date(currentSheet.signedAt) : null;
  const savedAtDate = currentSheet.savedAt ? new Date(currentSheet.savedAt) : null;
  const selectedStudent = currentSheet.students.find((student) => student.id === selectedStudentId) ?? null;
  const selectedStudentHistory = selectedStudent
    ? Object.values(sheets)
        .filter((sheet) => sheet.students.some((student) => student.id === selectedStudent.id && student.absent))
        .sort((first, second) => first.day.localeCompare(second.day) || first.hour - second.hour)
    : [];

  function updateCurrentSheet(updater: (sheet: AttendanceSheetPayload) => AttendanceSheetPayload) {
    setSheets((currentSheets) => {
      const activeSheet = currentSheets[selectedSheetKey] ?? createDefaultSheet(selectedDay, selectedHour);
      return {
        ...currentSheets,
        [selectedSheetKey]: updater(activeSheet)
      };
    });
  }

  function toggleStudentAbsence(studentId: string) {
    if (!canEdit) {
      setMessage("Το υπογεγραμμένο απουσιολόγιο δεν αλλάζει από το tablet τάξης.");
      return;
    }

    updateCurrentSheet((sheet) => ({
      ...sheet,
      savedAt: null,
      signedAt: sheet.signedAt && isTeacher ? null : sheet.signedAt,
      dirty: true,
      students: sheet.students.map((student) =>
        student.id === studentId ? { ...student, absent: !student.absent } : student
      )
    }));
    setMessage("Υπάρχουν μη αποθηκευμένες αλλαγές.");
  }

  async function saveDraft() {
    const now = new Date();
    const optimisticSheet = {
      ...currentSheet,
      savedAt: now.toISOString(),
      dirty: false
    };
    const nextSheets = {
      ...sheets,
      [selectedSheetKey]: optimisticSheet
    };

    setSheets(nextSheets);
    writeStoredSheets(nextSheets);
    setIsSyncing(true);

    try {
      const persistedSheet = await persistAttendanceSheet(selectedClassId, optimisticSheet, "draft");
      setSheets((currentSheets) => {
        const syncedSheets = {
          ...currentSheets,
          [selectedSheetKey]: persistedSheet
        };
        writeStoredSheets(syncedSheets);
        return syncedSheets;
      });
      setDatabaseStatus("ready");
      setMessage(`Το πρόχειρο αποθηκεύτηκε στη βάση στις ${formatSavedAt(now)}.`);
    } catch {
      setDatabaseStatus("fallback");
      setMessage(`Το πρόχειρο αποθηκεύτηκε μόνο στη συσκευή στις ${formatSavedAt(now)}.`);
    } finally {
      setIsSyncing(false);
    }
  }

  async function signAttendanceSheet() {
    if (!isTeacher) {
      setMessage("Μόνο εκπαιδευτικός μπορεί να υπογράψει το απουσιολόγιο.");
      return;
    }

    const now = new Date();
    const optimisticSheet = {
      ...currentSheet,
      signedAt: now.toISOString(),
      savedAt: now.toISOString(),
      dirty: false
    };
    const nextSheets = {
      ...sheets,
      [selectedSheetKey]: optimisticSheet
    };

    setSheets(nextSheets);
    writeStoredSheets(nextSheets);
    setIsSyncing(true);

    try {
      const persistedSheet = await persistAttendanceSheet(selectedClassId, optimisticSheet, "sign");
      setSheets((currentSheets) => {
        const syncedSheets = {
          ...currentSheets,
          [selectedSheetKey]: persistedSheet
        };
        writeStoredSheets(syncedSheets);
        return syncedSheets;
      });
      setDatabaseStatus("ready");
      setMessage(`Το απουσιολόγιο υπογράφηκε στη βάση από ${currentSheet.teacherName} στις ${formatSavedAt(now)}.`);
    } catch {
      setDatabaseStatus("fallback");
      setMessage(`Το απουσιολόγιο υπογράφηκε μόνο στη συσκευή από ${currentSheet.teacherName} στις ${formatSavedAt(now)}.`);
    } finally {
      setIsSyncing(false);
    }
  }

  function setNoCourse() {
    updateCurrentSheet((sheet) => ({
      ...sheet,
      course: "ΚΕΝΟ",
      savedAt: null,
      signedAt: sheet.signedAt && isTeacher ? null : sheet.signedAt,
      dirty: true
    }));
    setMessage("Ορίστηκε ΚΕΝΟ για την επιλεγμένη ώρα.");
  }

  function reopenSignedSheet() {
    updateCurrentSheet((sheet) => ({
      ...sheet,
      signedAt: null,
      savedAt: null,
      dirty: true
    }));
    setMessage("Το απουσιολόγιο άνοιξε ξανά για διόρθωση από εκπαιδευτικό.");
  }

  function clearCurrentSheet() {
    const nextSheets = {
      ...sheets,
      [selectedSheetKey]: createDefaultSheet(selectedDay, selectedHour)
    };
    setSheets(nextSheets);
    writeStoredSheets(nextSheets);
    setMessage("Το απουσιολόγιο της επιλεγμένης ώρας επανήλθε στην αρχική κατάσταση.");
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.reload();
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">ΣΧ</div>
          <div>
            <h1>Σχολικό CRM</h1>
            <span>Διαχείριση παρουσιών και απουσιών</span>
          </div>
        </div>
        <div className="user-chip">
          <ShieldCheck size={17} />
          {userLabel}
        </div>
        {isAdmin ? (
          <Link className="secondary-button" href="/admin">
            Διαχείριση
          </Link>
        ) : null}
        <button className="secondary-button" onClick={logout} type="button">
          Αποσύνδεση
        </button>
      </header>

      <div className="workspace">
        <nav className="sidebar" aria-label="Κύρια πλοήγηση">
          <button className="nav-button active">
            <ClipboardCheck size={18} />
            Απουσιολόγιο
          </button>
          <Link className="nav-button" href="/students">
            <UsersRound size={18} />
            Μαθητές
          </Link>
          <Link className="nav-button" href="/teacher">
            <CalendarClock size={18} />
            Σήμερα
          </Link>
          <Link className="nav-button" href="/dashboard">
            <BarChart3 size={18} />
            Dashboard
          </Link>
          <Link className="nav-button" href="/reports">
            <BarChart3 size={18} />
            Αναφορές τάξης
          </Link>
          <Link className="nav-button" href="/api/reports/export">
            <FileSpreadsheet size={18} />
            Εξαγωγές
          </Link>
          <Link className="nav-button" href="/notifications">
            <Mail size={18} />
            Κανόνες ειδοποιήσεων
          </Link>
          <Link className="nav-button" href="/schedule">
            <CalendarDays size={18} />
            Πρόγραμμα
          </Link>
          <Link className="nav-button" href="/print">
            <Printer size={18} />
            Εκτυπώσεις
          </Link>
        </nav>

        <section className="main-grid">
          <div className="page-header">
            <div>
              <h2>Απουσιολόγιο τάξης {currentClass.name}</h2>
              <p>
                Σχολικό έτος {currentClass.schoolYear}, Τάξη {currentClass.grade}. Το τάμπλετ της τάξης ανοίγει απευθείας αυτή την οθόνη.
              </p>
            </div>
            <div className="status-row">
              <span className="pill">
                <CalendarClock size={15} />
                {selectedDayLabel}, {selectedHourLabel}
              </span>
              <span className="pill">
                <UserRound size={15} />
                {currentSheet.teacherName}
              </span>
            </div>
          </div>

          <section className="panel mode-panel">
            <div className="mode-control" aria-label="Επιλογή ρόλου χρήστη">
              <span className={mode === "teacher" ? "mode-button active" : "mode-button"}>Εκπαιδευτικός</span>
              <span className={mode === "tablet" ? "mode-button active" : "mode-button"}>Τάμπλετ τάξης</span>
            </div>
            <p>{isTeacher ? "Μπορεί να καταχωρίσει, να αποθηκεύσει και να υπογράψει." : "Μπορεί να καταχωρίσει απουσίες, αλλά όχι να υπογράψει."}</p>
            <span className={databaseStatus === "ready" ? "sync-pill ready" : "sync-pill"}>
              {isSyncing ? "Συγχρονισμός..." : databaseStatus === "ready" ? "Βάση δεδομένων ενεργή" : databaseStatus === "fallback" ? "Τοπική αποθήκευση" : "Έλεγχος βάσης"}
            </span>
            <span className="sync-pill ready">Χρήστης: {username}</span>
          </section>

          {isAdmin ? (
            <section className="panel admin-class-switch">
              <div className="field">
                <label htmlFor="adminClassId">Τμήμα εργασίας admin</label>
                <select
                  id="adminClassId"
                  value={selectedClassId}
                  onChange={(event) => {
                    setSelectedClassId(event.target.value);
                    setSelectedStudentId(null);
                    setMessage("Ο admin άλλαξε τμήμα εργασίας.");
                  }}
                >
                  {availableClasses.map((classRecord) => (
                    <option key={classRecord.id} value={classRecord.id}>
                      {classRecord.name} ({classRecord.schoolYear})
                    </option>
                  ))}
                </select>
              </div>
            </section>
          ) : null}

          <div className="summary-grid">
            <div className="panel metric">
              <span>Μαθητές</span>
              <strong>{currentSheet.students.length}</strong>
            </div>
            <div className="panel metric">
              <span>Καταχωρισμένες απουσίες</span>
              <strong>{absentCount}</strong>
            </div>
            <div className="panel metric">
              <span>Υπογραφή</span>
              <strong>{isSigned ? "Υπογεγραμμένο" : "Ανοιχτό"}</strong>
            </div>
            <div className="panel metric">
              <span>Κατάσταση</span>
              <strong>{currentSheet.dirty ? "Πρόχειρο" : savedAtDate ? "Αποθηκευμένο" : "Νέο"}</strong>
            </div>
          </div>

          <section className="panel">
            <div className="controls">
              <div className="field">
                <label htmlFor="day">Ημέρα</label>
                <select
                  id="day"
                  value={selectedDay}
                  onChange={(event) => {
                    setSelectedDay(event.target.value);
                    setMessage("Φορτώθηκε το απουσιολόγιο της επιλεγμένης ημέρας.");
                  }}
                >
                  {weekDays.map((day) => (
                    <option key={day.value} value={day.value}>
                      Ημέρα {day.number}: {day.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="hour">Ώρα</label>
                <select
                  id="hour"
                  value={selectedHour}
                  onChange={(event) => {
                    setSelectedHour(Number(event.target.value));
                    setMessage("Φορτώθηκε το απουσιολόγιο της επιλεγμένης ώρας.");
                  }}
                >
                  {schoolHours.map((slot) => (
                    <option key={slot.hour} value={slot.hour}>
                      {slot.label}: {slot.starts}-{slot.ends}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="course">Μάθημα</label>
                <select
                  id="course"
                  value={currentSheet.course}
                  disabled={!canEdit}
                  onChange={(event) => {
                    updateCurrentSheet((sheet) => ({
                      ...sheet,
                      course: event.target.value,
                      savedAt: null,
                      signedAt: sheet.signedAt && isTeacher ? null : sheet.signedAt,
                      dirty: true
                    }));
                    setMessage("Υπάρχουν μη αποθηκευμένες αλλαγές.");
                  }}
                >
                  {courseOptions.map((course) => (
                    <option key={course} value={course}>
                      {course}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="teacher">Εκπαιδευτικός</label>
                <input
                  id="teacher"
                  value={currentSheet.teacherName}
                  disabled={!canEdit}
                  onChange={(event) => {
                    updateCurrentSheet((sheet) => ({
                      ...sheet,
                      teacherName: event.target.value,
                      savedAt: null,
                      signedAt: sheet.signedAt && isTeacher ? null : sheet.signedAt,
                      dirty: true
                    }));
                    setMessage("Υπάρχουν μη αποθηκευμένες αλλαγές.");
                  }}
                />
              </div>
            </div>
          </section>

          <section className="panel attendance-panel">
            <div className="panel-title">
              <h3>Μαθητές</h3>
              <span className={isSigned ? "pill signed-pill" : "pill"}>
                {isSigned ? <LockKeyhole size={15} /> : <CheckCircle2 size={15} />}
                {signedAtDate ? `Υπογραφή ${formatSavedAt(signedAtDate)}` : "Ο εκπαιδευτικός υπογράφει μετά τον έλεγχο"}
              </span>
            </div>

            <div className="student-list">
              {currentSheet.students.map((student) => (
                <div className="student-row" key={student.id}>
                  <div className="student-name">
                    <strong>
                      {student.surname} {student.name}
                    </strong>
                    <span>{student.code}</span>
                  </div>
                  <button
                    className={`absence-toggle${student.absent ? " marked" : ""}`}
                    onClick={() => toggleStudentAbsence(student.id)}
                    type="button"
                  >
                    {student.absent ? "Απών/Απούσα" : "Παρών/Παρούσα"}
                  </button>
                  <button
                    className="icon-button"
                    title="Ιστορικό μαθητή"
                    aria-label={`Άνοιγμα ιστορικού για ${student.name}`}
                    onClick={() => setSelectedStudentId(student.id)}
                    type="button"
                  >
                    <History size={18} />
                  </button>
                </div>
              ))}
            </div>

            {selectedStudent ? (
              <div className="student-history">
                <div>
                  <strong>
                    Ιστορικό απουσιών: {selectedStudent.surname} {selectedStudent.name}
                  </strong>
                  <span>
                    {selectedStudentHistory.length > 0
                      ? `${selectedStudentHistory.length} αποθηκευμένες/τρέχουσες εγγραφές`
                      : "Δεν υπάρχουν απουσίες για τον μαθητή στα ανοιγμένα φύλλα."}
                  </span>
                </div>
                <div className="history-list">
                  {selectedStudentHistory.map((sheet) => (
                    <span className="history-chip" key={`${sheet.day}-${sheet.hour}`}>
                      {weekDays.find((day) => day.value === sheet.day)?.label}, {schoolHours.find((slot) => slot.hour === sheet.hour)?.label}
                    </span>
                  ))}
                </div>
                <button className="icon-button" onClick={() => setSelectedStudentId(null)} title="Κλείσιμο ιστορικού" type="button">
                  ×
                </button>
              </div>
            ) : null}

            <div className="status-message" role="status">
              <span>{message}</span>
              {savedAtDate ? <strong>Τελευταία αποθήκευση: {formatSavedAt(savedAtDate)}</strong> : null}
            </div>

            <div className="teacher-actions">
              <button className="secondary-button danger" disabled={!canEdit} onClick={setNoCourse} type="button">
                Ορισμός ΚΕΝΟΥ
              </button>
              <button className="secondary-button" disabled={isSyncing} onClick={saveDraft} type="button">
                <Save size={18} />
                Αποθήκευση πρόχειρου
              </button>
              {isSigned && isTeacher ? (
                <button className="secondary-button" onClick={reopenSignedSheet} type="button">
                  Άνοιγμα για διόρθωση
                </button>
              ) : null}
              <button className="secondary-button" disabled={!canEdit} onClick={clearCurrentSheet} type="button">
                Επαναφορά ώρας
              </button>
              <button className="primary-button" disabled={!isTeacher || isSigned || isSyncing} onClick={signAttendanceSheet} type="button">
                <CheckCircle2 size={18} />
                Υπογραφή απουσιολογίου
              </button>
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
