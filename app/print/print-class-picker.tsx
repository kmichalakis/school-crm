"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type PrintClassOption = {
  id: string;
  label: string;
};

type PrintClassPickerProps = {
  classes: PrintClassOption[];
  selectedClassId: string;
};

export function PrintClassPicker({ classes, selectedClassId }: PrintClassPickerProps) {
  const router = useRouter();
  const [classId, setClassId] = useState(selectedClassId);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="inline-form print-selector-form">
      <label>
        Τμήμα
        <select
          aria-busy={isPending}
          value={classId}
          onChange={(event) => {
            const nextClassId = event.target.value;
            setClassId(nextClassId);
            startTransition(() => {
              router.push(`/print?classId=${encodeURIComponent(nextClassId)}`);
            });
          }}
        >
          {classes.map((classRecord) => (
            <option key={classRecord.id} value={classRecord.id}>
              {classRecord.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
