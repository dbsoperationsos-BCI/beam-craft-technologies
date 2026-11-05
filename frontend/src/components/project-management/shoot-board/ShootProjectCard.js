"use client";

import Button from "@/components/shared/Button";

/**
 * A project on a day, drawn as the Shoot Board's cards are (`ShootBoardCard`): its colour as the bar
 * down the left, its name and Event ID, and how many of its shoots fall on the day. Opens to those
 * shoots.
 */
export default function ShootProjectCard({ name, eventId, count, colour, onOpen }) {
  return <Button
    type="button"
    variant="plain"
    size="none"
    onClick={onOpen}
    aria-label={`Open ${name}'s shoots`}
    className="shoot-card flex w-full min-w-0 !items-stretch !justify-start overflow-hidden rounded-xl bg-white shadow-sm transition hover:shadow-md focus-visible:ring-2 focus-visible:ring-blue-500"
  >
    <span aria-hidden="true" className={`w-1.5 shrink-0 ${colour?.bar || "bg-slate-300"}`} />
    <span className="flex min-w-0 flex-1 items-center justify-between gap-3 p-3 text-left">
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold leading-5 text-slate-900">{name}</span>
        {eventId && eventId !== name && <span className="block truncate text-[11px] text-slate-400">{eventId}</span>}
      </span>
      <span className={`inline-flex shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ${colour?.chip || "bg-slate-100 text-slate-700 ring-slate-200"}`}>{count} shoot{count === 1 ? "" : "s"}</span>
    </span>
  </Button>;
}
