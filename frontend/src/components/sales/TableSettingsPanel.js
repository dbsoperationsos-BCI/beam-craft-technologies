"use client";

import SimpleTable from "@/components/data-table/SimpleTable";

import { useEffect, useMemo, useRef, useState } from "react";
import Button from "@/components/shared/Button";
import Checkbox from "@/components/shared/Checkbox";
import DateField from "@/components/shared/DateField";
import Dropdown from "@/components/shared/Dropdown";
import IconButton from "@/components/shared/IconButton";
import SelectableOption from "@/components/shared/SelectableOption";
import TextField from "@/components/shared/TextField";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import useUnsavedGuard from "@/components/shared/useUnsavedGuard";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { SIDEBAR_MODULES } from "@/constants/navigation.mjs";
import ArrowUpwardRoundedIcon from "@mui/icons-material/ArrowUpwardRounded";
import ArrowDownwardRoundedIcon from "@mui/icons-material/ArrowDownwardRounded";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";

/**
 * The CRM's form builder, reached from Settings › General Settings › Table Settings.
 *
 * A field built here becomes three things at once: a column on that vertical's lead table, a
 * row in the lead Info panel, and an input in the Client Details section of Add Lead. That
 * is the point of it - the CRM's shape is set here rather than in code.
 *
 * Fields belong to one vertical. Dum Dum, Qua Qua and Corp collect genuinely different
 * things, and the vertical picker in the header is what decides which form is on the canvas.
 * Saving replaces that vertical's fields and touches no other, so two people editing two
 * verticals cannot overwrite each other.
 */

export const FIELD_TYPES = [
  { type: "text", label: "Input Field", icon: "▭" },
  { type: "number", label: "Numeric Field", icon: "123" },
  { type: "email", label: "Email Field", icon: "@" },
  { type: "website", label: "Website Field", icon: "🌐" },
  { type: "textarea", label: "Text Area", icon: "▤" },
  { type: "checkbox", label: "CheckBox Group", icon: "☑" },
  { type: "radio", label: "Radio Group", icon: "◉" },
  { type: "dropdown", label: "DropDown", icon: "▾" },
  { type: "date", label: "Datepicker", icon: "▦" },
];

const TYPES_WITH_OPTIONS = ["checkbox", "radio", "dropdown"];
const MAX_FIELDS = 40;

function typeLabel(type) {
  return FIELD_TYPES.find((item) => item.type === type)?.label || "Input Field";
}

/**
 * A choice list, normalised to `{ text, value, default }`.
 *
 * `text` is shown on the lead form, `value` is what gets stored against the lead, so a
 * branch can read "Coimbatore" and be filed as "Cbe". A bare string becomes both, which is
 * the shape fields saved before options had a value still hold.
 */
export function normalizeOptions(options) {
  // Shape only - empty rows are kept. A row the user has just added is empty until they type
  // in it, and dropping it here would make "Add option" appear to do nothing.
  return (Array.isArray(options) ? options : []).map((option) => (typeof option === "string"
    ? { text: option, value: option, default: false }
    : { text: String(option?.text ?? ""), value: String(option?.value ?? option?.text ?? ""), default: Boolean(option?.default) }));
}

// The choices worth rendering on a lead form: an unfinished row has nothing to show.
function renderableOptions(options) {
  return normalizeOptions(options).filter((option) => option.text.trim());
}

// The choice a lead form starts on, if the builder marked one.
export function defaultOptionValue(field) {
  const option = normalizeOptions(field?.options).find((item) => item.default);
  return option ? option.value || option.text : "";
}

// A row the user is still filling in has a text but no value yet, so the value falls back to
// the text rather than saving a choice that stores nothing.
function optionsForSave(options) {
  const seen = new Set();
  return normalizeOptions(options)
    .map((option) => ({ ...option, text: option.text.trim(), value: (option.value || option.text).trim() }))
    .filter((option) => {
      if (!option.text || seen.has(option.value)) return false;
      seen.add(option.value);
      return true;
    });
}

// What stops a field being saved, said in the words the user needs to fix it. Shared by the
// per-field editor and the whole-form Save so the two cannot disagree about what is valid.
function draftError(field) {
  if (!String(field?.label || "").trim()) return "Give the field a label.";
  if (TYPES_WITH_OPTIONS.includes(field?.fieldType) && !optionsForSave(field?.options).length) {
    return `A ${typeLabel(field.fieldType).toLowerCase()} needs at least one option with text.`;
  }
  return "";
}

function commitOptions(field) {
  return TYPES_WITH_OPTIONS.includes(field.fieldType)
    ? { ...field, options: optionsForSave(field.options) }
    : { ...field, options: [] };
}

/**
 * The Text / Value / Default / Remove grid the builder edits a choice list with.
 *
 * Rows are edited in place and only tidied on save, so typing a space or clearing a cell
 * mid-edit does not fight the user. Default is single-choice: ticking one unticks the rest,
 * because a field starts on one value or none.
 */
function OptionsEditor({ options, onChange }) {
  const rows = normalizeOptions(options);

  function patchRow(index, patch) {
    onChange(rows.map((row, position) => (position === index ? { ...row, ...patch } : row)));
  }

  function setDefault(index, checked) {
    onChange(rows.map((row, position) => ({ ...row, default: checked && position === index })));
  }

  return (
    <div className="sm:col-span-2">
      <p className="text-xs font-semibold text-slate-600">Options</p>
      <SimpleTable
        variant="form"
        classNames={{ wrapper: "mt-1.5 !overflow-hidden", head: "!text-[12px] uppercase", body: "divide-y divide-slate-100 bg-white", row: "!border-t-0" }}
        columns={[
          { key: "text", label: "Text", render: (row, index) => (
            <input
              value={row.text}
              aria-label={`Option ${index + 1} text`}
              onChange={(event) => patchRow(index, { text: event.target.value })}
              className="block min-h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          ) },
          { key: "value", label: "Value", render: (row, index) => (
            <input
              value={row.value}
              aria-label={`Option ${index + 1} value`}
              placeholder={row.text}
              onChange={(event) => patchRow(index, { value: event.target.value })}
              className="block min-h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          ) },
          { key: "default", label: "Default", headerClassName: "w-20 text-center", cellClassName: "text-center", render: (row, index) => (
            <Checkbox
              ariaLabel={`Make ${row.text || `option ${index + 1}`} the default`}
              checked={row.default}
              onChange={(checked) => setDefault(index, checked)}
            />
          ) },
          { key: "remove", label: "Remove", headerClassName: "w-20 text-center", cellClassName: "text-center", render: (row, index) => (
            // The last row keeps its control but cannot be removed - a choice list with nothing
            // in it is not a saveable field.
            <IconButton
              variant="ghost"
              ariaLabel={`Remove ${row.text || `option ${index + 1}`}`}
              disabled={rows.length === 1}
              onClick={() => onChange(rows.filter((item, position) => position !== index))}
            >
              <DeleteOutlineRoundedIcon sx={{ fontSize: 18 }} />
            </IconButton>
          ) },
        ]}
        rows={rows}
        rowKey={(_row, index) => index}
        emptyMessage="No options yet."
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="mt-2"
        onClick={() => onChange([...rows, { text: "", value: "", default: false }])}
      >
        Add option
      </Button>
    </div>
  );
}

// Ids are for React keys and for tracking a card while it is being dragged around the
// canvas; the server never sees them. `key` is the identity that outlives a save.
let draftSequence = 0;
function nextDraftId() {
  draftSequence += 1;
  return `draft-${draftSequence}`;
}

function newField(type) {
  return {
    id: nextDraftId(),
    key: "",
    label: typeLabel(type),
    fieldType: type,
    placeholder: "",
    required: false,
    options: TYPES_WITH_OPTIONS.includes(type) ? ["Option 1"] : [],
  };
}

function toDraft(field) {
  return {
    id: nextDraftId(),
    key: field.key || "",
    label: field.label || "",
    fieldType: field.fieldType || "text",
    placeholder: field.placeholder || "",
    required: Boolean(field.required),
    options: Array.isArray(field.options) ? field.options : [],
  };
}

/**
 * One field as the lead-facing form will render it.
 *
 * Shared by the builder card and the Preview toggle so the two cannot disagree, and reused
 * by Add Lead through `CustomFieldInput` below - a field that looks one way while being
 * built and another once saved would make the builder useless for checking your work.
 */
export function CustomFieldInput({ field, value, onChange, disabled = false }) {
  const label = field.label || typeLabel(field.fieldType);
  // `text` is displayed, `value` is stored - so a choice can read "Coimbatore" and file as
  // "Cbe". Rows still being typed carry no text and are not shown.
  const options = renderableOptions(field.options);

  if (field.fieldType === "textarea") {
    return (
      <label className="block text-xs font-semibold text-slate-600">
        <span>{label}{field.required && <span aria-hidden="true" className="ml-0.5 text-rose-500">*</span>}</span>
        <textarea
          value={value || ""}
          disabled={disabled}
          placeholder={field.placeholder || ""}
          onChange={(event) => onChange?.(event.target.value)}
          className="mt-1.5 block min-h-[5.5rem] w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50"
        />
      </label>
    );
  }

  if (field.fieldType === "date") {
    return <DateField label={label} required={field.required} value={value || ""} disabled={disabled} onChange={(next) => onChange?.(next)} />;
  }

  if (field.fieldType === "dropdown") {
    return (
      <Dropdown
        mode="input"
        label={label}
        required={field.required}
        ariaLabel={label}
        placeholder={field.placeholder || "Select"}
        value={value || ""}
        disabled={disabled}
        onChange={(next) => onChange?.(next)}
        options={options.map((option) => ({ label: option.text, value: option.value || option.text }))}
      />
    );
  }

  if (field.fieldType === "radio") {
    // Built from SelectableOption rather than RadioGroupField because the label shown and
    // the value stored differ here, which that component does not separate. The group also
    // needs a name of its own, or two fields sharing a label behave as one group.
    const groupName = `custom-${field.key || label}`;
    return (
      <fieldset className="text-xs font-semibold text-slate-600">
        <legend>{label}{field.required && <span aria-hidden="true" className="ml-0.5 text-rose-500">*</span>}</legend>
        <div className="mt-1.5 flex min-h-9 flex-wrap items-center gap-4 rounded-lg border border-slate-300 bg-white px-3 py-2">
          {options.map((option) => (
            <SelectableOption
              key={option.value || option.text}
              type="radio"
              name={groupName}
              value={option.value || option.text}
              label={option.text}
              disabled={disabled}
              checked={value === (option.value || option.text)}
              onCheckedChange={() => onChange?.(option.value || option.text)}
            />
          ))}
        </div>
      </fieldset>
    );
  }

  if (field.fieldType === "checkbox") {
    // A checkbox group holds several answers, so its value is a list; it is stored as one
    // comma-joined string because a lead's answers are a flat key/value object.
    const picked = String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
    return (
      <div className="block text-xs font-semibold text-slate-600">
        <span>{label}{field.required && <span aria-hidden="true" className="ml-0.5 text-rose-500">*</span>}</span>
        <div className="mt-1.5 flex min-h-9 flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-slate-300 bg-white px-3 py-2">
          {options.map((option) => {
            const stored = option.value || option.text;
            return (
              <label key={stored} className="flex cursor-pointer items-center gap-2 text-sm font-normal text-slate-700">
                <Checkbox
                  ariaLabel={`${label}: ${option.text}`}
                  checked={picked.includes(stored)}
                  disabled={disabled}
                  onChange={() => {
                    const next = picked.includes(stored) ? picked.filter((item) => item !== stored) : [...picked, stored];
                    onChange?.(next.join(", "));
                  }}
                />
                <span>{option.text}</span>
              </label>
            );
          })}
        </div>
      </div>
    );
  }

  const inputType = field.fieldType === "number" ? "number" : field.fieldType === "email" ? "email" : field.fieldType === "website" ? "url" : "text";
  return (
    <TextField
      label={label}
      required={field.required}
      type={inputType}
      value={value || ""}
      disabled={disabled}
      placeholder={field.placeholder || ""}
      onChange={(event) => onChange?.(event.target.value)}
    />
  );
}

function FieldCard({ field, index, total, editing, onEdit, onDuplicate, onRemove, onMove, onChange, onSave, onCancel }) {
  const error = editing ? draftError(field) : "";

  return (
    <li className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5">
        <span className="truncate text-sm text-slate-500">{typeLabel(field.fieldType)}</span>
        {/* Move up and down rather than drag: the order is what Add Lead renders by, and
            two buttons are reachable by keyboard and on a touch screen, which a drag
            handle is not. */}
        <span className="flex shrink-0 items-center gap-1">
          <IconButton variant="ghost" ariaLabel={`Move ${field.label || "field"} up`} disabled={index === 0} onClick={() => onMove(index, -1)}>
            <ArrowUpwardRoundedIcon sx={{ fontSize: 18 }} />
          </IconButton>
          <IconButton variant="ghost" ariaLabel={`Move ${field.label || "field"} down`} disabled={index === total - 1} onClick={() => onMove(index, 1)}>
            <ArrowDownwardRoundedIcon sx={{ fontSize: 18 }} />
          </IconButton>
          <IconButton variant="ghost" ariaLabel={`${editing ? "Close" : "Open"} settings for ${field.label || "field"}`} onClick={onEdit}>
            <EditRoundedIcon sx={{ fontSize: 18 }} />
          </IconButton>
          <IconButton variant="ghost" ariaLabel={`Duplicate ${field.label || "field"}`} onClick={onDuplicate}>
            <ContentCopyRoundedIcon sx={{ fontSize: 18 }} />
          </IconButton>
          <IconButton variant="ghost" ariaLabel={`Delete ${field.label || "field"}`} onClick={onRemove}>
            <DeleteOutlineRoundedIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </span>
      </div>

      {/* The card shows the field exactly as the lead form will render it. `inert` makes it
          non-interactive without the greyed-out look `disabled` gives, which read as a
          broken control rather than a picture of one. */}
      <div inert={true} className="px-4 py-4">
        <CustomFieldInput field={field} value="" onChange={() => {}} />
      </div>

      {editing && (
        <div className="border-t border-slate-200 bg-slate-50">
          <div className="grid gap-4 px-4 py-4 sm:grid-cols-2">
            <TextField
              label="Field label"
              required
              value={field.label}
              onChange={(event) => onChange({ label: event.target.value })}
            />
            <Dropdown
              mode="input"
              label="Field type"
              ariaLabel="Field type"
              value={field.fieldType}
              onChange={(nextType) => onChange({
                fieldType: nextType,
                // A type that carries choices must not arrive with an empty list, and one
                // that does not must not keep a stale one the builder would never show.
                options: TYPES_WITH_OPTIONS.includes(nextType)
                  ? (normalizeOptions(field.options).length ? field.options : [{ text: "", value: "", default: false }])
                  : [],
              })}
              options={FIELD_TYPES.map((item) => ({ value: item.type, label: item.label }))}
            />
            {!TYPES_WITH_OPTIONS.includes(field.fieldType) && field.fieldType !== "date" && (
              <TextField
                label="Placeholder"
                value={field.placeholder}
                onChange={(event) => onChange({ placeholder: event.target.value })}
              />
            )}
            {TYPES_WITH_OPTIONS.includes(field.fieldType) && (
              <OptionsEditor options={field.options} onChange={(options) => onChange({ options })} />
            )}
            <div className="sm:col-span-2">
              <ToggleSwitch
                label="Required"
                checked={field.required}
                onCheckedChange={(checked) => onChange({ required: checked })}
              />
            </div>
          </div>

          {/* Save commits the card, Cancel puts it back as it was. Without them an edit was
              committed on every keystroke and there was no way to back out of one. */}
          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 px-4 py-3">
            {error && <p role="alert" className="mr-auto text-xs text-rose-600">{error}</p>}
            <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="button" variant="primary" size="sm" onClick={onSave} disabled={Boolean(error)}>
              Save
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

/*
 * ── Three questions, and the first two are the sidebar's ──────────────────────────────────────
 *
 * Module, then screen, then vertical: the same path a person walks in the hamburger to reach the
 * form these fields are built onto, and the same first two questions Field Settings asks one
 * entry below in the rail. So neither picker is written down here - both are `SIDEBAR_MODULES`,
 * the registry the hamburger, Sidebar Layout and Role Management already share, and a screen
 * added there appears in these pickers with nothing changed in this file.
 *
 * It replaced a Module picker over `OS_MODULES`, a list of this application's modules kept only
 * here: a second answer to "what are this application's modules", in its own order, naming
 * `sales-manager`, `booking-converts` and `technical`, which are on no menu. Worse, it filed
 * **Leads & Followups** - a *screen*, the one the hamburger keeps under Sales & CRM - as a module
 * of its own, so the one thing this panel actually edits was the one entry in the wrong column.
 *
 * Nothing about which fields are stored where changes with it: the canvas is keyed by the
 * **vertical** alone, which is what `onSaved` writes and what `fieldsByVertical` is read by. The
 * module and the screen decide what may be picked, never where it is kept.
 */
const MODULE_OPTIONS = SIDEBAR_MODULES.map((group) => ({ value: group.id, label: group.title }));
const screensOf = (moduleId) => (SIDEBAR_MODULES.find((group) => group.id === moduleId)?.items || []);

/**
 * The screens that keep custom fields of their own, by their `navigation.mjs` id.
 *
 * Only the CRM's lead form does today. Every other screen is still offered and answers that it has
 * none, rather than being hidden - this picker and the hamburger describe the same application, and
 * a screen gaining its own table fields later is an id added here, not a new control.
 *
 * An employee's form and a quotation's are fixed, for instance: what varies on those is the answers
 * their fields offer, which is Field Settings, the section after this one.
 */
const TABLE_SETTINGS_SCREENS = new Set(["leads-followups"]);

// The CRM's three verticals, which are what the second picker offers once Leads & Followups is chosen.
export const CRM_VERTICALS = ["Dum Dum", "Qua Qua", "Corp"];

/**
 * The Table Settings builder, rendered inside Settings › General Settings.
 *
 * Three pickers decide what is being edited: a module, then one of its screens, then - once a
 * screen that has table fields is picked - one of its verticals. Each is on screen from the start
 * but inert until the one before it is answered, so the order they must be answered in is visible
 * rather than something the user discovers by clicking.
 */
export default function TableSettingsPanel({ verticalOptions, fieldsByVertical, onSaved, onError, unsavedRef }) {
  const [moduleId, setModuleId] = useState("");
  const [screenId, setScreenId] = useState("");
  const [activeVertical, setActiveVertical] = useState("");
  const [fields, setFields] = useState([]);
  const [loadedBranch, setLoadedBranch] = useState("");
  // The field whose settings are open, held as a working copy. Edits go to the copy, so
  // Cancel can put the card back exactly as it was and Save is the only thing that commits.
  const [editing, setEditing] = useState(null);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef(null);

  function openEditor(field) {
    setEditing({ id: field.id, draft: { ...field, options: normalizeOptions(field.options) } });
  }

  function patchDraft(patch) {
    setEditing((current) => (current ? { ...current, draft: { ...current.draft, ...patch } } : current));
  }

  function commitEditor() {
    if (!editing || draftError(editing.draft)) return;
    const committed = commitOptions(editing.draft);
    setFields((current) => current.map((field) => (field.id === editing.id ? committed : field)));
    setEditing(null);
  }

  // Switching the vertical reloads the canvas from that vertical's saved fields. Done during
  // render rather than in an effect: React discards this pass and re-renders immediately, so
  // the canvas is never painted holding the previous vertical's form for a frame.
  if (loadedBranch !== activeVertical) {
    setLoadedBranch(activeVertical);
    setFields((fieldsByVertical[activeVertical] || []).map(toDraft));
    setEditing(null);
  }


  /**
   * Everything below builds the new field before calling setFields, never inside the
   * updater. An updater has to be pure: React runs it twice in development to catch exactly
   * this, which doubled the id counter and left `editing` pointing at an id no card had - so
   * adding a field from the palette silently failed to open its settings.
   */
  function addField(type) {
    if (fields.length >= MAX_FIELDS) return;
    const field = newField(type);
    setFields((current) => [...current, field]);
    openEditor(field);
    // The new card lands at the bottom of the canvas, so scroll to it rather than leave the
    // user to find what their click did.
    window.requestAnimationFrame(() => {
      canvasRef.current?.scrollTo({ top: canvasRef.current.scrollHeight, behavior: "smooth" });
    });
  }

  function moveField(index, offset) {
    setFields((current) => {
      const target = index + offset;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function duplicateField(id) {
    if (fields.length >= MAX_FIELDS) return;
    const index = fields.findIndex((field) => field.id === id);
    if (index === -1) return;
    // The copy gets a blank key so the server mints it a new one. Sharing the original's key
    // would make both cards write to the same answer on every lead.
    const copy = { ...fields[index], id: nextDraftId(), key: "", label: `${fields[index].label} copy` };
    setFields((current) => [...current.slice(0, index + 1), copy, ...current.slice(index + 1)]);
    openEditor(copy);
  }

  function removeField(id) {
    setFields((current) => current.filter((field) => field.id !== id));
    setEditing((current) => (current?.id === id ? null : current));
  }

  /**
   * The form as it would be saved right now.
   *
   * An open editor's working copy is folded in rather than ignored, so pressing Save at the
   * top of the page cannot silently drop the edit the user can see on screen. Per-card Save
   * and Cancel still decide what the card keeps; this only stops the whole-form Save from
   * disagreeing with what is displayed.
   */
  const effectiveFields = useMemo(
    () => (editing ? fields.map((field) => (field.id === editing.id ? editing.draft : field)) : fields),
    [editing, fields],
  );

  const invalid = useMemo(
    () => effectiveFields.map(draftError).find(Boolean) || "",
    [effectiveFields],
  );

  /*
   * Whether the canvas differs from what this vertical has saved.
   *
   * Compared against the same `toDraft` shape the canvas is loaded from, so the two are like
   * for like and normalising on load does not read as an edit. An open card's working copy is
   * folded in through `effectiveFields`, so a label being typed counts as unsaved before the
   * card itself has been saved.
   *
   * Reported to whoever opened this panel through a ref rather than a callback: it is read at
   * the moment somebody tries to leave, not subscribed to, and a ref cannot re-render the
   * settings shell on every keystroke here.
   */
  const savedFields = useMemo(
    () => (fieldsByVertical[activeVertical] || []).map(toDraft),
    [fieldsByVertical, activeVertical],
  );
  const unsaved = useMemo(
    () => JSON.stringify(effectiveFields) !== JSON.stringify(savedFields),
    [effectiveFields, savedFields],
  );
  // Published after the render that worked it out. Writing a ref is not state, so this costs
  // the settings shell no render - it simply has the answer ready for the next rail click.
  useEffect(() => {
    if (unsavedRef) unsavedRef.current = unsaved;
  }, [unsaved, unsavedRef]);

  async function save() {
    if (invalid || saving) return;
    setSaving(true);
    try {
      // commitOptions turns an open editor's raw text into the list before it is sent; `id`
      // is the canvas's own handle on a card and means nothing to the server.
      await onSaved?.(activeVertical, effectiveFields.map((field) => {
        const { id, ...rest } = commitOptions(field);
        return rest;
      }));
    } catch (error) {
      onError?.(error?.message || "Unable to save table settings.");
    } finally {
      setSaving(false);
    }
  }

  const screens = screensOf(moduleId);
  const activeScreen = screens.find((item) => item.id === screenId) || null;
  const moduleLabel = MODULE_OPTIONS.find((item) => item.value === moduleId)?.label;
  const verticalChoices = verticalOptions || CRM_VERTICALS;
  /*
   * The two pickers throw the canvas away as completely as the settings rail does - a vertical's
   * fields are loaded from that vertical, so choosing another one replaces them - and until now
   * only the rail asked about it. Ten fields built on Dum Dum and one click on the Vertical
   * dropdown, and the work was gone without a word, a single click away from the dialog that
   * would have caught the same move made through the rail.
   */
  const { guard: guardPickerChange, confirmProps: pickerConfirmProps } = useUnsavedGuard(unsaved);

  // Each picker is inert until the one before it is answered, which is what shows the order to
  // answer in. `verticalEnabled` is false for a screen that simply keeps no table fields.
  const screenEnabled = screens.length > 0;
  const verticalEnabled = Boolean(screenId) && TABLE_SETTINGS_SCREENS.has(screenId);
  const ready = verticalEnabled && Boolean(activeVertical);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The three pickers on one row, on the module's own field styling, so they read as the
          questions that decide what the canvas below is editing. They wrap rather than scroll:
          three pickers and the actions do not fit a phone in one line, and the shell's panes are
          what scroll. */}
      <div className="flex flex-wrap items-end gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
        <Dropdown
          mode="input"
          label="Module"
          ariaLabel="Module"
          placeholder="Select module"
          value={moduleId}
          onChange={(value) => guardPickerChange(() => {
            setModuleId(value);
            // A screen belongs to the module it was picked under and a vertical to the screen, so
            // changing module clears both rather than carrying a Dum Dum selection onto Accounts,
            // where it means nothing.
            setScreenId("");
            setActiveVertical("");
          })}
          options={MODULE_OPTIONS}
          // The sidebar registry has an order - the hamburger's - and the whole point of reading it
          // here is that this screen walks the same path, so it is not alphabetised.
          sorted={false}
          className="w-full sm:w-[17rem]"
        />
        <Dropdown
          mode="input"
          label="Screen"
          ariaLabel="Screen"
          placeholder={screenEnabled ? "Select screen" : "Select a module first"}
          value={screenId}
          disabled={!screenEnabled}
          onChange={(value) => guardPickerChange(() => {
            setScreenId(value);
            setActiveVertical("");
          })}
          options={screens.map((item) => ({ value: item.id, label: item.label }))}
          sorted={false}
          className="w-full sm:w-[15rem]"
        />
        <Dropdown
          mode="input"
          label="Vertical"
          ariaLabel="Vertical"
          placeholder={!screenId ? "Select a screen first" : verticalEnabled ? "Select vertical" : "No table fields on this screen"}
          value={activeVertical}
          disabled={!verticalEnabled}
          onChange={(value) => guardPickerChange(() => setActiveVertical(value))}
          // The chosen screen's own verticals. Only Leads & Followups has table fields today.
          options={verticalChoices.map((item) => (typeof item === "string" ? { value: item, label: item } : item))}
          className="w-full sm:w-[13rem]"
        />
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <ToggleSwitch label="Preview" checked={preview} onCheckedChange={setPreview} />
          <Button type="button" variant="secondary" onClick={() => setLoadedBranch("")} disabled={saving || !ready}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={() => void save()} disabled={saving || !ready || Boolean(invalid)}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      {!ready ? (
        <div className="px-5 py-10 sm:px-6">
          <p className="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-12 text-center text-sm text-slate-500">
            {!moduleId
              ? "Pick a module, then one of its screens, to set up its table fields."
              : !screenId
                ? `Pick one of ${moduleLabel}'s screens.`
                : !verticalEnabled
                  ? `${activeScreen?.label || "This screen"} does not have table fields of its own.`
                  : "Pick a vertical to set up its table fields."}
          </p>
        </div>
      ) : (
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {!preview && (
          <aside className="w-[16rem] shrink-0 overflow-y-auto border-r border-slate-200 bg-white px-4 py-4">
            <h3 className="text-sm font-semibold text-slate-800">Form Fields</h3>
            <p className="mt-1 text-xs text-slate-500">Pick a field to add it to the form.</p>
            <ul className="mt-3 space-y-2">
              {FIELD_TYPES.map((item) => (
                <li key={item.type}>
                  <button
                    type="button"
                    onClick={() => addField(item.type)}
                    disabled={fields.length >= MAX_FIELDS}
                    className="flex w-full items-center gap-2.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-700 transition hover:border-blue-400 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span aria-hidden="true" className="w-6 shrink-0 text-center text-xs text-slate-400">{item.icon}</span>
                    <span className="truncate">{item.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        )}

        <div ref={canvasRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-8">
          <div className="mx-auto max-w-[52rem]">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-slate-500">
                {fields.length} of {MAX_FIELDS} fields on {activeScreen?.label} · {activeVertical}
              </p>
              {!preview && fields.length > 0 && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="text-rose-600"
                  onClick={() => {
                    setFields([]);
                    setEditing(null);
                  }}
                >
                  Delete All
                </Button>
              )}
            </div>

            {invalid && !preview && (
              <p role="alert" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{invalid}</p>
            )}

            {fields.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white px-5 py-12 text-center text-sm text-slate-500">
                No custom fields on {activeVertical} yet. Pick one from Form Fields to start.
              </div>
            ) : preview ? (
              // Preview drops the builder chrome and shows the Client Details block exactly
              // as Add Lead will lay it out, three across.
              <div className="mt-4 overflow-hidden rounded-2xl bg-white">
                <h3 className="border-b border-slate-200 px-5 py-3 text-lg font-medium text-slate-700">Client Details — {activeVertical}</h3>
                <div className="grid gap-5 p-5 md:grid-cols-3">
                  {fields.map((field) => (
                    <CustomFieldInput key={field.id} field={field} value="" onChange={() => {}} />
                  ))}
                </div>
              </div>
            ) : (
              <ul className="mt-4 space-y-3">
                {fields.map((field, index) => (
                  <FieldCard
                    key={field.id}
                    // While a card is being edited it renders from the working copy, so its
                    // preview tracks what is being typed rather than the last saved values.
                    field={editing?.id === field.id ? editing.draft : field}
                    index={index}
                    total={fields.length}
                    editing={editing?.id === field.id}
                    onEdit={() => (editing?.id === field.id ? setEditing(null) : openEditor(field))}
                    onDuplicate={() => duplicateField(field.id)}
                    onRemove={() => removeField(field.id)}
                    onMove={moveField}
                    onChange={patchDraft}
                    onSave={commitEditor}
                    onCancel={() => setEditing(null)}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
      )}

      {/* The same question the settings rail asks, in the same words, because it is the same loss:
          Go Back leaves the canvas as it is so the work can still be saved, and Discard lets the
          picker move and the fields reload over it. */}
      <ConfirmDialog {...pickerConfirmProps} />
    </div>
  );
}
