/**
 * "On Hold", beside a project's name in the title of every form panel that works on it - the project
 * itself, Pre Production, Production - and in the Projects list, so nobody updates a held project
 * without seeing that it is held. Amber, the house colour for stopped.
 *
 * Says where the hold comes from: `holds` are the departments holding one of its shoots (the server's
 * `projectHolds.js`) - "On Hold (Pre-Production)", "On Hold (Production)", both - and the project's
 * own On Hold status reads "On Hold". Beside it, "Overdue (Accounts)" or "Due (Accounts)" when a
 * payment the project is owed is - Overdue when it has both. Draws nothing when none applies, and
 * nothing for a Delivered project - a shoot still held inside it shows on that shoot.
 */
import { holdLabel, paymentsDueLabel } from "@/lib/projectHolds.mjs";

export { HOLD_STATUS, holdLabel, paymentsDueLabel } from "@/lib/projectHolds.mjs";

export default function ProjectHoldBadge({ status, holds, paymentsDue }) {
  const label = holdLabel(status, holds);
  // The money it is owed, beside the hold: red when overdue, amber when due.
  const due = paymentsDueLabel(status, paymentsDue);
  if (!label && !due) return null;
  return <>
    {label && <span className="inline-flex shrink-0 items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">{label}</span>}
    {due && <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${paymentsDue === "Overdue" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}>{due}</span>}
  </>;
}
