"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import A4DocumentPreview from "@/components/shared/A4DocumentPreview";
import Button from "@/components/shared/Button";
import Checkbox from "@/components/shared/Checkbox";
import FileUploadField from "@/components/shared/FileUploadField";
import HelpTip from "@/components/shared/HelpTip";
import SortableList from "@/components/shared/SortableList";
import { CardState } from "@/components/shared/DashboardCard";
import TextAreaField from "@/components/shared/TextAreaField";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import useFormErrors from "@/components/shared/useFormErrors";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Dialog from "@/components/ui/Dialog";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { layers } from "@/constants/layers";
import { sectionsToText, textToSections } from "@/lib/offerSectionsText.mjs";
import { getOfferLetterSections, importOfferLetterSections, previewOfferLetterSections, saveOfferLetterCompensation, saveOfferLetterEmployment, saveOfferLetterSections } from "@/services/settings/certificates.service";

/*
 * Settings → Offer Letter → Sections: the letter's sections, titled not numbered, all in one list held and dragged
 * into order - the two built-in ones as well as the studio's own. Employment Details prints the lines
 * switched on for it (Choose lines), filled from the employee, and with none on, is left out.
 * Compensation likewise - Monthly Gross
 * Salary (the employee's salary), Annual CTC (twelve of it), Salary Payment Date (the payroll's payable
 * day) and Deductions (the summary typed here) - and with none on, is left out. Then the
 * studio's own: a title and its content each, printed in the order listed, added, edited, moved
 * and removed one at a time, each saved as it is made. `onSaved` tells the page, so the A4 sheet
 * below redraws.
 *
 * Settings is a form panel, so the menu, the dialog and the confirmation all sit on the layers over
 * a panel - on the plain `dialog` layer they open underneath it, and nothing seems to happen.
 */

const MAX_SECTIONS = 15;
const isList = (format) => format === "POINTS" || format === "NUMBERED";

/**
 * The studio's own sections as one piece of text, edited like a document - ## a title, - a point,
 * 1. a numbered point, anything else a paragraph - beside the offer letter itself, drawn from that
 * text as it is typed. Two errands:
 *   Import Offer Letter (`editIndex` null) - pick a Word document, the server reads it into sections,
 *     and they are added after the sections already there.
 *   Edit (`editIndex` a section's place) - that section as text; saved back in its place, and a second
 *     ## title typed into it adds a section right after it.
 * Nothing is saved until Save is pressed; only the words come across, printed in the letter's style.
 */
function SectionsDocumentDialog({ existing, editIndex = null, onClose, onSave }) {
  const editing = editIndex !== null;
  const [file, setFile] = useState([]);
  const [reading, setReading] = useState(false);
  const [text, setText] = useState(() => (editing ? sectionsToText([existing[editIndex]]) : null));
  const [warnings, setWarnings] = useState([]);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState({ html: "", state: "" });
  const { busy, run } = useSubmitOnce();
  const fields = useFormErrors();
  const parsed = useMemo(() => (text === null ? null : textToSections(text)), [text]);

  async function read() {
    if (!fields.check({ file: file[0] ? "" : "Choose a .docx file." })) return;
    setReading(true);
    setError("");
    try {
      const data = (await importOfferLetterSections(file[0]))?.data || {};
      setText(sectionsToText(data.sections || []));
      setWarnings(data.warnings || []);
    } catch (requestError) {
      setError(requestError?.data?.message || requestError?.message || "Unable to read that document.");
    } finally {
      setReading(false);
    }
  }

  // The list as it would be saved: the text's sections after the existing ones, or in the edited one's place.
  const compose = (written) => (editing ? [...existing.slice(0, editIndex), ...written, ...existing.slice(editIndex + 1)] : [...existing, ...written]);

  /*
   * The letter, redrawn a moment after the typing stops, from what the box holds - the sections that
   * can already be read, where they would be saved. What cannot be read yet is left out of the
   * drawing and said beside the box.
   */
  useEffect(() => {
    if (!parsed) return undefined;
    const drawable = parsed.sections.filter((section) => section.title && (section.format === "PARAGRAPH" ? section.content : section.points.length));
    const sections = compose(drawable);
    let live = true;
    const timer = window.setTimeout(() => {
      setPreview((current) => ({ ...current, state: "updating" }));
      previewOfferLetterSections({ sections })
        .then((response) => { if (live) setPreview({ html: response?.data?.html || "", state: "" }); })
        .catch(() => { if (live) setPreview((current) => ({ ...current, state: "failed" })); });
    }, 400);
    return () => { live = false; window.clearTimeout(timer); };
    // `compose` reads only `existing` and `editIndex`, both listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, existing, editIndex]);

  // The cap is on the studio's own sections, as they would be saved.
  const total = compose(parsed?.sections || []).filter((entry) => !isBuiltin(entry)).length;

  function save(event) {
    event?.preventDefault?.();
    if (!parsed) { void read(); return; }
    // Every problem here is the text's, so it is said under the text box.
    const textProblem = parsed.errors.length ? "Fix the lines listed below."
      : !parsed.sections.length ? (editing ? "Write the section, or remove it from its ⋮ instead." : "Nothing is left to import.")
        : total > MAX_SECTIONS ? `The letter takes ${MAX_SECTIONS} sections of your own - remove ${total - MAX_SECTIONS} here, or some of those already there first.` : "";
    setError("");
    if (!fields.check({ text: textProblem })) return;
    void run(async () => {
      try {
        await onSave(compose(parsed.sections), parsed.sections);
      } catch (requestError) {
        setError(requestError?.data?.message || requestError?.message || "Unable to save the sections.");
      }
    });
  }

  return <Dialog
    title={editing ? "Edit Section" : "Import Offer Letter"}
    description={parsed ? "Edit the text like a document - the letter beside it shows how it prints." : "Read a Word document's text into sections. The letter prints them in its own style."}
    size={parsed ? "wide" : "md"}
    layer="dialogOverPanel"
    busy={busy || reading}
    onClose={() => { if (!busy && !reading) onClose(); }}
    onSubmit={save}
    footer={<>
      <Button type="button" variant="secondary" onClick={onClose} disabled={busy || reading}>Cancel</Button>
      {parsed
        ? <Button type="submit" variant="primary" busy={busy}>{editing ? "Save Section" : "Save Sections"}</Button>
        : <Button type="submit" variant="primary" busy={reading} busyLabel="Reading...">Read Document</Button>}
    </>}
  >
    {!parsed && <div className="flex flex-col gap-4">
      <FileUploadField label="Word document (.docx)" required accept=".docx" maxFiles={1} value={file} onChange={(value) => { setFile(value); setError(""); fields.clear("file"); }} error={fields.errors.file} />
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </div>}
    {parsed && <div className="grid gap-4 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-3">
        {warnings.length > 0 && <ul className="list-disc space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-6 py-2 text-xs text-amber-800 sm:text-sm">
          {warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>}
        <TextAreaField label={editing ? "Section" : "Sections"} required rows={22} value={text} onChange={(event) => { setText(event.target.value); setError(""); fields.clear("text"); }} error={fields.errors.text} helperText="“## Title” starts a section · “- text” a bullet point · “1. text” a numbered point · any other line is the paragraph. A section is one of those three." />
        {parsed.errors.length > 0 && <ul role="alert" className="list-disc space-y-1 rounded-lg border border-red-200 bg-red-50 px-6 py-2 text-xs text-red-700 sm:text-sm">
          {parsed.errors.map((message) => <li key={message}>{message}</li>)}
        </ul>}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        {preview.state === "updating" && <p className="text-xs text-slate-500" aria-live="polite">Updating the letter...</p>}
        {preview.state === "failed" && <p className="text-xs text-red-700" role="alert">The letter could not be redrawn - it may not show your latest text. Saving still works.</p>}
        {/* A window of its own height, as the Sections box beside it is, scrolled inside - so the
            letter is read page by page without moving the text being edited out of view. */}
        <div className="h-[28rem] overflow-y-auto rounded-lg lg:h-[34rem]">
          <A4DocumentPreview html={preview.html} title="The offer letter with these sections" />
        </div>
      </div>
    </div>}
  </Dialog>;
}

const EMPLOYMENT_LINES = [
  { key: "designation", label: "Designation", hint: "Also the job title in the subject." },
  { key: "department", label: "Department", hint: "Filled from the employee's department." },
  { key: "employmentType", label: "Employment Type", hint: "The employee's Work Type." },
  { key: "workLocation", label: "Work Location", hint: "The current work location." },
  { key: "reportingTo", label: "Reporting To", hint: "Reports To." },
  { key: "dateOfJoining", label: "Date of Joining", hint: "Filled from the employee's joining date." },
];
const COMPENSATION_LINES = [
  { key: "monthlyGross", label: "Monthly Gross Salary", hint: "The employee's salary." },
  { key: "annualCtc", label: "Annual CTC", hint: "The salary times 12." },
  { key: "paymentDate", label: "Salary Payment Date", hint: "The payroll's payable day, as Payroll rules set it." },
  { key: "statutory", label: "Deductions", hint: "Prints the summary below." },
];
const SUMMARY_LIMIT = 1000;
const anyLine = (saved, lines) => Boolean(saved && lines.some((line) => saved[line.key]));
// Employment Details and Compensation: in the list as `{ builtin }`, where they were placed.
const isBuiltin = (entry) => Boolean(entry?.builtin);
const BUILTIN_TITLES = { EMPLOYMENT: "Employment Details", COMPENSATION: "Compensation" };

/**
 * A built-in section's lines - Employment Details, Compensation: a switch for each, saved together
 * (`store`); only those on print, and with none on the section is left out. `withSummary` is
 * Compensation's Deductions summary, asked while that line is on. Opened from the row's Choose lines.
 */
function SectionLinesCard({ title, lines, filledFrom, saved, store, withSummary = false, onStored, onNotice, onError }) {
  const [draft, setDraft] = useState(saved);
  const [error, setError] = useState("");
  const { busy, run } = useSubmitOnce();
  const fields = useFormErrors();
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  const set = (key, value) => { setDraft((current) => ({ ...current, [key]: value })); setError(""); fields.clear(key); };

  function save() {
    setError("");
    if (!fields.check({ statutorySummary: withSummary && draft.statutory && !draft.statutorySummary.trim() ? "Write the Deductions summary, or switch it off." : "" })) return;
    void run(async () => {
      try {
        const next = await store(withSummary ? { ...draft, statutorySummary: draft.statutorySummary.trim() } : draft);
        setDraft(next);
        onStored(next);
        onNotice?.(anyLine(next, lines) ? `${title} is saved.` : `${title} is switched off - it no longer prints on the offer letter.`);
      } catch (requestError) {
        const message = requestError?.data?.message || requestError?.message || `Unable to save ${title}.`;
        setError(message);
        onError?.(message);
      }
    });
  }

  return <div className="flex flex-col gap-3">
    <p className="text-xs text-slate-600 sm:text-sm">{anyLine(draft, lines) ? `The lines switched on print on the letter, filled from ${filledFrom}.` : `Every line is off: ${title} is left off the letter.`}</p>
    <div className="grid gap-3 sm:grid-cols-2">
      {lines.map((line) => <ToggleSwitch key={line.key} label={line.label} helperText={line.hint} checked={Boolean(draft[line.key])} disabled={busy} onCheckedChange={(checked) => set(line.key, checked)} />)}
    </div>
    {withSummary && draft.statutory && <TextAreaField label="Deductions summary" required rows={3} maxLength={SUMMARY_LIMIT} disabled={busy} value={draft.statutorySummary} onChange={(event) => set("statutorySummary", event.target.value)} error={fields.errors.statutorySummary} helperText="Printed as the Deductions line under Compensation, such as PF and ESI." />}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    <div className="flex flex-wrap items-center justify-end gap-2">
      <span className="mr-auto text-xs text-slate-500" aria-live="polite">{changed ? "Unsaved changes" : "All changes saved"}</span>
      {changed && <Button type="button" size="sm" disabled={busy} onClick={() => { setDraft(saved); setError(""); fields.clearAll(); }}>Discard changes</Button>}
      <Button type="button" variant="primary" size="sm" disabled={!changed} busy={busy} onClick={save}>Save</Button>
    </div>
  </div>;
}

export default function OfferLetterSectionsEditor({ onSaved, onNotice, onError }) {
  const [sections, setSections] = useState([]);
  const [employment, setEmployment] = useState(null);
  const [compensation, setCompensation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  // The place of the section being edited in the document editor, or null.
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [importing, setImporting] = useState(false);
  // The built-in section whose lines are being chosen: "EMPLOYMENT", "COMPENSATION" or null.
  const [choosingLines, setChoosingLines] = useState(null);
  // The studio's own sections ticked to be deleted together - by their place in the list - and the
  // confirmation for it. The built-in two are never ticked: they are switched off, not deleted.
  const [selected, setSelected] = useState(() => new Set());
  const [deletingSelected, setDeletingSelected] = useState(false);
  const { busy, run } = useSubmitOnce();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const data = (await getOfferLetterSections())?.data || {};
      setSections(data.sections || []);
      setEmployment(data.employment || null);
      setCompensation(data.compensation || null);
    } catch (requestError) {
      setLoadError(requestError?.data?.message || requestError?.message || "Unable to load the sections.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  /** Saves the whole list, in order; refused, the list on screen stays as it was. */
  function store(next, message) {
    return Promise.resolve(run(async () => {
      const saved = (await saveOfferLetterSections({ sections: next }))?.data?.sections || [];
      setSections(saved);
      // The places have moved, so whatever was ticked no longer points where it did.
      setSelected(new Set());
      onSaved?.();
      onNotice?.(message);
    }));
  }

  // Held and dragged to a new place; the new order is saved as it is.
  function reorder(ids) {
    const next = ids.map((id) => sections[Number(String(id).replace("entry-", ""))]).filter(Boolean);
    if (next.length !== sections.length) return;
    void store(next, "The sections are reordered.").catch((requestError) => onError?.(requestError?.data?.message || requestError?.message || "Unable to reorder the sections."));
  }

  function toggleSelected(index, checked) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(index); else next.delete(index);
      return next;
    });
  }

  function removeSelected() {
    const count = selected.size;
    void store(sections.filter((entry, at) => !selected.has(at)), `${count} ${count === 1 ? "section is" : "sections are"} deleted from the offer letter.`)
      .catch((requestError) => onError?.(requestError?.data?.message || requestError?.message || "Unable to delete the sections."))
      .finally(() => setDeletingSelected(false));
  }

  function remove() {
    const index = removing;
    const section = sections[index];
    void store(sections.filter((entry, at) => at !== index), `${section.title} is removed from the offer letter.`)
      .catch((requestError) => onError?.(requestError?.data?.message || requestError?.message || "Unable to remove the section."))
      .finally(() => setRemoving(null));
  }

  const ownCount = sections.filter((entry) => !isBuiltin(entry)).length;
  const ownIndexes = sections.map((entry, index) => (isBuiltin(entry) ? null : index)).filter((index) => index !== null);
  const allSelected = ownCount > 0 && ownIndexes.every((index) => selected.has(index));
  const selectedTitles = [...selected].map((index) => sections[index]?.title).filter(Boolean);
  // A built-in row's summary: the lines switched on, or that it is off.
  const linesSummary = (entry) => {
    const [lines, saved] = entry.builtin === "EMPLOYMENT" ? [EMPLOYMENT_LINES, employment] : [COMPENSATION_LINES, compensation];
    const on = lines.filter((line) => saved?.[line.key]).map((line) => line.label);
    return on.length ? on.join(", ") : "Every line is off - not on the letter.";
  };

  return <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <p className="flex min-w-0 items-center text-sm font-semibold text-slate-800">Sections<HelpTip text="The letter prints them in this order - hold and drag any of them to move it. Employment Details and Compensation print the lines switched on." /></p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => setImporting(true)} disabled={loading || Boolean(loadError)}>Import Offer Letter</Button>
      </div>
    </div>
    <CardState loading={loading} error={loadError} onRetry={load} rows={2}>
      {/* Ticking the studio's own sections to delete several at once - all of them from Select all. */}
      {ownCount > 0 && <div className="mb-2 flex min-h-9 flex-wrap items-center justify-between gap-2 px-1">
        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-600 sm:text-sm">
          <Checkbox
            ariaLabel="Select all your sections"
            checked={allSelected}
            indeterminate={selected.size > 0 && !allSelected}
            disabled={busy}
            onChange={(checked) => setSelected(checked ? new Set(ownIndexes) : new Set())}
          />
          {selected.size ? `${selected.size} selected` : "Select all"}
        </label>
        {selected.size > 0 && <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setSelected(new Set())}>Clear</Button>
          <Button type="button" variant="danger" size="sm" disabled={busy} onClick={() => setDeletingSelected(true)}>Delete selected ({selected.size})</Button>
        </div>}
      </div>}
      {/* Every section in one list, held and dragged into a new order and saved as it lands: the
          built-in two as well as the studio's own. */}
      <SortableList
        label="Sections"
        disabled={busy}
        // Moved by holding and dragging alone - no arrows beside each row.
        moveButtons={false}
        items={sections.map((entry, index) => ({ ...entry, id: `entry-${index}`, label: entry.builtin ? BUILTIN_TITLES[entry.builtin] : entry.title, index }))}
        onReorder={reorder}
        renderRow={(row) => <div className="flex items-start gap-3">
          {/* A tick box on the studio's own; the built-in two keep the space, so the titles line up. */}
          <span className="mt-0.5 flex w-5 shrink-0 justify-center">
            {!row.builtin && <Checkbox ariaLabel={`Select ${row.label}`} checked={selected.has(row.index)} disabled={busy} onChange={(checked) => toggleSelected(row.index, checked)} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-800">{row.label}</p>
            <p className="line-clamp-2 whitespace-pre-line text-xs text-slate-600">{row.builtin ? linesSummary(row)
              : isList(row.format) ? row.points.map((point, at) => `${row.format === "NUMBERED" ? `${at + 1}.` : "•"} ${point}`).join("\n") : row.content}</p>
          </div>
          <OptionsMenu ariaLabel={`Actions for ${row.label}`} menuZIndexClassName={layers.menuOverPanel} items={row.builtin
            ? [{ label: "Choose lines", onSelect: () => setChoosingLines(row.builtin) }]
            : [
              { label: "Edit", onSelect: () => setEditing(row.index) },
              { label: "Remove", tone: "danger", onSelect: () => setRemoving(row.index) },
            ]} />
        </div>}
      />
      {!ownCount && <p className="mt-2 px-1 text-xs text-slate-500">No sections of your own yet - import a Word document to add them.</p>}
    </CardState>
    {editing !== null && sections[editing] && <SectionsDocumentDialog
      existing={sections}
      editIndex={editing}
      onClose={() => setEditing(null)}
      onSave={(next, written) => store(next, `${written.map((section) => section.title).join(", ")} ${written.length === 1 ? "is" : "are"} saved.`).then(() => setEditing(null))}
    />}
    {/* A built-in section's switches, opened from its row - kept out of the dragged row itself. */}
    {choosingLines === "EMPLOYMENT" && employment && <Dialog title="Employment Details - lines" size="md" layer="dialogOverPanel" onClose={() => setChoosingLines(null)}>
      <SectionLinesCard title="Employment Details" lines={EMPLOYMENT_LINES} filledFrom="the employee" saved={employment}
        store={async (payload) => (await saveOfferLetterEmployment(payload))?.data?.employment}
        onStored={(next) => { setEmployment(next); setChoosingLines(null); onSaved?.(); }} onNotice={onNotice} onError={onError} />
    </Dialog>}
    {choosingLines === "COMPENSATION" && compensation && <Dialog title="Compensation - lines" size="md" layer="dialogOverPanel" onClose={() => setChoosingLines(null)}>
      <SectionLinesCard title="Compensation" lines={COMPENSATION_LINES} filledFrom="the employee and the payroll" saved={compensation} withSummary
        store={async (payload) => (await saveOfferLetterCompensation(payload))?.data?.compensation}
        onStored={(next) => { setCompensation(next); setChoosingLines(null); onSaved?.(); }} onNotice={onNotice} onError={onError} />
    </Dialog>}
    {importing && <SectionsDocumentDialog
      existing={sections}
      onClose={() => setImporting(false)}
      onSave={(next, written) => store(next, `${written.length} ${written.length === 1 ? "section is" : "sections are"} imported.`).then(() => setImporting(false))}
    />}
    <ConfirmDialog
      open={deletingSelected}
      title={`Delete ${selected.size} ${selected.size === 1 ? "section" : "sections"}?`}
      message={`${selectedTitles.slice(0, 3).map((title) => `"${title}"`).join(", ")}${selectedTitles.length > 3 ? ` and ${selectedTitles.length - 3} more` : ""} will no longer print on the offer letter.`}
      confirmLabel="Delete"
      tone="danger"
      loading={busy}
      layer="dialogOverPanel"
      onConfirm={removeSelected}
      onCancel={() => setDeletingSelected(false)}
    />
    <ConfirmDialog
      open={removing !== null}
      title="Remove this section?"
      message={removing !== null ? `"${sections[removing]?.title}" will no longer print on the offer letter.` : ""}
      confirmLabel="Remove"
      tone="danger"
      loading={busy}
      layer="dialogOverPanel"
      onConfirm={remove}
      onCancel={() => setRemoving(null)}
    />
  </section>;
}
