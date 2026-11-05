"use client";

import { useCallback, useEffect, useState } from "react";
import EmployeeAvatar from "@/components/shared/EmployeeAvatar";
import Loader from "@/components/shared/Loader";
import { getEmployeeOrgChart } from "@/services/hrm/org-chart.service";

/**
 * The reporting lines around one employee, drawn from `employee.reportsToEmployeeId`.
 *
 * Read top to bottom: the chain up to whoever reports to nobody, then the person the tab was opened
 * on, then everybody reporting directly to them, then everybody else sharing their manager. Clicking
 * any other node re-centres the chart on that person, which is how the whole studio is walked
 * without ever loading the whole studio — each view is one request for one person.
 *
 * The chart is never held whole on the client on purpose. A tree of every employee is far more than
 * a panel needs, and the shape of it changes the moment anybody is re-pointed.
 */

/**
 * One person's card. A button whenever it is somebody else, because every other node re-centres the
 * view; the focused node is the one already being read, so it is text rather than a control.
 *
 * Carries what identifies somebody on a chart and nothing a profile would: designation and
 * department, the branch they work out of, and the identifiers under their name — employee ID and,
 * where they have signed in before, their username. There is deliberately no "View profile" here;
 * this card's whole job is to be clicked into the next person's chart, not to open a record.
 */
function Node({ node, variant, onOpen }) {
  const isFocus = variant === "focus";
  const reports = node.directReportCount || 0;
  const title = [node.designation, node.department].filter(Boolean).join(" · ");

  const base = "w-full max-w-xs rounded-lg border px-3 py-2 text-left transition-colors";
  // The focused card is marked by its outline alone — same white ground and same text colours as
  // every other node, with a heavier blue border and ring around it. Nothing inside it changes, so
  // a name reads identically wherever it appears on the chart.
  const tone = isFocus
    ? "border-blue-600 bg-white ring-2 ring-blue-500"
    : "border-slate-200 bg-white hover:border-blue-400 hover:bg-blue-50/60";

  const body = <span className="flex min-w-0 items-center gap-2.5">
    {/* The face first: on a chart of look-alike cards it is the fastest thing to recognise.
        Seeded by the row id, so the four initial colours stay with their people. */}
    <EmployeeAvatar name={node.employeeName} photoUrl={node.profilePhotoUrl} seed={node.id} size="md" />
    <span className="min-w-0 flex-1">
      <p className="truncate text-sm font-semibold text-slate-800">{node.employeeName}</p>
      {/* Designation and department, the way a title reads on a chart everywhere else in the OS. */}
      {title && <p className="truncate text-xs text-slate-500">{title}</p>}
      {/* The branch a person works out of — the same field the rest of the app already reads as
          "branch" for anybody with no project of their own to take it from. */}
      {node.workBaseLocation && <p className="truncate text-xs text-slate-500">{node.workBaseLocation}</p>}
      <p className="mt-0.5 truncate text-[11px] text-slate-400">
        {node.employeeId}
        {/* Only for a login that has actually signed in before; most nodes on a chart have none. */}
        {node.username && <span className="ml-2">@{node.username}</span>}
        {reports > 0 && <span className="ml-2 text-slate-500">{reports} report{reports === 1 ? "" : "s"}</span>}
      </p>
    </span>
  </span>;

  if (isFocus) return <div className={`${base} ${tone}`} aria-current="true">{body}</div>;

  return <button type="button" onClick={() => onOpen(node.id)} className={`${base} ${tone}`} aria-label={`View ${node.employeeName}'s reporting chart`}>
    {body}
  </button>;
}

/** The line joining one node to the next. Purely decorative, so it is hidden from a screen reader. */
function Connector() {
  return <span aria-hidden="true" className="my-1 block h-4 w-px bg-slate-300" />;
}

/**
 * Everybody above the immediate manager, collapsed to a row of faces rather than a wall of cards.
 *
 * A chart several levels deep used to stack a full card per manager, which pushed the person the
 * tab was actually opened on off the bottom of the screen. Only the nearest manager keeps a full
 * card here; the rest are a row of clickable faces with a count beside them, the way the app's own
 * "+N" avatar stacks already read elsewhere. Each face still jumps straight to that manager's own
 * chart — "Show N more" is for reading the names, not for reaching them.
 */
function ChainStrip({ managers, onOpen, onExpand }) {
  return <div className="mb-3 flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm">
    <div className="flex -space-x-2">
      {managers.map((manager) => <button key={manager.id} type="button" onClick={() => onOpen(manager.id)} title={manager.employeeName} aria-label={`View ${manager.employeeName}'s reporting chart`} className="rounded-full ring-2 ring-white transition hover:z-10 hover:ring-blue-300">
        <EmployeeAvatar name={manager.employeeName} photoUrl={manager.profilePhotoUrl} seed={manager.id} size="sm" />
      </button>)}
    </div>
    <button type="button" onClick={onExpand} className="text-xs font-medium text-blue-600 hover:text-blue-800">
      Show {managers.length} more
    </button>
  </div>;
}

/** A rule with a label centred on it, for the section under the chart that is not part of the tree. */
function SectionRule({ label }) {
  return <div className="mb-3 mt-6 flex w-full items-center gap-3">
    <span aria-hidden="true" className="h-px flex-1 bg-slate-200" />
    <p className="shrink-0 text-xs font-medium text-slate-500">{label}</p>
    <span aria-hidden="true" className="h-px flex-1 bg-slate-200" />
  </div>;
}

/**
 * `fetchChart` lets a caller swap the request the chart is drawn from: the Employee Repository
 * uses the HRM-guarded route by default, and My Profile passes the self-service one every
 * signed-in person may read.
 */
export default function EmployeeOrgChart({ employeeId, employeeName, fetchChart = getEmployeeOrgChart }) {
  const [chart, setChart] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Which person the chart is drawn around. Starts at the row the tab was opened on and moves as
  // nodes are clicked, so the panel behind it never has to know the view has changed.
  const [focusId, setFocusId] = useState(employeeId);
  // Whether the chain above the immediate manager is drawn as full cards. Collapses again on every
  // re-centre, so walking the chart never leaves yesterday's expansion sitting open on a person it
  // was never asked of.
  const [chainExpanded, setChainExpanded] = useState(false);

  // Re-opening the tab on a different row must start that row's chart, not keep the last one.
  useEffect(() => { setFocusId(employeeId); }, [employeeId]);
  useEffect(() => { setChainExpanded(false); }, [focusId]);

  const load = useCallback(async (id) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetchChart(id);
      setChart(response.data);
    } catch (requestError) {
      setChart(null);
      setError(requestError.status === 403
        ? "You do not have access to the reporting chart."
        : requestError.message || "Unable to load the reporting chart.");
    } finally {
      setLoading(false);
    }
  }, [fetchChart]);

  // A null focus is a real question, not a missing one: the self-service route answers it with
  // the caller's own chart, or the top of the studio for a login with no employee record.
  useEffect(() => { void load(focusId); }, [focusId, load]);

  if (loading && !chart) return <Loader label="Loading the reporting chart..." />;
  if (error) return <p className="px-1 py-6 text-sm text-red-600">{error}</p>;
  if (!chart) return null;

  // Nearest manager first from the server; drawn top-down, so the topmost person comes first.
  const managers = [...(chart.managers || [])].reverse();
  const reports = chart.directReports || [];
  const peers = chart.peers || [];
  // Only the closest manager gets a full card in the tree itself; anybody further up is offered
  // through the collapsed strip above it instead.
  const nearestManager = managers[managers.length - 1];
  const higherManagers = managers.slice(0, -1);

  return <div className="flex w-full flex-col items-center gap-0 pb-4">
    {chart.chainBrokenAt && (
      <p className="mb-3 w-full rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        {chart.chainBrokenAt === "cycle"
          ? "The reporting line above this point loops back on itself, so it cannot be followed to the top. Correct it from the employee form."
          : "The reporting line above this point is too long to follow and has been cut short."}
      </p>
    )}

    {managers.length === 0 && !chart.employee.reportsToEmployeeId && (
      <p className="mb-3 text-xs text-slate-500">Reports to nobody — this is the top of the chart.</p>
    )}

    {higherManagers.length > 0 && !chainExpanded && (
      <ChainStrip managers={higherManagers} onOpen={setFocusId} onExpand={() => setChainExpanded(true)} />
    )}
    {higherManagers.length > 0 && chainExpanded && <>
      {higherManagers.map((manager) => <div key={manager.id} className="flex w-full flex-col items-center">
        <Node node={manager} variant="manager" onOpen={setFocusId} />
        <Connector />
      </div>)}
      <button type="button" onClick={() => setChainExpanded(false)} className="mb-2 text-xs font-medium text-blue-600 underline underline-offset-2 hover:text-blue-800">
        Show less
      </button>
    </>}

    {nearestManager && <div className="flex w-full flex-col items-center">
      <Node node={nearestManager} variant="manager" onOpen={setFocusId} />
      <Connector />
    </div>}

    <Node node={chart.employee} variant="focus" />

    {reports.length > 0 && <>
      <Connector />
      {/* Wraps rather than scrolls sideways: a manager with eight reports must still read at 360px,
          where a row of cards would otherwise run off the screen. */}
      <div className="flex w-full flex-wrap items-start justify-center gap-2 pt-1">
        {reports.map((report) => <Node key={report.id} node={report} variant="report" onOpen={setFocusId} />)}
      </div>
    </>}

    {reports.length === 0 && <p className="pt-3 text-xs text-slate-500">Nobody reports to {chart.employee.employeeName}.</p>}

    {/* Everybody else sharing this person's manager — not part of the reporting tree, so it sits
        below it under its own rule rather than as one more row of the chart. */}
    {peers.length > 0 && <div className="w-full">
      <SectionRule label={`${chart.employee.employeeName.split(" ")[0]} works with`} />
      <div className="flex w-full flex-wrap items-start justify-center gap-2">
        {peers.map((peer) => <Node key={peer.id} node={peer} variant="peer" onOpen={setFocusId} />)}
      </div>
    </div>}

    {focusId !== employeeId && (
      <button type="button" onClick={() => setFocusId(employeeId)} className="mt-4 text-xs font-medium text-blue-600 underline underline-offset-2 hover:text-blue-800">
        Back to {employeeName}
      </button>
    )}
  </div>;
}
