"use client";

import { useCallback, useState } from "react";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import Tabs from "@/components/ui/Tabs";
import ProjectActivityTab from "@/components/project-management/ProjectActivityTab";
import ProjectStageView from "@/components/project-management/ProjectStageView";
import ProjectPaymentsView from "@/components/project-management/ProjectPaymentsView";
import { useModuleAccess } from "@/components/auth/PermissionsProvider";
import { getPreProductionProjectActivity } from "@/services/project-management/pre-production.service";
import DepartmentStatusNote from "@/components/project-management/DepartmentStatusNote";
import { pendingDetailsText } from "@/lib/pendingDetails.mjs";
import { GeneralBar } from "@/components/project-management/PreProductionGeneral";
import Button from "@/components/shared/Button";
import { preProductionStorageFields } from "@/constants/preProductionVerticalFields";
import { formatDate } from "@/lib/preProductionFormat";
import { projectCompletionLabel, projectCompletionStatus, shootPlanStatus, shootProgress } from "@/lib/preProductionProgress";
import { verticalCode } from "@/components/sales/whatsappGroupNameUtils";
import ProjectHoldBadge from "@/components/project-management/ProjectHoldBadge";
import ProjectShootTile from "@/components/project-management/ProjectShootTile";

/*
 * One project's shoots, laid out as cards to work through.
 *
 * A wedding is several shoots and the coordinator prepares them one at a time, so Edit Pre
 * Production opens here rather than straight into a form: every shoot of the project on one
 * screen, each card saying how far along it is, and clicking one opens that shoot's own form over
 * this panel. Saving brings the coordinator back to the cards with the one they finished updated,
 * which is the loop they actually work in — pick a shoot, fill it in, pick the next.
 */

// The house status colours: grey not started, blue in progress, green done, amber waiting or held,
// red rejected. A shoot's and the project's statuses alike.
const statusTone = {
  "Yet to Start": "bg-slate-100 text-slate-600",
  "Work in Progress": "bg-blue-50 text-blue-700",
  Planned: "bg-emerald-50 text-emerald-700",
  WCR: "bg-amber-50 text-amber-800",
  Hold: "bg-amber-50 text-amber-800",
  Rejected: "bg-red-50 text-red-700",
};

function isOverdue(row) {
  if (!row.nextFollowupDate || row.completionStatus === "Planned") return false;
  const due = new Date(row.nextFollowupDate);
  if (Number.isNaN(due.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}

/**
 * The four answers a coordinator scans a card for: when, where, and the two times that decide the
 * day. Deliberately not everything the shoot holds — a card is for picking which shoot to work on,
 * and twenty rows of "—" is a wall to read rather than a choice to make. The rest is one click
 * away, in the form the card opens.
 */
function tileRows(row) {
  return [
    ["Date", formatDate(row.subEventDate)],
    ["Place", [row.shootPlace, row.district].filter(Boolean).join(", ") || "—"],
    ["Event", row.eventStartTime ? `${row.eventStartTime}${row.eventEndTime ? `–${row.eventEndTime}` : ""}` : "—"],
    ["Reporting", row.reportingTime || "—"],
  ];
}

const statusDot = {
  "Yet to Start": "bg-slate-400",
  "Work in Progress": "bg-blue-500",
  Planned: "bg-emerald-500",
  WCR: "bg-amber-500",
  Hold: "bg-amber-500",
  Rejected: "bg-red-500",
};

function ShootTile({ row, onOpen }) {
  const status = row.completionStatus || "Work in Progress";
  const { pending, percent } = shootProgress(row);
  return <ProjectShootTile
    title={row.shoot || "Shoot"}
    shootId={row.shootId}
    isMainEvent={row.isMainEvent}
    status={status}
    tone={statusTone[status]}
    dot={statusDot[status]}
    rows={tileRows(row)}
    tags={isOverdue(row) ? ["Follow-up overdue"] : []}
    progressText={pendingDetailsText(pending)}
    percent={percent}
    done={pending === 0}
    onOpen={() => onOpen(row)}
  />;
}

// The project's shoots as tiles, and - beside them - everything done to it from Pre Production.
/*
 * Overall Status: where the whole project stands, every stage - and a stage the viewer may change
 * carries **Update**.
 *
 * It was read-only here, which meant somebody holding Pre Production at Read & Write had to leave
 * this panel and find the shoot again to do what the tab was already showing them. `canUpdate`
 * does not grant anything: `ProjectStageView.updateFor` asks each stage's own permission, so
 * Pre Production's Update shows on Pre Production's permission and Production's on Production's -
 * one without the other shows one button and not the other.
 *
 * **Project Initiation never carries one here.** That stage's editor is the project's own details,
 * which `ProjectStageView` opens only through `onUpdateStarted` - the Edit Project panel's, where
 * the started-project rule decides who may change a project once it has been created. This panel
 * does not pass it, so the tab cannot become a way round that rule.
 */
const PANEL_TABS = [{ id: "shoots", label: "Shoots" }, { id: "status", label: "Overall Status" }, { id: "activity", label: "Activity" }];
const PAYMENTS_TAB = { id: "payments", label: "Payments" };

export default function PreProductionProjectPanel({ rows, onBack, onClose, onOpenShoot, onOpenGeneral, followups }) {
  const first = rows[0];
  const [tab, setTab] = useState("shoots");
  /*
   * Payments: the project's money, the same section Edit Project shows (`ProjectPaymentsView`), on
   * the same project. Shown to somebody who may read Accounts' cash entries - the server asks that
   * and this board (`/projects/:id/payments`); without it the tab is not there at all. Recording
   * cash and raising extras each ask their own permission inside it.
   */
  const { canRead: canReadCash } = useModuleAccess("ACCOUNTS", "Cash Management");
  const tabs = canReadCash && first?.projectId ? [...PANEL_TABS.slice(0, 2), PAYMENTS_TAB, ...PANEL_TABS.slice(2)] : PANEL_TABS;
  const loadActivity = useCallback(() => getPreProductionProjectActivity(first?.projectId), [first?.projectId]);
  const done = rows.filter((row) => shootPlanStatus(row) === "Planned").length;
  // The project's own pre production status, from its shoots' details (each tile shows its shoot's):
  // Yet to Start, Work in Progress (n%) or Planned - shown beside the project's name in the title.
  const projectStatus = projectCompletionStatus(rows);
  const projectLabel = projectCompletionLabel(rows);

  return <SchemaFormPanel
    title={first?.clientName || first?.eventId || "Pre Production"}
    titleAddon={<>
      <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${statusTone[projectStatus] || statusTone["Yet to Start"]}`}>
        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${statusDot[projectStatus] || statusDot["Yet to Start"]}`} />
        {projectLabel}
      </span>
      <ProjectHoldBadge status={first?.projectStatus} holds={first?.holds} paymentsDue={first?.paymentsDue} />
    </>}
    description={`Pre Production | ${first?.eventId || ""}${first?.product ? ` · ${verticalCode(first.product)}` : ""} · ${rows.length} shoot${rows.length === 1 ? "" : "s"}, ${done} planned`}
    tabs={<Tabs tabs={tabs} value={tab} onChange={setTab} ariaLabel="Pre production project sections" />}
    sections={[]}
    values={{}}
    onChange={() => {}}
    onSubmit={(event) => event.preventDefault()}
    onBack={onBack}
    backAriaLabel="Back"
    onClose={onClose}
    closeAriaLabel="Close pre production shoots"
    footer={<Button className="max-sm:w-full" type="button" variant="primary" onClick={onClose}>Close</Button>}
    // The project's follow-ups stay beside the cards while they scroll: the shoots are the work,
    // the follow-ups the chase that runs alongside it.
    aside={followups}
    asideAriaLabel="Project follow-ups"
  >
    {/* Re-read whenever the shoots change, so a save made a moment ago is already listed. */}
    {tab === "status" && first?.projectId && <div className="w-full px-4 py-4 sm:px-6 sm:py-5"><ProjectStageView projectId={first.projectId} canUpdate /></div>}
    {tab === "activity" && <div className="w-full"><ProjectActivityTab load={loadActivity} refreshKey={rows.map((row) => row.updatedAt).join("|")} /></div>}
    {tab === "payments" && canReadCash && first?.projectId && <div className="w-full px-4 py-4 sm:px-6 sm:py-5"><ProjectPaymentsView projectId={first.projectId} stacked /></div>}
    {tab === "shoots" && <div className="w-full max-w-[1040px] px-4 py-4 sm:px-6 sm:py-5">
      {/* Why the project's Pre Production status reads what it does, when it was set by hand. */}
      <DepartmentStatusNote department="Pre Production" status={first?.preProductionStatus} remarks={first?.preProductionStatusRemarks} by={first?.preProductionStatusBy} at={first?.preProductionStatusAt} />
      <GeneralBar project={first} onOpen={onOpenGeneral} />
      <h2 className="mt-6 text-sm font-semibold text-slate-700">Shoots</h2>
      <p className="mt-1 text-xs text-slate-500">Open a shoot to fill in its pre production details. Saving brings you back here.</p>
      <div className="mt-4 grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => <ShootTile key={row.id} row={row} onOpen={onOpenShoot} />)}
      </div>
    </div>}
  </SchemaFormPanel>;
}
