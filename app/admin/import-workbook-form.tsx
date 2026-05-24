"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { importSchoolWorkbookAction } from "@/app/admin/actions";

type ImportWorkbookFormProps = {
  activeSchoolYearId: string;
};

function elapsedLabel(seconds: number) {
  if (seconds < 60) {
    return `${seconds} δευτ.`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes} λεπ. ${remainingSeconds} δευτ.`;
}

function ImportSubmitStatus({ startedAt, fileName }: { startedAt: number | null; fileName: string }) {
  const { pending } = useFormStatus();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!pending || !startedAt) {
      setElapsedSeconds(0);
      return undefined;
    }

    const updateElapsed = () => {
      setElapsedSeconds(Math.max(1, Math.round((Date.now() - startedAt) / 1000)));
    };
    updateElapsed();
    const interval = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(interval);
  }, [pending, startedAt]);

  if (!pending) {
    return null;
  }

  const estimate =
    elapsedSeconds < 20
      ? "Εκτίμηση: συνήθως 20-60 δευτερόλεπτα."
      : elapsedSeconds < 60
        ? "Ακόμα δουλεύει. Σε Vercel μπορεί να πάρει έως περίπου 1 λεπτό."
        : "Κρατάει αρκετά. Αν αποτύχει, δοκιμάστε ξανά μετά το νέο deploy ή στείλτε το μήνυμα σφάλματος.";

  return (
    <div className="import-progress" role="status">
      <strong>Γίνεται εισαγωγή Excel...</strong>
      <span>{fileName ? `Αρχείο: ${fileName}` : "Το αρχείο ανεβαίνει και ελέγχεται."}</span>
      <span>Χρόνος: {elapsedLabel(elapsedSeconds)}</span>
      <span>{estimate}</span>
    </div>
  );
}

function ImportSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button className="primary-button" disabled={pending} type="submit">
      {pending ? "Γίνεται εισαγωγή..." : "Εισαγωγή Excel"}
    </button>
  );
}

export function ImportWorkbookForm({ activeSchoolYearId }: ImportWorkbookFormProps) {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [fileName, setFileName] = useState("");

  return (
    <form
      action={importSchoolWorkbookAction}
      className="admin-form import-form"
      onSubmit={() => {
        setStartedAt(Date.now());
      }}
    >
      <input name="activeSchoolYearId" type="hidden" value={activeSchoolYearId} />
      <input
        name="workbook"
        type="file"
        accept=".xlsx,.xls"
        onChange={(event) => setFileName(event.currentTarget.files?.[0]?.name ?? "")}
        required
      />
      <a className="secondary-button" href="/admin/import-template">
        Λήψη προτύπου Excel
      </a>
      <ImportSubmitButton />
      <ImportSubmitStatus fileName={fileName} startedAt={startedAt} />
    </form>
  );
}
