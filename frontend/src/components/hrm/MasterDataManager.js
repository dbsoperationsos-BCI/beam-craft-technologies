"use client";

import SimpleTable from "@/components/data-table/SimpleTable";

import { useCallback, useEffect, useState } from "react";
import { deactivateMasterData, getMasterData, saveMasterData } from "@/services/hrm/master-data.service";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import Loader from "@/components/shared/Loader";
import { fieldLabels, masterDataModules } from "./masterDataConfig";
import { useRouteAccess } from "@/components/auth/PermissionsProvider";

const emptyValues = (fields) => Object.fromEntries(fields.map((field) => [field, ""]));

function getErrorMessage(error) {
  if (error.status === 401 || error.status === 403) return "Your session has expired. Please sign in again.";
  return error.message || "Request failed";
}

export default function MasterDataManager({ resource }) {
  const config = masterDataModules[resource];
  // HRM / Master Data. Without READ_WRITE the records are still listed - that is what READ is for -
  // but the form that creates and edits them, and the per-row Edit and Deactivate, are not drawn.
  const { canWrite } = useRouteAccess();
  const [records, setRecords] = useState([]);
  const [form, setForm] = useState(() => emptyValues(config.fields));
  const [editingId, setEditingId] = useState(null);
  const { notice, showSuccess, showError, clearNotice } = useNotice();
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getMasterData(resource);
      setRecords(result.data);
    } catch (error) {
      showError(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [resource, showError]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function resetForm() {
    setForm(emptyValues(config.fields));
    setEditingId(null);
  }

  function edit(record) {
    setEditingId(record.id);
    setForm(Object.fromEntries(config.fields.map((field) => [field, record[field] ?? ""])));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit(event) {
    event.preventDefault();
    const payload = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, key === "sortOrder" || key === "parentDepartmentId" ? (value === "" ? null : Number(value)) : value || null]));
    try {
      await saveMasterData(resource, payload, editingId);
      showSuccess(`${config.singular} ${editingId ? "updated" : "created"}.`);
      resetForm();
      void load();
    } catch (error) {
      showError(getErrorMessage(error));
    }
  }

  async function deactivate(id) {
    if (!window.confirm(`Deactivate this ${config.singular.toLowerCase()}?`)) return;
    try {
      await deactivateMasterData(resource, id);
      showSuccess(`${config.singular} deactivated.`);
      void load();
    } catch (error) {
      showError(getErrorMessage(error));
    }
  }

  return <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-900 sm:px-10"><div className="mx-auto max-w-6xl"><header className="mb-8"><p className="text-sm font-semibold uppercase tracking-widest text-indigo-600">HRM Foundation</p><h1 className="mt-2 text-3xl font-bold">{config.label}</h1><p className="mt-2 text-slate-600">Maintain reusable workforce master data. Deleting a record deactivates it to preserve future references.</p></header><FloatingNotice notice={notice} onClose={clearNotice} />{canWrite && <section className="mb-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="mb-4 text-lg font-semibold">{editingId ? `Edit ${config.singular}` : `Add ${config.singular}`}</h2><form onSubmit={submit} className="grid gap-4 md:grid-cols-2">{config.fields.map((field) => <label key={field} className={field === "description" || field === "address" ? "md:col-span-2 text-sm font-medium" : "text-sm font-medium"}>{fieldLabels[field]}{field === "description" || field === "address" ? <textarea value={form[field]} onChange={(event) => updateField(field, event.target.value)} className="mt-1 block min-h-24 w-full rounded-md border border-slate-300 px-3 py-2 font-normal" /> : <input required={field === "code" || field === "name"} type={field === "sortOrder" || field === "parentDepartmentId" ? "number" : "text"} value={form[field]} onChange={(event) => updateField(field, event.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 font-normal" />}</label>)}<div className="flex gap-3 md:col-span-2"><button type="submit" className="rounded-md bg-indigo-700 px-4 py-2 font-medium text-white">{editingId ? "Save changes" : `Create ${config.singular}`}</button>{editingId && <button type="button" onClick={resetForm} className="rounded-md border border-slate-300 px-4 py-2 font-medium">Cancel</button>}</div></form></section>}<section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-200 px-5 py-4"><h2 className="font-semibold">Records</h2></div><SimpleTable variant="form" classNames={{ wrapper: "!rounded-none !border-0", table: "text-sm", head: "!text-sm !font-normal !tracking-normal !text-slate-600", th: "!px-5 !py-3", td: "!px-5 !py-3", empty: "!px-5 !py-8" }} columns={[{ key: "code", label: "Code", cellClassName: "font-mono text-xs", render: (record) => record.code }, { key: "name", label: "Name", render: (record) => record.name }, { key: "status", label: "Status", render: (record) => <span className={record.isActive ? "rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-700" : "rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600"}>{record.isActive ? "Active" : "Inactive"}</span> }, ...(canWrite ? [{ key: "actions", label: "Actions", headerClassName: "text-right", cellClassName: "text-right", render: (record) => <>{<button type="button" onClick={() => edit(record)} className="mr-3 text-indigo-700">Edit</button>}{record.isActive && <button type="button" onClick={() => deactivate(record.id)} className="text-rose-700">Deactivate</button>}</> }] : [])]} rows={records} loading={loading} loadingMessage="Loading records..." emptyMessage="No records yet." /></section></div></main>;
}
