"use client";

import { useCallback, useEffect, useState } from "react";
import { deleteMasterData, getMasterData, saveMasterData } from "@/services/hrm/master-data.service";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import SchemaFormSection from "@/components/schema-form/SchemaFormSection";
import Button from "@/components/shared/Button";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import Loader from "@/components/shared/Loader";
import TextField from "@/components/shared/TextField";
import Dialog from "@/components/ui/Dialog";

/**
 * Every master-data row is keyed by a code as well as a name, but the name is the only part HR ever
 * sees, so the code is derived from it rather than asked for. A clash comes back from the server as
 * a plain "already exists".
 */
const toCode = (name) => name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50);

function errorMessage(error, fallback) {
  if (error?.status === 401 || error?.status === 403) return "Your session has expired. Please sign in again.";
  return error?.data?.message || error?.message || fallback;
}

/** One list, drawn as a section of the panel so the rail can move between them. */
function OptionList({ option, records, loading, busyId, editing, onStartEdit, onCancelEdit, onEditingNameChange, onRename, onDelete, newName, onNewNameChange, onAdd, adding }) {
  const noun = option.singular.toLowerCase();
  return <SchemaFormSection id={option.resource} title={option.label}>
    {/* A row, not a form. This panel is drawn inside SchemaFormPanel's own form, and a form cannot
        contain another: the inner one's submit handler does not reliably intercept, so Add
        performed a native submit that reloaded the route — the panel vanished and the page came
        back with nothing added and nothing said. The button adds directly, and Enter in the box is
        wired to the same call so the keyboard still works. */}
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <TextField
        className="min-w-0 flex-1"
        label={`Add ${option.singular}`}
        value={newName}
        onChange={(event) => onNewNameChange(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onAdd(); } }}
        placeholder={`New ${noun} name`}
      />
      <Button type="button" variant="primary" className="max-sm:w-full" onClick={onAdd} disabled={adding || !newName.trim()}>{adding ? "Adding..." : "Add"}</Button>
    </div>

    {loading
      ? <Loader label={`Loading ${option.label.toLowerCase()}...`} />
      : records.length === 0
        ? <p className="mt-4 rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">No {option.label.toLowerCase()} yet.</p>
        : <ul className="mt-4 divide-y divide-slate-100 border-t border-slate-200">
          {records.map((record) => <li key={record.id} className="flex flex-wrap items-center gap-2 py-2.5">
            {editing?.id === record.id
              ? <TextField className="min-w-0 flex-1" aria-label={`${option.singular} name`} value={editing.name} onChange={(event) => onEditingNameChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onRename(record); } }} />
              : <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{record.name}</span>}
            {editing?.id === record.id ? <>
              <Button type="button" size="sm" variant="primary" busy={busyId === record.id} onClick={() => onRename(record)}>Save</Button>
              <Button type="button" size="sm" onClick={onCancelEdit}>Cancel</Button>
            </> : <>
              <Button type="button" size="sm" disabled={busyId === record.id} onClick={() => onStartEdit(record)}>Rename</Button>
              <Button type="button" size="sm" variant="danger" busy={busyId === record.id} onClick={() => onDelete(option, record)}>Delete</Button>
            </>}
          </li>)}
        </ul>}
  </SchemaFormSection>;
}

/**
 * Maintains the lists the employee form's Designation, Department, Vertical and Skills dropdowns are
 * built from. Drawn as a full-screen schema panel with a section per list, so it reads like every
 * other settings surface rather than as a dialog with tabs.
 *
 * Each change saves on its own, so the panel has no Save of its own — the footer only closes it.
 */
/**
 * Maintains a set of master-data lists — the rows other forms then pick from.
 *
 * Which lists, and what the panel is called, come from the caller: HR maintains designations and
 * skills here, Accounts maintains its bank accounts, and both are the same screen because a
 * master-data row is the same thing either way — a code, a name, and whether it is still offered.
 */
/**
 * @param extraSections screens that are not option lists but belong in the same Settings panel,
 *                      as `[{ id, title, render }]`. Table Settings is one: it is a builder rather
 *                      than a list of names, and it belongs beside the lists rather than behind a
 *                      second entry in the same menu.
 */
export default function MasterDataSettingsPanel({ resources, extraSections = [], title = "Settings", description, onClose, onSaved }) {
  const [records, setRecords] = useState({});
  const [loading, setLoading] = useState(true);
  const [newNames, setNewNames] = useState({});
  const [addingResource, setAddingResource] = useState("");
  const [editing, setEditing] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const { notice, showSuccess, showError, clearNotice } = useNotice();

  const loadAll = useCallback(async () => {
    try {
      const results = await Promise.all(resources.map((option) => getMasterData(option.resource)
        .then((result) => [option.resource, result.data || []])
        .catch(() => [option.resource, []])));
      setRecords(Object.fromEntries(results));
    } catch (error) {
      showError(errorMessage(error, "Unable to load these options."));
    } finally {
      setLoading(false);
    }
  }, [resources, showError]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadAll(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadAll]);

  async function add(option) {
    const name = (newNames[option.resource] || "").trim();
    if (!name) return;
    setAddingResource(option.resource);
    try {
      await saveMasterData(option.resource, { code: toCode(name), name });
      setNewNames((current) => ({ ...current, [option.resource]: "" }));
      showSuccess(`${option.singular} added.`);
      await loadAll();
      onSaved?.();
    } catch (error) {
      showError(errorMessage(error, `Unable to add this ${option.singular.toLowerCase()}.`));
    } finally {
      setAddingResource("");
    }
  }

  async function rename(option, record) {
    const name = (editing?.name || "").trim();
    if (!name || name === record.name) {
      setEditing(null);
      return;
    }
    setBusyId(record.id);
    try {
      await saveMasterData(option.resource, { name }, record.id);
      setEditing(null);
      showSuccess(`${option.singular} renamed.`);
      await loadAll();
      onSaved?.();
    } catch (error) {
      showError(errorMessage(error, `Unable to rename this ${option.singular.toLowerCase()}.`));
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    const { option, record } = deleting;
    setBusyId(record.id);
    try {
      await deleteMasterData(option.resource, record.id);
      setDeleting(null);
      showSuccess(`${option.singular} deleted.`);
      await loadAll();
      onSaved?.();
    } catch (error) {
      showError(errorMessage(error, `Unable to delete this ${option.singular.toLowerCase()}.`));
    } finally {
      setBusyId(null);
    }
  }

  return <>
    <FloatingNotice notice={notice} onClose={clearNotice} />
    <SchemaFormPanel
      title={title}
      description={description}
      sections={[...resources.map((option) => [option.resource, option.label]), ...extraSections.map((section) => [section.id, section.title])]}
      sidebarAriaLabel="Employee option lists"
      closeAriaLabel="Close employee settings"
      onClose={onClose}
      // Each change saves as it is made, so there is nothing for a submit to do.
      onSubmit={(event) => event.preventDefault()}
      loading={loading}
      loadingLabel="Loading options..."
      // The rail moves between the four lists rather than scrolling through them, so only the chosen
      // one is drawn.
      navigate
      footer={<Button className="ml-auto max-sm:w-full" type="button" variant="primary" onClick={onClose}>Done</Button>}
    >
      {(activeResource) => {
        // The extra screens are looked for first: they are not option lists, and falling through to
        // the list renderer would draw the wrong thing under the right heading.
        const extra = extraSections.find((section) => section.id === activeResource);
        if (extra) return extra.render();
        const option = resources.find((item) => item.resource === activeResource) || resources[0];
        return <OptionList
          option={option}
          records={records[option.resource] || []}
          loading={false}
          busyId={busyId}
          editing={editing?.resource === option.resource ? editing : null}
          onStartEdit={(record) => setEditing({ resource: option.resource, id: record.id, name: record.name })}
          onCancelEdit={() => setEditing(null)}
          onEditingNameChange={(name) => setEditing((current) => ({ ...current, name }))}
          onRename={(record) => void rename(option, record)}
          onDelete={(listOption, record) => setDeleting({ option: listOption, record })}
          newName={newNames[option.resource] || ""}
          onNewNameChange={(name) => setNewNames((current) => ({ ...current, [option.resource]: name }))}
          onAdd={() => void add(option)}
          adding={addingResource === option.resource}
        />;
      }}
    </SchemaFormPanel>

    {/* Stacks above the panel it was opened from, so the row being deleted stays in view. */}
    {deleting && <Dialog
      title={`Delete ${deleting.option.singular}`}
      layer="dialogOverPanel"
      busy={busyId === deleting.record.id}
      onClose={() => { if (busyId !== deleting.record.id) setDeleting(null); }}
      footer={<>
        <Button className="max-sm:flex-1" type="button" disabled={busyId === deleting.record.id} onClick={() => setDeleting(null)}>Cancel</Button>
        <Button className="max-sm:flex-1" type="button" variant="danger" disabled={busyId === deleting.record.id} onClick={() => void confirmDelete()}>{busyId === deleting.record.id ? "Deleting..." : "Delete"}</Button>
      </>}
    >
      <p className="text-sm leading-6 text-slate-600">
        Are you sure you want to delete <span className="font-semibold text-slate-800">{deleting.record.name}</span>? It will no longer be offered in the employee form. Employees already recorded against it keep it, and you can add it again later.
      </p>
    </Dialog>}
  </>;
}
