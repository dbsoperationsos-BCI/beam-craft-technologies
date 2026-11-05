"use client";

import { useState } from "react";
import Button from "@/components/shared/Button";
import DashboardCard, { CardState } from "@/components/shared/DashboardCard";
import { requestTypeLabels } from "@/components/hrm/attendanceRequests";
import Tabs from "@/components/ui/Tabs";
import { irregularityNote, irregularityTabs, pendingRequestLabel, requestSummary } from "@/lib/attendanceRegisterCards.mjs";

/*
 * The Attendance Register's two cards of things to act on, below Today's Attendance - side by side
 * from a tablet up and stacked on a phone:
 *
 * - **Irregularities** - who is Absent with no approved leave, comp-off or permission (the server's
 *   `irregularities`), in two tabs: **Today** for the fixed shifts, **Yesterday** for whoever works a
 *   flexible shift - their day is judged once it is over, never today, since they often work at night.
 * - **Request** - the requests waiting on this login's answer: the same list as "Waiting for me" in
 *   Leave or Comp-Off Request (`awaitsMe`), so the count here and that tab's always agree.
 */

// Every kind, Comp-off included - it is a Leave Type on the form now, but its requests still say Comp-off.
const TYPE_LABELS = requestTypeLabels;

function PersonList({ items, render }) {
  return <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto">
    {items.map((item) => <li key={item.key} className="py-2 first:pt-0 last:pb-0">{render(item)}</li>)}
  </ul>;
}

const nameLine = (name, code, branch) => <p className="truncate text-sm font-medium text-slate-800">
  {name}{code ? <span className="font-normal text-slate-500"> ({code})</span> : null}
  {branch ? <span className="font-normal text-slate-500"> · {branch}</span> : null}
</p>;

export default function RegisterAttentionCards({ irregularities, shownDate, loading, error, onRetry, requests, requestsLoading, requestsError, onRetryRequests, onOpenRequests }) {
  const absent = irregularities || [];
  const tabs = irregularityTabs(absent);
  const [tabId, setTabId] = useState("today");
  const shown = tabs.find((tab) => tab.id === tabId) || tabs[0];
  const waiting = requests || [];
  return <div className="grid gap-3 md:grid-cols-2">
    <DashboardCard
      title={`Irregularities${loading ? "" : ` (${absent.length})`}`}
      note="Absent with no approved leave or permission."
    >
      {/* A register that did not load is said so - never read as nobody being absent. */}
      <Tabs
        tabs={tabs.map((tab) => ({ id: tab.id, label: tab.label, count: loading ? null : tab.items.length }))}
        value={shown.id}
        onChange={setTabId}
        ariaLabel="Irregularities by day"
        className="mb-2 border-b border-slate-100"
      />
      <CardState loading={loading} error={error} onRetry={onRetry} empty={!shown.items.length} emptyMessage={shown.id === "yesterday" ? "No flexible-shift absences yesterday." : "Nobody is absent without approval."} rows={3}>
        <PersonList
          items={shown.items.map((item) => ({ ...item, key: `${item.employeeId}-${item.date}` }))}
          render={(item) => <>
            {nameLine(item.employeeName, item.employeeCode, item.branchName)}
            <p className="text-xs text-slate-500">{irregularityNote(item, shownDate)}</p>
            {pendingRequestLabel(item) && <span className="mt-1 inline-block rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-200">{pendingRequestLabel(item)}</span>}
          </>}
        />
      </CardState>
    </DashboardCard>

    <DashboardCard
      title={`Request${requestsLoading ? "" : ` (${waiting.length})`}`}
      note="Waiting for your answer in Leave or Comp-Off Request."
      action={onOpenRequests && waiting.length > 0 ? <Button type="button" size="sm" onClick={onOpenRequests}>Open requests</Button> : null}
    >
      <CardState loading={requestsLoading} error={requestsError} onRetry={onRetryRequests} empty={!waiting.length} emptyMessage="Nothing is waiting for you." rows={3}>
        <PersonList
          items={waiting.map((request) => ({ ...request, key: request.id }))}
          render={(request) => <>
            {nameLine(request.employeeName, request.employeeCode)}
            <p className="text-xs text-slate-500">{requestSummary(request, TYPE_LABELS)}</p>
          </>}
        />
      </CardState>
    </DashboardCard>
  </div>;
}
