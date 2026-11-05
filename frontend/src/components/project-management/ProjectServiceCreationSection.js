"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DataTable from "@/components/data-table/DataTable";
import Dropdown from "@/components/shared/Dropdown";
import ChevronIcon from "@/components/ui/ChevronIcon";
import CloseIcon from "@/components/ui/CloseIcon";
import OptionsMenu from "@/components/ui/OptionsMenu";
import SharedConfirmDialog from "@/components/ui/ConfirmDialog";
import ProjectShootList from "./ProjectShootList";
import { shootTypesOf } from "./AddShootDialog";
import { pricedSizeOptionsOf } from "@/lib/deliverablePricing.mjs";
// A deliverable's No. of Count is a Yes or a No held as the word itself, and this reads it back
// into the answer this table has always worked from.
import { deliverableAnswerOn } from "@/lib/deliverableAnswers.mjs";
import { deliverableVariantOptions } from "@/lib/deliverableBrands.mjs";
import { pricedServiceSizeOptions } from "@/lib/servicePricing.mjs";

const formatDate = (value) => {
  // `new Date(null)` is the epoch rather than an invalid date, so an unscheduled shoot would
  // otherwise read as 1 Jan 1970. Asked first, before anything tries to parse it.
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
};

function formatShootMeta(shoot) {
  const place = [shoot.shootPlace, shoot.district, shoot.state].filter(Boolean).join(", ");
  return [shoot.shootId, formatDate(shoot.dateCreated), place].filter(Boolean).join(" | ");
}

function allocationServiceName(row) {
  return row.serviceDefinition?.name || row.serviceName || "—";
}

/*
 * What a deliverable row is called.
 *
 * A row added from a brand's variant carries the label that variant was picked under - "Album
 * Printing - Canvera - 12x18 - 1.5 inch" - and reads as that, so the table says which of a
 * deliverable's variants is on the quotation without a column being added for the brand, the size
 * and the frame. `deliverableName` itself is left as the deliverable's own name, which is what the
 * PDF prints and what a project raised off the quotation matches its deliverables by.
 *
 * A row from anywhere else has no variant and reads exactly as it always did.
 */
function allocationDeliverableName(row) {
  return row.deliverableVariantLabel || row.deliverableDefinition?.name || row.deliverableName || "—";
}

function serviceDefinition(row) {
  return row.serviceDefinition || {};
}

function deliverableDefinition(row) {
  return row.deliverableDefinition || {};
}

/*
 * Every timing the service allows, not just the first one.
 *
 * Session Timing became a multi-select in Project Settings, and this had stayed singular - so a
 * service ticked for Full/Half Session *and* Hours/Minutes offered whichever happened to be first
 * and silently dropped the rest. The backend was already storing and accepting all of them; only
 * the screen was showing one.
 *
 * Falls back to the single `timingMode` for a definition saved before the list existed.
 */
function serviceTimingModes(row) {
  const definition = serviceDefinition(row);
  const listed = Array.isArray(definition.timingModes) ? definition.timingModes.filter((mode) => mode && mode !== "NONE") : [];
  if (listed.length) return listed;
  const single = definition.timingMode;
  return single && single !== "NONE" ? [single] : [];
}


/*
 * A service line always has its remarks box.
 *
 * Its definition's Remarks used to decide: a service answered No took the box away. That column is
 * a note the studio writes about the service now, not a switch, and reading a note as an answer
 * meant one beginning "Not applicable" silently removed the box from every project line using it.
 * Kept as a function rather than inlined, so the readers below go on reading the same way and the
 * rule stays in one place - as `deliverableRemarksEnabled` does for a deliverable.
 */
function remarksEnabled() {
  return true;
}

// `=== true` as it always was, spelled for words: an answer starting with "no", and a deliverable
// never asked at all, both leave the line without a photo count. See `deliverableAnswers`.
function deliverablePhotoCountEnabled(row) {
  return deliverableAnswerOn(deliverableDefinition(row).photoCountEnabled);
}

function deliverablePhotoCountPlaceholder(row) {
  const name = allocationDeliverableName(row).trim().toLocaleLowerCase();
  return name === "album printing" || name === "album designing" ? "No.Of.Sheets" : "";
}

/*
 * A deliverable line always has its remarks box.
 *
 * Its definition's Remarks used to decide: a deliverable answered No took the box away. That column
 * is a note the studio writes about the deliverable now, not a switch, and reading a note as an
 * answer meant one beginning "Not applicable" or "No frames" silently removed the box from every
 * project line using it. Kept as a function rather than inlined, so the two readers below go on
 * reading the same way and the rule stays in one place.
 */
function deliverableRemarksEnabled() {
  return true;
}

/** The two halves of the studio's session scale, spelled as the option values spell them. */
const SESSION_TIMING_MODES = ["HALF_SESSION", "FULL_SESSION"];

/*
 * The session choices this service actually offers.
 *
 * The set holds both, so a service sold only as a half session would otherwise be offered a full one
 * in the dropdown. The timing modes are the option values' own codes, so they match directly.
 */
function sessionOptionsFor(row, options) {
  const allowed = serviceTimingModes(row).filter((mode) => SESSION_TIMING_MODES.includes(mode));
  return options.filter((option) => allowed.includes(option.code));
}

function activeOptionValues(optionSet) {
  return (optionSet?.values || []).filter((option) => option.isActive !== false);
}

function displayOptionLabel(option) {
  if (!option) return "";
  return [option.description, option.label || option.value].filter(Boolean).join(" ");
}

/*
 * Complimentary, as a line answers it.
 *
 * A boolean held as a boolean, so the cell offers the two answers a boolean has. A line that has
 * never been asked reads No, which is what every line drawn before this existed means.
 */
const COMPLIMENTARY_OPTIONS = [{ id: "true", label: "Yes" }, { id: "false", label: "No" }];
const complimentaryValue = (row) => String(row?.complimentary === true);

/**
 * Whether this line may be marked complimentary at all.
 *
 * The master's Complimentary answer is a *permission*, not a default: it says whether this may be
 * given away, and the line's own answer - always starting at No - says whether it is. A line the
 * master does not permit is not asked the question at all.
 *
 * `complimentaryAllowed` is worked out when the line is normalised, from the master as it stands.
 * A line already answered Yes keeps the question even if that permission has since been withdrawn:
 * it is a fact about a quotation somebody raised, and hiding the control would leave an answer on
 * the line with no way to change it.
 */
const complimentaryAllowed = (row) => row?.complimentaryAllowed === true || row?.complimentary === true;
const displayComplimentary = (row) => (!complimentaryAllowed(row) ? "-" : row?.complimentary === true ? "Yes" : "No");

function groupedOptionValues(options) {
  const grouped = [];
  let currentGroup = "";
  options.forEach((option) => {
    const group = option.description || "";
    if (group && group !== currentGroup) {
      grouped.push({ label: group, value: `group-${group}`, disabled: true });
      currentGroup = group;
    }
    grouped.push({ label: option.label || option.value, displayLabel: displayOptionLabel(option), value: option.id });
  });
  return grouped;
}

function optionLabelById(options, id) {
  return options.find((option) => option.id === id)?.label || options.find((option) => option.id === id)?.value || "";
}

function displayQuantity(row) {
  return row.quantity ?? 1;
}

/*
 * One line per timing the service allows, joined - "Full Session, 2h 30m, 3 Days".
 *
 * Only the timings that have actually been filled in are named. A service may allow four and have
 * one answered, and listing the three blanks would bury the answer.
 */
function displayTiming(row) {
  const modes = serviceTimingModes(row);
  if (!modes.length) return "-";
  const parts = [];

  if (modes.some((mode) => SESSION_TIMING_MODES.includes(mode))) {
    const options = activeOptionValues(serviceDefinition(row).timingOptionSet);
    const session = row.sessionOption?.label || optionLabelById(options, row.sessionOptionId);
    if (session) parts.push(session);
  }
  if (modes.includes("HOURS_MINUTES") && (row.durationHours != null || row.durationMinutes != null)) {
    parts.push(`${Number(row.durationHours || 0)}h ${Number(row.durationMinutes || 0)}m`);
  }

  return parts.length ? parts.join(", ") : (row.quantitySessionTiming || "-");
}

/**
 * The sizes a service line may be given: every size its pricing names, from whichever of the
 * studio's lists - a service sold by size - or, where the pricing names none, the one list the
 * definition is pointed at, as it always was.
 */
function serviceSizeOptions(definition) {
  const priced = pricedServiceSizeOptions(definition);
  return priced.length ? priced : activeOptionValues(definition.sizeOptionSet);
}

function displaySize(row) {
  const options = serviceSizeOptions(serviceDefinition(row));
  if (!options.length) return "-";
  return row.sizeOptionValue?.label || optionLabelById(options, row.sizeOptionValueId) || "-";
}

function displayServiceRemarks(row) {
  if (!remarksEnabled(row)) return "-";
  return row.remarks || "-";
}

function displayDeliverablePhotos(row) {
  if (!deliverablePhotoCountEnabled(row)) return "-";
  return row.numberOfPhotos ?? "-";
}

/**
 * The sizes a deliverable line may be given: every size its pricing names, from whichever kinds'
 * lists - a deliverable priced as frames and as an album offers both - or, where the pricing names
 * none, the one list the definition is pointed at, as it always was.
 */
function deliverableSizeOptions(definition) {
  const priced = pricedSizeOptionsOf(definition);
  return priced.length ? priced : activeOptionValues(definition.sizeOptionSet);
}

function displayDeliverableSize(row) {
  /*
   * A row added from a brand's variant already knows its size: the variant is what carries it, and
   * the deliverable's own size list has nothing to say about it. So it is shown as the variant
   * holds it - a video's row shows the length for the same reason - before any list is consulted.
   */
  if (row.deliverableVariantId) return row.size || row.videoLength || "-";
  const definition = deliverableDefinition(row);
  const options = deliverableSizeOptions(definition);
  if (!options.length) return "-";
  return displayOptionLabel(row.sizeOptionValue) || displayOptionLabel(options.find((option) => option.id === row.sizeOptionValueId)) || optionLabelById(options, row.sizeOptionValueId) || row.size || "-";
}

function displayDeliverableRemarks(row) {
  if (!deliverableRemarksEnabled(row)) return "-";
  return row.remarks || "-";
}

/*
 * `className` sizes the field: the shoot cards cap it at `max-w-lg`, as ever, and the CRM Quotation
 * Calculator - whose entries carry a service's whole booking in their name - lets it fill its panel.
 * The list is as wide as the field and its entries wrap, so a long name is read whole rather than
 * cut off, and it shows a screen's worth of entries before scrolling.
 */
function SearchablePicker({ label, options, disabledIds, disabledNames, onSelect, placeholder, loading, emptyMessage, errorMessage, className = "max-w-lg" }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const ref = useRef(null);
  const normalized = query.trim().toLocaleLowerCase();
  const availableOptions = options.filter((option) => !disabledIds.has(option.id) && !disabledNames.has(option.name.toLocaleLowerCase()));
  const visibleOptions = availableOptions.filter((option) => !normalized || option.name.toLocaleLowerCase().includes(normalized));

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => { if (!ref.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function choose(option) {
    onSelect(option);
    setQuery("");
    setOpen(false);
    setActiveIndex(0);
  }

  const statusText = errorMessage || (loading ? "Loading..." : !options.length ? emptyMessage : !visibleOptions.length ? "No matching records found." : "");

  return <div ref={ref} className={`relative block text-xs font-semibold text-slate-600 ${className}`}>
    <label>
      <span>{label}</span>
      <span className="relative mt-1.5 block">
        <input value={query} disabled={loading || Boolean(errorMessage) || !options.length} onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); setOpen(true); }} onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((current) => visibleOptions.length ? (current + 1) % visibleOptions.length : 0);
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((current) => visibleOptions.length ? (current - 1 + visibleOptions.length) % visibleOptions.length : 0);
          }
          if (event.key === "Enter" && visibleOptions[activeIndex]) {
            event.preventDefault();
            choose(visibleOptions[activeIndex]);
          }
          /*
           * `preventDefault` is what says "this press was mine".
           *
           * Handled here on the input rather than through `useEscapeKey`, because this list belongs
           * to the field it is under - but the panel around it is listening too, and without this
           * one press would close the suggestions *and* the form they are being typed into. The
           * contract is written up in `useEscapeKey`.
           */
          if (event.key === "Escape" && open) { event.preventDefault(); setOpen(false); }
        }} placeholder={placeholder} className="block min-h-9 w-full rounded-lg border border-slate-300 bg-white px-3 pr-9 text-sm font-normal text-slate-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500" />
        <button type="button" disabled={loading || Boolean(errorMessage) || !options.length} onClick={() => { setActiveIndex(0); setOpen((current) => !current); }} aria-label={`Open ${label}`} className="absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"><ChevronIcon size={20} /></button>
      </span>
    </label>
    {open && <div className="absolute z-[170] mt-1 max-h-80 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
      {visibleOptions.length ? visibleOptions.map((option, index) => <button key={option.id} type="button" onMouseEnter={() => setActiveIndex(index)} onMouseDown={(event) => { event.preventDefault(); choose(option); }} className={`block w-full whitespace-normal break-words px-3 py-2 text-left text-sm font-normal ${index === activeIndex ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-blue-50"}`}>{option.name}</button>) : <p className="px-3 py-3 text-sm font-normal text-slate-500">{statusText}</p>}
    </div>}
    {!open && statusText && <p className={`mt-1 text-xs font-normal ${errorMessage ? "text-red-600" : "text-slate-500"}`}>{statusText}</p>}
  </div>;
}

function ConfirmDialog({ title, message, loading, onCancel, onConfirm }) {
  // Raised above the project form panel it is opened from.
  return <SharedConfirmDialog title={title} message={message} confirmLabel="Delete" busyLabel="Deleting..." loading={loading} layer="dialogOverPanel" onCancel={onCancel} onConfirm={onConfirm} />;
}

function numericValue(value, max) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits === "") return "";
  return max === undefined ? digits : String(Math.min(max, Number(digits)));
}

function SpreadsheetCell({ value: initialValue, type = "text", placeholder = "", disabled = false, onCommit }) {
  const [value, setValue] = useState(initialValue ?? "");

  async function commit(nextValue = value) {
    const normalized = type === "number" ? numericValue(nextValue) : nextValue;
    if (String(normalized ?? "") === String(initialValue ?? "")) return;
    await onCommit(normalized);
  }

  return <input type={type} min={type === "number" ? "0" : undefined} inputMode={type === "number" ? "numeric" : undefined} placeholder={placeholder} disabled={disabled} value={value} onChange={(event) => setValue(type === "number" ? numericValue(event.target.value) : event.target.value)} onBlur={() => void commit()} onKeyDown={(event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setValue(initialValue ?? "");
      event.currentTarget.blur();
    }
  }} className="min-h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:bg-blue-50/60 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400" />;
}

/**
 * A cell's own dropdown.
 *
 * `maxWidth` caps the control without narrowing the column it sits in. The control is `w-full`, so
 * a cell holding "Full Session" or a plain "No" otherwise drew a box the whole width of its column
 * - a box several times longer than anything it can ever contain, which reads as a field waiting
 * for a sentence. The column keeps its width, so the heading still has room; only the control stops
 * stretching. A cell whose answers are genuinely long - a size list - passes none and is unchanged.
 */
function SpreadsheetSelectCell({ value: initialValue, options, disabled = false, onCommit, maxWidth }) {
  const [value, setValue] = useState(initialValue || "");
  const dropdownOptions = useMemo(() => groupedOptionValues(options), [options]);

  const control = <Dropdown ariaLabel="Select option" mode="input" searchable value={value || ""} disabled={disabled} placeholder="Select" menuZIndexClassName="z-[160]" options={dropdownOptions} onChange={(next) => {
    setValue(next);
    if (String(next || "") !== String(initialValue || "")) void onCommit(next);
  }} />;
  return maxWidth ? <div style={{ maxWidth }}>{control}</div> : control;
}

/**
 * Several numbers that belong to one measurement, in one box.
 *
 * The Add Shoot dialog puts Hours and Minutes in a single bordered control with a divider between
 * them, because they are two halves of one duration rather than two questions. Days and Minutes were
 * plain single cells and read as unrelated fields; they use this now, so every timing on the row
 * looks like the one measurement it is.
 *
 * Segments are given rather than fixed, because a service may allow several timings at once and they
 * share the box: `{ key, label, ariaLabel, value, max, onCommit }`. The label is the placeholder, as
 * in the shoot dialog - the box is too small for a legend above each half.
 */
function GroupedNumberCell({ segments, disabled = false }) {
  /*
   * Keyed by segment, and reset when the row's stored values change.
   *
   * A single object rather than a `useState` per segment: the number of segments depends on what
   * the service allows, and a hook count that changes with the data is not allowed to.
   */
  const [values, setValues] = useState(() => Object.fromEntries(segments.map((segment) => [segment.key, segment.value ?? ""])));

  const setSegment = (key, next) => setValues((current) => ({ ...current, [key]: next }));

  async function commit(segment) {
    const next = numericValue(values[segment.key], segment.max);
    if (String(next ?? "") === String(segment.value ?? "")) return;
    await segment.onCommit(next);
  }

  return <div className="flex min-h-8 overflow-hidden rounded-md border border-slate-200 bg-white">
    {segments.map((segment, index) => (
      <input
        key={segment.key}
        type="number"
        min="0"
        max={segment.max}
        inputMode="numeric"
        aria-label={segment.ariaLabel || segment.label}
        placeholder={segment.label}
        disabled={disabled}
        value={values[segment.key] ?? ""}
        onChange={(event) => setSegment(segment.key, numericValue(event.target.value, segment.max))}
        onBlur={() => void commit(segment)}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
          if (event.key === "Escape") { event.preventDefault(); setSegment(segment.key, segment.value ?? ""); event.currentTarget.blur(); }
        }}
        // Equal shares of the box, divided by a hairline rather than a gap - one control, not several.
        className={`min-w-0 flex-1 border-0 bg-transparent px-2 text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:bg-blue-50/60 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 ${index < segments.length - 1 ? "border-r border-slate-200" : ""}`}
      />
    ))}
  </div>;
}

function RowActions({ label, onEdit, onDelete, editing = false }) {
  return <OptionsMenu ariaLabel={`Actions for ${label}`} menuZIndexClassName="z-[160]" items={[
    ...(!editing ? [{ label: "Edit", onSelect: onEdit }] : []),
    { label: "Delete", tone: "danger", onSelect: onDelete },
  ]} />;
}

function DeleteRowButton({ label, disabled, onClick }) {
  return <button type="button" disabled={disabled} onClick={onClick} aria-label={`Delete ${label}`} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"><CloseIcon className="h-4 w-4" /></button>;
}

/*
 * Which services a shoot may be given.
 *
 * A service configured for outdoor shoots should not be offered on a studio one - that is what the
 * Shoot Type tick boxes in Project Settings decide. The settings store `STUDIO`/`OUTDOOR`; a shoot
 * stores the wording a person picked, so the two are matched here rather than either side changing
 * to suit the other.
 *
 * Nothing ticked means every shoot type, which is both the sensible default and what every service
 * saved before Shoot Type existed means. A shoot with no type set is offered everything, because
 * hiding services over a blank field would look like the catalogue had gone missing.
 */
const SHOOT_TYPE_BY_LABEL = {
  "Studio / In-House": "STUDIO",
  "Outdoor / On-Location": "OUTDOOR",
};

function servicesForShootType(definitions, shoot) {
  /*
   * Services and deliverables alike: a deliverable carries the same `shootTypes` a service does,
   * and is offered on the same rule.
   *
   * A shoot may run in more than one place, so a service allowed for any of them is offered.
   *
   * A wedding booked as studio *and* outdoor should be able to take both the studio-only and the
   * outdoor-only services - it genuinely does both - so this is a union rather than an intersection.
   */
  const codes = shootTypesOf(shoot).map((label) => SHOOT_TYPE_BY_LABEL[label]).filter(Boolean);
  if (!codes.length) return definitions;
  return definitions.filter((definition) => {
    const allowed = definition?.shootTypes;
    return !Array.isArray(allowed) || allowed.length === 0 || allowed.some((code) => codes.includes(code));
  });
}

function ClearAllButton({ label, disabled, onClick }) {
  return <button type="button" disabled={disabled} onClick={onClick} className="h-9 rounded-lg bg-blue-50 px-4 text-sm font-normal text-blue-600 transition hover:bg-blue-100 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40">{label}</button>;
}

export default function ProjectServiceCreationSection({
  /*
   * The shoots this caller's rows may be changed to — for a quotation, the shoots its brand quotes
   * for. Forwarded to the list rather than read there, so the one component that knows which brand
   * is being quoted is the one that decides.
   */
  shootChoices = null,
  shoots,
  loading,
  loadingMasterData,
  serviceDefinitionsError,
  deliverableDefinitionsError,
  serviceDefinitions,
  deliverableDefinitions,
  servicesByShoot,
  deliverablesByShoot,
  onAddShoot,
  onAddService,
  onUpdateService,
  onDeleteService,
  onClearServices,
  /*
   * Whether the Choose Deliverables picker lists a deliverable's brands and variants one by one
   * rather than the deliverable alone. The Quotation Generator does, because a quotation line is
   * priced and a variant is what carries a price; the project screens do not, because a shoot holds
   * one allocation per deliverable - the server refuses a second - so listing six variants there
   * would offer five that cannot be added.
   */
  deliverableVariants = false,
  /*
   * Whether each line is asked whether it is complimentary. The Quotation Generator is: a line on a
   * quotation may be given rather than charged for, and that is this quotation's answer rather than
   * the master's. The project screens are not - a project records work done, and nothing there
   * prices anything - so they keep the columns they have.
   */
  complimentaryColumn = false,
  onAddDeliverable,
  onUpdateDeliverable,
  onDeleteDeliverable,
  onClearDeliverables,
  onSaveShootEdit,
  onDeleteShoot,
  onRequestEditShoot,
  /*
   * What the strip above the list says, where the default - "Add one or more Shoots for this
   * Project" - would be describing something this caller does not offer. Create Project sets it to
   * say the shoots came from the quotation.
   */
  shootListHint,
}) {
  const [confirm, setConfirm] = useState(null);
  // The typed "DELETE" for the high-impact shoot deletion — a shoot whose Image Selection gallery
  // holds client-submitted selections must not go on a plain two-button confirmation.
  const [ackText, setAckText] = useState("");
  const [collapsedShootIds, setCollapsedShootIds] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const toggleShootCollapsed = useCallback((shootId) => {
    setCollapsedShootIds((current) => {
      const next = new Set(current);
      if (next.has(shootId)) next.delete(shootId);
      else next.add(shootId);
      return next;
    });
  }, []);

  const updateServiceCell = useCallback(async (row, data) => {
    setBusy(true);
    setError("");
    try {
      await onUpdateService(row, data);
    } catch (updateError) {
      setError(updateError.message || "Unable to save service row.");
    } finally {
      setBusy(false);
    }
  }, [onUpdateService]);

  const updateDeliverableCell = useCallback(async (row, data) => {
    setBusy(true);
    setError("");
    try {
      await onUpdateDeliverable(row, data);
    } catch (updateError) {
      setError(updateError.message || "Unable to save deliverable row.");
    } finally {
      setBusy(false);
    }
  }, [onUpdateDeliverable]);

  /*
   * One control per timing the service allows, rather than one for the first of them.
   *
   * The session dropdown stands on its own - it is a choice, not a measurement - and every numeric
   * timing shares a single box beneath it, the way Hours and Minutes always did.
   */
  const renderTimingCell = useCallback((row) => {
    const modes = serviceTimingModes(row);
    if (!modes.length) return "-";

    const segments = [];
    if (modes.includes("HOURS_MINUTES")) {
      segments.push({ key: "durationHours", label: "Hours", ariaLabel: "Duration hours", value: row.durationHours ?? "", onCommit: (value) => updateServiceCell(row, { durationHours: value === "" ? null : Number(value) }) });
      segments.push({ key: "durationMinutes", label: "Minutes", ariaLabel: "Duration minutes", value: row.durationMinutes ?? "", max: 59, onCommit: (value) => updateServiceCell(row, { durationMinutes: value === "" ? null : Number(value) }) });
    }

    // Narrowed to what the service offers - see `sessionOptionsFor`.
    const sessionOptions = sessionOptionsFor(row, activeOptionValues(serviceDefinition(row).timingOptionSet));

    return <div className="flex flex-col gap-1">
      {sessionOptions.length > 0 && (
        <SpreadsheetSelectCell key={`${row.id}-session-${row.sessionOptionId || ""}`} value={row.sessionOptionId || ""} options={sessionOptions} disabled={busy} maxWidth={180} onCommit={(value) => updateServiceCell(row, { sessionOptionId: value || null })} />
      )}
      {segments.length > 0 && (
        <GroupedNumberCell key={`${row.id}-timing-${segments.map((segment) => segment.value).join("-")}`} segments={segments} disabled={busy} />
      )}
    </div>;
  }, [busy, updateServiceCell]);

  /*
   * Whether these rows are the reader's to change, which is the caller's answer rather than this
   * component's.
   *
   * A caller that hands over no way to add, change or remove a row is saying the rows are settled -
   * Create Project, once a quotation has priced them. The cells then print what they hold instead
   * of offering an editor, the pickers above the table go, and the row's delete goes with them.
   * Absent rather than disabled: a table of greyed-out inputs reads as broken.
   */
  const servicesEditable = Boolean(onAddService && onUpdateService && onDeleteService);
  const deliverablesEditable = Boolean(onAddDeliverable && onUpdateDeliverable && onDeleteDeliverable);

  const serviceColumns = useMemo(() => [
    { id: "serviceName", header: "Services", accessorFn: allocationServiceName, sortable: false, filterable: false, width: "22%", minWidth: 170, cell: ({ row }) => allocationServiceName(row.original) },
    { id: "quantity", header: "Quantity", accessorFn: displayQuantity, sortable: false, filterable: false, width: "9%", minWidth: 80, cell: ({ row }) => servicesEditable ? <SpreadsheetCell key={`${row.original.id}-quantity-${row.original.quantity ?? ""}`} type="number" value={row.original.quantity ?? ""} disabled={busy} onCommit={(value) => updateServiceCell(row.original, { quantity: value === "" ? 1 : Number(value) })} /> : displayQuantity(row.original) },
    { id: "sessionTiming", header: "Session Timing", accessorFn: displayTiming, sortable: false, filterable: false, width: "18%", minWidth: 150, cell: ({ row }) => servicesEditable ? renderTimingCell(row.original) : displayTiming(row.original) },
    { id: "size", header: "Size", accessorFn: displaySize, sortable: false, filterable: false, width: "12%", minWidth: 100, cell: ({ row }) => {
      if (!servicesEditable) return displaySize(row.original);
      const options = serviceSizeOptions(serviceDefinition(row.original));
      return options.length ? <SpreadsheetSelectCell key={`${row.original.id}-size-${row.original.sizeOptionValueId || ""}`} value={row.original.sizeOptionValueId || ""} options={options} disabled={busy} onCommit={(value) => updateServiceCell(row.original, { sizeOptionValueId: value || null })} /> : "-";
    } },
    { id: "remarks", header: "Remarks", accessorFn: displayServiceRemarks, sortable: false, filterable: false, width: "19%", minWidth: 150, cell: ({ row }) => !servicesEditable ? displayServiceRemarks(row.original) : remarksEnabled(row.original) ? <SpreadsheetCell key={`${row.original.id}-remarks-${row.original.remarks || ""}`} value={row.original.remarks || ""} disabled={busy} onCommit={(value) => updateServiceCell(row.original, { remarks: value || null })} /> : "-" },
    ...(complimentaryColumn ? [{ id: "complimentary", header: "Complimentary", accessorFn: displayComplimentary, sortable: false, filterable: false, width: "12%", minWidth: 110, cell: ({ row }) => !servicesEditable || !complimentaryAllowed(row.original) ? displayComplimentary(row.original) : <SpreadsheetSelectCell key={`${row.original.id}-complimentary-${complimentaryValue(row.original)}`} value={complimentaryValue(row.original)} options={COMPLIMENTARY_OPTIONS} disabled={busy} maxWidth={110} onCommit={(value) => updateServiceCell(row.original, { complimentary: value === "true" })} /> }] : []),
    ...(servicesEditable ? [{ id: "actions", header: "", sortable: false, filterable: false, fixed: true, width: 48, minWidth: 48, cell: ({ row }) => <DeleteRowButton label={allocationServiceName(row.original)} disabled={busy} onClick={() => setConfirm({ type: "service", row: row.original })} /> }] : []),
  ], [busy, complimentaryColumn, renderTimingCell, servicesEditable, updateServiceCell]);

  const deliverableColumns = useMemo(() => [
    // `title` so the whole of it is readable on hover: a variant carrying its Settings note - "Demo
    // Album Printing - Canvera - 12x18 - 1.5 inch - Sent flat, never rolled." - is longer than the
    // column, and a truncated line should still be able to say what it is.
    { id: "deliverableName", header: "Deliverables", accessorFn: allocationDeliverableName, title: allocationDeliverableName, sortable: false, filterable: false, width: "27%", minWidth: 200, cell: ({ row }) => allocationDeliverableName(row.original) },
    { id: "quantity", header: "Quantity", accessorFn: (row) => row.quantity || "—", sortable: false, filterable: false, width: "9%", minWidth: 80, cell: ({ row }) => deliverablesEditable ? <SpreadsheetCell key={`${row.original.id}-quantity-${row.original.quantity ?? ""}`} type="number" value={row.original.quantity ?? ""} disabled={busy} onCommit={(value) => updateDeliverableCell(row.original, { quantity: value === "" ? 1 : Number(value) })} /> : (row.original.quantity || "—") },
    { id: "numberOfPhotos", header: "No.of.Count", accessorFn: displayDeliverablePhotos, sortable: false, filterable: false, width: "12%", minWidth: 100, cell: ({ row }) => !deliverablesEditable ? displayDeliverablePhotos(row.original) : deliverablePhotoCountEnabled(row.original) ? <SpreadsheetCell key={`${row.original.id}-photos-${row.original.numberOfPhotos ?? ""}`} type="number" placeholder={deliverablePhotoCountPlaceholder(row.original)} value={row.original.numberOfPhotos ?? ""} disabled={busy} onCommit={(value) => updateDeliverableCell(row.original, { numberOfPhotos: value === "" ? null : Number(value) })} /> : "-" },
    { id: "size", header: "Size", accessorFn: displayDeliverableSize, sortable: false, filterable: false, width: "11%", minWidth: 100, cell: ({ row }) => {
      if (!deliverablesEditable) return displayDeliverableSize(row.original);
      // A variant's size was settled when the variant was chosen; offering the deliverable's size
      // list here would let a quotation line say one size and be priced at another's.
      if (row.original.deliverableVariantId) return displayDeliverableSize(row.original);
      const definition = deliverableDefinition(row.original);
      const options = deliverableSizeOptions(definition);
      return options.length ? <SpreadsheetSelectCell key={`${row.original.id}-size-${row.original.sizeOptionValueId || ""}`} value={row.original.sizeOptionValueId || ""} options={options} disabled={busy} onCommit={(value) => updateDeliverableCell(row.original, { sizeOptionValueId: value || null })} /> : "-";
    } },
    { id: "remarks", header: "Remarks", accessorFn: displayDeliverableRemarks, sortable: false, filterable: false, width: "19%", minWidth: 150, cell: ({ row }) => !deliverablesEditable ? displayDeliverableRemarks(row.original) : deliverableRemarksEnabled(row.original) ? <SpreadsheetCell key={`${row.original.id}-remarks-${row.original.remarks || ""}`} value={row.original.remarks || ""} disabled={busy} onCommit={(value) => updateDeliverableCell(row.original, { remarks: value || null })} /> : "-" },
    ...(complimentaryColumn ? [{ id: "complimentary", header: "Complimentary", accessorFn: displayComplimentary, sortable: false, filterable: false, width: "12%", minWidth: 110, cell: ({ row }) => !deliverablesEditable || !complimentaryAllowed(row.original) ? displayComplimentary(row.original) : <SpreadsheetSelectCell key={`${row.original.id}-complimentary-${complimentaryValue(row.original)}`} value={complimentaryValue(row.original)} options={COMPLIMENTARY_OPTIONS} disabled={busy} maxWidth={110} onCommit={(value) => updateDeliverableCell(row.original, { complimentary: value === "true" })} /> }] : []),
    ...(deliverablesEditable ? [{ id: "actions", header: "", sortable: false, filterable: false, fixed: true, width: 48, minWidth: 48, cell: ({ row }) => <DeleteRowButton label={allocationDeliverableName(row.original)} disabled={busy} onClick={() => setConfirm({ type: "deliverable", row: row.original })} /> }] : []),
  ], [busy, complimentaryColumn, deliverablesEditable, updateDeliverableCell]);

  async function confirmDelete() {
    if (!confirm) return;
    const action = confirm;
    setConfirm(null);
    setBusy(true);
    try {
      if (action.type === "service") await onDeleteService(action.row);
      else if (action.type === "deliverable") await onDeleteDeliverable(action.row);
      else if (action.type === "clear-services") await (onClearServices || (async (rows) => { for (const row of rows) await onDeleteService(row); }))(action.rows);
      else if (action.type === "clear-deliverables") await (onClearDeliverables || (async (rows) => { for (const row of rows) await onDeleteDeliverable(row); }))(action.rows);
      else await onDeleteShoot(action.row, action.index, action.type === "shoot-submitted" ? { acknowledgeSubmitted: true } : undefined);
    } catch (deleteError) {
      // The backend refused the shoot delete because its gallery holds client-submitted
      // selections: escalate to the high-impact dialog with the counts it sent back.
      const details = deleteError.data?.details;
      if (action.type === "shoot" && details?.requiresAcknowledgement) {
        setAckText("");
        setConfirm({ type: "shoot-submitted", row: action.row, index: action.index, impact: details });
        return;
      }
      setError(deleteError.message || deleteError.data?.message || "Unable to clear rows.");
    } finally {
      setBusy(false);
    }
  }

  async function addServiceAndEdit(shoot, definition) {
    setBusy(true);
    setError("");
    try {
      await onAddService(shoot, definition);
    } catch (addError) {
      setError(addError.message || "Unable to add service.");
    } finally {
      setBusy(false);
    }
  }

  async function addDeliverableAndEdit(shoot, definition, variant = null) {
    setBusy(true);
    setError("");
    try {
      // A screen that does not offer variants passes none, and its handler never looks for one.
      await onAddDeliverable(shoot, definition, variant);
    } catch (addError) {
      setError(addError.message || "Unable to add deliverable.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">Loading shoots...</p>;

  return <div className="space-y-5">
    {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    {/*
      * Adding a shoot is offered where the caller offers it. Create Project withholds it once a
      * quotation has supplied the shoots: those are what the client agreed to pay for, and a
      * project planned with an extra shoot bolted on at booking is a project that no longer
      * matches its quotation. Absent rather than disabled, the way every other control the
      * situation does not allow is.
      */}
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-blue-50 px-4 py-3">
      <div><h3 className="font-semibold text-slate-800">Shoot List</h3><p className="text-sm text-slate-600">{shootListHint || "Add one or more Shoots for this Project"}</p></div>
      {onAddShoot && <button type="button" onClick={onAddShoot} className="min-h-10 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">+ Add Shoot</button>}
    </div>
    {/* The rows are shown either way; what changes is whether they can be changed. A caller with
        no shoot editors gets the list read-only rather than no list at all. */}
    {shoots.length
      ? <ProjectShootList
        shoots={shoots}
        shootChoices={shootChoices}
        readOnly={!onSaveShootEdit || !onDeleteShoot}
        onSaveEdit={onSaveShootEdit}
        onRequestDelete={onDeleteShoot ? (shoot, index) => setConfirm({ type: "shoot", row: shoot, index }) : undefined}
      />
      : <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">No shoots added yet.</p>}
    <div className="space-y-8 rounded-lg bg-blue-50 p-3">
      {shoots.map((shoot, shootIndex) => {
        const serviceRows = servicesByShoot[shoot.id] || [];
        const deliverableRows = deliverablesByShoot[shoot.id] || [];
        const selectedServiceIds = new Set(serviceRows.map((row) => row.serviceDefinitionId).filter(Boolean));
        /*
         * What is already on the shoot, so the picker stops offering it.
         *
         * A row added from a variant is held by that variant's own option id, not by its
         * deliverable's - otherwise choosing Canvera's 12x18 would take Canvera's 16x24 and every
         * other variant of that deliverable out of the list with it. A row from anywhere else has
         * no option id and is held by its definition, exactly as it always was.
         */
        const selectedDeliverableIds = new Set(deliverableRows.map((row) => row.deliverableOptionId || row.deliverableDefinitionId).filter(Boolean));
        const selectedServiceNames = new Set(serviceRows.map((row) => allocationServiceName(row).toLocaleLowerCase()).filter((name) => name && name !== "—"));
        const selectedDeliverableNames = new Set(deliverableRows.map((row) => allocationDeliverableName(row).toLocaleLowerCase()).filter((name) => name && name !== "—"));
        const isCollapsed = collapsedShootIds.has(shoot.id);
        const shootMeta = formatShootMeta(shoot);
        return <article key={shoot.id} className="rounded-lg bg-white p-4 shadow-sm ring-1 ring-slate-200">
          <header className={isCollapsed ? "" : "mb-4"}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-xl font-semibold text-slate-800">{shoot.shoot || "Shoot"}</h3>
                {shootMeta && <p className="mt-1 truncate text-sm text-slate-500">{shootMeta}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" onClick={() => toggleShootCollapsed(shoot.id)} aria-label={isCollapsed ? `Expand ${shoot.shoot || "shoot"}` : `Collapse ${shoot.shoot || "shoot"}`} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700"><ChevronIcon direction={isCollapsed ? "down" : "up"} size={24} /></button>
                {onRequestEditShoot && onDeleteShoot && <RowActions label={shoot.shoot || "shoot"} onEdit={() => onRequestEditShoot(shoot, shootIndex)} onDelete={() => setConfirm({ type: "shoot", row: shoot, index: shootIndex })} />}
              </div>
            </div>
          </header>
          {!isCollapsed && <div className="space-y-4">
            {/* The way rows are added and cleared, offered only where the rows may change at all.
                On Create Project a quotation has already priced them. */}
            {servicesEditable && <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-start">
              <div className="w-full min-w-0 sm:max-w-lg"><SearchablePicker label="Choose Services" placeholder="Search or browse services" options={servicesForShootType(serviceDefinitions, shoot)} disabledIds={selectedServiceIds} disabledNames={selectedServiceNames} loading={loadingMasterData || busy} emptyMessage="No services available for this shoot type" errorMessage={serviceDefinitionsError} onSelect={(definition) => void addServiceAndEdit(shoot, definition)} /></div>
              <ClearAllButton label="Clear all" disabled={busy || !serviceRows.length} onClick={() => setConfirm({ type: "clear-services", rows: serviceRows, shoot })} />
            </div>}
            <div className="h-auto overflow-hidden rounded-lg border border-slate-200">
              <div className="h-auto min-h-28"><DataTable columns={serviceColumns} data={serviceRows} ariaLabel={`${shoot.shoot || "Shoot"} services`} emptyMessage="No services selected." features={{ filtering: false, sorting: false, tableOptions: false }} getRowId={(row) => row.id} /></div>
            </div>
            <div className="border-t border-dashed border-slate-200 pt-4" />
            {deliverablesEditable && <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-start">
              {/*
                * One entry per brand and variant where the screen asked for them, and one per
                * deliverable where it did not. The options are built from the deliverables this
                * shoot is already narrowed to, so nothing widens the list; the label carries the
                * brand, the size, the frame and the length, which is what makes the box's own
                * search find "Canvera" or "12x18" without searching anything new.
                */}
              <div className="w-full min-w-0 sm:max-w-lg"><SearchablePicker label="Choose Deliverables" placeholder="Search or browse deliverables" options={deliverableVariants ? deliverableVariantOptions(servicesForShootType(deliverableDefinitions, shoot), { withRemarks: true }) : servicesForShootType(deliverableDefinitions, shoot)} disabledIds={selectedDeliverableIds} disabledNames={selectedDeliverableNames} loading={loadingMasterData || busy} emptyMessage="No deliverables available" errorMessage={deliverableDefinitionsError} onSelect={(option) => void addDeliverableAndEdit(shoot, option.definition || option, option.variant ? { ...option.variant, optionId: option.id, label: option.name } : null)} /></div>
              <ClearAllButton label="Clear all" disabled={busy || !deliverableRows.length} onClick={() => setConfirm({ type: "clear-deliverables", rows: deliverableRows, shoot })} />
            </div>}
            <div className="h-auto overflow-hidden rounded-lg border border-slate-200">
              <div className="h-auto min-h-28"><DataTable columns={deliverableColumns} data={deliverableRows} ariaLabel={`${shoot.shoot || "Shoot"} deliverables`} emptyMessage="No deliverables selected." features={{ filtering: false, sorting: false, tableOptions: false }} getRowId={(row) => row.id} /></div>
            </div>
          </div>}
        </article>;
      })}
    </div>
    {confirm?.type === "shoot-submitted" && <ConfirmDialog
      title="High-impact deletion"
      confirmLabel="Delete Anyway"
      loading={busy}
      confirmDisabled={ackText.trim() !== "DELETE"}
      onCancel={() => { if (!busy) { setConfirm(null); setAckText(""); } }}
      onConfirm={() => void confirmDelete()}
    >
      <div className="space-y-3">
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-800" role="alert">
          <p className="font-bold">⚠️ HIGH WARNING</p>
          <p className="mt-1">This shoot has already been submitted by the client.</p>
          <p className="mt-2">Client submitted selections: <strong>{confirm.impact.submittedSelectionCount}</strong><br />Total photos affected: <strong>{confirm.impact.photoCount}</strong></p>
          <p className="mt-2">Deleting this shoot will permanently remove the client&apos;s submitted selections and all associated preview data. Original photos will remain untouched.</p>
        </div>
        <label className="block text-xs text-slate-700">
          Type <strong>DELETE</strong> to confirm
          <input value={ackText} onChange={(event) => setAckText(event.target.value)} autoFocus placeholder="DELETE" className="mt-1 h-9 w-full rounded-md border border-slate-300 px-2 text-sm outline-none focus:border-red-500" />
        </label>
      </div>
    </ConfirmDialog>}
    {confirm && confirm.type !== "shoot-submitted" && <ConfirmDialog title={confirm.type === "service" ? "Delete Service?" : confirm.type === "deliverable" ? "Delete Deliverable?" : confirm.type === "clear-services" ? "Clear All Services?" : confirm.type === "clear-deliverables" ? "Clear All Deliverables?" : "Delete Shoot?"} message={confirm.type === "service" ? "Are you sure you want to remove this service from this shoot?" : confirm.type === "deliverable" ? "Are you sure you want to remove this deliverable from this shoot?" : confirm.type === "clear-services" ? `Clear all services from ${confirm.shoot?.shoot || "this shoot"}?` : confirm.type === "clear-deliverables" ? `Clear all deliverables from ${confirm.shoot?.shoot || "this shoot"}?` : "Delete this shoot? All previews, thumbnails, folders and selection data inside this shoot's Image Selection gallery will be permanently removed with it. Your original photos will NOT be deleted."} confirmLabel={confirm.type === "clear-services" || confirm.type === "clear-deliverables" ? "Clear all" : "Delete"} loading={busy} onCancel={() => { if (!busy) setConfirm(null); }} onConfirm={() => void confirmDelete()} />}
  </div>;
}

// The picker on its own, for the CRM Quotation Calculator, which chooses services and deliverables
// with the same control this section does.
export { SearchablePicker };
