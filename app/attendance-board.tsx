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
  Minus,
  Plus,
  Printer,
  Save,
  ShieldCheck,
  UserRound,
  UsersRound
} from "lucide-react";
import { currentContext, demoClass, demoCourses, demoStudents } from "@/lib/demo-data";
import { schoolHours, weekDays } from "@/lib/school-time";
import type { AttendanceCourseEntry, AttendanceCourseOption, AttendanceSheetPayload, SaveAttendanceAction } from "@/lib/attendance-types";

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
  const defaultCourseOption = {
    courseId: "demo-course",
    name: currentContext.course,
    teacherId: "demo-teacher",
    teacherName: currentContext.teacher
  };

  return {
    day,
    hour,
    course: currentContext.course,
    courses: demoCourses,
    courseOptions: [defaultCourseOption],
    courseEntries: [{ ...defaultCourseOption, position: 0, signedAt: null }],
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

function fallbackCourseOptions(sheet: AttendanceSheetPayload): AttendanceCourseOption[] {
  if (sheet.courseOptions && sheet.courseOptions.length > 0) {
    return sheet.courseOptions;
  }

  return (sheet.courses && sheet.courses.length > 0 ? sheet.courses : demoCourses).map((courseName, index) => ({
    courseId: courseName === sheet.course ? "legacy-current-course" : `legacy-course-${index}`,
    name: courseName,
    teacherId: null,
    teacherName: courseName === sheet.course ? sheet.teacherName : "Δεν έχει οριστεί εκπαιδευτικός"
  }));
}

function normalizedCourseEntries(sheet: AttendanceSheetPayload): AttendanceCourseEntry[] {
  if (sheet.courseEntries && sheet.courseEntries.length > 0) {
    return sheet.courseEntries.slice(0, 2).map((entry, index) => ({
      ...entry,
      position: index
    }));
  }

  const options = fallbackCourseOptions(sheet);
  const selectedOption = options.find((option) => option.name === sheet.course) ?? options[0];
  if (!selectedOption) {
    return [];
  }

  return [
    {
      ...selectedOption,
      position: 0,
      signedAt: sheet.signedAt
    }
  ];
}

function sheetWithCourseEntries(sheet: AttendanceSheetPayload, courseEntries: AttendanceCourseEntry[]): AttendanceSheetPayload {
  const teacherNames = Array.from(new Set(courseEntries.map((entry) => entry.teacherName).filter(Boolean)));
  const fullSignedAt =
    courseEntries.length > 0 && courseEntries.every((entry) => entry.signedAt)
      ? courseEntries
          .map((entry) => entry.signedAt)
          .filter((signedAt): signedAt is string => signedAt !== null)
          .sort()
          .at(-1) ?? null
      : null;

  return {
    ...sheet,
    course: courseEntries.map((entry) => entry.name).join(" / ") || sheet.course,
    courseEntries,
    teacherName: teacherNames.join(" / ") || sheet.teacherName,
    signedAt: fullSignedAt
  };
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

async function persistAttendanceSheet(
  classId: string,
  sheet: AttendanceSheetPayload,
  action: SaveAttendanceAction,
  signaturePasswords?: Record<string, string>
) {
  const response = await fetch("/api/attendance", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      ...sheet,
      classId,
      action,
      signaturePasswords
    })
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? "Η βάση δεν αποθήκευσε το απουσιολόγιο.");
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
  const [isSignatureDialogOpen, setIsSignatureDialogOpen] = useState(false);
  const [signaturePasswords, setSignaturePasswords] = useState<Record<string, string>>({});

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
  const courseOptions = useMemo(() => fallbackCourseOptions(currentSheet), [currentSheet]);
  const currentCourseEntries = useMemo(() => normalizedCourseEntries(currentSheet), [currentSheet]);

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
  const isClassTablet = mode === "tablet" && !isAdmin;
  const signedCourseCount = currentCourseEntries.filter((entry) => entry.signedAt).length;
  const hasAnySignature = signedCourseCount > 0;
  const isSigned = currentCourseEntries.length > 0 && signedCourseCount === currentCourseEntries.length;
  const signatureStatus = isSigned ? "Υπογεγραμμένο" : hasAnySignature ? `Μερική (${signedCourseCount}/${currentCourseEntries.length})` : "Ανοιχτό";
  const canEdit = !hasAnySignature || isTeacher;
  const canSign = (isTeacher || isClassTablet) && !isSigned && !isSyncing;
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
    const optimisticSheet = sheetWithCourseEntries({
      ...currentSheet,
      savedAt: now.toISOString(),
      dirty: false
    }, currentCourseEntries);
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

  async function signAttendanceSheet(passwords?: Record<string, string>) {
    if (!isTeacher && !isClassTablet) {
      setMessage("Μόνο εκπαιδευτικός ή τάμπλετ τάξης μπορεί να ξεκινήσει υπογραφή.");
      return;
    }

    const now = new Date();
    const sheetToSign = sheetWithCourseEntries({
      ...currentSheet,
      savedAt: now.toISOString(),
      dirty: false
    }, currentCourseEntries);
    setIsSyncing(true);

    try {
      const persistedSheet = await persistAttendanceSheet(selectedClassId, sheetToSign, "sign", passwords);
      setSheets((currentSheets) => {
        const syncedSheets = {
          ...currentSheets,
          [selectedSheetKey]: persistedSheet
        };
        writeStoredSheets(syncedSheets);
        return syncedSheets;
      });
      setDatabaseStatus("ready");
      setIsSignatureDialogOpen(false);
      setSignaturePasswords({});
      setMessage(`Το απουσιολόγιο υπογράφηκε στη βάση στις ${formatSavedAt(now)}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Αποτυχία υπογραφής απουσιολογίου.");
    } finally {
      setIsSyncing(false);
    }
  }

  function updateCourseEntry(position: number, courseId: string) {
    const selectedOption = courseOptions.find((option) => option.courseId === courseId);
    if (!selectedOption) {
      return;
    }

    const nextEntries = currentCourseEntries.map((entry, index) =>
      index === position
        ? {
            ...selectedOption,
            position,
            signedAt: null
          }
        : entry
    );
    updateCurrentSheet((sheet) => ({
      ...sheetWithCourseEntries(sheet, nextEntries),
      savedAt: null,
      dirty: true
    }));
    setMessage("Το μάθημα και ο εκπαιδευτικός ενημερώθηκαν αυτόματα.");
  }

  function addCourseEntry() {
    if (currentCourseEntries.length >= 2) {
      setMessage("Μπορούν να υπάρχουν μέχρι δύο μαθήματα στην ίδια ώρα.");
      return;
    }

    const existingCourseIds = new Set(currentCourseEntries.map((entry) => entry.courseId));
    const nextOption = courseOptions.find((option) => !existingCourseIds.has(option.courseId));
    if (!nextOption) {
      setMessage("Δεν υπάρχει άλλο διαθέσιμο μάθημα για προσθήκη.");
      return;
    }

    const nextEntries = [
      ...currentCourseEntries,
      {
        ...nextOption,
        position: currentCourseEntries.length,
        signedAt: null
      }
    ];
    updateCurrentSheet((sheet) => ({
      ...sheetWithCourseEntries(sheet, nextEntries),
      savedAt: null,
      dirty: true
    }));
    setMessage("Προστέθηκε δεύτερο μάθημα για την ώρα.");
  }

  function removeCourseEntry(position: number) {
    if (currentCourseEntries.length <= 1) {
      return;
    }

    const nextEntries = currentCourseEntries
      .filter((_, index) => index !== position)
      .map((entry, index) => ({ ...entry, position: index }));
    updateCurrentSheet((sheet) => ({
      ...sheetWithCourseEntries(sheet, nextEntries),
      savedAt: null,
      dirty: true
    }));
    setMessage("Αφαιρέθηκε το δεύτερο μάθημα της ώρας.");
  }

  function setNoCourse() {
    const noCourseOption = courseOptions.find((option) => option.name === "ΚΕΝΟ");
    if (!noCourseOption) {
      setMessage("Δεν υπάρχει μάθημα ΚΕΝΟ στο τμήμα.");
      return;
    }

    updateCurrentSheet((sheet) => ({
      ...sheetWithCourseEntries(sheet, [{ ...noCourseOption, position: 0, signedAt: null }]),
      savedAt: null,
      dirty: true
    }));
    setMessage("Ορίστηκε ΚΕΝΟ για την επιλεγμένη ώρα.");
  }

  function reopenSignedSheet() {
    updateCurrentSheet((sheet) => ({
      ...sheetWithCourseEntries(
        sheet,
        normalizedCourseEntries(sheet).map((entry) => ({ ...entry, signedAt: null }))
      ),
      signedAt: null,
      savedAt: null,
      dirty: true
    }));
    setMessage("Το απουσιολόγιο άνοιξε ξανά για διόρθωση από εκπαιδευτικό.");
  }

  async function clearCurrentSheet() {
    setIsSyncing(true);

    try {
      const payload = await fetchAttendanceSheet(selectedClassId, selectedDay, selectedHour);
      setSheets((currentSheets) => {
        const nextSheets = {
          ...currentSheets,
          [selectedSheetKey]: payload
        };
        writeStoredSheets(nextSheets);
        return nextSheets;
      });
      setDatabaseStatus("ready");
      setMessage("Η ώρα επαναφορτώθηκε από τη βάση δεδομένων.");
    } catch {
      setDatabaseStatus("fallback");
      setMessage("Δεν έγινε επαναφορά, γιατί η βάση δεν απάντησε. Τα τρέχοντα δεδομένα έμειναν όπως ήταν.");
    } finally {
      setIsSyncing(false);
    }
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.reload();
  }

  return (
    <main className={isClassTablet ? "app-shell tablet-shell" : "app-shell"}>
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

      <div className={isClassTablet ? "workspace tablet-workspace" : "workspace"}>
        {isClassTablet ? null : (
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
        )}

        <section className="main-grid">
          <div className="page-header">
            <div>
              <h2>Απουσιολόγιο τάξης {currentClass.name}</h2>
              {isClassTablet ? null : (
                <p>
                  Σχολικό έτος {currentClass.schoolYear}, Τάξη {currentClass.grade}. Το τάμπλετ της τάξης ανοίγει απευθείας αυτή την οθόνη.
                </p>
              )}
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

          {isClassTablet ? null : (
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
          )}

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
              <strong>{signatureStatus}</strong>
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

              <div className="field course-picker-field">
                <label>Μάθημα και εκπαιδευτικός</label>
                <div className="course-entry-list">
                  {currentCourseEntries.map((entry, index) => {
                    const selectedCourseIds = new Set(currentCourseEntries.map((courseEntry) => courseEntry.courseId));
                    return (
                      <div className="course-entry-row" key={`${entry.courseId}-${index}`}>
                        <select
                          aria-label={`Μάθημα ${index + 1}`}
                          disabled={!canEdit || Boolean(entry.signedAt)}
                          value={entry.courseId}
                          onChange={(event) => updateCourseEntry(index, event.target.value)}
                        >
                          {courseOptions
                            .filter((option) => option.courseId === entry.courseId || !selectedCourseIds.has(option.courseId))
                            .map((option) => (
                              <option key={option.courseId} value={option.courseId}>
                                {option.name}
                              </option>
                            ))}
                        </select>
                        <span className="course-teacher-name">{entry.teacherName}</span>
                        {index === 0 && currentCourseEntries.length < 2 ? (
                          <button
                            aria-label="Προσθήκη δεύτερου μαθήματος"
                            className="icon-button"
                            disabled={!canEdit}
                            onClick={addCourseEntry}
                            title="Προσθήκη δεύτερου μαθήματος"
                            type="button"
                          >
                            <Plus size={18} />
                          </button>
                        ) : null}
                        {index === 1 ? (
                          <button
                            aria-label="Αφαίρεση δεύτερου μαθήματος"
                            className="icon-button"
                            disabled={!canEdit || Boolean(entry.signedAt)}
                            onClick={() => removeCourseEntry(index)}
                            title="Αφαίρεση δεύτερου μαθήματος"
                            type="button"
                          >
                            <Minus size={18} />
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          <section className="panel attendance-panel">
            <div className="panel-title">
              <h3>Μαθητές</h3>
              <span className={isSigned ? "pill signed-pill" : "pill"}>
                {isSigned ? <LockKeyhole size={15} /> : <CheckCircle2 size={15} />}
                {signedAtDate
                  ? `Υπογραφή ${formatSavedAt(signedAtDate)}`
                  : hasAnySignature
                    ? `Μερική υπογραφή ${signedCourseCount}/${currentCourseEntries.length}`
                    : "Ο εκπαιδευτικός υπογράφει μετά τον έλεγχο"}
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
              <button className="secondary-button" disabled={!canEdit || isSyncing} onClick={() => void clearCurrentSheet()} type="button">
                Επαναφορά ώρας
              </button>
              <button
                className="primary-button"
                disabled={!canSign}
                onClick={() => {
                  if (isClassTablet) {
                    setIsSignatureDialogOpen(true);
                    return;
                  }
                  void signAttendanceSheet();
                }}
                type="button"
              >
                <CheckCircle2 size={18} />
                Υπογραφή απουσιολογίου
              </button>
            </div>
          </section>
        </section>
      </div>

      {isSignatureDialogOpen ? (
        <div className="modal-backdrop" role="presentation">
          <form
            className="signature-modal"
            onSubmit={(event) => {
              event.preventDefault();
              void signAttendanceSheet(signaturePasswords);
            }}
          >
            <div>
              <h3>Υπογραφή απουσιολογίου</h3>
              <p>Κάθε εκπαιδευτικός πληκτρολογεί μόνο τον δικό του κωδικό.</p>
            </div>
            <div className="signature-course-list">
              {currentCourseEntries.map((entry, index) => (
                <div className="signature-course-row" key={`${entry.courseId}-${index}`}>
                  <div>
                    <strong>{entry.teacherName}</strong>
                    <span>{entry.name}</span>
                  </div>
                  {entry.signedAt ? (
                    <span className="sync-pill ready">Υπογεγραμμένο</span>
                  ) : (
                    <input
                      aria-label={`Κωδικός εκπαιδευτικού ${entry.teacherName}`}
                      autoFocus={index === 0}
                      minLength={4}
                      onChange={(event) =>
                        setSignaturePasswords((currentPasswords) => ({
                          ...currentPasswords,
                          [entry.courseId]: event.target.value
                        }))
                      }
                      placeholder="Κωδικός"
                      type="password"
                      value={signaturePasswords[entry.courseId] ?? ""}
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button
                className="secondary-button"
                onClick={() => {
                  setIsSignatureDialogOpen(false);
                  setSignaturePasswords({});
                }}
                type="button"
              >
                Άκυρο
              </button>
              <button
                className="primary-button"
                disabled={
                  isSyncing ||
                  !currentCourseEntries.some((entry) => !entry.signedAt && (signaturePasswords[entry.courseId]?.length ?? 0) >= 4)
                }
                type="submit"
              >
                Υπογραφή
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}
