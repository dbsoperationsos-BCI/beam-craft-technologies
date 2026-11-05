"use client";

import Dialog from "@/components/ui/Dialog";
import Button from "@/components/shared/Button";
import { shortDate, weekdayName } from "@/lib/shootBoard.mjs";

/**
 * One day's free shooters, opened from the count under its date on the Shoot Board: the employees
 * in the Technical department who have no shoot at all that date (the server's `freeShooters.js` - any
 * role on any of the studio's shoots makes them busy).
 */
export default function ShootFreeShootersDialog({ day, shooters = [], onClose }) {
  return <Dialog
    title={`Free shooters · ${weekdayName(day)}, ${shortDate(day)}`}
    description={shooters.length ? `${shooters.length} with no shoot this day` : undefined}
    onClose={onClose}
    footer={<Button type="button" className="max-sm:w-full" onClick={onClose}>Close</Button>}
  >
    {shooters.length
      ? <ul className="divide-y divide-slate-100">
        {shooters.map((person) => <li key={person.id} className="py-2 text-sm text-slate-800">{person.name}</li>)}
      </ul>
      : <p className="text-sm text-slate-600">Every shooter has a shoot this day.</p>}
  </Dialog>;
}
