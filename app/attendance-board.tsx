"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  History,
  LockKeyhole,
  Minus,
  Plus,
  Printer,
  Save,
  ShieldCheck
} from "lucide-react";
import { appTitle, SchoolBrand } from "@/app/school-brand";
import { currentContext, demoClass, demoCourses, demoStudents } from "@/lib/demo-data";
import { isAllowedSchoolDate, type SchoolCalendarException, type SchoolYearDateBounds } from "@/lib/school-calendar";
import { dateToWeekDay, formatDateInput, schoolHours, weekDays } from "@/lib/school-time";
import type { AttendanceCourseEntry, AttendanceCourseOption, AttendanceSheetPayload, SaveAttendanceAction } from "@/lib/attendance-types";

type UserMode = "tablet" | "teacher";
type DatabaseStatus = "unknown" | "ready" | "fallback";
type MessageTone = "info" | "success" | "error";

type AttendanceBoardProps = {
  initialMode: UserMode;
  userLabel: string;
  username: string;
  initialClassId: string;
  initialDate: string;
  initialDay: string;
  initialHour: number;
  availableClasses: Array<{
    id: string;
    name: string;
    grade: string;
    schoolYear: string;
    isResponsible?: boolean;
  }>;
  isAdmin: boolean;
  currentTeacherId: string | null;
  showClassSelection?: boolean;
  schoolYearBounds: SchoolYearDateBounds | null;
  calendarExceptions: SchoolCalendarException[];
};

const storageKey = "school-crm-attendance-sheets-v2";

function formatSavedAt(date: Date) {
  return new Intl.DateTimeFormat("el-GR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

function getSheetKey(classId: string, date: string, hour: number) {
  return `${classId}:${date}:${hour}`;
}

function createDefaultSheet(date: string, day: string, hour: number): AttendanceSheetPayload {
  const defaultCourseOption = {
    courseId: "demo-course",
    isNoCourse: false,
    name: currentContext.course,
    teacherId: "demo-teacher",
    teacherName: currentContext.teacher
  };

  return {
    date,
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
    isNoCourse: courseName === "ΚΕΝΟ",
    isSubstitution: courseName === "ΑΝΑΠΛΗΡΩΣΗ",
    name: courseName,
    teacherId: null,
    teacherName: courseName === "ΚΕΝΟ" ? "ΚΕΝΟ" : courseName === sheet.course ? sheet.teacherName : "Δεν έχει οριστεί εκπαιδευτικός"
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

async function fetchAttendanceSheet(classId: string, date: string, day: string, hour: number) {
  const params = new URLSearchParams({
    classId,
    date,
    day,
    hour: String(hour)
  });
  const response = await fetch(`/api/attendance?${params.toString()}`);

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? "Η βάση δεν επέστρεψε απουσιολόγιο.");
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
  initialDate,
  initialDay,
  initialHour,
  availableClasses,
  isAdmin,
  currentTeacherId,
  showClassSelection = false,
  schoolYearBounds,
  calendarExceptions
}: AttendanceBoardProps) {
  const [mode] = useState<UserMode>(initialMode);
  const [selectedClassId, setSelectedClassId] = useState(initialClassId);
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [selectedDay, setSelectedDay] = useState(initialDay);
  const [selectedHour, setSelectedHour] = useState(initialHour);
  const [sheets, setSheets] = useState<Record<string, AttendanceSheetPayload>>(() => ({
    [getSheetKey(initialClassId, initialDate, initialHour)]: createDefaultSheet(initialDate, initialDay, initialHour)
  }));
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [databaseStatus, setDatabaseStatus] = useState<DatabaseStatus>("unknown");
  const [isSyncing, setIsSyncing] = useState(false);
  const [message, setMessage] = useState("Δεν υπάρχουν μη αποθηκευμένες αλλαγές.");
  const [messageTone, setMessageTone] = useState<MessageTone>("info");
  const [isSignatureDialogOpen, setIsSignatureDialogOpen] = useState(false);
  const [signatureAction, setSignatureAction] = useState<"sign" | "unlock">("sign");
  const [signaturePasswords, setSignaturePasswords] = useState<Record<string, string>>({});

  function showMessage(nextMessage: string, tone: MessageTone = "info") {
    setMessage(nextMessage);
    setMessageTone(tone);
  }

  useEffect(() => {
    setSelectedClassId(initialClassId);
    setSelectedDate(initialDate);
    setSelectedDay(initialDay);
    setSelectedHour(initialHour);
    setSelectedStudentId(null);
  }, [initialClassId, initialDate, initialDay, initialHour]);

  useEffect(() => {
    const storedSheets = readStoredSheets();
    if (Object.keys(storedSheets).length > 0) {
      setSheets(storedSheets);
      showMessage("Φορτώθηκαν τα αποθηκευμένα πρόχειρα από τη συσκευή.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadFromDatabase() {
      setIsSyncing(true);
      try {
        const payload = await fetchAttendanceSheet(selectedClassId, selectedDate, selectedDay, selectedHour);
        if (cancelled) {
          return;
        }

        setSheets((currentSheets) => {
          const nextSheets = {
            ...currentSheets,
            [getSheetKey(selectedClassId, selectedDate, selectedHour)]: payload
          };
          writeStoredSheets(nextSheets);
          return nextSheets;
        });
        setDatabaseStatus("ready");
        showMessage("Το απουσιολόγιο φορτώθηκε από τη βάση δεδομένων.", "success");
      } catch (error) {
        if (cancelled) {
          return;
        }

        setDatabaseStatus("fallback");
        showMessage(error instanceof Error ? error.message : "Η βάση δεν είναι διαθέσιμη. Προσωρινά χρησιμοποιείται αποθήκευση στη συσκευή.", "error");
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
  }, [selectedClassId, selectedDate, selectedDay, selectedHour]);

  const selectedSheetKey = getSheetKey(selectedClassId, selectedDate, selectedHour);
  const currentSheet = sheets[selectedSheetKey] ?? createDefaultSheet(selectedDate, selectedDay, selectedHour);
  const currentClass = availableClasses.find((classRecord) => classRecord.id === selectedClassId) ?? availableClasses[0] ?? demoClass;
  const courseOptions = useMemo(() => fallbackCourseOptions(currentSheet), [currentSheet]);
  const currentCourseEntries = useMemo(() => normalizedCourseEntries(currentSheet), [currentSheet]);

  const selectedDayLabel = useMemo(
    () => weekDays.find((day) => day.value === selectedDay)?.label ?? "Δευτέρα",
    [selectedDay]
  );
  const absentCount = currentSheet.students.filter((student) => student.absent).length;
  const isTeacher = mode === "teacher";
  const isClassTablet = mode === "tablet" && !isAdmin;
  const signedCourseCount = currentCourseEntries.filter((entry) => entry.signedAt).length;
  const hasAnySignature = signedCourseCount > 0;
  const isSigned = currentCourseEntries.length > 0 && signedCourseCount === currentCourseEntries.length;
  const signatureStatus = isSigned ? "Υπογεγραμμένο" : hasAnySignature ? `Μερική (${signedCourseCount}/${currentCourseEntries.length})` : "Ανοιχτό";
  const canEdit = !isSigned || isTeacher;
  const isFutureAttendanceDate = selectedDate > formatDateInput(new Date());
  const hasUnsignedCourseForCurrentTeacher = currentCourseEntries.some((entry) => entry.teacherId === currentTeacherId && !entry.signedAt);
  const hasSignedCourseForCurrentTeacher = currentCourseEntries.some((entry) => entry.teacherId === currentTeacherId && entry.signedAt);
  const canSign = (isClassTablet || hasUnsignedCourseForCurrentTeacher) && !isSigned && !isSyncing && !isFutureAttendanceDate;
  const canUnlock = (isClassTablet || hasSignedCourseForCurrentTeacher) && isSigned && !isSyncing;
  const signedAtDate = currentSheet.signedAt ? new Date(currentSheet.signedAt) : null;
  const savedAtDate = currentSheet.savedAt ? new Date(currentSheet.savedAt) : null;
  const selectedDateAllowed = isAllowedSchoolDate(selectedDate, schoolYearBounds, calendarExceptions);
  const selectedStudent = currentSheet.students.find((student) => student.id === selectedStudentId) ?? null;
  const selectedStudentHistory = selectedStudent
    ? Object.values(sheets)
        .filter((sheet) => sheet.students.some((student) => student.id === selectedStudent.id && student.absent))
        .sort((first, second) => first.day.localeCompare(second.day) || first.hour - second.hour)
    : [];

  function updateCurrentSheet(updater: (sheet: AttendanceSheetPayload) => AttendanceSheetPayload) {
    setSheets((currentSheets) => {
      const activeSheet = currentSheets[selectedSheetKey] ?? createDefaultSheet(selectedDate, selectedDay, selectedHour);
      return {
        ...currentSheets,
        [selectedSheetKey]: updater(activeSheet)
      };
    });
  }

  function toggleStudentAbsence(studentId: string) {
    if (!canEdit) {
      showMessage("Το υπογεγραμμένο απουσιολόγιο δεν αλλάζει από το tablet τάξης.", "error");
      return;
    }

    updateCurrentSheet((sheet) => ({
      ...sheet,
      savedAt: null,
      signedAt: sheet.signedAt && isTeacher ? null : sheet.signedAt,
      dirty: true,
      students: sheet.students.map((student) =>
        student.id === studentId ? { ...student, absent: !student.absent, isHourlyExpulsion: student.absent ? false : student.isHourlyExpulsion } : student
      )
    }));
    showMessage("Υπάρχουν μη αποθηκευμένες αλλαγές.");
  }

  function toggleHourlyExpulsion(studentId: string) {
    if (!canEdit) {
      showMessage("Το υπογεγραμμένο απουσιολόγιο δεν αλλάζει από το tablet τάξης.", "error");
      return;
    }

    updateCurrentSheet((sheet) => ({
      ...sheet,
      savedAt: null,
      signedAt: sheet.signedAt && isTeacher ? null : sheet.signedAt,
      dirty: true,
      students: sheet.students.map((student) =>
        student.id === studentId ? { ...student, absent: true, isHourlyExpulsion: !student.isHourlyExpulsion } : student
      )
    }));
    showMessage("Η ένδειξη ωριαίας αποβολής ενημερώθηκε.");
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
      showMessage(`Το πρόχειρο αποθηκεύτηκε στη βάση στις ${formatSavedAt(now)}.`, "success");
    } catch {
      setDatabaseStatus("fallback");
      showMessage(`Το πρόχειρο αποθηκεύτηκε μόνο στη συσκευή στις ${formatSavedAt(now)}.`, "error");
    } finally {
      setIsSyncing(false);
    }
  }

  async function signAttendanceSheet(passwords?: Record<string, string>) {
    if (!isTeacher && !isClassTablet) {
      showMessage("Μόνο εκπαιδευτικός ή τάμπλετ τάξης μπορεί να ξεκινήσει υπογραφή.", "error");
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
      showMessage(`Το απουσιολόγιο υπογράφηκε στη βάση στις ${formatSavedAt(now)}.`, "success");
    } catch (error) {
      showMessage(error instanceof Error ? error.message : "Αποτυχία υπογραφής απουσιολογίου.", "error");
    } finally {
      setIsSyncing(false);
    }
  }

  async function unlockAttendanceSheet(passwords?: Record<string, string>) {
    if (!isTeacher && !isClassTablet) {
      showMessage("Μόνο εκπαιδευτικός ή τάμπλετ τάξης μπορεί να ακυρώσει υπογραφή.", "error");
      return;
    }

    const now = new Date();
    const sheetToUnlock = sheetWithCourseEntries({
      ...currentSheet,
      savedAt: now.toISOString(),
      dirty: false
    }, currentCourseEntries);
    setIsSyncing(true);

    try {
      const persistedSheet = await persistAttendanceSheet(selectedClassId, sheetToUnlock, "unlock", passwords);
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
      showMessage("Η υπογραφή ακυρώθηκε. Το απουσιολόγιο άνοιξε για διορθώσεις.", "success");
    } catch (error) {
      showMessage(error instanceof Error ? error.message : "Αποτυχία ακύρωσης υπογραφής.", "error");
    } finally {
      setIsSyncing(false);
    }
  }

  function updateCourseEntry(position: number, courseId: string) {
    const selectedOption = courseOptions.find((option) => option.courseId === courseId);
    if (!selectedOption) {
      return;
    }

    const nextEntries = selectedOption.isNoCourse
      ? [
          {
            ...selectedOption,
            position: 0,
            signedAt: null
          }
        ]
      : currentCourseEntries.map((entry, index) =>
          index === position
            ? {
                ...selectedOption,
                position,
                teacherId: selectedOption.isSubstitution ? null : selectedOption.teacherId,
                teacherName: selectedOption.isSubstitution ? "Επιλέξτε εκπαιδευτικό αναπλήρωσης" : selectedOption.teacherName,
                signedAt: null
              }
            : entry
        );
    updateCurrentSheet((sheet) => ({
      ...sheetWithCourseEntries(sheet, nextEntries),
      savedAt: null,
      dirty: true,
      students: selectedOption.isNoCourse ? sheet.students.map((student) => ({ ...student, absent: false })) : sheet.students
    }));
    showMessage(selectedOption.isNoCourse ? "Η ώρα ορίστηκε ως ΚΕΝΟ." : "Το μάθημα και ο εκπαιδευτικός ενημερώθηκαν αυτόματα.");
  }

  function updateSubstitutionTeacher(position: number, teacherId: string) {
    const teacher = currentSheet.teacherOptions?.find((teacherOption) => teacherOption.id === teacherId);
    updateCurrentSheet((sheet) => ({
      ...sheetWithCourseEntries(
        sheet,
        currentCourseEntries.map((entry, index) =>
          index === position
            ? {
                ...entry,
                teacherId: teacher?.id ?? null,
                teacherName: teacher?.name ?? "Επιλέξτε εκπαιδευτικό αναπλήρωσης",
                signedAt: null
              }
            : entry
        )
      ),
      savedAt: null,
      dirty: true
    }));
    showMessage("Ο εκπαιδευτικός αναπλήρωσης ενημερώθηκε.");
  }

  function addCourseEntry() {
    if (currentCourseEntries.length >= 2) {
      showMessage("Μπορούν να υπάρχουν μέχρι δύο μαθήματα στην ίδια ώρα.", "error");
      return;
    }

    const existingCourseIds = new Set(currentCourseEntries.map((entry) => entry.courseId));
    const nextOption = courseOptions.find((option) => !option.isNoCourse && !existingCourseIds.has(option.courseId));
    if (!nextOption) {
      showMessage("Δεν υπάρχει άλλο διαθέσιμο μάθημα για προσθήκη.", "error");
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
    showMessage("Προστέθηκε δεύτερο μάθημα για την ώρα.");
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
    showMessage("Αφαιρέθηκε το δεύτερο μάθημα της ώρας.");
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
    showMessage("Το απουσιολόγιο άνοιξε ξανά για διόρθωση από εκπαιδευτικό.");
  }

  async function clearCurrentSheet() {
    setIsSyncing(true);

    try {
      const payload = await fetchAttendanceSheet(selectedClassId, selectedDate, selectedDay, selectedHour);
      setSheets((currentSheets) => {
        const nextSheets = {
          ...currentSheets,
          [selectedSheetKey]: payload
        };
        writeStoredSheets(nextSheets);
        return nextSheets;
      });
      setDatabaseStatus("ready");
      showMessage("Η ώρα επαναφορτώθηκε από τη βάση δεδομένων.", "success");
    } catch {
      setDatabaseStatus("fallback");
      showMessage("Δεν έγινε επαναφορά, γιατί η βάση δεν απάντησε. Τα τρέχοντα δεδομένα έμειναν όπως ήταν.", "error");
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
        <SchoolBrand title={appTitle} subtitle="Διαχείριση παρουσιών και απουσιών" />
        <div className="user-chip">
          <ShieldCheck size={17} />
          {userLabel}
        </div>
        <button className="secondary-button" onClick={logout} type="button">
          Αποσύνδεση
        </button>
      </header>

      <div className={isClassTablet ? "workspace tablet-workspace" : "workspace"}>
        {isClassTablet ? null : (
        <nav className="sidebar" aria-label="Κύρια πλοήγηση">
          <Link className="nav-button active" href="/">
            <ClipboardCheck size={18} />
            Απουσιολόγιο
          </Link>
          <Link className="nav-button" href="/teacher">
            <CalendarClock size={18} />
            Μαθήματα
          </Link>
          <Link className="nav-button" href="/pending">
            <ClipboardCheck size={18} />
            Εκκρεμότητες
          </Link>
          <Link className="nav-button" href="/reports">
            <ClipboardCheck size={18} />
            Τμήματα
          </Link>
          <Link className="nav-button" href="/print">
            <Printer size={18} />
            Εκτυπώσεις
          </Link>
          {isAdmin ? (
            <>
              <Link className="nav-button" href="/dashboard">
                <ClipboardCheck size={18} />
                Dashboard
              </Link>
              <Link className="nav-button" href="/api/reports/export">
                <Printer size={18} />
                Εξαγωγές
              </Link>
              <Link className="nav-button" href="/notifications">
                <ShieldCheck size={18} />
                Κανόνες ειδοποιήσεων
              </Link>
              <Link className="nav-button" href="/schedule">
                <CalendarClock size={18} />
                Πρόγραμμα
              </Link>
              <Link className="nav-button" href="/admin">
                <ShieldCheck size={18} />
                Διαχείριση
              </Link>
            </>
          ) : null}
        </nav>
        )}

        <section className="main-grid">
          <div className="page-header">
            <div>
              <h2>{showClassSelection ? "Απουσιολόγιο" : `Απουσιολόγιο τάξης ${currentClass.name}`}</h2>
              {isClassTablet || showClassSelection ? null : (
                <p>
                  Σχολικό έτος {currentClass.schoolYear}, Τάξη {currentClass.grade}. Το τάμπλετ της τάξης ανοίγει απευθείας αυτή την οθόνη.
                </p>
              )}
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
                    showMessage("Ο admin άλλαξε τμήμα εργασίας.");
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

          {showClassSelection ? (
            <section className="admin-section">
              <div className="admin-section-title">
                <h2>Επιλογή τμήματος</h2>
                <p>Διάλεξε τμήμα για να ανοίξει το απουσιολόγιο στην κοντινότερη κατάλληλη ημερομηνία και ώρα.</p>
              </div>
              <div className="teacher-class-list">
                {availableClasses.length > 0 ? (
                  availableClasses.map((classRecord) => (
                    <Link
                      className="teacher-class-link"
                      href={`/?classId=${classRecord.id}&date=${selectedDate}&hour=${selectedHour}`}
                      key={classRecord.id}
                    >
                      <strong>{classRecord.name}</strong>
                      <span>{classRecord.schoolYear}</span>
                      {classRecord.isResponsible ? <em>Υπεύθυνος/η</em> : null}
                    </Link>
                  ))
                ) : (
                  <p>Δεν έχουν συνδεθεί τμήματα με αυτόν τον εκπαιδευτικό.</p>
                )}
              </div>
            </section>
          ) : null}

          {showClassSelection ? null : (
          <>
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
                <label htmlFor="attendanceDate">Ημερομηνία</label>
                <input
                  id="attendanceDate"
                  type="date"
                  min={schoolYearBounds?.startsOn}
                  max={schoolYearBounds?.endsOn}
                  value={selectedDate}
                  onChange={(event) => {
                    const nextDate = event.target.value;
                    const nextDay = dateToWeekDay(nextDate);
                    if (!nextDay) {
                      showMessage("Επιλέξτε εργάσιμη ημέρα Δευτέρα έως Παρασκευή.", "error");
                      return;
                    }
                    if (!isAllowedSchoolDate(nextDate, schoolYearBounds, calendarExceptions)) {
                      showMessage("Η ημερομηνία είναι εκτός σχολικού έτους ή έχει δηλωθεί μη εργάσιμη στο ημερολόγιο.", "error");
                      return;
                    }

                    setSelectedDate(nextDate);
                    setSelectedDay(nextDay);
                    showMessage("Φορτώθηκε το απουσιολόγιο της επιλεγμένης ημερομηνίας.");
                  }}
                />
                <span className="field-hint">{selectedDayLabel}</span>
              </div>

              <div className="field">
                <label htmlFor="hour">Ώρα</label>
                <select
                  id="hour"
                  value={selectedHour}
                  onChange={(event) => {
                    setSelectedHour(Number(event.target.value));
                    showMessage("Φορτώθηκε το απουσιολόγιο της επιλεγμένης ώρας.");
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
                        {entry.isSubstitution ? (
                          <select
                            aria-label={`Εκπαιδευτικός αναπλήρωσης ${index + 1}`}
                            disabled={!canEdit || Boolean(entry.signedAt)}
                            value={entry.teacherId ?? ""}
                            onChange={(event) => updateSubstitutionTeacher(index, event.target.value)}
                          >
                            <option value="">Επιλέξτε εκπαιδευτικό</option>
                            {(currentSheet.teacherOptions ?? []).map((teacher) => (
                              <option key={teacher.id} value={teacher.id}>
                                {teacher.name}
                              </option>
                            ))}
                          </select>
                        ) : null}
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

            <div className={`status-message ${messageTone}`} role={messageTone === "error" ? "alert" : "status"} aria-live="polite">
              <span className="status-message-main">
                {messageTone === "error" ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
                {message}
              </span>
              {savedAtDate ? <strong>Τελευταία αποθήκευση: {formatSavedAt(savedAtDate)}</strong> : null}
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
                    className={`absence-toggle expulsion-toggle${student.isHourlyExpulsion ? " marked" : ""}`}
                    disabled={!student.absent}
                    onClick={() => toggleHourlyExpulsion(student.id)}
                    type="button"
                  >
                    Ωριαία αποβολή
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
                    <span className="history-chip" key={`${sheet.date}-${sheet.hour}`}>
                      {sheet.date}, {weekDays.find((day) => day.value === sheet.day)?.label}, {schoolHours.find((slot) => slot.hour === sheet.hour)?.label}
                    </span>
                  ))}
                </div>
                <button className="icon-button" onClick={() => setSelectedStudentId(null)} title="Κλείσιμο ιστορικού" type="button">
                  ×
                </button>
              </div>
            ) : null}

            <div className="teacher-actions">
              <button className="secondary-button" disabled={isSyncing || !selectedDateAllowed} onClick={saveDraft} type="button">
                <Save size={18} />
                Αποθήκευση πρόχειρου
              </button>
              {isSigned && isTeacher ? (
                <button className="secondary-button" onClick={reopenSignedSheet} type="button">
                  Άνοιγμα για διόρθωση
                </button>
              ) : null}
              <button className="secondary-button" disabled={!canEdit || isSyncing || !selectedDateAllowed} onClick={() => void clearCurrentSheet()} type="button">
                Επαναφορά ώρας
              </button>
              {isSigned ? (
                <button
                  className="primary-button"
                  disabled={!canUnlock || !selectedDateAllowed}
                  onClick={() => {
                    if (isClassTablet) {
                      setSignatureAction("unlock");
                      setSignaturePasswords({});
                      setIsSignatureDialogOpen(true);
                      return;
                    }
                    void unlockAttendanceSheet();
                  }}
                  type="button"
                >
                  <LockKeyhole size={18} />
                  Ακύρωση υπογραφής
                </button>
              ) : (
                <button
                  className="primary-button"
                  disabled={!canSign || !selectedDateAllowed}
                  onClick={() => {
                    if (isClassTablet) {
                      setSignatureAction("sign");
                      setSignaturePasswords({});
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
              )}
            </div>
          </section>
          </>
          )}
        </section>
      </div>

      {isSignatureDialogOpen ? (
        <div className="modal-backdrop" role="presentation">
          <form
            className="signature-modal"
            onSubmit={(event) => {
              event.preventDefault();
              if (signatureAction === "unlock") {
                void unlockAttendanceSheet(signaturePasswords);
                return;
              }

              void signAttendanceSheet(signaturePasswords);
            }}
          >
            <div>
              <h3>{signatureAction === "unlock" ? "Ακύρωση υπογραφής" : "Υπογραφή απουσιολογίου"}</h3>
              <p>
                {signatureAction === "unlock"
                  ? "Ένας από τους εκπαιδευτικούς πληκτρολογεί τον κωδικό του για να ανοίξει το απουσιολόγιο."
                  : "Κάθε εκπαιδευτικός πληκτρολογεί μόνο τον δικό του κωδικό."}
              </p>
            </div>
            <div className="signature-course-list">
              {currentCourseEntries.map((entry, index) => (
                <div className="signature-course-row" key={`${entry.courseId}-${index}`}>
                  <div>
                    <strong>{entry.teacherName}</strong>
                    <span>{entry.name}</span>
                  </div>
                  {signatureAction === "sign" && entry.signedAt ? (
                    <span className="sync-pill ready">Υπογεγραμμένο</span>
                  ) : signatureAction === "unlock" && !entry.signedAt ? (
                    <span className="sync-pill">Δεν έχει υπογραφεί</span>
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
                  !currentCourseEntries.some((entry) => {
                    const canSubmitEntry = signatureAction === "unlock" ? Boolean(entry.signedAt) : !entry.signedAt;
                    return canSubmitEntry && (signaturePasswords[entry.courseId]?.length ?? 0) >= 4;
                  })
                }
                type="submit"
              >
                {signatureAction === "unlock" ? "Ακύρωση υπογραφής" : "Υπογραφή"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}
