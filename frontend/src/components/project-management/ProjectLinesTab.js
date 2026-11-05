"use client";

import { useCallback, useEffect, useState } from "react";
import SimpleTable from "@/components/data-table/SimpleTable";
import Button from "@/components/shared/Button";
import Loader from "@/components/shared/Loader";
import TextField from "@/components/shared/TextField";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Dialog from "@/components/ui/Dialog";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { layers } from "@/constants/layers";
import { deliverableRowLabel } from "@/lib/deliverableBrands.mjs";
import {
  deleteProjectDeliverableAllocation,
  deleteProjectServiceAllocation,
  getProjectDeliverableAllocations,
  getProjectServiceAllocations,
  updateProjectDeliverableAllocation,
  updateProjectServiceAllocation,
} from "@/services/project-management/project-workflow.service";

/*
 * A project's services and deliverables, shoot by shoot, as tables - the Services & Deliverables tab of
 * a project's View, each line with its amount at the studio's prices. Whatever is on the project shows: what the team added in Edit Project and what was
 * approved from the client's own requests (Client Management -> Client Requests). Each line can be
 * edited (how many, its remarks - and a deliverable's photo count) or removed, through the same
 * endpoints Edit Project uses, so the same permissions decide. Opened inside the project's full-screen
 * panel, so its menus and dialogs stack above it.
 */

const rupees = (amount) => `Rs ${Math.round(Number(amount) || 0).toLocaleString("en-IN")}`;
/*
 * What a line comes to, at the studio's prices (Settings -> Project -> Services / Deliverables): its
 * Price for the quantity - or, priced per session or size instead, the lowest of those - and nothing
 * where the entry is complimentary. `{ amount, free, from }`; amount null when Settings has no price.
 */
function amountOf(line) {
  const definition = line.serviceDefinition || line.deliverableDefinition || {};
  if (definition.complimentary === true) return { amount: 0, free: true };
  const quantity = Number(line.quantity) || 1;
  if (definition.price !== null && definition.price !== undefined && definition.price !== "") return { amount: Number(definition.price) * quantity };
  const rows = Array.isArray(definition.pricing) ? definition.pricing.map((entry) => Number(entry?.price)).filter((value) => Number.isFinite(value) && value > 0) : [];
  return rows.length ? { amount: Math.min(...rows) * quantity, from: true } : { amount: null };
}
const sumOf = (lines) => lines.reduce((sum, line) => sum + (amountOf(line).amount || 0), 0);
const amountCell = (line) => {
  const { amount, free, from } = amountOf(line);
  if (free) return <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Free</span>;
  return amount === null ? <span className="text-slate-400">—</span> : <span className="font-medium tabular-nums text-slate-800">{from ? "from " : ""}{rupees(amount)}</span>;
};

const when = (value) => (value ? new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

/** Changing one line: its quantity and remarks, and for a deliverable its photo count. */
function EditLine({ line, onClose, onSaved }) {
  const isService = line.kind === "service";
  const [quantity, setQuantity] = useState(String(line.quantity ?? 1));
  const [photos, setPhotos] = useState(line.numberOfPhotos == null ? "" : String(line.numberOfPhotos));
  const [remarks, setRemarks] = useState(line.remarks || "");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");

  async function save() {
    const count = Number(quantity);
    if (!Number.isInteger(count) || count < 1) { setProblem("Enter how many - 1 or more."); return; }
    setSaving(true);
    setProblem("");
    try {
      const data = { quantity: count, remarks: remarks.trim() || null, ...(isService ? {} : { numberOfPhotos: photos === "" ? null : Number(photos) }) };
      await (isService ? updateProjectServiceAllocation(line.projectId, line.id, data) : updateProjectDeliverableAllocation(line.projectId, line.id, data));
      onSaved(`${line.name} saved.`);
    } catch (error) {
      setProblem(error.message || "Unable to save.");
    } finally {
      setSaving(false);
    }
  }

  return <Dialog
    title={`Edit ${line.name}`}
    description={`${line.shootName}${isService ? " · Service" : " · Deliverable"}`}
    size="sm"
    layer="dialogOverPanel"
    onClose={onClose}
    busy={saving}
    onSubmit={(event) => { event.preventDefault(); void save(); }}
    footer={<>
      <Button type="button" onClick={onClose} disabled={saving}>Cancel</Button>
      <Button type="submit" variant="primary" disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
    </>}
  >
    <div className="space-y-4">
      <TextField label="Quantity" type="number" min={1} value={quantity} onChange={(event) => setQuantity(event.target.value)} />
      {isService ? null : <TextField label="No. of photos" type="number" min={0} value={photos} onChange={(event) => setPhotos(event.target.value)} />}
      <TextField label="Remarks" value={remarks} onChange={(event) => setRemarks(event.target.value)} />
      {problem ? <p className="text-sm text-red-600" role="alert">{problem}</p> : null}
    </div>
  </Dialog>;
}

export default function ProjectLinesTab({ projectId }) {
  const [shoots, setShoots] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);
  // Narrowing the tab: one shoot (or all), words to find a line, and the shoot cards folded shut.
  const [shootFilter, setShootFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [closed, setClosed] = useState(() => new Set());

  const load = useCallback(async () => {
    try {
      const [services, deliverables] = await Promise.all([getProjectServiceAllocations(projectId), getProjectDeliverableAllocations(projectId)]);
      // Shoot by shoot, in the order the shoots run.
      const byShoot = new Map();
      const add = (row, kind) => {
        const shoot = row.shoot || { id: row.shootId, shoot: "Shoot" };
        if (!byShoot.has(shoot.id)) byShoot.set(shoot.id, { ...shoot, services: [], deliverables: [] });
        const line = { ...row, kind, projectId, shootName: shoot.shoot, name: kind === "service" ? row.serviceName : (row.deliverableName || row.name) };
        byShoot.get(shoot.id)[kind === "service" ? "services" : "deliverables"].push(line);
      };
      (services?.data || []).forEach((row) => add(row, "service"));
      (deliverables?.data || []).forEach((row) => add(row, "deliverable"));
      setShoots([...byShoot.values()].sort((a, b) => String(a.dateCreated || "").localeCompare(String(b.dateCreated || ""))));
      setError("");
    } catch (loadError) {
      setError(loadError.message || "Unable to load the services and deliverables.");
    }
  }, [projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function remove() {
    setBusy(true);
    try {
      await (removing.kind === "service" ? deleteProjectServiceAllocation(projectId, removing.id) : deleteProjectDeliverableAllocation(projectId, removing.id));
      setNotice(`${removing.name} removed.`);
      setRemoving(null);
      await load();
    } catch (removeError) {
      setNotice(removeError.message || "Unable to remove it.");
    } finally {
      setBusy(false);
    }
  }

  const menu = (line) => <OptionsMenu ariaLabel={`Actions for ${line.name}`} menuZIndexClassName={layers.menuOverPanel} items={[
    { label: "Edit", onSelect: () => setEditing(line) },
    { label: "Remove", tone: "danger", onSelect: () => setRemoving(line) },
  ]} />;
  const compact = { variant: "form", classNames: { wrapper: "overflow-x-auto", table: "w-full border-collapse text-left text-sm", th: "px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500", td: "px-3 py-2 align-middle" } };

  if (error) return <p className="m-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;
  if (!shoots) return <Loader label="Loading services and deliverables..." className="p-6" />;

  const words = query.trim().toLowerCase();
  const matches = (line) => !words || [line.name, line.remarks, deliverableRowLabel(line)].some((text) => String(text || "").toLowerCase().includes(words));
  const shown = shoots
    .filter((shoot) => shootFilter === "all" || shoot.id === shootFilter)
    .map((shoot) => ({ ...shoot, services: shoot.services.filter(matches), deliverables: shoot.deliverables.filter(matches) }))
    .filter((shoot) => !words || shoot.services.length || shoot.deliverables.length);
  const totals = {
    services: shoots.reduce((n, shoot) => n + shoot.services.length, 0),
    deliverables: shoots.reduce((n, shoot) => n + shoot.deliverables.length, 0),
    amount: shoots.reduce((sum, shoot) => sum + sumOf(shoot.services) + sumOf(shoot.deliverables), 0),
  };
  const toggle = (id) => setClosed((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const tile = (label, value, tone) => <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
    <span className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm font-bold ${tone}`}>{value}</span>
    <span className="text-sm font-medium text-slate-600">{label}</span>
  </div>;
  const block = (title, lines, children) => <div className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white">
    <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
      <span className="text-sm font-semibold text-slate-700">{title}</span>
      <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-500 ring-1 ring-slate-200">{lines.length}</span>
      <span className="ml-auto text-sm font-semibold tabular-nums text-slate-700">{rupees(sumOf(lines))}</span>
    </div>
    {children}
  </div>;

  return <div className="w-full space-y-4 px-4 py-4 sm:px-6">
    {/* Where the project stands at a glance, and a way to find a line. */}
    <div className="flex flex-wrap items-center gap-3">
      {tile("Shoots", shoots.length, "bg-slate-100 text-slate-700")}
      {tile("Services", totals.services, "bg-blue-50 text-blue-700")}
      {tile("Deliverables", totals.deliverables, "bg-emerald-50 text-emerald-700")}
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <span className="text-sm font-medium text-slate-600">Total amount</span>
        <span className="text-lg font-bold tabular-nums text-slate-900">{rupees(totals.amount)}</span>
      </div>
      <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search services and deliverables" aria-label="Search services and deliverables" className="ml-auto h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:border-blue-500 focus:outline-none sm:w-72" />
    </div>
    {shoots.length > 1 ? <div className="flex flex-wrap gap-2" role="tablist" aria-label="Shoots">
      {[{ id: "all", shoot: "All shoots", count: totals.services + totals.deliverables }, ...shoots.map((shoot) => ({ ...shoot, count: shoot.services.length + shoot.deliverables.length }))].map((chip) => {
        const on = shootFilter === chip.id;
        return <button key={chip.id} type="button" role="tab" aria-selected={on} onClick={() => setShootFilter(chip.id)} className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${on ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-400"}`}>
          {chip.shoot}<span className={`ml-1.5 text-xs ${on ? "text-blue-100" : "text-slate-400"}`}>{chip.count}</span>
        </button>;
      })}
    </div> : null}
    {notice ? <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700" role="status">{notice}</p> : null}
    {!shown.length ? <p className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">{words ? `Nothing matches "${query.trim()}".` : "No services or deliverables on this project yet."}</p> : null}

    {/* A card a shoot, folding shut on its header: its services beside its deliverables. */}
    {shown.map((shoot) => {
      const open = !closed.has(shoot.id);
      return <section key={shoot.id} className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50/60 shadow-sm">
        <button type="button" onClick={() => toggle(shoot.id)} aria-expanded={open} className="flex w-full items-center gap-3 bg-white px-4 py-3 text-left hover:bg-slate-50">
          <span aria-hidden="true" className={`text-slate-400 transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-semibold text-slate-900">{shoot.shoot}</span>
            <span className="block text-xs text-slate-500">{[shoot.shootId, when(shoot.dateCreated)].filter(Boolean).join(" · ")}</span>
          </span>
          <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">{shoot.services.length} service{shoot.services.length === 1 ? "" : "s"}</span>
          <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">{shoot.deliverables.length} deliverable{shoot.deliverables.length === 1 ? "" : "s"}</span>
          <span className="min-w-[96px] text-right text-sm font-bold tabular-nums text-slate-900">{rupees(sumOf(shoot.services) + sumOf(shoot.deliverables))}</span>
        </button>
        {open ? <div className="grid gap-3 border-t border-slate-200 p-3 xl:grid-cols-2">
          {block("Services", shoot.services, <SimpleTable
            {...compact}
            rows={shoot.services}
            emptyMessage="No services on this shoot."
            columns={[
              { key: "name", label: "Service", render: (line) => <span className="font-medium text-slate-800">{line.name}</span> },
              { key: "quantity", label: "Qty", headerClassName: "w-14", render: (line) => line.quantity ?? 1 },
              { key: "amount", label: "Amount", headerClassName: "w-28", render: amountCell },
              { key: "remarks", label: "Remarks", render: (line) => <span className="text-slate-500">{line.remarks || "—"}</span> },
              { key: "menu", label: "Actions", srOnly: true, cellClassName: "w-10 text-right", render: menu },
            ]}
          />)}
          {block("Deliverables", shoot.deliverables, <SimpleTable
            {...compact}
            rows={shoot.deliverables}
            emptyMessage="No deliverables on this shoot."
            columns={[
              { key: "name", label: "Deliverable", render: (line) => <span className="font-medium text-slate-800">{deliverableRowLabel(line) || line.name}</span> },
              { key: "quantity", label: "Qty", headerClassName: "w-14", render: (line) => line.quantity ?? 1 },
              { key: "photos", label: "Photos", headerClassName: "w-16", render: (line) => (line.numberOfPhotos == null ? "—" : line.numberOfPhotos) },
              { key: "amount", label: "Amount", headerClassName: "w-28", render: amountCell },
              { key: "remarks", label: "Remarks", render: (line) => <span className="text-slate-500">{line.remarks || "—"}</span> },
              { key: "menu", label: "Actions", srOnly: true, cellClassName: "w-10 text-right", render: menu },
            ]}
          />)}
        </div> : null}
      </section>;
    })}
    {editing ? <EditLine line={editing} onClose={() => setEditing(null)} onSaved={(message) => { setEditing(null); setNotice(message); void load(); }} /> : null}
    {removing ? <ConfirmDialog
      layer="dialogOverPanel"
      title={`Remove ${removing.name}?`}
      message={`It comes off ${removing.shootName} on this project${removing.kind === "service" ? ", with the deliverables it brought automatically" : ""}.`}
      confirmLabel="Remove"
      busyLabel="Removing..."
      loading={busy}
      onCancel={() => setRemoving(null)}
      onConfirm={() => void remove()}
    /> : null}
  </div>;
}
