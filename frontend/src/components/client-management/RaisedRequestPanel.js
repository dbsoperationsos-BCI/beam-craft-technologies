"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import SimpleTable from "@/components/data-table/SimpleTable";
import ClientRecordPanel from "@/components/client-management/ClientRecordPanel";
import Button from "@/components/shared/Button";
import Dropdown from "@/components/shared/Dropdown";
import Loader from "@/components/shared/Loader";
import RecordSummaryCard from "@/components/shared/RecordSummaryCard";
import TextAreaField from "@/components/shared/TextAreaField";
import TextField from "@/components/shared/TextField";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { layers } from "@/constants/layers";
import { ITEM_TYPE_LABELS, REQUEST_TYPE_LABELS, STATUS_LABELS, approvedTotal, isDecided, outcomeOf, reviewPayload, reviewProblems, reviewRow, rupees } from "@/lib/changeRequests.mjs";
import { askChangeRequestInformation, decideChangeRequest, getChangeRequest, replyToChangeRequest, saveChangeRequestReview } from "@/services/client-management/change-requests.service";

/*
 * One raised request, opened from Client Requests -> Raised Requests: what was asked, item by item,
 * and - for whoever holds `CLIENT / Request Approval` (`canApprove`) - the review: approve or reject
 * each item, the approved amount (₹0 for complimentary) and quantity, remarks, a reason for each
 * rejection, the approved total as it is typed, and Submit Decision once every item has one. Save
 * Progress keeps the review without deciding. A reviewer may ask the person who raised it for more,
 * and anyone who may raise requests (`canRaise`) answers here.
 *
 * Once decided the request only reads: the decisions, the amounts, the reasons, and what the decision
 * created - the shoot, the extra quotation, the correction's task.
 */

const DECISION_OPTIONS = [{ value: "APPROVED", label: "Approve" }, { value: "REJECTED", label: "Reject" }];
const DECISION_TONE = { APPROVED: "bg-emerald-50 text-emerald-700", REJECTED: "bg-red-50 text-red-700" };
const STATUS_TONE = { WAITING: "bg-amber-50 text-amber-700", IN_PROGRESS: "bg-blue-50 text-blue-700", ACCEPTED: "bg-emerald-50 text-emerald-700", PARTIALLY_ACCEPTED: "bg-teal-50 text-teal-700", DECLINED: "bg-red-50 text-red-700" };
const FLOW = [
  { id: "RAISED", label: "Raised", hex: "#0284c7" },
  { id: "REVIEWED", label: "Review", hex: "#2563eb" },
  { id: "ITEM_DECIDED", label: "Item decided", hex: "#7c3aed" },
  { id: "INFO_REQUESTED", label: "Information asked", hex: "#d97706" },
  { id: "INFO_GIVEN", label: "Information given", hex: "#0891b2" },
  { id: "APPLIED", label: "Added to project", hex: "#059669" },
  { id: "DECIDED", label: "Decided", hex: "#16a34a" },
];
const when = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const day = (iso) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");

/** A line's configuration as asked, in a few words: session, size, photos, its remarks. */
function configSummary(item) {
  const config = item.config || {};
  return [
    config.durationHours || config.durationMinutes ? `${config.durationHours || 0}h ${config.durationMinutes || 0}m` : "",
    config.workDays ? `${config.workDays} day${config.workDays === 1 ? "" : "s"}` : "",
    config.numberOfPhotos ? `${config.numberOfPhotos} photos` : "",
    config.remarks ? `"${config.remarks}"` : "",
  ].filter(Boolean).join(" · ");
}

export default function RaisedRequestPanel({ requestId, canApprove = false, canRaise = false, onClose, onChanged }) {
  const [request, setRequest] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [rows, setRows] = useState([]);
  const [decisionRemarks, setDecisionRemarks] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState("");
  const [showProblems, setShowProblems] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const take = useCallback((data) => {
    setRequest(data);
    setRows((data?.items || []).map(reviewRow));
    setDecisionRemarks(data?.decisionRemarks || "");
    setShowProblems(false);
  }, []);

  useEffect(() => {
    let alive = true;
    getChangeRequest(requestId).then((response) => { if (alive) take(response?.data || null); }).catch((error) => { if (alive) setLoadError(error.message || "Unable to load the request."); });
    return () => { alive = false; };
  }, [requestId, take]);

  const decided = isDecided(request);
  const reviewing = canApprove && request && !decided;
  const items = useMemo(() => request?.items || [], [request]);
  const problems = useMemo(() => reviewProblems(items, rows), [items, rows]);
  const total = approvedTotal(rows);
  const outcome = outcomeOf(rows);
  const asked = (request?.events || []).some((event) => event.action === "INFO_REQUESTED");

  const setRow = (id, patch) => setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  async function run(kind, work, success) {
    setBusy(kind);
    setProblem("");
    try {
      const response = await work();
      take(response?.data || null);
      onChanged?.(response?.message || success);
      return true;
    } catch (error) {
      setProblem(error.data?.message || error.message || "Something went wrong. Please try again.");
      return false;
    } finally {
      setBusy("");
    }
  }

  const review = () => ({ version: request.version, items: reviewPayload(rows), decisionRemarks: decisionRemarks.trim() || null });
  const save = () => run("save", () => saveChangeRequestReview(request.id, review()), "Review saved.");
  function askToSubmit() {
    setShowProblems(true);
    if (Object.keys(problems).length) { setProblem("Every item needs a decision - see the boxes marked below."); return; }
    setProblem("");
    setConfirming(true);
  }
  async function submit() {
    const ok = await run("decide", () => decideChangeRequest(request.id, review()), "Decision submitted.");
    setConfirming(false);
    return ok;
  }
  async function sendMessage() {
    const text = message.trim();
    if (!text) { setProblem("Write the message first."); return; }
    const ok = await run("message", () => (canApprove && !decided ? askChangeRequestInformation(request.id, text) : replyToChangeRequest(request.id, text)), "Sent.");
    if (ok) setMessage("");
  }

  if (!request) {
    return <ClientRecordPanel title="Raised request" description="Client Requests | Raised Requests" onClose={onClose}>
      {loadError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p> : <Loader label="Loading the request..." />}
    </ClientRecordPanel>;
  }

  const fieldError = (item, field) => (showProblems ? problems[item.id]?.[field] || "" : "");
  const shootLabel = request.requestType === "SHOOT"
    ? `${request.shootName || "New shoot"} (new)${request.createdShoot ? ` - added as ${request.createdShoot.shootId}` : ""}`
    : [request.shootCode, request.shootName].filter(Boolean).join(" · ");
  const shootDetails = request.shootDetails || {};

  const columns = [
    { key: "item", label: "Item", cellClassName: "min-w-[14rem] whitespace-normal", render: (item) => <div className="min-w-0">
      <p className="break-words font-medium text-slate-800">{item.itemName}</p>
      <p className="text-xs text-slate-500">{ITEM_TYPE_LABELS[item.itemType]}{item.itemType === "SERVICE" || item.itemType === "DELIVERABLE" ? ` · asked ${item.quantity}` : ""}{configSummary(item) ? ` · ${configSummary(item)}` : ""}</p>
    </div> },
    { key: "decision", label: "Decision", cellClassName: "min-w-[9rem]", render: (item) => {
      const row = rows.find((entry) => entry.id === item.id);
      if (!reviewing) return item.decision ? <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${DECISION_TONE[item.decision]}`}>{item.decision === "APPROVED" ? "Approved" : "Rejected"}</span> : <span className="text-xs text-slate-500">Not decided</span>;
      return <Dropdown ariaLabel={`Decision for ${item.itemName}`} hideLabel placeholder="Choose" options={DECISION_OPTIONS} value={row.decision} searchable={false} sorted={false} menuZIndexClassName={layers.menuOverPanel} error={fieldError(item, "decision")} onChange={(value) => setRow(item.id, { decision: value })} />;
    } },
    { key: "amount", label: "Approved amount", headerClassName: "text-right", cellClassName: "min-w-[8.5rem] text-right tabular-nums", render: (item) => {
      const row = rows.find((entry) => entry.id === item.id);
      if (!reviewing) return item.decision === "APPROVED" ? (Number(item.approvedAmount) === 0 ? "Complimentary" : rupees(item.approvedAmount)) : item.approvedAmount !== null ? rupees(item.approvedAmount) : "—";
      if (row.decision === "REJECTED") return "—";
      return <TextField aria-label={`Approved amount for ${item.itemName}`} type="number" inputMode="decimal" min={0} step="0.01" prefix="₹" placeholder="0" value={row.approvedAmount} inputClassName="text-right" error={fieldError(item, "approvedAmount")} onChange={(event) => setRow(item.id, { approvedAmount: event.target.value })} />;
    } },
    { key: "quantity", label: "Approved qty", headerClassName: "text-right", cellClassName: "min-w-[6rem] text-right tabular-nums", render: (item) => {
      if (item.itemType !== "SERVICE" && item.itemType !== "DELIVERABLE") return "—";
      const row = rows.find((entry) => entry.id === item.id);
      if (!reviewing) return item.decision === "APPROVED" ? item.approvedQuantity || item.quantity : "—";
      if (row.decision === "REJECTED") return "—";
      return <TextField aria-label={`Approved quantity for ${item.itemName}`} type="number" inputMode="numeric" min={1} step="1" placeholder={String(item.quantity)} value={row.approvedQuantity} inputClassName="text-right" onChange={(event) => setRow(item.id, { approvedQuantity: event.target.value })} />;
    } },
    { key: "remarks", label: "Manager remarks / reason", cellClassName: "min-w-[13rem] whitespace-normal", render: (item) => {
      const row = rows.find((entry) => entry.id === item.id);
      if (!reviewing) return <div className="space-y-0.5 text-sm">
        {item.rejectionReason && <p className="text-red-700">Reason: {item.rejectionReason}</p>}
        {item.managerRemarks && <p>{item.managerRemarks}</p>}
        {!item.rejectionReason && !item.managerRemarks && "—"}
        {item.decidedByName && <p className="text-xs text-slate-500">{item.decidedByName} · {when(item.decidedAt)}</p>}
      </div>;
      return <div className="space-y-2">
        {row.decision === "REJECTED" && <TextField aria-label={`Rejection reason for ${item.itemName}`} required placeholder="Rejection reason" maxLength={2000} value={row.rejectionReason} error={fieldError(item, "rejectionReason")} onChange={(event) => setRow(item.id, { rejectionReason: event.target.value })} />}
        <TextField aria-label={`Manager remarks for ${item.itemName}`} placeholder="Remarks (optional)" maxLength={2000} value={row.managerRemarks} onChange={(event) => setRow(item.id, { managerRemarks: event.target.value })} />
      </div>;
    } },
  ];

  const activity = (request.events || []).map((event) => ({ id: event.id, stage: event.action, at: event.createdAt, title: event.detail || STATUS_LABELS[event.action] || event.action, detail: "", by: event.actorName || null }));
  const tile = (label, value) => <div className="rounded-lg border border-slate-200 bg-white px-4 py-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-lg font-semibold text-slate-900">{value}</p></div>;

  return <>
    <ClientRecordPanel
      title={`${request.requestCode} · ${REQUEST_TYPE_LABELS[request.requestType]}`}
      titleAddon={<span className={`inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_TONE[request.status]}`}>{STATUS_LABELS[request.status]}</span>}
      description={`Client Requests | Raised Requests · ${request.eventId} · ${request.clientName}`}
      detailsLabel="Request"
      stages={FLOW}
      activity={activity}
      heading="Request history, oldest first"
      onClose={onClose}
      actions={reviewing ? <>
        {problem ? <span role="alert" className="text-sm text-red-600 sm:mr-auto">{problem}</span> : <span className="text-sm text-slate-500 sm:mr-auto">Approved total: <b className="text-slate-800">{rupees(total)}</b></span>}
        <Button className="max-sm:w-full" type="button" onClick={() => void save()} disabled={Boolean(busy)}>{busy === "save" ? "Saving..." : "Save Progress"}</Button>
        <Button className="max-sm:w-full" type="button" variant="primary" onClick={askToSubmit} disabled={Boolean(busy)}>Submit Decision</Button>
      </> : problem ? <span role="alert" className="text-sm text-red-600 sm:mr-auto">{problem}</span> : null}
    >
      {reviewing && <p className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">Approve or reject each item. An approved item needs its amount (₹0 if it is complimentary); a rejected one needs its reason. <b>Submit Decision</b> adds only the approved items to the project and records their total as an approved extra quotation.</p>}
      {!canApprove && !decided && <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Waiting for a decision. Nothing is added to the project until it is approved.</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tile("Items", items.length)}
        {tile("Approved", `${(reviewing ? rows : items).filter((row) => row.decision === "APPROVED").length} of ${items.length}`)}
        {tile(decided ? "Approved amount" : "Approved total so far", rupees(reviewing ? total : request.approvedAmount))}
        {tile(decided ? "Outcome" : "Outcome if submitted", decided ? STATUS_LABELS[request.status] : reviewing && outcome ? STATUS_LABELS[outcome] : "—")}
      </div>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-slate-800">Request</h2>
        <RecordSummaryCard columnsClassName="sm:grid-cols-2 lg:grid-cols-3" rows={[
          ["Request ID", request.requestCode],
          ["Project", `${request.eventId} · ${request.clientName}`],
          ["Request type", REQUEST_TYPE_LABELS[request.requestType]],
          ["Requested by", request.requestedByName],
          ["Requested on", when(request.requestedAt)],
          ["Shoot", shootLabel],
          ...(request.requestType === "SHOOT" ? [["Shoot date", day(shootDetails.dateCreated) || "Not fixed yet"], ["Location", [shootDetails.shootPlace, shootDetails.district, shootDetails.state].filter(Boolean).join(", ")], ["Session", (shootDetails.sessionTimings || []).join(", ")]] : []),
          ...(request.requestType === "OTHER" ? [["Correction category", request.correctionCategory]] : []),
          ["Requester remarks", request.remarks],
          ...(decided ? [["Decided", `${when(request.decidedAt)}${request.reviewedByName ? ` by ${request.reviewedByName}` : ""}`], ["Decision remarks", request.decisionRemarks]] : []),
          ...(request.extraQuotation ? [["Extra quotation", `${request.extraQuotation.requestCode} · ${rupees(request.extraQuotation.amount)} · ${String(request.extraQuotation.status).toLowerCase()}`]] : []),
          ...(request.task ? [["Correction task", `${request.task.taskCode} · ${request.task.assignedToName}`]] : []),
        ]} />
        {request.attachments.length > 0 && <div className="mt-3 flex flex-wrap gap-2">
          {request.attachments.map((file, index) => <a key={file.url} href={file.url} target="_blank" rel="noreferrer" className="block h-20 w-20 overflow-hidden rounded-lg border border-slate-200" aria-label={`Open attachment ${index + 1}`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a stored upload, sized here */}
            <img src={file.url} alt={`Attachment ${index + 1}`} className="h-full w-full object-cover" />
          </a>)}
        </div>}
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-slate-800">Items <span className="font-normal text-slate-500">({items.length})</span></h2>
        <SimpleTable variant="card" classNames={{ table: "w-full min-w-[860px] border-collapse text-left text-sm", td: "px-4 py-3 align-top" }} rows={items} columns={columns} ariaLabel="Requested items" />
      </section>

      {reviewing && <TextAreaField className="mt-6" label="Decision remarks (shown to the person who raised it)" rows={2} maxLength={5000} value={decisionRemarks} onChange={(event) => setDecisionRemarks(event.target.value)} />}

      {!decided && (canApprove || (canRaise && asked)) && <section className="mt-6 rounded-lg border border-slate-200 p-4">
        <h2 className="text-sm font-semibold text-slate-800">{canApprove ? "Ask the requester for more information" : "Answer the reviewer"}</h2>
        {!canApprove && <p className="mt-1 text-sm text-slate-600">{[...request.events].reverse().find((event) => event.action === "INFO_REQUESTED")?.detail}</p>}
        <TextAreaField className="mt-2" label="Message" rows={2} maxLength={2000} value={message} onChange={(event) => setMessage(event.target.value)} />
        <Button type="button" className="mt-2 max-sm:w-full" onClick={() => void sendMessage()} disabled={Boolean(busy)}>{busy === "message" ? "Sending..." : canApprove ? "Ask" : "Send Reply"}</Button>
      </section>}
    </ClientRecordPanel>
    {confirming && <ConfirmDialog
      layer="dialogOverPanel"
      title={`Submit the decision on ${request.requestCode}?`}
      message={`${STATUS_LABELS[outcome]}: ${rows.filter((row) => row.decision === "APPROVED").length} approved, ${rows.filter((row) => row.decision === "REJECTED").length} rejected${total > 0 ? `, approved total ${rupees(total)} recorded as an approved extra quotation` : ""}. The approved items are added to the project now, and the decision cannot be changed afterwards.`}
      confirmLabel="Submit Decision"
      tone="primary"
      busyLabel="Submitting..."
      loading={busy === "decide"}
      onCancel={() => setConfirming(false)}
      onConfirm={() => void submit()}
    />}
  </>;
}
