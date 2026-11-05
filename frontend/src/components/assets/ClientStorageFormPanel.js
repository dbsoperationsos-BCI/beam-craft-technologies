"use client";

import { useCallback, useMemo, useState } from "react";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import { clientStorageFormSections, emptyValues } from "@/constants/formPanelConfig";

function formatDate(value) {
  return value ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(value)) : "";
}

/**
 * The shoot's and project's own columns are shown read-only: they are stored once on those records
 * and read through the links, so a storage record can never disagree with them.
 *
 * A record raised automatically when its project started may not have a shoot yet, so the project
 * details fall back to the record's own project link and only the two shoot rows stay blank until a
 * shoot is chosen.
 */
function ShootSummary({ shoot, project }) {
  const details = shoot?.project || project;
  const rows = [
    ["Date Created", formatDate(shoot?.dateCreated)],
    ["Client Name", details?.clientName],
    ["Project Status", details?.projectStatus],
    ["Shoot", shoot?.shoot],
    ["Main Event Date", formatDate(details?.mainEventDate)],
    ["Source Branch", details?.sourceBranch],
    ["CRM", details?.crmName],
    ["Pre Production Coordinator", details?.preProductionCoordinator],
    ["Creative Manager", details?.creativeManager],
    ["Post Production Coordinator", details?.postProductionCoordinator],
  ];
  if (!shoot && !details) return <p className="text-sm text-slate-500">Select a Shoot ID to pull in the client, project status and coordinator details.</p>;
  return <>
    {!shoot && <p className="mb-3 text-sm text-slate-500">Select a Shoot ID to record which shoot this footage came from.</p>}
    <dl className="grid gap-x-4 gap-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
      {rows.map(([label, value]) => <div key={label}><dt className="text-xs font-semibold text-slate-500">{label}</dt><dd className="mt-0.5 text-sm text-slate-800">{value || "—"}</dd></div>)}
    </dl>
  </>;
}

export default function ClientStorageFormPanel({ record, shoots, options, saving, error, onClose, onSave }) {
  const [form, setForm] = useState(() => ({ ...emptyValues(clientStorageFormSections, record), storageId: record?.storageId || "" }));
  const update = useCallback((field, value) => setForm((current) => ({ ...current, [field]: value })), []);

  // The dropdown only carries the most recent shoots, so a record already pointing at an older one
  // falls back to the shoot it was saved with rather than showing an empty selection.
  const selectedShoot = useMemo(
    () => shoots.find((item) => item.id === form.shootId) || (record?.shoot?.id === form.shootId ? record.shoot : null),
    [form.shootId, shoots, record],
  );
  const shootOptions = useMemo(() => {
    const list = shoots.map((item) => ({ value: item.id, label: `${item.shootId} — ${item.shoot}` }));
    if (selectedShoot && !shoots.some((item) => item.id === selectedShoot.id)) list.unshift({ value: selectedShoot.id, label: `${selectedShoot.shootId} — ${selectedShoot.shoot}` });
    return list;
  }, [shoots, selectedShoot]);

  const context = useMemo(() => ({
    options: { ...options, shoots: shootOptions },
    renderers: { shootSummary: () => <ShootSummary shoot={selectedShoot} project={record?.project} /> },
  }), [options, record, selectedShoot, shootOptions]);

  function submit(event) {
    event.preventDefault();
    const { storageId, shootSummary, ...payload } = form;
    onSave({ ...payload, shootId: payload.shootId || null });
  }

  return <SchemaFormPanel
    title={record ? "Edit Storage" : "Add Storage"}
    description="Record the hard disc holding a shoot's footage and the checks done on it."
    sections={clientStorageFormSections}
    values={form}
    onChange={update}
    context={context}
    sidebarAriaLabel="Client storage form sections"
    closeAriaLabel="Close client storage form"
    onClose={onClose}
    onSubmit={submit}
    error={error}
    saving={saving}
    submitLabel={record ? "Update Storage" : "Save Storage"}
    savingLabel="Saving..."
  />;
}
