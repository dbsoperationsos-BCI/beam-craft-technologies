"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DataTable from "@/components/data-table/DataTable";
import DataTableShell from "@/components/data-table/DataTableShell";
import SimpleTable from "@/components/data-table/SimpleTable";
import TableFooter from "@/components/data-table/TableFooter";
import { TableCellValue } from "@/components/data-table/tableCells";
import useTableSelection from "@/components/data-table/useTableSelection";
import useCompactView from "@/components/shared/useCompactView";
import ClientRecordPanel from "@/components/client-management/ClientRecordPanel";
import RaiseRequestDialog from "@/components/client-management/RaiseRequestDialog";
import RaisedRequestPanel from "@/components/client-management/RaisedRequestPanel";
import RaisedRequestsTable from "@/components/client-management/RaisedRequestsTable";
import Dropdown from "@/components/shared/Dropdown";
import useStickyTab from "@/components/shared/useStickyTab";
import { RAISED_TABS, inRaisedTab } from "@/lib/changeRequests.mjs";
import { listChangeRequests } from "@/services/client-management/change-requests.service";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { layers } from "@/constants/layers";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import { useModuleAccess } from "@/components/auth/PermissionsProvider";
import Button from "@/components/shared/Button";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import TextField from "@/components/shared/TextField";
import Dialog from "@/components/ui/Dialog";
import { answerClientRequest, approveClientRequests, deleteClientRequests, listClientRequests } from "@/services/client-management/client-requests.service";

/*
 * Client Management -> Client Requests: what clients ask from their app about their booking's
 * services and deliverables - to add something from the studio's list, to change something, or a
 * question - each already priced from Settings -> Project -> Services / Deliverables. Respond opens
 * the client's View, where the waiting ones are ticked and approved: approved items are added to the project's shoots at once (a priced one
 * also raises an extra for Project Payments) and the client is told. Or Decline one with a reason, or
 * Answer a question.
 * Behind `CLIENT / Client Requests`: Read to see them, Read / Write to answer.
 *
 * A second view, **Raised Requests**, is what the studio itself asks for on a project - a new shoot,
 * services or deliverables for a shoot, a correction - raised with Raise Request (Client Requests
 * Read / Write) and priced and decided item by item behind `CLIENT / Request Approval`
 * (`RaisedRequestPanel`). The header's switch chooses the view; each keeps its own tabs.
 */
const VIEWS = [{ value: "raised", label: "Raised Requests" }, { value: "client", label: "From Client App" }];

const KIND = {
  add: { label: "Add", tone: "bg-blue-50 text-blue-700" },
  change: { label: "Change", tone: "bg-violet-50 text-violet-700" },
  question: { label: "Question", tone: "bg-slate-100 text-slate-700" },
};
const STATUS = {
  pending: { label: "Waiting", tone: "bg-amber-50 text-amber-700" },
  accepted: { label: "Accepted", tone: "bg-emerald-50 text-emerald-700" },
  declined: { label: "Rejected", tone: "bg-red-50 text-red-700" },
  answered: { label: "Answered", tone: "bg-emerald-50 text-emerald-700" },
};
// The header's tabs: the status a request is at.
const TABS = ["All", "Waiting", "Accepted", "Rejected"];
const TAB_STATUS = { Waiting: "pending", Accepted: "accepted", Rejected: "declined" };
const STATUS_DOTS = { Waiting: "bg-amber-500", Accepted: "bg-emerald-500", Rejected: "bg-red-500", Answered: "bg-emerald-500", "Awaiting approval": "bg-blue-500", "Added to booking": "bg-emerald-500", "Not added": "bg-red-500" };
// An accepted request's payment: a priced one waits for its extra quotation's approval, then is on the booking.
const STAGE_LABELS = { awaiting: "Awaiting approval", added: "Added to booking", "not-added": "Not added" };
const statusLabel = (row) => (row.status === "accepted" && STAGE_LABELS[row.stage]) || STATUS[row.status]?.label || "";
const rupees = (amount) => `Rs ${Number(amount || 0).toLocaleString("en-IN")}`;
const when = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "");

// A request's journey, for its View panel's activity flow.
const FLOW = {
  RAISED: { id: "RAISED", label: "Requested", hex: "#0284c7" },
  QUOTED: { id: "QUOTED", label: "Approved", hex: "#059669" },
  ANSWERED: { id: "ANSWERED", label: "Answered", hex: "#4f46e5" },
  DECLINED: { id: "DECLINED", label: "Rejected", hex: "#dc2626" },
  EXTRA: { id: "EXTRA", label: "Extra quotation", hex: "#059669" },
  CLIENT: { id: "CLIENT", label: "Client opened", hex: "#b45309" },
};

/** What happened to a request, oldest first: raised, answered (quoted, declined), the extra raised, the client opening it. */
function requestActivity(request) {
  const lines = [{ id: "raised", stage: "RAISED", at: request.createdAt, title: `Client asked ${request.kind === "question" ? "a question" : `to ${request.kind}`}: ${request.itemName}${request.quantity > 1 ? ` x${request.quantity}` : ""}`, detail: [request.shootName, request.note ? `"${request.note}"` : ""].filter(Boolean).join(" · "), by: "Client (app)" }];
  if (request.decidedAt) {
    const stage = request.status === "declined" ? "DECLINED" : request.status === "answered" ? "ANSWERED" : "QUOTED";
    const what = request.status === "declined" ? "Rejected" : request.status === "answered" ? "Answered" : "Approved and added to the project";
    const price = request.status === "accepted" ? (request.complimentary ? " - complimentary" : request.price ? ` at ${rupees(request.price)}` : " - no extra charge") : "";
    lines.push({ id: "decided", stage, at: request.decidedAt, title: `${what}${price}`, detail: request.reply, by: request.decidedByName || null });
    if (request.extraQuotation) lines.push({ id: "extra", stage: "EXTRA", at: request.decidedAt, title: `Extra quotation ${request.extraQuotation.requestCode} raised`, detail: `For the project's approval - ${String(request.extraQuotation.status || "").toLowerCase()}`, by: request.decidedByName || null });
  }
  if (request.clientSeenAt) lines.push({ id: "seen", stage: "CLIENT", at: request.clientSeenAt, title: "The client opened the answer in their app", by: "Client (app)" });
  return lines;
}

const STATUS_TONE = { Waiting: "bg-amber-50 text-amber-700", "Awaiting approval": "bg-blue-50 text-blue-700", "Added to booking": "bg-emerald-50 text-emerald-700", Accepted: "bg-emerald-50 text-emerald-700", Answered: "bg-emerald-50 text-emerald-700", Rejected: "bg-red-50 text-red-700", "Not added": "bg-red-50 text-red-700" };

/**
 * A client's View - as a project opens in Pre Production: everything they have asked for, shoot by
 * shoot (each request with its quantity, price, where it stands, their note and the studio's reply),
 * a line of totals over it, and the Activity flow of every request together.
 */
function ClientPanel({ group, canWrite, onClose, onApproved, onAnswer, onDecline, onDelete }) {
  const all = group.all;
  const waiting = all.filter((row) => row.status === "pending");
  const quotable = waiting.filter((row) => row.kind !== "question");
  // Approving here, in the client's own View: the waiting services and deliverables ticked (all, to start).
  const [chosen, setChosen] = useState(() => new Set(quotable.map((row) => row.id)));
  const [approving, setApproving] = useState(false);
  const [problem, setProblem] = useState("");
  const ticked = quotable.filter((row) => chosen.has(row.id));
  const toggle = (id) => setChosen((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  async function approve() {
    if (!ticked.length) return;
    setApproving(true);
    setProblem("");
    try {
      const result = await approveClientRequests({ ids: ticked.map((row) => row.id) });
      onApproved(result?.message || "Approved.");
    } catch (error) {
      setProblem(error.message || "Unable to approve the requests.");
    } finally {
      setApproving(false);
    }
  }
  const total = all.reduce((sum, row) => sum + (row.complimentary ? 0 : Number(row.price) || 0), 0);
  const added = all.filter((row) => row.status === "accepted" && row.stage === "added").length;
  const byShoot = [...new Set(all.map((row) => row.shootName || "Shoot"))].map((name) => ({ name, rows: all.filter((row) => (row.shootName || "Shoot") === name) }));
  const activity = all.flatMap((row) => requestActivity(row).map((line) => ({ ...line, id: `${row.id}-${line.id}`, shoot: row.shootName || "" })));
  const tile = (label, value) => <div className="rounded-lg border border-slate-200 bg-white px-4 py-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-lg font-semibold text-slate-900">{value}</p></div>;
  return <ClientRecordPanel
    title={group.groupName || group.eventId}
    titleAddon={waiting.length ? <span className="inline-flex shrink-0 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">{waiting.length} waiting</span> : null}
    description={`Client Requests | ${group.eventId} · ${all.length} request${all.length === 1 ? "" : "s"} across ${byShoot.length} shoot${byShoot.length === 1 ? "" : "s"}`}
    detailsLabel="Requests"
    stages={Object.values(FLOW)}
    activity={activity}
    heading="Requests flow, oldest first"
    onClose={onClose}
    actions={canWrite && quotable.length ? <>
      {problem ? <span className="mr-auto text-sm text-red-600" role="alert">{problem}</span> : <span className="mr-auto text-sm text-slate-500">{ticked.length} of {quotable.length} ticked · {rupees(ticked.reduce((sum, row) => sum + (row.complimentary ? 0 : Number(row.price) || 0), 0))}</span>}
      <Button type="button" variant="primary" onClick={() => void approve()} disabled={approving || !ticked.length}>{approving ? "Approving..." : `Approve selected (${ticked.length})`}</Button>
    </> : null}
  >
    {canWrite && quotable.length ? <p className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">Tick the requests to approve and press <b>Approve selected</b>. Approved items are added to this project&apos;s shoots at once, and the client is told the team will contact them.</p> : null}
    <div className="grid gap-3 sm:grid-cols-4">
      {tile("Requests", all.length)}
      {tile("Waiting", waiting.length)}
      {tile("Total", rupees(total))}
      {tile("Added to booking", added)}
    </div>
    {byShoot.map((shoot) => <section key={shoot.name} className="mt-6">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">{shoot.name}<span className="text-xs font-normal text-slate-500">{shoot.rows.length} request{shoot.rows.length === 1 ? "" : "s"}</span></h2>
      <SimpleTable
        variant="card"
        classNames={{ table: "w-full min-w-[900px] border-collapse text-left text-sm", td: "px-4 py-3 align-middle" }}
        rows={shoot.rows}
        columns={[
          ...(canWrite && quotable.length ? [{ key: "pick", label: "Approve", srOnly: true, render: (row) => (row.status === "pending" && row.kind !== "question"
            ? <input type="checkbox" checked={chosen.has(row.id)} onChange={() => toggle(row.id)} aria-label={`Approve ${row.itemName}`} className="h-4 w-4 accent-blue-600" />
            : null) }] : []),
          { key: "item", label: "Request", render: (row) => <div><p className="font-medium text-slate-800">{row.itemName}</p><p className="text-xs text-slate-500">{KIND[row.kind]?.label}{row.itemType === "deliverable" ? " · Deliverable" : row.itemType === "service" ? " · Service" : ""} · {when(row.createdAt)}</p></div> },
          { key: "qty", label: "Qty", render: (row) => row.quantity },
          { key: "price", label: "Price", render: (row) => (row.complimentary ? "Complimentary" : row.price ? rupees(row.price) : "—") },
          { key: "status", label: "Status", render: (row) => <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_TONE[statusLabel(row)] || "bg-slate-100 text-slate-600"}`}>{statusLabel(row)}</span> },
          { key: "note", label: "Client's note", render: (row) => row.note || "—" },
          { key: "reply", label: "Studio's reply", render: (row) => row.reply || "—" },
          { key: "menu", label: "Actions", srOnly: true, render: (row) => (canWrite ? <OptionsMenu ariaLabel={`Actions for ${row.itemName}`} menuZIndexClassName={layers.menuOverPanel} items={[
            ...(row.status === "pending" && row.kind === "question" ? [{ label: "Answer", onSelect: () => onAnswer(row) }] : []),
            ...(row.status === "pending" && row.kind !== "question" ? [{ label: "Reject", onSelect: () => onDecline(row) }] : []),
            { label: "Delete", tone: "danger", onSelect: () => onDelete(row) },
          ]} /> : null) },
        ]}
      />
    </section>)}
  </ClientRecordPanel>;
}

/** Answering one request: accept (with a price, or free), decline with a reason, or answer a question. */
function AnswerForm({ request, start = null, layer, onClose, onSaved }) {
  const question = request.kind === "question";
  const [action, setAction] = useState(question ? "answer" : start || "accept");
  const [price, setPrice] = useState("");
  const [reply, setReply] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");

  async function save() {
    const amount = price === "" ? null : Number(price);
    if (action === "accept" && amount !== null && !(amount >= 0)) { setProblem("Enter the price in rupees, or leave it empty for no charge."); return; }
    if (action !== "accept" && !reply.trim()) { setProblem(action === "decline" ? "Tell the client why." : "Write your answer."); return; }
    setSaving(true);
    setProblem("");
    try {
      const result = await answerClientRequest(request.id, { action, price: action === "accept" ? amount : undefined, reply: reply.trim() });
      onSaved(result?.message || "Sent to the client.");
    } catch (error) {
      setProblem(error.message || "Unable to answer.");
    } finally {
      setSaving(false);
    }
  }

  const choices = question ? [["answer", "Answer"]] : [["accept", "Accept"], ["decline", "Reject"]];
  return <Dialog
    title={`${KIND[request.kind]?.label || "Request"}: ${request.itemName}${request.quantity > 1 ? ` x${request.quantity}` : ""}`}
    description={`${request.eventId} · ${request.shootName || "Shoot"}${request.note ? ` - "${request.note}"` : ""}`}
    size="sm"
    layer={layer}
    onClose={onClose}
    busy={saving}
    onSubmit={(event) => { event.preventDefault(); void save(); }}
    footer={<>
      <Button type="button" onClick={onClose} disabled={saving}>Cancel</Button>
      <Button type="submit" variant="primary" disabled={saving}>{saving ? "Sending..." : "Send to client"}</Button>
    </>}
  >
    <div className="space-y-4">
      {choices.length > 1 ? <div role="radiogroup" aria-label="Answer" className="grid grid-cols-2 gap-2">
        {choices.map(([key, label]) => <button key={key} type="button" role="radio" aria-checked={action === key} onClick={() => setAction(key)} className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${action === key ? (key === "decline" ? "border-red-500 bg-red-50 text-red-700" : "border-blue-600 bg-blue-50 text-blue-700") : "border-slate-200 text-slate-600 hover:border-slate-400"}`}>{label}</button>)}
      </div> : null}
      {action === "accept" ? <TextField label="Price (Rs)" type="number" min={0} value={price} onChange={(event) => setPrice(event.target.value)} placeholder={request.catalogPrice ? `List price: ${request.catalogPrice}` : "Leave empty for no extra charge"} helperText="A price raises an extra quotation on this booking, for the project's approval and billing." /> : null}
      <label className="block text-xs font-semibold text-slate-600">
        {action === "accept" ? "Message to the client (optional)" : action === "decline" ? "Reason" : "Your answer"}
        <textarea value={reply} onChange={(event) => setReply(event.target.value)} rows={3} maxLength={1000} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800 focus:border-blue-500 focus:outline-none" />
      </label>
      {problem ? <p className="text-sm text-red-600" role="alert">{problem}</p> : null}
    </div>
  </Dialog>;
}

export default function ClientRequestsPage() {
  const { canWrite } = useModuleAccess("CLIENT", "Client Requests");
  const { density } = useCompactView();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("Waiting");
  // A question answered, or one request declined: `{ request, start }`. A booking's requests quoted: one of them.
  const [answering, setAnswering] = useState(null);
  // The client (booking) open in its View, by Event ID - re-read from the rows, so it follows a reload.
  const [viewingId, setViewingId] = useState(null);
  // Delete: `{ ids, label }` - one request, or every request of the clients ticked or chosen.
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);
  // Raise Request: the studio raising a request on a project.
  const [raising, setRaising] = useState(false);
  // Which list the page shows - remembered per person - and the raised requests' own list and tab.
  const [view, setView] = useStickyTab("client-requests-view", "client", VIEWS.map((option) => option.value));
  const { canWrite: canApprove } = useModuleAccess("CLIENT", "Request Approval");
  const [raised, setRaised] = useState(null);
  const [raisedError, setRaisedError] = useState("");
  const [raisedTab, setRaisedTab] = useState("Waiting");
  // The raised request open in its panel, by id.
  const [openRequestId, setOpenRequestId] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [tableStats, setTableStats] = useState({ total: 0 });
  const { notice, showSuccess, showError, clearNotice } = useNotice();

  const load = useCallback(async () => {
    try {
      setRows((await listClientRequests())?.data || []);
      setLastUpdated(new Date());
      setError("");
    } catch (loadError) {
      setError(loadError.message || "Unable to load client requests.");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const loadRaised = useCallback(async () => {
    try {
      setRaised((await listChangeRequests())?.data || []);
      setLastUpdated(new Date());
      setRaisedError("");
    } catch (loadError) {
      setRaised([]);
      setRaisedError(loadError.message || "Unable to load the raised requests.");
    }
  }, []);

  // The raised requests load beside the client's, so the switch shows both counts at once. A notice's
  // link (`?view=raised&request=12`) opens the request it is about.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadRaised();
      const params = new URLSearchParams(window.location.search);
      if (params.get("view") === "raised") setView("raised");
      if (Number(params.get("request")) > 0 && params.get("view") === "raised") setOpenRequestId(Number(params.get("request")));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadRaised, setView]);
  const raisedShown = useMemo(() => (raised || []).filter((request) => inRaisedTab(request, raisedTab)), [raised, raisedTab]);
  const raisedCounts = useMemo(() => Object.fromEntries(RAISED_TABS.map((name) => [name, (raised || []).filter((request) => inRaisedTab(request, name)).length])), [raised]);
  const onRaisedView = view === "raised";
  // The same function from render to render: the raised requests table builds its columns from it, and a
  // new one each render rebuilt every row - an open ⋮ closed under the person's hand.
  const openRaised = useCallback((request) => setOpenRequestId(request.id), []);

  /*
   * One row a client's booking, not one a request: everything a client asks for - however many shoots
   * and items - reads as one line, opened (double click, or View) to see it all shoot by shoot. A
   * booking is in a tab when any of its requests is.
   */
  const groups = useMemo(() => {
    const byEvent = new Map();
    for (const row of rows || []) {
      if (!byEvent.has(row.eventId)) byEvent.set(row.eventId, { id: row.eventId, eventId: row.eventId, groupName: row.groupName, all: [] });
      byEvent.get(row.eventId).all.push(row);
    }
    return [...byEvent.values()].map((group) => {
      const waiting = group.all.filter((row) => row.status === "pending");
      return {
        ...group,
        waiting,
        shoots: [...new Set(group.all.map((row) => row.shootName).filter(Boolean))].join(", "),
        items: group.all.map((row) => row.itemName).join(", "),
        total: group.all.reduce((sum, row) => sum + (row.complimentary ? 0 : Number(row.price) || 0), 0),
        lastAt: group.all.reduce((latest, row) => (row.createdAt > latest ? row.createdAt : latest), ""),
        summary: waiting.length ? "Waiting" : group.all.some((row) => row.stage === "awaiting") ? "Awaiting approval" : group.all.some((row) => row.status === "accepted") ? "Added to booking" : statusLabel(group.all[0]),
      };
    }).sort((a, b) => Number(Boolean(b.waiting.length)) - Number(Boolean(a.waiting.length)) || b.lastAt.localeCompare(a.lastAt));
  }, [rows]);
  const inTab = (group, name) => name === "All" || group.all.some((row) => row.status === TAB_STATUS[name]);
  const shown = useMemo(() => groups.filter((group) => inTab(group, tab)), [groups, tab]);
  const counts = useMemo(() => Object.fromEntries(TABS.map((name) => [name, groups.filter((group) => inTab(group, name)).length])), [groups]);
  const viewing = viewingId ? groups.find((group) => group.eventId === viewingId) || null : null;
  // A window opened from inside a client's View has to stack above it, or it opens unseen behind it.
  const overPanel = viewing ? layers.dialogOverPanel : undefined;

  // Ticking clients: the table's own Delete, for every request of each.
  const bulk = useTableSelection({
    rows: shown,
    noun: "client",
    onDelete: async (eventIds) => {
      await deleteClientRequests(groups.filter((group) => eventIds.includes(group.id)).flatMap((group) => group.all.map((row) => row.id)));
      return { deletedIds: eventIds };
    },
    onDeleted: () => load(),
    showSuccess,
    showError,
  });
  const quoteFirst = (group) => group.waiting.find((row) => row.kind !== "question");

  async function removeNow() {
    setBusy(true);
    try {
      await deleteClientRequests(removing.ids);
      showSuccess(removing.ids.length === 1 ? "Request deleted." : `${removing.ids.length} requests deleted.`);
      setRemoving(null);
      await load();
    } catch (removeError) {
      showError(removeError.message || "Unable to delete.");
    } finally {
      setBusy(false);
    }
  }

  // One column a fact, as every table in the OS reads: each can be filtered, sorted, hidden and exported.
  const columns = useMemo(() => {
    const text = (id, header, value, width = 160) => ({ id, header, accessorFn: value, cell: ({ row }) => value(row.original) || "—", exportValue: value, width, minWidth: Math.min(width, 120) });
    return [
      text("eventId", "Event ID", (group) => group.eventId, 210),
      text("client", "Client", (group) => group.groupName, 260),
      text("shoots", "Shoots", (group) => group.shoots, 170),
      text("items", "Requested", (group) => group.items, 280),
      text("count", "Requests", (group) => String(group.all.length), 100),
      text("waiting", "Waiting", (group) => String(group.waiting.length), 100),
      text("total", "Total", (group) => (group.total ? rupees(group.total) : ""), 130),
      { ...text("status", "Status", (group) => group.summary, 170), cell: ({ row }) => <TableCellValue value={row.original.summary} type="status" statusStyles={STATUS_DOTS} /> },
      text("lastAt", "Last request", (group) => when(group.lastAt), 150),
      {
        id: "action",
        header: "Action",
        accessorFn: () => "",
        enableColumnFilter: false,
        enableSorting: false,
        width: 150,
        minWidth: 150,
        cell: ({ row }) => {
          const first = quoteFirst(row.original);
          if (canWrite && first) return <Button type="button" size="sm" variant="primary" onClick={(event) => { event.stopPropagation(); setViewingId(row.original.eventId); }}>Respond</Button>;
          const question = row.original.waiting.find((item) => item.kind === "question");
          if (canWrite && question) return <Button type="button" size="sm" variant="primary" onClick={(event) => { event.stopPropagation(); setAnswering({ request: question }); }}>Answer</Button>;
          return <span className="text-xs text-slate-400">{row.original.summary}</span>;
        },
      },
      {
        id: "menu",
        header: "",
        accessorFn: () => "",
        enableColumnFilter: false,
        enableSorting: false,
        width: 56,
        minWidth: 56,
        cell: ({ row }) => <OptionsMenu ariaLabel="Client actions" items={[
          { label: "View", onSelect: () => setViewingId(row.original.eventId) },
          ...(canWrite && quoteFirst(row.original) ? [{ label: "Respond", onSelect: () => setViewingId(row.original.eventId) }] : []),
          ...(canWrite ? [{ label: "Delete all requests", tone: "danger", onSelect: () => setRemoving({ ids: row.original.all.map((item) => item.id), label: `every request from ${row.original.groupName || row.original.eventId}` }) }] : []),
        ]} />,
      },
    ];
   
  }, [canWrite]);

  const updatedText = lastUpdated ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(lastUpdated) : "-";

  return <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
    <ModulePageHeader
      title="Client Requests"
      tabs={onRaisedView
        ? RAISED_TABS.map((name) => ({ id: name, label: name, count: raised ? raisedCounts[name] : undefined }))
        : TABS.map((name) => ({ id: name, label: name, count: rows ? counts[name] : undefined }))}
      tabValue={onRaisedView ? raisedTab : tab}
      onTabChange={(next) => { if (onRaisedView) setRaisedTab(next); else { setTab(next); bulk.clear(); } }}
      tabsAriaLabel={onRaisedView ? "Raised request status" : "Client request status"}
      actions={<>
        <Dropdown mode="switch" ariaLabel="Which requests are shown" value={view} onChange={(next) => { setView(next); bulk.clear(); }} options={VIEWS} searchable={false} sorted={false} className="w-[11rem] shrink-0" />
        {canWrite ? <Button type="button" variant="primary" onClick={() => setRaising(true)}>Raise Request</Button> : null}
      </>}
    />
    <FloatingNotice notice={notice} onClose={clearNotice} />
    {(onRaisedView ? raisedError : error) ? <p className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{onRaisedView ? raisedError : error}</p> : null}
    <div className="min-h-0 flex-1">
      <DataTableShell className="h-full min-h-0" footer={<TableFooter spread><span>Last updated: {updatedText}</span><span>Total rows: {tableStats.total}</span></TableFooter>}>
        <div className="flex min-h-0 min-w-0 flex-1">
          {onRaisedView ? <RaisedRequestsTable
            rows={raisedShown}
            loading={!raised}
            density={density}
            canApprove={canApprove}
            emptyMessage={raisedTab === "Waiting" ? `Nothing waiting.${canWrite ? " Press Raise Request to ask for a shoot, services, deliverables or a correction on a project." : ""}` : "No requests here yet."}
            onOpen={openRaised}
            onVisibleRowsChange={setTableStats}
          /> : <DataTable
            columns={columns}
            data={shown}
            density={density}
            loading={!rows && !error}
            loadingMessage="Loading client requests..."
            emptyMessage={tab === "Waiting" ? "Nothing waiting. A client's request shows here the moment they send it." : "No requests here yet."}
            noMatchMessage="No clients match."
            onVisibleRowsChange={setTableStats}
            onRowDoubleClick={(group) => setViewingId(group.eventId)}
            ariaLabel="Client requests table"
            features={{ filtering: true, sorting: true, columnVisibility: true, infiniteScroll: { pageSize: 50 }, csvExport: { enabled: true, fileName: "client-requests" }, selection: bulk.selection }}
          />}
        </div>
      </DataTableShell>
    </div>
    {viewing ? <ClientPanel
      group={viewing}
      canWrite={canWrite}
      onClose={() => setViewingId(null)}
      key={`${viewing.eventId}-${viewing.waiting.length}`}
      onApproved={(message) => { showSuccess(message); void load(); }}
      onAnswer={(request) => setAnswering({ request })}
      onDecline={(request) => setAnswering({ request, start: "decline" })}
      onDelete={(request) => setRemoving({ ids: [request.id], label: `"${request.itemName}"` })}
    /> : null}
    {removing ? <ConfirmDialog
      layer={overPanel}
      title={`Delete ${removing.label}?`}
      message="Deleted requests leave the client's app. An extra quotation already raised from one stays on the project."
      confirmLabel="Delete"
      busyLabel="Deleting..."
      loading={busy}
      onCancel={() => setRemoving(null)}
      onConfirm={() => void removeNow()}
    /> : null}
    {raising ? <RaiseRequestDialog onClose={() => setRaising(false)} onRaised={(message) => { setRaising(false); showSuccess(message); setView("raised"); setRaisedTab("Waiting"); void loadRaised(); }} /> : null}
    {openRequestId ? <RaisedRequestPanel key={openRequestId} requestId={openRequestId} canApprove={canApprove} canRaise={canWrite} onClose={() => setOpenRequestId(null)} onChanged={(message) => { showSuccess(message); void loadRaised(); }} /> : null}
    {answering ? <AnswerForm request={answering.request} start={answering.start} layer={overPanel} onClose={() => setAnswering(null)} onSaved={(message) => { setAnswering(null); showSuccess(message); void load(); }} /> : null}
  </section>;
}
