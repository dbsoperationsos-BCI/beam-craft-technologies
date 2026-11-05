"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import CheckRounded from "@mui/icons-material/CheckRounded";
import { useModuleAccess } from "@/components/auth/PermissionsProvider";
import Button from "@/components/shared/Button";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import Loader from "@/components/shared/Loader";
import HelpTip from "@/components/shared/HelpTip";
import PreProductionProjectEditor from "@/components/project-management/PreProductionProjectEditor";
import DepartmentStatusNote from "@/components/project-management/DepartmentStatusNote";
import ProductionPendingPill from "@/components/project-management/production/ProductionPendingPill";
import ProductionShootPanel from "@/components/project-management/production/ProductionShootPanel";
import CrdDocumentViewPanel from "@/components/sales/CrdDocumentViewPanel";
import { shootCompletionStatus } from "@/lib/preProductionProgress";
import { getPreProductionOptions, getPreProductionRows } from "@/services/project-management/pre-production.service";
import { getProjectCrdResponse, getProjectStage } from "@/services/project-management/project-workflow.service";

// The house status colours (Pre Production's cards, Tasks): grey not started, blue in progress, amber
// waiting, green done - one meaning per colour, wherever a status is shown.
const STATE_TAGS = {
  done: ["Done", "bg-emerald-50 text-emerald-700"],
  current: ["In progress", "bg-blue-50 text-blue-700"],
  upcoming: ["Not started yet", "bg-slate-100 text-slate-600"],
};
const PILL = "inline-flex max-w-full items-center truncate rounded-full px-2 py-0.5 text-xs font-medium";

/** What each stage means, and what each fact the server sends for it means, for somebody new to the tab. */
const STAGE_HELP = {
  STARTED: "Done once the project leaves Yet to Start, which happens when Start Project is saved and its team is named.",
  PRE_PRODUCTION: "Planning the shoots with the client. Done once every shoot's production plan is submitted, or when it is set to Planned by hand.",
  PRODUCTION: "The shoot days. Done once every shoot has finished its last production step, or when it is set to Completed by hand.",
  POST_PRODUCTION: "Editing and making the deliverables, from the end of the shoots until the project is Completed.",
  DELIVERED: "Done once the project's status is Completed.",
};
const FACT_HELP = {
  "Converted by": "The CRM (salesperson) who booked this sale.",
  "Converted on": "The day the sale was booked as a project.",
  "Converted value": "The amount the sale was signed for when it was booked, before any extras.",
  "Enquiry ID": "The enquiry (CRM lead) this project was booked against.",
  Branch: "The branch the project belongs to.",
  Vertical: "The brand the project is sold under: Dum Dum, Qua Qua or Corp.",
  "Main event date": "The day of the main event, from the shoot marked as the main event.",
  "Project manager": "The employee who owns this project from start to delivery, named on Start Project.",
  "Recorded by": "The user who saved the booking in the app.",
  "Pre-production coordinator": "The employee who plans the shoots with the client, named on Start Project.",
  "Creative manager": "The employee who leads the creative side of this project, named on Start Project.",
  "Production plans submitted": "How many shoots have had their production plan submitted, out of all the project's shoots.",
  "Production manager": "The employee who runs the shoot days and the crew, named on Start Project.",
  "Shoots finished": "How many shoots have finished their last production step, out of all the project's shoots.",
  "Post-production coordinator": "The employee who sees editing and deliverables through to delivery, named on Start Project.",
};

function formatFact({ value, kind }) {
  if (value === null || value === undefined || value === "") return null;
  if (kind === "date") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date);
  }
  if (kind === "money") return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(value));
  return String(value);
}

/** What a stage's count means, said the way the studio would say it. */
const COUNT_WORDS = { PRE_PRODUCTION: "planned", PRODUCTION: "shot" };

/**
 * How far along the track is filled, 0-1: up to the stage in progress, plus that stage's finished
 * share on towards the next, so a project half way through its shoots sits half way along.
 */
function trackFill(stages) {
  const gaps = stages.length - 1;
  if (gaps <= 0) return 0;
  const doneCount = stages.filter((stage) => stage.state === "done").length;
  if (doneCount === stages.length) return 1;
  const current = stages.find((stage) => stage.state === "current");
  const part = current?.total ? current.done / current.total : 0;
  return Math.min(1, (doneCount + part) / gaps);
}

function Marker({ state }) {
  if (state === "done") {
    return <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white"><CheckRounded style={{ fontSize: 16 }} /></span>;
  }
  if (state === "current") {
    return <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-blue-600 bg-white"><span className="h-2.5 w-2.5 rounded-full bg-blue-600" /></span>;
  }
  return <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-slate-200 bg-white" />;
}

function stageNote(stage) {
  if (stage.total && COUNT_WORDS[stage.id]) return `${stage.done} of ${stage.total} ${COUNT_WORDS[stage.id]}`;
  if (stage.state === "done") return "Done";
  if (stage.state === "current") return "In progress";
  return "";
}

/** The five stages across the width from md up; a short vertical list on a phone. */
function StageTrack({ stages, selectedId, onSelect }) {
  const fill = trackFill(stages);
  return <>
    <ol className="relative hidden grid-cols-5 md:grid" aria-label="Project stages">
      <span aria-hidden="true" className="absolute left-[10%] right-[10%] top-3.5 h-1 rounded-full bg-slate-100" />
      <span aria-hidden="true" className="absolute left-[10%] top-3.5 h-1 rounded-full bg-blue-600 transition-[width] duration-700" style={{ width: `${fill * 80}%` }} />
      {stages.map((stage) => {
        const picked = stage.id === selectedId;
        return <li key={stage.id} aria-current={stage.state === "current" ? "step" : undefined} className="relative flex flex-col items-center px-1">
          <Button type="button" variant="plain" size="none" aria-pressed={picked} onClick={() => onSelect(stage.id)} className="flex-col gap-2 text-center">
            <Marker state={stage.state} />
            <span className={`text-sm font-semibold ${picked ? "text-blue-700" : stage.state === "upcoming" ? "text-slate-400" : "text-slate-900"}`}>{stage.label}</span>
            <span className={`text-xs ${stage.state === "current" ? "font-medium text-blue-700" : "text-slate-500"}`}>{stageNote(stage) || "\u00a0"}</span>
            {/* The stage whose details are open below: a short bar under it, pointing down to them. */}
            <span aria-hidden="true" className={`h-1 w-8 rounded-full ${picked ? "bg-blue-600" : "bg-transparent"}`} />
          </Button>
        </li>;
      })}
    </ol>
    <ol className="flex flex-col md:hidden" aria-label="Project stages">
      {stages.map((stage, index) => <li key={stage.id} aria-current={stage.state === "current" ? "step" : undefined} className="relative flex items-start gap-3 pb-4 last:pb-0">
        {index < stages.length - 1 && <span aria-hidden="true" className={`absolute left-[13px] top-[36px] bottom-0 w-0.5 ${stage.state === "done" ? "bg-blue-600" : "bg-slate-200"}`} />}
        <Button type="button" variant="plain" size="none" aria-pressed={stage.id === selectedId} onClick={() => onSelect(stage.id)} className="min-h-11 w-full justify-start gap-3 text-left">
          <Marker state={stage.state} />
          <span className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
            <span className={`text-sm font-semibold ${stage.id === selectedId ? "text-blue-700 underline decoration-2 underline-offset-4" : stage.state === "upcoming" ? "text-slate-400" : "text-slate-900"}`}>{stage.label}</span>
            <span className={`shrink-0 text-xs ${stage.state === "current" ? "font-medium text-blue-700" : "text-slate-500"}`}>{stageNote(stage)}</span>
          </span>
        </Button>
      </li>)}
    </ol>
  </>;
}

const DATE_TIME = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

/** The remarks left when this stage was updated from here, newest first. */
function StageHistory({ updates }) {
  if (!updates.length) return null;
  return <div className="mt-6">
    <h5 className="mb-1 flex items-center text-sm font-semibold text-slate-900">Updates<HelpTip text="The remarks left each time this stage was updated from this tab, newest first." /></h5>
    <ul className="divide-y divide-slate-100 border-y border-slate-100">
      {updates.map((update) => <li key={update.id} className="py-2.5">
        <p className="whitespace-pre-line break-words text-sm text-slate-800">{update.remark}</p>
        <p className="mt-0.5 text-xs text-slate-500">{update.by} · {DATE_TIME.format(new Date(update.at))}</p>
      </li>)}
    </ul>
  </div>;
}

/**
 * The selected stage: what it holds so far, or that it has not started yet. `onUpdate` is given
 * only where the viewer may update this stage, and `onUpdateShoot` only on Production, where each
 * shoot is updated on its own.
 */
/**
 * The Pre Production stage's CRD document - shown only when the project needs one - as Submitted or
 * Not submitted, with a View that opens what the client submitted, read-only: no share link is
 * offered or made from here.
 */
function CrdDocumentLine({ projectId, crd }) {
  const [viewing, setViewing] = useState(false);
  const loadResponse = useCallback(() => getProjectCrdResponse(projectId), [projectId]);
  // One line: the name, its status beside it, and View at the end.
  return <div className="mt-6">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-y border-slate-100 py-2.5">
      <span className="flex items-center text-sm font-semibold text-slate-900">CRD Document<HelpTip text="The client requirement document the client fills in for this project. Submitted once they send it back." /></span>
      <span className={`${PILL} ${crd.submitted ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{crd.submitted ? "Submitted" : "Not submitted"}</span>
      {crd.submitted && crd.documentId && <Button type="button" size="sm" className="ml-auto" onClick={() => setViewing(true)}>View</Button>}
    </div>
    {viewing && <CrdDocumentViewPanel
      readOnly
      layer="dialogOverPanel"
      row={{ crdDocument: { id: crd.documentId, submittedAt: crd.submittedAt } }}
      loadResponse={loadResponse}
      onClose={() => setViewing(false)}
    />}
  </div>;
}

function StageDetails({ projectId, stage, updates, onUpdate, onUpdateShoot }) {
  const [tagText, tagTone] = STATE_TAGS[stage.state] || STATE_TAGS.upcoming;
  const facts = (stage.facts || []).map((item) => ({ ...item, text: formatFact(item) }));
  const known = facts.filter((item) => item.text);
  const shoots = ["PRE_PRODUCTION", "PRODUCTION"].includes(stage.id) ? stage.shoots || [] : [];
  const nothingYet = stage.state === "upcoming" && known.length === 0;
  // Somebody who may update a shoot sees the shoots even before the stage begins, to set them up.
  const showShoots = shoots.length > 0 && (stage.state !== "upcoming" || Boolean(onUpdateShoot));

  return <section aria-live="polite" className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
    {/* The status reads with the name it belongs to; the one action stands apart on the right. */}
    <div className="flex flex-wrap items-center gap-2">
      <h4 className="flex items-center text-lg font-semibold text-slate-900">{stage.label}<HelpTip text={STAGE_HELP[stage.id]} /></h4>
      <span className={`${PILL} ${tagTone}`}>{tagText}</span>
      {onUpdate && <Button type="button" variant="primary" size="sm" className="ml-auto" onClick={onUpdate}>Update</Button>}
    </div>
    {/* The stage's overall status set by hand on its board, which overrides what its shoots say;
        the shoots below keep their own. */}
    {stage.setStatus && <DepartmentStatusNote department={stage.label} className="mt-4" {...stage.setStatus} />}

    {nothingYet && !showShoots
      ? <p className="mt-3 text-sm text-slate-500">Not started yet. Details show here once this stage begins.</p>
      : <>
        {stage.state === "upcoming" && <p className="mt-3 text-sm text-slate-500">Not started yet. Here is what is already set up for it.</p>}
        {facts.length > 0 && <dl className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          {facts.map((item) => <div key={item.label} className="min-w-0">
            <dt className="flex items-center text-xs text-slate-500">{item.label}<HelpTip text={FACT_HELP[item.label]} /></dt>
            <dd className={`mt-0.5 truncate text-sm ${item.text ? "font-medium text-slate-900" : "text-slate-400"}`}>{item.text || "Not recorded"}</dd>
          </div>)}
        </dl>}
        {stage.id === "PRE_PRODUCTION" && stage.crd && <CrdDocumentLine projectId={projectId} crd={stage.crd} />}
        {showShoots && <div className="mt-6">
          <h5 className="mb-1 flex items-center text-sm font-semibold text-slate-900">Shoots<HelpTip text={stage.id === "PRE_PRODUCTION" ? "Each shoot, and whether its production plan has been submitted yet." : "Each shoot, and the production step it is waiting on."} /></h5>
          <ul className="divide-y divide-slate-100 border-y border-slate-100">
            {shoots.map((shoot) => <li key={shoot.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
              <span className="min-w-0 truncate text-sm font-medium text-slate-800">{shoot.name}</span>
              {stage.id === "PRE_PRODUCTION"
                ? <span className={`${PILL} ${shoot.planned ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{shoot.planned ? `Plan submitted ${formatFact({ value: shoot.plannedAt, kind: "date" }) || ""}`.trim() : "Awaiting plan"}</span>
                : <ProductionPendingPill label={shoot.pending} />}
              {onUpdateShoot && shoot.hasProduction && <Button type="button" variant="primary" size="sm" className="ml-auto" onClick={() => onUpdateShoot(shoot)}>Update</Button>}
            </li>)}
          </ul>
        </div>}
      </>}
    <StageHistory updates={updates} />
  </section>;
}

/**
 * One project's pre production opened from the Status tab: its rows read from the same board the
 * coordinator works, so a save here is the board's save. The board lists only the shoots the viewer
 * is the named coordinator of (a Super Admin sees all), so somebody who is not is told so instead.
 */
function PreProductionStageEditor({ projectId, canWrite, onClose, onChanged, onSuccess, onError }) {
  const [rows, setRows] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [branches, setBranches] = useState([]);
  const withStatus = (row) => ({ ...row, completionStatus: shootCompletionStatus(row) });

  const load = useCallback(async () => {
    try {
      const response = await getPreProductionRows();
      const mine = (response?.data || []).filter((row) => row.projectId === projectId).map(withStatus);
      if (!mine.length) {
        // Either nothing is raised yet (not started, or no coordinator named) or it is not this
        // viewer's to open - the board answers the same empty list for both, so both are said.
        onError("No pre production shoots are open to you for this project. They appear once it is started with a Pre Production Coordinator, for that coordinator, a Super Admin or somebody who may work every project.");
        onClose();
        return;
      }
      setRows(mine);
    } catch (loadError) {
      onError(loadError.message || "Unable to load pre production.");
      onClose();
    }
  }, [onClose, onError, projectId]);

  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);
  useEffect(() => {
    if (!canWrite) return;
    getPreProductionOptions().then((response) => { setEmployees(response?.data?.employees || []); setBranches(response?.data?.branches || []); }).catch(() => {});
  }, [canWrite]);

  if (!rows) return <Loader label="Opening pre production..." className="py-10" />;
  return <PreProductionProjectEditor
    rows={rows}
    employees={employees}
    branches={branches}
    canWrite={canWrite}
    onBack={onClose}
    onClose={onClose}
    onRowSaved={(saved) => { setRows((current) => current.map((row) => (row.id === saved.id ? withStatus(saved) : row))); onChanged(); }}
    // The follow-ups are the project's, so every shoot row carries the list the server answers with.
    onFollowups={(summary) => {
      if (!summary?.projectId) return;
      setRows((current) => current.map((row) => ({ ...row, ...summary })));
      onChanged();
    }}
    onReload={async () => { await load(); onChanged(); }}
    onSuccess={onSuccess}
    onError={onError}
  />;
}

/**
 * The Status tab of Project Management's project panel: where the project is among its five
 * stages, the state of each shoot, and who holds each stage. What counts as done is decided on the
 * server (`sales/projects/stage.js`).
 *
 * With `canUpdate` (the Edit / Start Project panel, never the read-only record) a stage the viewer
 * may change carries Update, which opens **that stage's own editor** on top - the project's details
 * (`onUpdateStarted`, handled by the panel around this), the pre production shoot cards and forms,
 * or a shoot's production - so a save writes the same records those screens do and shows
 * everywhere. Back or Close returns here straight away, and Production also comes back once its plan
 * is saved. Only the project's details (Project started, in the panel around this) ask a remark,
 * kept in the stage's history. Who may update follows the stage's own permission
 * (`PROJECT / Pre Production`, `PROJECT / Production`), and each editor still asks the server.
 *
 * **Project Initiation** is the one whose editor is not here: it is the project's own form, this
 * page's own owner being Projects. Inside Edit Project the panel around this opens it
 * (`onUpdateStarted`); from a board this goes to Projects with the project named in the address.
 * Either way it is offered on the server's `canUpdateStarted` - the permission that opens the form,
 * and, once the project has started, being its Project Manager, a branch administrator or whoever
 * works every project.
 */
export default function ProjectStageView({ projectId, canUpdate = false, onUpdateStarted }) {
  const [stage, setStage] = useState(null);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  // The stage open in its editor: { id: "PRE_PRODUCTION" } or { id: "PRODUCTION", shootId }.
  const [editing, setEditing] = useState(null);
  const { notice, showSuccess, showError, clearNotice } = useNotice();
  const router = useRouter();
  const preProductionAccess = useModuleAccess("PROJECT", "Pre Production");
  const productionAccess = useModuleAccess("PROJECT", "Production");

  const load = useCallback(async () => {
    try {
      const response = await getProjectStage(projectId);
      setStage(response?.data || null);
    } catch (loadError) {
      setError(loadError.message || "Unable to load the project status.");
    }
  }, [projectId]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);

  // Back or Close from a stage's editor: straight back here, the status read again for what it saved.
  const finishEditing = useCallback(() => {
    setEditing(null);
    void load();
  }, [load]);

  if (error) return <p className="px-1 py-6 text-sm text-red-600">{error}</p>;
  if (!stage) return <Loader label="Loading project status..." className="py-10" />;

  const stages = stage.stages || [];
  const current = stages.find((item) => item.state === "current");
  const delivered = stages.length > 0 && stages.every((item) => item.state === "done");
  // The stage in progress opens first; once everything is done, the last one.
  const selected = stages.find((item) => item.id === selectedId) || current || stages[stages.length - 1];

  const updateFor = (item) => {
    if (!canUpdate) return undefined;
    /*
     * **Project Initiation** opens the project's own form, which is a screen rather than a section:
     * where this view sits inside that form already (Edit Project), the panel around it opens it
     * (`onUpdateStarted`); anywhere else - the Pre Production and Production project panels - this
     * hands it to Projects, where that editor lives, with the project named in the address so it
     * opens on it. One owner for the project's form and its autosave, rather than a second copy of
     * both on two more boards.
     *
     * Offered on `stage.canUpdateStarted`, which is the server's answer to the two rules the save
     * itself answers to - the permission that opens the form, and, on a started project, being its
     * Project Manager, a branch administrator or whoever works every project. So a Project Manager,
     * a Super Admin and a branch administrator each get it; somebody who would be refused does not.
     */
    if (item.id === "STARTED") {
      if (onUpdateStarted) return onUpdateStarted;
      if (!stage.canUpdateStarted || !stage.eventId) return undefined;
      return () => router.push(`/project-management/projects?project=${encodeURIComponent(stage.eventId)}&edit=1`);
    }
    if (item.id === "PRE_PRODUCTION" && preProductionAccess.canWrite) return () => setEditing({ id: "PRE_PRODUCTION" });
    return undefined;
  };
  const updateShoot = canUpdate && selected?.id === "PRODUCTION" && productionAccess.canWrite
    ? (shoot) => setEditing({ id: "PRODUCTION", shootId: shoot.id })
    : undefined;

  return <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
    <FloatingNotice notice={notice} onClose={clearNotice} />
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <div className="min-w-0">
        <h3 className="text-2xl font-semibold tracking-tight text-slate-900">{delivered ? "Delivered" : current?.label || "—"}</h3>
        <p className="mt-1 text-sm text-slate-500">
          {delivered ? "Every stage is done." : `Stage ${stages.indexOf(current) + 1} of ${stages.length}${current?.total ? `, ${stageNote(current)}` : ""}`}
        </p>
      </div>
      <span className="flex items-center rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">{stage.projectStatus}<HelpTip text="The project's own status: Yet to Start, In Progress, On Hold, Rejected or Completed." /></span>
    </header>

    {stage.flag && <p role="status" className="-mt-4 rounded-md border-l-4 border-amber-500 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
      This project is {stage.flag}. The track shows how far it got before that.
    </p>}

    <StageTrack stages={stages} selectedId={selected?.id} onSelect={setSelectedId} />

    {selected && <StageDetails
      projectId={projectId}
      stage={selected}
      updates={(stage.updates || []).filter((update) => update.stage === selected.id)}
      onUpdate={updateFor(selected)}
      onUpdateShoot={updateShoot}
    />}

    {/* Each editor behaves as on its own page and returns here straight away - no remark asked;
        its saves are already its own record. Production also comes back once its plan is saved. */}
    {editing?.id === "PRE_PRODUCTION" && <PreProductionStageEditor
      projectId={projectId}
      canWrite={preProductionAccess.canWrite}
      onClose={finishEditing}
      onChanged={() => {}}
      onSuccess={showSuccess}
      onError={showError}
    />}
    {editing?.id === "PRODUCTION" && <ProductionShootPanel
      shootId={editing.shootId}
      canWrite={productionAccess.canWrite}
      onBack={finishEditing}
      onClose={finishEditing}
      onChanged={(message) => { if (message) showSuccess(message); }}
    />}
  </div>;
}
