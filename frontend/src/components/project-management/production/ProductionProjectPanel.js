"use client";

import { useCallback, useState } from "react";
import Button from "@/components/shared/Button";
import Tabs from "@/components/ui/Tabs";
import ProjectStageView from "@/components/project-management/ProjectStageView";
import ProjectPaymentsView from "@/components/project-management/ProjectPaymentsView";
import ProjectActivityTab from "@/components/project-management/ProjectActivityTab";
import { getProjectActivity } from "@/services/project-management/project-workflow.service";
import { useModuleAccess } from "@/components/auth/PermissionsProvider";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import DepartmentStatusNote from "@/components/project-management/DepartmentStatusNote";
import ProjectShootTile from "@/components/project-management/ProjectShootTile";
import { projectProductionLabel, shootProductionStatus, shootStatusLabel, shootStepProgress } from "@/lib/productionBoard.mjs";
import { formatDay, PRODUCTION_STEPS } from "@/lib/productionSteps.mjs";
import { shootTimeLabel } from "@/lib/shootBoard.mjs";

// Where a shoot or project stands in Production, in the house status colours: grey not started, blue
// under way, green done, amber waiting or held, red rejected.
const TONES = {
  "Yet to Start": ["bg-slate-100 text-slate-600", "bg-slate-400"],
  "Work in Progress": ["bg-blue-50 text-blue-700", "bg-blue-500"],
  Planned: ["bg-emerald-50 text-emerald-700", "bg-emerald-500"],
  // On the day: violet, apart from the blue of planning still under way.
  Execution: ["bg-violet-50 text-violet-700", "bg-violet-500"],
  Travelling: ["bg-violet-50 text-violet-700", "bg-violet-500"],
  "Setting up": ["bg-violet-50 text-violet-700", "bg-violet-500"],
  "Shoot in progress": ["bg-blue-50 text-blue-700", "bg-blue-500"],
  // A shoot that has stopped, and one waiting for its footage: both are somebody's to pick up.
  Paused: ["bg-amber-50 text-amber-800", "bg-amber-500"],
  "File in pending": ["bg-amber-50 text-amber-800", "bg-amber-500"],
  "Shoot completed": ["bg-emerald-50 text-emerald-700", "bg-emerald-500"],
  Completed: ["bg-emerald-50 text-emerald-700", "bg-emerald-500"],
  Hold: ["bg-amber-50 text-amber-800", "bg-amber-500"],
  WCR: ["bg-amber-50 text-amber-800", "bg-amber-500"],
  Rejected: ["bg-red-50 text-red-700", "bg-red-500"],
};
export const productionTone = (status) => TONES[status] || TONES["Yet to Start"];

/** A production status as a pill with its dot - a shoot's, or a project's with its percentage. */
export function ProductionStatusPill({ status, label, size = "text-xs" }) {
  const [tone, dot] = productionTone(status);
  return <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 ${size} font-medium ${tone}`}>
    <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dot}`} />
    {label || status}
  </span>;
}

/** The four answers a Production Manager scans a tile for: when, what time, where, and who runs it. */
function tileRows(shoot) {
  return [
    ["Date", formatDay(shoot.shootDate) || "—"],
    ["Time", shootTimeLabel(shoot) || "—"],
    ["Place", shoot.shootPlace || "—"],
    ["Coordinator", shoot.productionCoordinator || "—"],
  ];
}

/**
 * One project on the Production board: its shoots as tiles - the same tiles as Pre Production's - in
 * the order they happen, with the main event marked. Each says where the shoot stands and how far
 * through its own steps it is. A tile opens that shoot's production panel over this one
 * (`onOpenShoot`), and closing it comes back here.
 */
/*
 * Overall Status: where the whole project stands, every stage - and a stage the viewer may change
 * carries **Update**, exactly as it does on Pre Production's own panel (the reasoning is written
 * out there). `canUpdate` grants nothing of itself: each stage asks its own permission, so a
 * viewer with Production at Read & Write and Pre Production at Read sees Production's Update and
 * not Pre Production's.
 *
 * Project Initiation carries none here either: that editor is the project's own details, opened
 * only through the Edit Project panel's `onUpdateStarted`, where the rule about editing a project
 * once it has been created lives.
 */
const PANEL_TABS = [{ id: "shoots", label: "Shoots" }, { id: "status", label: "Overall Status" }];
// The project's money, as on Edit Project and Pre Production - see `PreProductionProjectPanel`.
const PAYMENTS_TAB = { id: "payments", label: "Payments" };
// The project's whole flow, enquiry to feedback - each stage shown only to a role that may open it.
const ACTIVITY_TAB = { id: "activity", label: "Activity" };

export default function ProductionProjectPanel({ project, onOpenShoot, onClose }) {
  const [tab, setTab] = useState("shoots");
  // Shown only to somebody who may read Accounts' cash entries; absent otherwise.
  const { canRead: canReadCash } = useModuleAccess("ACCOUNTS", "Cash Management");
  const tabs = canReadCash && project.projectId ? [...PANEL_TABS, PAYMENTS_TAB, ACTIVITY_TAB] : project.projectId ? [...PANEL_TABS, ACTIVITY_TAB] : PANEL_TABS;
  const loadActivity = useCallback(() => getProjectActivity(project.projectId), [project.projectId]);
  const done = project.shoots.filter((shoot) => shootProductionStatus(shoot) === "Completed").length;
  return <SchemaFormPanel
    title={project.clientName || project.eventId || "Production"}
    // The project's own production status beside its name, as Pre Production shows its: "In progress (45%)".
    titleAddon={<ProductionStatusPill status={project.status} label={projectProductionLabel(project.shoots, PRODUCTION_STEPS)} />}
    description={`Production | ${project.eventId || ""} · ${project.shoots.length} shoot${project.shoots.length === 1 ? "" : "s"}, ${done} done`}
    tabs={<Tabs tabs={tabs} value={tab} onChange={setTab} ariaLabel="Production project sections" />}
    sections={[]}
    values={{}}
    onChange={() => {}}
    onSubmit={(event) => event.preventDefault()}
    onClose={onClose}
    closeAriaLabel="Close production shoots"
    footer={<Button className="max-sm:w-full" type="button" variant="primary" onClick={onClose}>Close</Button>}
  >
    {tab === "status" && project.projectId && <div className="w-full px-4 py-4 sm:px-6 sm:py-5"><ProjectStageView projectId={project.projectId} canUpdate /></div>}
    {tab === "payments" && canReadCash && project.projectId && <div className="w-full px-4 py-4 sm:px-6 sm:py-5"><ProjectPaymentsView projectId={project.projectId} /></div>}
    {tab === "activity" && project.projectId && <div className="w-full"><ProjectActivityTab load={loadActivity} refreshKey={project.shoots.map((shoot) => shoot.updatedAt || "").join("|")} /></div>}
    {tab === "shoots" && <div className="w-full max-w-[1040px] px-4 py-4 sm:px-6 sm:py-5">
      {/* Why the project's Production status reads what it does, when it was set by hand. */}
      <DepartmentStatusNote department="Production" status={project.shoots[0]?.productionStatus} remarks={project.shoots[0]?.productionStatusRemarks} by={project.shoots[0]?.productionStatusBy} at={project.shoots[0]?.productionStatusAt} />
      <h2 className="text-sm font-semibold text-slate-700">Shoots</h2>
      <p className="mt-1 text-xs text-slate-500">Open a shoot to plan it or work its steps. Closing it brings you back here.</p>
      <div className="mt-4 grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {project.shoots.map((shoot) => {
          const progress = shootStepProgress(shoot, PRODUCTION_STEPS);
          const status = shootProductionStatus(shoot);
          const [tone, dot] = productionTone(status);
          return <ProjectShootTile
            key={shoot.shootRecordId || shoot.id}
            title={shoot.shoot || "Shoot"}
            shootId={shoot.shootId}
            isMainEvent={shoot.isMainEvent}
            status={shootStatusLabel(shoot)}
            tone={tone}
            dot={dot}
            rows={tileRows(shoot)}
            progressText={progress.text}
            percent={progress.percent}
            done={progress.percent === 100}
            onOpen={() => onOpenShoot(shoot.shootRecordId)}
          />;
        })}
      </div>
    </div>}
  </SchemaFormPanel>;
}
