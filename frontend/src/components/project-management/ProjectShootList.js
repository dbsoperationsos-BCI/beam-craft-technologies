"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import DataTable from "@/components/data-table/DataTable";
import ComboBoxField from "@/components/shared/ComboBoxField";
import Dropdown from "@/components/shared/Dropdown";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { districtOptions, durationForSessionTiming, durationLabelForSessionTiming, formatSessionTiming, sessionTimingOptions, shootCareOwnerOptions, shootOptions, shootPreferenceOptions, shootTimingsOf, shootTypeOptions, shootTypesOf, stateForDistrict, stateOptions } from "./AddShootDialog";
import CheckboxGroupField from "@/components/shared/CheckboxGroupField";

const formatDate = (value) => {
  // `new Date(null)` is the epoch rather than an invalid date, so an unscheduled shoot would
  // otherwise read as 1 Jan 1970. Asked first, before anything tries to parse it.
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(date);
};

const emptyEdit = (shoot) => ({
  dateCreated: String(shoot.dateCreated || "").slice(0, 10),
  shoot: shoot.shoot || "",
  shootPlace: shoot.shootPlace || "",
  // Lists, like the dialog - editing a shoot here must not collapse a shoot booked two ways.
  shootTypes: shootTypesOf(shoot).length ? shootTypesOf(shoot) : ["Studio / In-House"],
  isMainEvent: Boolean(shoot.isMainEvent),
  district: shoot.district || "",
  state: shoot.state || "",
  sessionTimings: shootTimingsOf(shoot).length ? shootTimingsOf(shoot) : ["Hourly"],
  ...durationForSessionTiming(shootTimingsOf(shoot).length ? shootTimingsOf(shoot) : ["Hourly"], shoot.sessionDurationHours ?? "", shoot.sessionDurationMinutes ?? ""),
  foodTakenCareBy: shoot.foodTakenCareBy || "Studio",
  accommodation: shoot.accommodation || "Studio",
  travel: shoot.travel || "Studio",
  preference: shoot.preference || "",
});

function validateDraft(draft) {
  // No Date here: a shoot may be added before its day is fixed (Add Shoot asks "Shoot Date
  // Known" first), and demanding one to correct a spelling would force somebody to invent it.
  if (!draft.shoot || !draft.shootPlace.trim() || !draft.district.trim() || !draft.state.trim()) return "Complete Shoot, Shoot Place, District, and State.";
  const types = shootTypesOf(draft);
  const timings = shootTimingsOf(draft);
  if (!types.length || types.some((type) => !shootTypeOptions.includes(type))) return "Select at least one Shoot Type.";
  if (!timings.length || timings.some((timing) => !sessionTimingOptions.includes(timing))) return "Select at least one Session Timing.";
  if (!shootCareOwnerOptions.includes(draft.foodTakenCareBy) || !shootCareOwnerOptions.includes(draft.accommodation) || !shootCareOwnerOptions.includes(draft.travel)) return "Select Studio or Client for Food, Accommodation, and Travel.";
  if (!shootPreferenceOptions.includes(draft.preference)) return "Select a Preference: Groom, Bride, or Both.";
  if (timings.includes("Hourly")) {
    const hours = Number(draft.sessionDurationHours || 0);
    const minutes = Number(draft.sessionDurationMinutes || 0);
    if (hours === 0 && minutes === 0) return "Enter duration for hourly session timing.";
    if (minutes > 59) return "Minutes must be between 0 and 59.";
  }
  return "";
}

function ShootActions({ shoot, index, onEdit, onDelete, editing = false }) {
  return <div className="flex justify-center"><OptionsMenu ariaLabel={`Actions for ${shoot.shoot || "shoot"}`} items={[
    ...(!editing ? [{ label: "Edit", onSelect: () => onEdit(shoot, index) }] : []),
    { label: "Delete", tone: "danger", onSelect: () => onDelete(shoot, index) },
  ]} menuZIndexClassName="z-[140]" /></div>;
}

function numericValue(value, max) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits === "") return "";
  return max === undefined ? digits : String(Math.min(max, Number(digits)));
}

function InlineInput({ initialValue, type = "text", list, options, onChange, onCancel, ariaLabel, max }) {
  const [value, setValue] = useState(initialValue ?? "");
  const className = "min-h-8 w-full rounded-md border border-blue-200 bg-blue-50/60 px-2 text-xs text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100";
  const common = { value: value || "", onKeyDown: (event) => { if (event.key === "Enter") event.preventDefault(); if (event.key === "Escape") { event.preventDefault(); onCancel(); } }, "aria-label": ariaLabel, className };
  if (options) return <Dropdown ariaLabel={ariaLabel} mode="input" value={value || ""} onChange={(nextValue) => { setValue(nextValue); onChange(nextValue); }} options={options.map((option) => ({ label: option, value: option }))} placeholder="Select" menuZIndexClassName="z-[160]" />;
  return <input {...common} type={type} min={type === "number" ? "0" : undefined} max={max} inputMode={type === "number" ? "numeric" : undefined} list={list} onChange={(event) => { const next = type === "number" ? numericValue(event.target.value, max) : event.target.value; setValue(next); onChange(next); }} />;
}

function InlineComboBox({ value, options, onChange, ariaLabel }) {
  return <ComboBoxField hideLabel ariaLabel={ariaLabel} value={value || ""} onChange={onChange} options={options} placeholder={`Select or enter ${ariaLabel.toLowerCase()}`} className="min-w-[12rem]" />;
}

function EditingActions({ saving, onSave, onCancel }) {
  return <div className="flex items-center justify-end gap-1">
    <button type="button" disabled={saving} onClick={onSave} className="min-h-8 rounded-md bg-blue-600 px-2.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{saving ? "Saving" : "Save"}</button>
    <button type="button" disabled={saving} onClick={onCancel} className="min-h-8 rounded-md border border-slate-200 px-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60">Cancel</button>
  </div>;
}

/*
 * The shoots a row may be changed to.
 *
 * `shootChoices` is the caller's own list — for a quotation, the shoots its brand actually quotes
 * for. Without one the studio's whole vocabulary is offered, which is right for a caller that has
 * no narrower list and was wrong for the quotation: editing a row read the global constant while
 * *adding* one went through `AddShootDialog` and was correctly narrowed, so a Dum Dum quotation
 * offered Baby Shower and Corporate the moment somebody edited a shoot instead of adding it.
 *
 * Same contract as that dialog, and in one place because this screen sets the field twice — once in
 * the table and once in the phone-width fields. Two readings of "which shoots" is how the first one
 * drifted.
 */
const shootsOffered = (shootChoices) => (Array.isArray(shootChoices) && shootChoices.length ? shootChoices : shootOptions);

function MobileEditFields({ draft, update, cancelEdit, shootChoices = null }) {
  const [timings, setTimings] = useState(() => shootTimingsOf(draft));
  const updateTimings = (value) => {
    setTimings(value);
    update("sessionTimings", value);
  };
  const rows = [
    ["shoot", "Shoot", <InlineInput key="shoot" initialValue={draft.shoot} options={shootsOffered(shootChoices)} onChange={(value) => update("shoot", value)} onCancel={cancelEdit} ariaLabel="Shoot" />],
    ["dateCreated", "Date", <InlineInput key="dateCreated" type="date" initialValue={draft.dateCreated} onChange={(value) => update("dateCreated", value)} onCancel={cancelEdit} ariaLabel="Date" />],
    ["shootPlace", "Shoot Place", <InlineInput key="shootPlace" initialValue={draft.shootPlace} onChange={(value) => update("shootPlace", value)} onCancel={cancelEdit} ariaLabel="Shoot Place" />],
    ["shootTypes", "Shoot Type", <ShootTypeEdit key="shootTypes" draft={draft} update={update} />],
    ["district", "District", <InlineComboBox key="district" value={draft.district} options={districtOptions} onChange={(value) => update("district", value)} ariaLabel="District" />],
    ["state", "State", <InlineComboBox key="state" value={draft.state} options={stateOptions} onChange={(value) => update("state", value)} ariaLabel="State" />],
    ["sessionTimings", "Session Timing", <CheckboxGroupField key="sessionTimings" label="" name="sessionTimings" value={timings} options={sessionTimingOptions} onChange={updateTimings} className="text-xs" controlClassName={inlineGroupClassName} />],
    ["isMainEvent", "Main Event", <InlineInput key="isMainEvent" initialValue={draft.isMainEvent ? "Yes" : "-"} options={["-", "Yes"]} onChange={(value) => update("isMainEvent", value === "Yes")} onCancel={cancelEdit} ariaLabel="Main Event" />],
    ["foodTakenCareBy", "Food", <InlineInput key="foodTakenCareBy" initialValue={draft.foodTakenCareBy || "Studio"} options={shootCareOwnerOptions} onChange={(value) => update("foodTakenCareBy", value)} onCancel={cancelEdit} ariaLabel="Food Taken Care by" />],
    ["accommodation", "Accommodation", <InlineInput key="accommodation" initialValue={draft.accommodation || "Studio"} options={shootCareOwnerOptions} onChange={(value) => update("accommodation", value)} onCancel={cancelEdit} ariaLabel="Accommodation" />],
    ["travel", "Travel", <InlineInput key="travel" initialValue={draft.travel || "Studio"} options={shootCareOwnerOptions} onChange={(value) => update("travel", value)} onCancel={cancelEdit} ariaLabel="Travel" />],
    ["preference", "Preference", <InlineInput key="preference" initialValue={draft.preference || ""} options={shootPreferenceOptions} onChange={(value) => update("preference", value)} onCancel={cancelEdit} ariaLabel="Preference" />],
  ];
  return <dl className="mt-3 grid grid-cols-1 gap-3 text-slate-600">{rows.map(([field, label, input]) => <div key={field} className="grid grid-cols-[8rem_1fr] items-center gap-2"><dt className="font-medium text-slate-700">{label}</dt><dd>{input}</dd></div>)}<div className="grid grid-cols-[8rem_1fr] items-center gap-2"><dt className="font-medium text-slate-700">Duration</dt><dd className="grid grid-cols-2 gap-2">{timings.includes("Hourly") ? <><InlineInput initialValue={draft.sessionDurationHours} type="number" onChange={(value) => update("sessionDurationHours", value)} onCancel={cancelEdit} ariaLabel="Hours" /><InlineInput initialValue={draft.sessionDurationMinutes} type="number" max={59} onChange={(value) => update("sessionDurationMinutes", value)} onCancel={cancelEdit} ariaLabel="Minutes" /></> : <span className="col-span-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-600">{durationLabelForSessionTiming(timings) || "Not Available"}</span>}</dd></div></dl>;
}

/*
 * The same tick boxes as the dialog, narrow enough for a cell.
 *
 * `py-0 px-0` and no border, because the cell already provides both - see `RadioGroupField` on why
 * `controlClassName` exists.
 */
const inlineGroupClassName = "!mt-0 !min-h-0 gap-x-3 gap-y-1 border-0 bg-transparent px-0 py-0";

function ShootTypeEdit({ draft, update }) {
  return <CheckboxGroupField
    label=""
    name="shootTypes"
    value={shootTypesOf(draft)}
    options={shootTypeOptions}
    onChange={(value) => update("shootTypes", value)}
    className="text-xs"
    controlClassName={inlineGroupClassName}
  />;
}

function SessionTimingEdit({ draft, update, cancelEdit }) {
  const [timings, setTimings] = useState(() => shootTimingsOf(draft));
  const updateTimings = (value) => {
    setTimings(value);
    update("sessionTimings", value);
  };
  return <div className="grid gap-1">
    <CheckboxGroupField label="" name="sessionTimings" value={timings} options={sessionTimingOptions} onChange={updateTimings} className="text-xs" controlClassName={inlineGroupClassName} />
    <div className="grid grid-cols-2 gap-1">{timings.includes("Hourly") ? <><InlineInput initialValue={draft.sessionDurationHours} type="number" onChange={(value) => update("sessionDurationHours", value)} onCancel={cancelEdit} ariaLabel="Hours" /><InlineInput initialValue={draft.sessionDurationMinutes} type="number" max={59} onChange={(value) => update("sessionDurationMinutes", value)} onCancel={cancelEdit} ariaLabel="Minutes" /></> : <span className="col-span-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-600">{durationLabelForSessionTiming(timings) || "Not Available"}</span>}</div>
  </div>;
}

/*
 * `readOnly` is the list with nothing to press: no actions column, no inline editing, the same rows.
 *
 * Create Project uses it for the shoots a quotation was priced on. Those are what the client agreed
 * to pay for, so the project is planned against them rather than around them - and a row that can
 * be retyped on the way in is a project that quietly stops matching the quotation it was sold on.
 */
export default function ProjectShootList({ shoots, loading = false, onSaveEdit, onRequestDelete, showShootId = true, readOnly = false, shootChoices = null }) {
  const [editing, setEditing] = useState(null);
  const draftRef = useRef(null);
  const [error, setError] = useState("");
  const [mainEventConfirm, setMainEventConfirm] = useState(null);
  const [saving, setSaving] = useState(false);

  function startEdit(shoot, index) {
    const draft = emptyEdit(shoot);
    draftRef.current = draft;
    setEditing({ key: shoot.id || shoot.clientKey || `${shoot.shoot}-${index}`, index, shoot, draft });
    setError("");
  }

  function cancelEdit() {
    setEditing(null);
    draftRef.current = null;
    setError("");
  }

  const updateDraft = useCallback((field, value) => {
    const current = draftRef.current || {};
    const matchedState = field === "district" ? stateForDistrict(value) : "";
    if (field === "isMainEvent" && value && !current.isMainEvent) {
      const existingMainShoot = shoots.find((shoot, index) => index !== editing?.index && shoot.isMainEvent);
      const existingMainLabel = existingMainShoot ? `${existingMainShoot.shoot || "Untitled Shoot"}${existingMainShoot.shootId ? ` (${existingMainShoot.shootId})` : ""}` : "";
      const message = existingMainShoot
        ? `${existingMainLabel} is already marked as Main Event. Do you want to change the Main Event to this shoot?`
        : "Are you sure you want to mark this shoot as the Main Event?";
      setMainEventConfirm({ value, message });
      return;
    }
    const nextDraft = {
      ...current,
      [field]: value,
      ...(matchedState ? { state: matchedState } : {}),
      ...(field === "sessionTiming" ? durationForSessionTiming(value) : {}),
    };
    draftRef.current = nextDraft;
    setEditing((currentEditing) => currentEditing ? { ...currentEditing, draft: nextDraft } : currentEditing);
  }, [editing?.index, shoots]);

  function confirmMainEventDraft() {
    const current = draftRef.current || {};
    const nextDraft = { ...current, isMainEvent: Boolean(mainEventConfirm?.value) };
    draftRef.current = nextDraft;
    setEditing((currentEditing) => currentEditing ? { ...currentEditing, draft: nextDraft } : currentEditing);
    setMainEventConfirm(null);
  }

  const saveEdit = useCallback(async () => {
    const draft = draftRef.current;
    const validationError = validateDraft(draft);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const types = shootTypesOf(draft);
      const timings = shootTimingsOf(draft);
      const duration = durationForSessionTiming(timings, draft.sessionDurationHours, draft.sessionDurationMinutes);
      await onSaveEdit?.(editing.shoot, editing.index, {
        ...editing.shoot,
        ...draft,
        dateCreated: draft.dateCreated,
        shootPlace: draft.shootPlace.trim(),
        shootTypes: types,
        sessionTimings: timings,
        // The first of each list, kept in step for anything that reads a shoot one-at-a-time.
        shootType: types[0] || "Studio / In-House",
        isMainEvent: Boolean(draft.isMainEvent),
        district: draft.district.trim(),
        state: draft.state.trim(),
        sessionTiming: timings[0] || "Hourly",
        sessionDurationHours: Number(duration.sessionDurationHours || 0),
        sessionDurationMinutes: Number(duration.sessionDurationMinutes || 0),
        foodTakenCareBy: draft.foodTakenCareBy || "Studio",
        accommodation: draft.accommodation || "Studio",
        travel: draft.travel || "Studio",
        preference: draft.preference,
        eventStartTime: null,
        eventEndTime: null,
      });
      cancelEdit();
    } catch (saveError) {
      setError(saveError.message || "Unable to save shoot.");
    } finally {
      setSaving(false);
    }
  }, [editing, onSaveEdit]);

  const columns = useMemo(() => [
    ...(showShootId ? [{ id: "shootId", header: "Shoot ID", accessorFn: (shoot) => shoot.shootId || "Pending", sortable: false, filterable: false, width: 120, cell: ({ row }) => row.original.shootId || "Pending" }] : []),
    { id: "dateCreated", header: "Date", accessorFn: (shoot) => formatDate(shoot.dateCreated), sortable: false, filterable: false, width: editing ? 170 : 140, cell: ({ row }) => editing?.index === row.index ? <InlineInput type="date" initialValue={editing.draft.dateCreated} onChange={(value) => updateDraft("dateCreated", value)} onCancel={cancelEdit} ariaLabel="Date" /> : formatDate(row.original.dateCreated) },
    { id: "shoot", header: "Shoot", accessorFn: (shoot) => shoot.shoot || "—", sortable: false, filterable: false, width: editing ? 210 : 180, cell: ({ row }) => editing?.index === row.index ? <InlineInput initialValue={editing.draft.shoot} options={shootsOffered(shootChoices)} onChange={(value) => updateDraft("shoot", value)} onCancel={cancelEdit} ariaLabel="Shoot" /> : row.original.shoot || "—" },
    { id: "shootPlace", header: "Shoot Place", accessorFn: (shoot) => shoot.shootPlace || "—", sortable: false, filterable: false, width: editing ? 220 : 200, cell: ({ row }) => editing?.index === row.index ? <InlineInput initialValue={editing.draft.shootPlace} onChange={(value) => updateDraft("shootPlace", value)} onCancel={cancelEdit} ariaLabel="Shoot Place" /> : row.original.shootPlace || "—" },
    { id: "shootType", header: "Shoot Type", accessorFn: (shoot) => shootTypesOf(shoot).join(", ") || "Studio / In-House", sortable: false, filterable: false, width: editing ? 230 : 190, cell: ({ row }) => editing?.index === row.index ? <ShootTypeEdit draft={editing.draft} update={updateDraft} /> : shootTypesOf(row.original).join(", ") || "Studio / In-House" },
    { id: "district", header: "District", accessorFn: (shoot) => shoot.district || "—", sortable: false, filterable: false, width: editing ? 230 : 170, cell: ({ row }) => editing?.index === row.index ? <InlineComboBox value={editing.draft.district} options={districtOptions} onChange={(value) => updateDraft("district", value)} ariaLabel="District" /> : row.original.district || "—" },
    { id: "state", header: "State", accessorFn: (shoot) => shoot.state || "—", sortable: false, filterable: false, width: editing ? 230 : 170, cell: ({ row }) => editing?.index === row.index ? <InlineComboBox value={editing.draft.state} options={stateOptions} onChange={(value) => updateDraft("state", value)} ariaLabel="State" /> : row.original.state || "—" },
    { id: "sessionTiming", header: "Session Timing", accessorFn: formatSessionTiming, sortable: false, filterable: false, width: editing ? 230 : 180, cell: ({ row }) => editing?.index === row.index ? <SessionTimingEdit draft={editing.draft} update={updateDraft} cancelEdit={cancelEdit} /> : formatSessionTiming(row.original) },
    { id: "isMainEvent", header: "Main Event", accessorFn: (shoot) => shoot.isMainEvent ? "Yes" : "-", sortable: false, filterable: false, width: editing ? 140 : 120, cell: ({ row }) => editing?.index === row.index ? <InlineInput initialValue={editing.draft.isMainEvent ? "Yes" : "-"} options={["-", "Yes"]} onChange={(value) => updateDraft("isMainEvent", value === "Yes")} onCancel={cancelEdit} ariaLabel="Main Event" /> : row.original.isMainEvent ? "Yes" : "-" },
    { id: "foodTakenCareBy", header: "Food", accessorFn: (shoot) => shoot.foodTakenCareBy || "Studio", sortable: false, filterable: false, width: editing ? 150 : 120, cell: ({ row }) => editing?.index === row.index ? <InlineInput initialValue={editing.draft.foodTakenCareBy || "Studio"} options={shootCareOwnerOptions} onChange={(value) => updateDraft("foodTakenCareBy", value)} onCancel={cancelEdit} ariaLabel="Food Taken Care by" /> : row.original.foodTakenCareBy || "Studio" },
    { id: "accommodation", header: "Accommodation", accessorFn: (shoot) => shoot.accommodation || "Studio", sortable: false, filterable: false, width: editing ? 170 : 150, cell: ({ row }) => editing?.index === row.index ? <InlineInput initialValue={editing.draft.accommodation || "Studio"} options={shootCareOwnerOptions} onChange={(value) => updateDraft("accommodation", value)} onCancel={cancelEdit} ariaLabel="Accommodation" /> : row.original.accommodation || "Studio" },
    { id: "travel", header: "Travel", accessorFn: (shoot) => shoot.travel || "Studio", sortable: false, filterable: false, width: editing ? 150 : 120, cell: ({ row }) => editing?.index === row.index ? <InlineInput initialValue={editing.draft.travel || "Studio"} options={shootCareOwnerOptions} onChange={(value) => updateDraft("travel", value)} onCancel={cancelEdit} ariaLabel="Travel" /> : row.original.travel || "Studio" },
    // A shoot booked before this was asked for has none, and a dash says "not recorded" rather
    // than inventing a side for it.
    { id: "preference", header: "Preference", accessorFn: (shoot) => shoot.preference || "", sortable: false, filterable: false, width: editing ? 150 : 120, cell: ({ row }) => editing?.index === row.index ? <InlineInput initialValue={editing.draft.preference || ""} options={shootPreferenceOptions} onChange={(value) => updateDraft("preference", value)} onCancel={cancelEdit} ariaLabel="Preference" /> : row.original.preference || "—" },
    ...(readOnly ? [] : [{ id: "actions", header: "", sortable: false, filterable: false, fixed: true, width: editing ? 112 : 52, minWidth: editing ? 112 : 52, size: editing ? 112 : 52, minSize: editing ? 112 : 48, maxSize: editing ? 112 : 56, cell: ({ row }) => editing?.index === row.index ? <EditingActions saving={saving} onSave={() => void saveEdit()} onCancel={cancelEdit} /> : <ShootActions shoot={row.original} index={row.index} onEdit={startEdit} onDelete={onRequestDelete} /> }]),
  ], [editing, onRequestDelete, readOnly, saveEdit, saving, showShootId, updateDraft]);

  if (loading) return <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">Loading shoots...</p>;
  if (!shoots.length) return <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">No shoots added yet.</p>;

  return <div className="space-y-3">
    {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    <div className="hidden h-auto overflow-x-auto rounded-lg border border-slate-200 md:block">
      <DataTable columns={columns} data={shoots} loading={false} ariaLabel="Shoot list table" /*
       * No table ⋮ on this one. Manage Columns, Export CSV and Compact view are a page-level
       * table's menu; on a handful of shoots inside a form they are a control that opens over the
       * form to offer things nobody came here for.
       */
      features={{ filtering: false, sorting: false, columnResize: true, tableOptions: false }}
      /*
       * The scrollbar's own room, on the element that actually scrolls - `DataTable` puts this on
       * its scroll container, which is the one holding the table.
       *
       * Fourteen columns is about two thousand pixels, so this list scrolls sideways wherever it is
       * read, and the scrollbar was drawn *over* the last row: on macOS an overlay scrollbar sits on
       * top of content, and the line it covered was a shoot somebody was scrolling to find.
       * `scrollbar-gutter: stable` reserves the track, and the padding keeps an overlay bar clear of
       * the final row.
       */
      className="pb-3 [scrollbar-gutter:stable]"
      getRowId={(shoot, index) => shoot.id || shoot.clientKey || `${shoot.shoot}-${index}`} />
    </div>
    <div className="space-y-3 md:hidden">
      {shoots.map((shoot, index) => {
        const key = shoot.id || shoot.clientKey || `${shoot.shoot}-${index}`;
        const isEditing = editing?.key === key;
        return <article key={key} className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-slate-900">{shoot.shoot || "—"}</p>
              <p className="mt-1 text-xs text-slate-500">{showShootId ? `${shoot.shootId || "Pending"} · ` : ""}{formatDate(shoot.dateCreated)}</p>
            </div>
            {!readOnly && !isEditing && <ShootActions shoot={shoot} index={index} onEdit={startEdit} onDelete={onRequestDelete} />}
          </div>
          {isEditing ? <>
            <MobileEditFields draft={editing.draft} update={updateDraft} cancelEdit={cancelEdit} shootChoices={shootChoices} />
            <div className="mt-4 flex justify-end"><EditingActions saving={saving} onSave={() => void saveEdit()} onCancel={cancelEdit} /></div>
          </> : <dl className="mt-3 grid grid-cols-1 gap-2 text-slate-600 sm:grid-cols-2 xl:grid-cols-3">
            {[["shootPlace", "Shoot Place"], ["shootType", "Shoot Type"], ["district", "District"], ["state", "State"], ["foodTakenCareBy", "Food"], ["accommodation", "Accommodation"], ["travel", "Travel"], ["preference", "Preference"]].map(([field, label]) => <div key={field} className="grid grid-cols-[8rem_1fr] gap-2"><dt className="font-medium text-slate-700">{label}</dt><dd className="min-w-0 break-words">{field === "shootType" ? (shootTypesOf(shoot).join(", ") || "Studio / In-House") : shoot[field] || (["foodTakenCareBy", "accommodation", "travel"].includes(field) ? "Studio" : "—")}</dd></div>)}<div className="grid grid-cols-[8rem_1fr] gap-2"><dt className="font-medium text-slate-700">Session Timing</dt><dd className="min-w-0 break-words">{formatSessionTiming(shoot)}</dd></div><div className="grid grid-cols-[8rem_1fr] gap-2"><dt className="font-medium text-slate-700">Main Event</dt><dd>{shoot.isMainEvent ? "Yes" : "-"}</dd></div>
          </dl>}
        </article>;
      })}
    </div>
    {mainEventConfirm && <ConfirmDialog title="Mark as Main Event?" message={mainEventConfirm.message} confirmLabel="Confirm" tone="primary" layer="dialogOverPanel" onCancel={() => setMainEventConfirm(null)} onConfirm={confirmMainEventDraft} />}
  </div>;
}
