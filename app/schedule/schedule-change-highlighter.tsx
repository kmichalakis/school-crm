"use client";

import { useEffect } from "react";

function normalizedSignature(row: HTMLElement) {
  const pairs = [0, 1]
    .map((position) => {
      const courseSelect = row.querySelector<HTMLSelectElement>(`select[data-course-position="${position}"]`);
      const course = courseSelect?.value ?? "";
      const isSubstitution = courseSelect?.selectedOptions[0]?.dataset.substitution === "true";
      const teacher = row.querySelector<HTMLSelectElement>(`select[data-teacher-position="${position}"]`)?.value ?? "";
      return course ? `${course}:${isSubstitution ? teacher : ""}` : "";
    })
    .filter(Boolean)
    .sort();

  return pairs.join("|");
}

export function ScheduleChangeHighlighter() {
  useEffect(() => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-daily-schedule-row]"));

    function updateRow(row: HTMLElement) {
      row.classList.toggle("changed", normalizedSignature(row) !== (row.dataset.baselineSignature ?? ""));
    }

    const cleanups = rows.flatMap((row) => {
      const selects = Array.from(row.querySelectorAll<HTMLSelectElement>("select"));
      updateRow(row);
      return selects.map((select) => {
        const handler = () => updateRow(row);
        select.addEventListener("change", handler);
        return () => select.removeEventListener("change", handler);
      });
    });

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, []);

  return null;
}
