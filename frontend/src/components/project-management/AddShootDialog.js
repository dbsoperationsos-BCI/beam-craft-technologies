"use client";

import SimpleTable from "@/components/data-table/SimpleTable";

import { useState } from "react";
import Button from "@/components/shared/Button";
import ComboBoxField from "@/components/shared/ComboBoxField";
import Dropdown from "@/components/shared/Dropdown";
import RadioGroupField from "@/components/shared/RadioGroupField";
import SharedDateField from "@/components/shared/DateField";
import TextField from "@/components/shared/TextField";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Dialog from "@/components/ui/Dialog";
import { districtOptions, districtState, stateForDistrict, stateOptions } from "@/lib/indiaLocations.mjs";

export { districtOptions, districtState, stateForDistrict, stateOptions };

export const shootOptions = ["Haldi", "Bride Haldi", "Groom Haldi", "New Born", "Baby Shoot IH", "Baby Shoot OH", "Baby Shoot_CP", "Birthday Shoot", "Puberty Function", "Puberty Outdoor", "Engagement", "Pre Wedding", "Mehandi", "Wedding", "Post Wedding", "Baby Shower", "Maternity IH", "Maternity OH", "Industrial", "Tours", "Misc", "Maternity CP", "Reception", "Rituals", "Ear Piercing", "Couple Shoot IH", "Naming ceremony", "Family", "Bride Making", "Groom Making", "Others", "Sangeeth", "Corporate", "Collaboration", "Wedding + Reception"];
export const sessionTimingOptions = ["Hourly", "Half Session", "Full Session"];
export const shootCareOwnerOptions = ["Studio", "Client"];
/*
 * Who the shoot is for, and a question only a wedding has to answer.
 *
 * Groom's side, bride's side or both is a Dum Dum distinction: a Qua Qua baby shoot or a Corp
 * shoot has no sides to follow, and asking anyway put a required field on those forms that meant
 * nothing. It is shown for Dum Dum alone and starts on Both - the answer that covers the whole
 * event, and the one a shoot has whenever nobody has said otherwise.
 */
export const shootPreferenceOptions = ["Groom", "Bride", "Both"];
export const defaultShootPreference = "Both";

/**
 * Whether this shoot belongs to a wedding.
 *
 * The two screens that open this dialog name the vertical differently - the Quotation Generator
 * holds "Dum Dum", Create Project holds the group name's "WED" - so both spellings are answered
 * here rather than translated at each call site. An unknown vertical is not a wedding: the field
 * stays off and Preference keeps its default, which is a valid answer either way.
 */
export function isWeddingVertical(vertical) {
  return ["dum dum", "dumdum", "wed"].includes(String(vertical || "").trim().toLowerCase());
}
export const shootTypeOptions = ["Studio / In-House", "Outdoor / On-Location"];

/**
 * The shoot types and session timings a shoot carries, as lists.
 *
 * A shoot may run in more than one place and over more than one session length - a wedding that
 * starts in the studio and moves outdoors, a day booked partly by the hour. The singular fields are
 * still written, holding the first of each list, so a shoot saved before this - or read by a screen
 * that only knows about one - still makes sense. These read the list and fall back to the singular.
 */
export function shootTypesOf(shoot) {
  const listed = Array.isArray(shoot?.shootTypes) ? shoot.shootTypes.filter(Boolean) : [];
  if (listed.length) return listed;
  return shoot?.shootType ? [shoot.shootType] : [];
}

export function shootTimingsOf(shoot) {
  const listed = Array.isArray(shoot?.sessionTimings) ? shoot.sessionTimings.filter(Boolean) : [];
  if (listed.length) return listed;
  return shoot?.sessionTiming ? [shoot.sessionTiming] : [];
}

/**
 * How long the shoot runs, from whichever timing decides it.
 *
 * Hourly is the only timing a person types, so when it is among them the typed figure is what is
 * kept. With no Hourly the length is the studio's own scale, and the longest session booked is the
 * day's length - a full session covers a half.
 */
export function durationForSessionTiming(sessionTimings, hours = "", minutes = "") {
  const timings = Array.isArray(sessionTimings) ? sessionTimings : [sessionTimings].filter(Boolean);
  if (timings.includes("Hourly")) return { sessionDurationHours: hours ?? "", sessionDurationMinutes: minutes ?? "" };
  if (timings.includes("Full Session")) return { sessionDurationHours: 12, sessionDurationMinutes: 0 };
  if (timings.includes("Half Session")) return { sessionDurationHours: 5, sessionDurationMinutes: 0 };
  return { sessionDurationHours: hours ?? "", sessionDurationMinutes: minutes ?? "" };
}

/** The studio's fixed session lengths, named for whichever sessions the shoot is booked over. */
export function durationLabelForSessionTiming(sessionTimings) {
  const timings = Array.isArray(sessionTimings) ? sessionTimings : [sessionTimings].filter(Boolean);
  return [
    timings.includes("Half Session") && "4-5 Hours (Half)",
    timings.includes("Full Session") && "10-12 Hours (Full)",
  ].filter(Boolean).join(" / ");
}

function today() {
  const date = new Date();
  return new Date(date.getTime() - (date.getTimezoneOffset() * 60000)).toISOString().slice(0, 10);
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(date);
}

/** The shoot's duration, reading as what it is: a typed length, the studio's sessions, or both. */
export function formatSessionTiming(shoot) {
  const timings = shootTimingsOf(shoot);
  if (!timings.length) return "—";
  const parts = [];
  if (timings.includes("Hourly")) {
    const { sessionDurationHours, sessionDurationMinutes } = durationForSessionTiming(timings, shoot?.sessionDurationHours, shoot?.sessionDurationMinutes);
    parts.push(`${Number(sessionDurationHours || 0)}h ${Number(sessionDurationMinutes || 0)}m`);
  }
  const sessions = durationLabelForSessionTiming(timings);
  if (sessions) parts.push(sessions);
  return parts.join(", ") || "—";
}

/**
 * Whether the shoot's day is settled, and the date itself once it is.
 *
 * The same control the W/A Group-Name Generator uses for Main Event Date Known, and deliberately
 * so: it is the one question the studio already answers this way, and a second shape for it would
 * make the two read as different questions. A toggle saying Yes or No, with the date beside it -
 * onto its own line on a phone - and nothing at all where the answer is No.
 *
 * Turning it off clears the date rather than hiding a filled-in one, so what is on screen is what
 * is saved.
 */
function ShootDateField({ shoot, onChange }) {
  return <div>
    <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
      <div className="shrink-0">
        <span className="block text-[11px] font-semibold text-slate-600 sm:text-xs">Shoot Date Known</span>
        <div className="mt-1.5 flex min-h-9 items-center">
          <ToggleSwitch
            checked={Boolean(shoot.dateKnown)}
            ariaLabel="Shoot date known"
            size="sm"
            label={shoot.dateKnown ? "Yes" : "No"}
            onCheckedChange={(checked) => {
              onChange("dateKnown", checked);
              if (!checked) onChange("dateCreated", "");
            }}
          />
        </div>
      </div>
      {/* Takes whatever the toggle leaves of the cell, and drops onto its own line rather than
          squeezing when there is not enough - which is what happens on a phone, where the grid is
          one column anyway. */}
      {shoot.dateKnown && <div className="w-full min-w-40 flex-1 sm:w-auto">
        <SharedDateField label="Date" required value={String(shoot.dateCreated || "").slice(0, 10)} onChange={(value) => onChange("dateCreated", value)} />
      </div>}
    </div>
  </div>;
}

function emptyShoot(shoot) {
  const values = shoot ?? {};
  return {
    /*
     * Whether the shoot's day is settled. A wedding is regularly sold months before the family
     * fixes the reception date, and the form had no way to say so - Date was required, so somebody
     * either invented one or left the shoot off the project until it was known.
     *
     * A new shoot opens on Yes, because most shoots are booked for a day: the Date field is there,
     * filled with today, exactly as it was before this question existed. Reopening a saved shoot
     * reads the answer off the shoot rather than storing it - the date is the answer, and a stored
     * flag could drift from it.
     */
    dateKnown: shoot ? Boolean(values.dateCreated) : true,
    dateCreated: values.dateCreated || today(),
    shoot: values.shoot || "",
    shootPlace: values.shootPlace || "",
    shootTypes: shootTypesOf(values).length ? shootTypesOf(values) : ["Studio / In-House"],
    isMainEvent: Boolean(values.isMainEvent),
    district: values.district || "",
    state: values.state || "",
    sessionTimings: shootTimingsOf(values).length ? shootTimingsOf(values) : ["Hourly"],
    ...durationForSessionTiming(shootTimingsOf(values).length ? shootTimingsOf(values) : ["Hourly"], values.sessionDurationHours ?? "", values.sessionDurationMinutes ?? ""),
    foodTakenCareBy: values.foodTakenCareBy || "Studio",
    accommodation: values.accommodation || "Studio",
    travel: values.travel || "Studio",
    preference: values.preference || defaultShootPreference,
  };
}

function validateShoot(shoot, wedding) {
  // Only where it is asked: a Date that is not on screen must not be able to refuse a save, which
  // is the same rule Preference below it follows.
  if (shoot.dateKnown && !shoot.dateCreated) return "Enter the Date, or set Shoot Date Known to No.";
  if (!shoot.shoot || !shoot.shootPlace.trim() || !shoot.district.trim() || !shoot.state.trim()) return "Complete Shoot, Shoot Place, District, and State.";
  const types = shootTypesOf(shoot);
  const timings = shootTimingsOf(shoot);
  if (!types.length || types.some((type) => !shootTypeOptions.includes(type))) return "Select at least one Shoot Type.";
  if (!timings.length || timings.some((timing) => !sessionTimingOptions.includes(timing))) return "Select at least one Session Timing.";
  if (!shootCareOwnerOptions.includes(shoot.foodTakenCareBy) || !shootCareOwnerOptions.includes(shoot.accommodation) || !shootCareOwnerOptions.includes(shoot.travel)) return "Select Studio or Client for Food, Accommodation, and Travel.";
  // Only where it is asked. A field that is not on screen must not be able to refuse a save.
  if (wedding && !shootPreferenceOptions.includes(shoot.preference)) return "Select a Preference: Groom, Bride, or Both.";
  // Only Hourly is typed, so it is the only timing that can be left blank by mistake.
  if (timings.includes("Hourly") && Number(shoot.sessionDurationHours || 0) === 0 && Number(shoot.sessionDurationMinutes || 0) === 0) return "Enter Hours or Minutes for hourly session timing.";
  if (timings.includes("Hourly") && Number(shoot.sessionDurationMinutes || 0) > 59) return "Minutes must be between 0 and 59.";
  return "";
}

const radioControlClassName = "!mt-0 !min-h-0 border-0 bg-transparent px-0 py-[6px] !gap-y-0";

export function CareOwnerField({ label, name, value, onChange, required = false }) {
  return <RadioGroupField label={label} required={required} name={name} value={value || "Studio"} options={shootCareOwnerOptions} onChange={onChange} className="text-[11px] font-semibold text-slate-600 sm:text-xs" controlClassName={radioControlClassName} />;
}

/**
 * How long the shoot runs, following whichever timings are ticked.
 *
 * Hourly is the only one a person types, so it gets the two boxes. The sessions have lengths the
 * studio has already decided, so they are stated rather than asked for. A shoot booked both ways
 * shows both - the typed length, and the sessions beside it.
 */
function DurationField({ shoot, onDurationChange }) {
  const timings = shootTimingsOf(shoot);
  const sessions = durationLabelForSessionTiming(timings);

  if (!timings.includes("Hourly")) {
    return <TextField label="Duration" required readOnly value={sessions || "Not Available"} />;
  }

  return <fieldset className="block text-[11px] font-semibold text-slate-600 sm:text-xs">
    <legend>Duration<span aria-hidden="true" className="ml-0.5 text-rose-500">*</span></legend>
    <div className="mt-1.5 grid min-h-9 grid-cols-2 gap-3 rounded-lg border border-slate-300 bg-white px-3 text-xs font-normal text-slate-700 outline-none transition focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 sm:text-sm">
      <label className="flex min-w-0 items-center gap-2 text-slate-500">Hours<input type="number" min="0" inputMode="numeric" value={shoot.sessionDurationHours} onChange={(event) => onDurationChange("sessionDurationHours", event.target.value)} className="min-w-0 flex-1 border-0 bg-transparent p-0 text-slate-800 outline-none" /></label>
      <label className="flex min-w-0 items-center gap-2 text-slate-500">Minutes<input type="number" min="0" max="59" inputMode="numeric" value={shoot.sessionDurationMinutes} onChange={(event) => onDurationChange("sessionDurationMinutes", event.target.value)} className="min-w-0 flex-1 border-0 bg-transparent p-0 text-slate-800 outline-none" /></label>
    </div>
    {/* The sessions are booked as well as the hours, so their lengths are named under the boxes. */}
    {sessions && <p className="mt-1 font-normal text-slate-500">Plus {sessions}</p>}
  </fieldset>;
}

/*
 * `vertical` decides whether Preference is asked for - it is a wedding question and nothing else.
 * The two screens that open this dialog spell it differently, which `isWeddingVertical` answers.
 */
/*
 * `shootChoices` narrows the Shoot picker to a caller's own list.
 *
 * Absent, it is the studio's whole vocabulary - which is right for Project Management, where a
 * project may be given any kind of shoot the studio does. The Quotation Generator passes the shoots
 * its brand quotes for, maintained in Settings → Field Settings → Quotation → Shoot Type, so a Dum
 * Dum quotation is not offered a Naming ceremony. An empty or missing list falls back to the whole
 * vocabulary rather than to nothing: a picker with no options cannot be used, and a brand whose
 * shoots have not been set up should not stop somebody quoting.
 */
export default function AddShootDialog({ initialShoot = null, existingShoots = [], vertical = "", shootChoices = null, onClose, onSave }) {
  const offeredShoots = Array.isArray(shootChoices) && shootChoices.length ? shootChoices : shootOptions;
  const isEdit = Boolean(initialShoot);
  const wedding = isWeddingVertical(vertical);
  const [currentShoot, setCurrentShoot] = useState(() => emptyShoot(initialShoot));
  const [shoots, setShoots] = useState([]);
  const [error, setError] = useState("");
  const [mainEventConfirm, setMainEventConfirm] = useState(null);
  const [saving, setSaving] = useState(false);

  function update(field, value) {
    const matchedState = field === "district" ? stateForDistrict(value) : "";
    setCurrentShoot((current) => ({
      ...current,
      [field]: value,
      ...(matchedState ? { state: matchedState } : {}),
      // Ticking or unticking a timing changes what the duration is, so it is recomputed here -
      // the typed hours are carried through, so unticking Half Session does not clear them.
      ...(field === "sessionTimings" ? durationForSessionTiming(value, current.sessionDurationHours, current.sessionDurationMinutes) : {}),
    }));
  }

  function updateDurationField(field, value) {
    const digits = String(value || "").replace(/\D/g, "");
    setCurrentShoot((current) => ({
      ...current,
      [field]: field === "sessionDurationMinutes" && digits !== "" ? String(Math.min(59, Number(digits))) : digits,
    }));
  }

  const hasCurrentValues = Object.entries(currentShoot).some(([key, value]) => value
    && !(key === "dateCreated" && value === today())
    && !(key === "shootTypes" && Array.isArray(value) && value.length === 1 && value[0] === "Studio / In-House")
    && !(key === "sessionTimings" && Array.isArray(value) && value.length === 1 && value[0] === "Hourly")
    && !(["foodTakenCareBy", "accommodation", "travel"].includes(key) && value === "Studio")
    // Preference arrives already answered, like the three Studio defaults beside it. Counting it
    // as something typed would make an untouched form look filled in, and Save would then insist
    // on completing a shoot nobody had started.
    && !(key === "preference" && value === defaultShootPreference)
    // Same reason: Shoot Date Known opens on Yes, so counting it as something typed would make an
    // untouched form look started and Save would then insist on finishing a shoot nobody began.
    && !(key === "dateKnown" && value === true));

  const visibleShoots = [...existingShoots.filter((shoot) => !initialShoot || shoot.id !== initialShoot.id), ...shoots];
  const existingMainShoot = visibleShoots.find((shoot) => shoot.isMainEvent);

  function mainEventConfirmMessage() {
    const existingMainLabel = existingMainShoot ? `${existingMainShoot.shoot || "Untitled Shoot"}${existingMainShoot.shootId ? ` (${existingMainShoot.shootId})` : ""}` : "";
    return existingMainShoot
      ? `${existingMainLabel} is already marked as Main Event. Do you want to change the Main Event to this shoot?`
      : "Are you sure you want to mark this shoot as the Main Event?";
  }

  function updateMainEvent(value) {
    if (value && !currentShoot.isMainEvent) {
      setMainEventConfirm({ value });
      return;
    }
    update("isMainEvent", value);
  }

  function normalizedShoot() {
    const timings = shootTimingsOf(currentShoot);
    const types = shootTypesOf(currentShoot);
    const duration = durationForSessionTiming(timings, currentShoot.sessionDurationHours, currentShoot.sessionDurationMinutes);
    // `dateKnown` is the form's question, not the shoot's field: the shoot either has a date or it
    // does not, and `emptyShoot` reads the answer back off that when the shoot is reopened. Kept
    // out of what is saved so there is one place the truth lives.
    const { dateKnown, ...values } = currentShoot;
    return {
      ...values,
      // No date at all when the answer is No; the toggle clears the field as it is turned off, so
      // what is on screen is what is saved. Where the answer is Yes a date is guaranteed, because
      // `validateShoot` refuses the form without one.
      dateCreated: dateKnown ? currentShoot.dateCreated : null,
      shootPlace: currentShoot.shootPlace.trim(),
      shootTypes: types,
      sessionTimings: timings,
      // The first of each list, so a screen that only knows about one still reads correctly.
      shootType: types[0] || "Studio / In-House",
      sessionTiming: timings[0] || "Hourly",
      isMainEvent: Boolean(currentShoot.isMainEvent),
      district: currentShoot.district.trim(),
      state: currentShoot.state.trim(),
      sessionDurationHours: Number(duration.sessionDurationHours || 0),
      sessionDurationMinutes: Number(duration.sessionDurationMinutes || 0),
      foodTakenCareBy: currentShoot.foodTakenCareBy || "Studio",
      accommodation: currentShoot.accommodation || "Studio",
      travel: currentShoot.travel || "Studio",
      preference: currentShoot.preference,
      eventStartTime: null,
      eventEndTime: null,
    };
  }

  function addCurrentShoot() {
    const validationError = validateShoot(currentShoot, wedding);
    if (validationError) {
      setError(validationError);
      return;
    }
    const nextShoot = normalizedShoot();
    setShoots((current) => [...current.map((shoot) => nextShoot.isMainEvent ? { ...shoot, isMainEvent: false } : shoot), nextShoot]);
    setCurrentShoot(emptyShoot());
    setError("");
  }

  async function save() {
    let rows = isEdit ? [normalizedShoot()] : shoots;
    if (!isEdit && hasCurrentValues) {
      const validationError = validateShoot(currentShoot, wedding);
      if (validationError) {
        setError(validationError);
        return;
      }
      const nextShoot = normalizedShoot();
      rows = [...rows.map((shoot) => nextShoot.isMainEvent ? { ...shoot, isMainEvent: false } : shoot), nextShoot];
    } else if (isEdit) {
      const validationError = validateShoot(currentShoot, wedding);
      if (validationError) {
        setError(validationError);
        return;
      }
    }
    if (!rows.length) {
      setError("Add at least one shoot.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(rows);
    } catch (saveError) {
      setError(saveError.message || "Unable to save the shoot list.");
    } finally {
      setSaving(false);
    }
  }

  return <>
  <Dialog
    title={isEdit ? "Edit Shoot" : "Add Shoot"}
    size="form"
    layer="dialogOverPanel"
    busy={saving}
    onClose={onClose}
    bodyClassName="pb-0"
    footer={<>
      <Button className="max-sm:flex-1" type="button" disabled={saving} onClick={onClose}>Cancel</Button>
      <Button className="max-sm:flex-1" type="button" variant="primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving..." : isEdit ? "Update" : "Save"}</Button>
    </>}
  >
    <div>
        <div className="grid gap-x-12 gap-y-5 md:grid-cols-2">
          {/* Searchable, like the District and State pickers beside it: 35 shoots is more than a
              menu can be scanned for, and "mehandi" is quicker to type than to hunt down. Still a
              closed list, unlike those two - a shoot's name is shared vocabulary, read back by the
              CRD form, the project's shoot list and Client Storage, so a typo invents a shoot
              rather than naming one. */}
          <Dropdown mode="input" searchable label="Shoot" required placeholder="Search or select shoot" value={currentShoot.shoot} onChange={(value) => update("shoot", value)} options={offeredShoots.map((option) => ({ label: option, value: option }))} menuZIndexClassName="z-[170]" />
          <RadioGroupField label="Shoot Type" required name="shootTypes" value={shootTypesOf(currentShoot)[0] || "Studio / In-House"} options={shootTypeOptions} onChange={(value) => update("shootTypes", [value])} className="text-[11px] font-semibold text-slate-600 sm:text-xs" controlClassName={radioControlClassName} />
          <TextField label="Shoot Place" required value={currentShoot.shootPlace} onChange={(event) => update("shootPlace", event.target.value)} />
          <ComboBoxField label="District" required placeholder="Select or enter district" value={currentShoot.district} onChange={(value) => update("district", value)} options={districtOptions} />
          <ComboBoxField label="State" required placeholder="Select or enter state" value={currentShoot.state} onChange={(value) => update("state", value)} options={stateOptions} />
          <RadioGroupField label="Session Timing" required name="sessionTimings" value={shootTimingsOf(currentShoot)[0] || "Hourly"} options={sessionTimingOptions} onChange={(value) => update("sessionTimings", [value])} className="text-[11px] font-semibold text-slate-600 sm:text-xs" controlClassName={radioControlClassName} />
          {/* The pair that closes the shoot's own details: the date question on the left, and
              Duration beside it on the right, directly under the Session Timing that decides it.
              Duration sat alone on the left before this with an empty half-row beside it. */}
          <ShootDateField shoot={currentShoot} onChange={update} />
          <DurationField shoot={currentShoot} onDurationChange={updateDurationField} />
          {/* Four across on a wide screen when Preference is among them, three when it is not, so
              the row fills its width either way instead of leaving a gap where it would have sat. */}
          <div className={`grid gap-6 md:col-span-2 md:grid-cols-2 ${wedding ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
            <CareOwnerField label="Food Taken Care by" required name="foodTakenCareBy" value={currentShoot.foodTakenCareBy} onChange={(value) => update("foodTakenCareBy", value)} />
            <CareOwnerField label="Accommodation" required name="accommodation" value={currentShoot.accommodation} onChange={(value) => update("accommodation", value)} />
            <CareOwnerField label="Travel" required name="travel" value={currentShoot.travel} onChange={(value) => update("travel", value)} />
            {/* Weddings only - a baby shoot has no groom's side to follow. The same radio group the
                three beside it use, so the row reads as one set of choices rather than three of one
                kind and one of another. */}
            {wedding && <RadioGroupField
              label="Preference"
              required
              name="preference"
              value={currentShoot.preference || defaultShootPreference}
              options={shootPreferenceOptions}
              onChange={(value) => update("preference", value)}
              className="text-[11px] font-semibold text-slate-600 sm:text-xs"
              controlClassName={radioControlClassName}
            />}
          </div>
          <fieldset className="text-[11px] font-semibold text-slate-600 sm:text-xs">
            <legend className="inline-flex items-center gap-2">Mark as Main Event<span aria-hidden="true" className="text-rose-500">*</span><span title="Only one shoot can be marked as the Main Event." className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-500 text-[10px] font-bold">i</span></legend>
            <div className="mt-2 flex min-h-11 items-center gap-4 text-sm font-normal text-slate-700">
              <span>No</span>
              <button type="button" role="switch" aria-checked={currentShoot.isMainEvent} onClick={() => updateMainEvent(!currentShoot.isMainEvent)} className={`relative h-7 w-14 rounded-full transition ${currentShoot.isMainEvent ? "bg-blue-600" : "bg-slate-300"}`}>
                <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${currentShoot.isMainEvent ? "left-8" : "left-1"}`} />
              </button>
              <span>Yes</span>
            </div>
          </fieldset>
          {!isEdit && <div className="flex items-end justify-end"><button type="button" onClick={addCurrentShoot} disabled={saving} className="min-h-9 rounded-md border border-blue-200 bg-blue-50 px-5 text-sm font-medium text-blue-700">Add Shoot List</button></div>}
        </div>
        {error && <p role="alert" className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {!isEdit && <SimpleTable
          variant="form"
          classNames={{ wrapper: "mt-6 !rounded-md", table: "min-w-full text-sm", head: "!text-sm !tracking-normal", th: "whitespace-nowrap !py-2.5", row: "text-slate-700", td: "whitespace-nowrap !py-2.5", empty: "!py-8" }}
          columns={[
            { key: "shoot", label: "Shoot", render: (shoot) => shoot.shoot },
            { key: "shootType", label: "Shoot Type", render: (shoot) => shootTypesOf(shoot).join(", ") || "Studio / In-House" },
            { key: "date", label: "Date", render: (shoot) => formatDate(shoot.dateCreated) },
            { key: "shootPlace", label: "Shoot Place", render: (shoot) => shoot.shootPlace },
            { key: "district", label: "District", render: (shoot) => shoot.district },
            { key: "state", label: "State", render: (shoot) => shoot.state },
            { key: "sessionTiming", label: "Session Timing", render: (shoot) => shootTimingsOf(shoot).join(", ") || "—" },
            { key: "duration", label: "Duration", render: (shoot) => formatSessionTiming(shoot) },
            { key: "food", label: "Food Taken Care by", render: (shoot) => shoot.foodTakenCareBy || "Studio" },
            { key: "accommodation", label: "Accommodation", render: (shoot) => shoot.accommodation || "Studio" },
            { key: "travel", label: "Travel", render: (shoot) => shoot.travel || "Studio" },
            { key: "preference", label: "Preference", render: (shoot) => shoot.preference || "—" },
            { key: "mainEvent", label: "Main Event", render: (shoot) => (shoot.isMainEvent ? "Yes" : "-") },
            { key: "remove", label: "", cellClassName: "text-right", render: (_shoot, index) => <button type="button" onClick={() => setShoots((current) => current.filter((_, rowIndex) => rowIndex !== index))} className="text-sm font-medium text-red-600">Remove</button> },
          ]}
          rows={shoots}
          rowKey={(shoot, index) => `${shoot.shoot}-${index}`}
          emptyMessage="No shoots added to this list yet."
        />}
      </div>
  </Dialog>
  {mainEventConfirm && <ConfirmDialog
    title="Mark as Main Event?"
    message={mainEventConfirmMessage()}
    confirmLabel="Confirm"
    tone="primary"
    layer="dialogOverPanel"
    onCancel={() => setMainEventConfirm(null)}
    onConfirm={() => {
      update("isMainEvent", mainEventConfirm.value);
      setMainEventConfirm(null);
    }}
  />}
  </>;
}
