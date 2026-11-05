"use client";

import Dialog from "@/components/ui/Dialog";
import Button from "@/components/shared/Button";
import { fromKey, shootDayKey, shortDate, weekdayName } from "@/lib/shootBoard.mjs";
import ShootBoardCard from "./ShootBoardCard";

/**
 * The shoots behind a merged bar, a day at a time, each a card.
 *
 * `onOpen` is what a card does, and `canOpen` whether this shoot has it to do - which is the
 * caller's to answer, not this dialog's. It asked `shoot.productionShootId`, the right question
 * only for the Shoot Board's production panel: the calendar opens the Projects board for somebody
 * who holds Projects rather than Production, and that needs no production record, so such a viewer
 * was given a dead card on a shoot whose production had not been raised. The default is still the
 * board's own rule, so nothing there changed.
 *
 * `menuFor(shoot)` gives a card its ⋮ items - the calendar's Update project, Pre Production,
 * Production and Update payment; the Shoot Board passes none.
 */
export default function ShootRunDialog({ project, run, onOpen, canOpen = (shoot) => Boolean(shoot.productionShootId), menuFor, onClose }) {
  const days = [...new Set(run.shoots.map((shoot) => shootDayKey(shoot.shootDate)))];
  return <Dialog
    title={project.label}
    description={project.eventId && project.eventId !== project.label ? project.eventId : undefined}
    onClose={onClose}
    footer={<Button type="button" className="max-sm:w-full" onClick={onClose}>Close</Button>}
  >
    <div className="flex flex-col gap-4">
      {days.map((key) => <section key={key} className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-slate-600">{weekdayName(fromKey(key))}, {shortDate(fromKey(key))}</h3>
        {run.shoots.filter((shoot) => shootDayKey(shoot.shootDate) === key).map((shoot) => <ShootBoardCard
          key={shoot.id}
          shoot={shoot}
          colour={project.colour}
          onOpen={onOpen && canOpen(shoot) ? onOpen : undefined}
          menuItems={menuFor?.(shoot) || []}
        />)}
      </section>)}
    </div>
  </Dialog>;
}
