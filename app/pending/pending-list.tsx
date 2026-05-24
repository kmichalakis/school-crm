"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { PendingAttendanceItem } from "@/lib/pending-attendance";

type PendingListProps = {
  canMarkBlank: boolean;
  emptyMessage: string;
  items: PendingAttendanceItem[];
};

async function markPendingAttendanceBlank(item: PendingAttendanceItem) {
  const response = await fetch("/api/pending/blank", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      classId: item.classId,
      date: item.date,
      hour: item.hour
    })
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error ?? "Αποτυχία ορισμού της ώρας ως ΚΕΝΟ.");
  }

  return payload as { ok: boolean };
}

function attendanceHref(item: PendingAttendanceItem) {
  const params = new URLSearchParams({
    classId: item.classId,
    date: item.date,
    day: item.day,
    hour: String(item.hour)
  });

  return `/?${params.toString()}`;
}

export function PendingList({ canMarkBlank, emptyMessage, items }: PendingListProps) {
  const [resolvedItemIds, setResolvedItemIds] = useState<Set<string>>(() => new Set());
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: "success" | "error" } | null>(null);
  const visibleItems = useMemo(() => items.filter((item) => !resolvedItemIds.has(item.id)), [items, resolvedItemIds]);

  async function handleMarkBlank(item: PendingAttendanceItem) {
    setBusyItemId(item.id);
    setMessage(null);

    try {
      await markPendingAttendanceBlank(item);
      setResolvedItemIds((currentIds) => {
        const nextIds = new Set(currentIds);
        for (const pendingItem of items) {
          if (pendingItem.classId === item.classId && pendingItem.date === item.date && pendingItem.hour === item.hour) {
            nextIds.add(pendingItem.id);
          }
        }
        return nextIds;
      });
      setMessage({ text: "Η ώρα ορίστηκε ως ΚΕΝΟ και αφαιρέθηκε από τις εκκρεμότητες.", tone: "success" });
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : "Αποτυχία ορισμού της ώρας ως ΚΕΝΟ.",
        tone: "error"
      });
    } finally {
      setBusyItemId(null);
    }
  }

  if (visibleItems.length === 0) {
    return (
      <div className="pending-list-shell">
        {message ? (
          <div className={`admin-notice ${message.tone}`} role={message.tone === "error" ? "alert" : "status"}>
            {message.text}
          </div>
        ) : null}
        <div className="empty-state">{emptyMessage}</div>
      </div>
    );
  }

  return (
    <div className="pending-list-shell">
      {message ? (
        <div className={`admin-notice ${message.tone}`} role={message.tone === "error" ? "alert" : "status"}>
          {message.text}
        </div>
      ) : null}

      <div className="teacher-day-list">
        {visibleItems.map((item) => (
          <article className="teacher-day-card pending-card" key={item.id}>
            <Link className="pending-card-link" href={attendanceHref(item)}>
              <div className="teacher-day-time">
                <strong>{item.dayLabel}</strong>
                <span>{item.dateLabel}</span>
              </div>
              <div className="teacher-day-main">
                <strong>
                  {item.className} · {item.hourLabel}
                </strong>
                <span>{item.courseName}</span>
                <span>{item.teacherName}</span>
              </div>
              <div className="teacher-day-status">
                <span className="pill">Εκκρεμεί</span>
              </div>
              <span className="primary-button pending-open-button">Άνοιγμα</span>
            </Link>
            {canMarkBlank ? (
              <button className="secondary-button" disabled={busyItemId === item.id} onClick={() => void handleMarkBlank(item)} type="button">
                {busyItemId === item.id ? "Ορισμός..." : "ΚΕΝΟ"}
              </button>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}
