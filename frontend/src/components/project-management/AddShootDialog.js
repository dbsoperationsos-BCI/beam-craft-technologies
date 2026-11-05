"use client";

import SimpleTable from "@/components/data-table/SimpleTable";

import { useId, useState } from "react";
import Button from "@/components/shared/Button";
import ComboBoxField from "@/components/shared/ComboBoxField";
import Dropdown from "@/components/shared/Dropdown";
import MultiSelectField from "@/components/shared/MultiSelectField";
import { NAME_COLUMN_MAX_WIDTH } from "@/components/data-table/tableLayout";
import RadioGroupField from "@/components/shared/RadioGroupField";
import SharedDateField from "@/components/shared/DateField";
import TextField from "@/components/shared/TextField";
import useFormErrors from "@/components/shared/useFormErrors";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Dialog from "@/components/ui/Dialog";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { districtOptions, districtState, stateForDistrict, stateOptions } from "@/lib/indiaLocations.mjs";
import { shootDisplayName } from "@/lib/shootDisplay.mjs";
import { duplicateShootValues } from "@/lib/shootDuplicate.mjs";
import { LOCATION_MODES, SHOOT_NAME_SEPARATOR, savedShootLocations, shootLocationsError, shootLocationsFor, shootLocationsSummary, shootNamesOf } from "@/lib/shootLocations.mjs";

/** The longest Additional Text a shoot takes - a phrase beside the shoot's name, not a note. */
const CUSTOM_TEXT_MAX_LENGTH = 120;

/*
 * Several shoots ticked are one shoot, named for all of them: "Haldi + Mehandi". The separator is
 * the one the studio already writes by hand - "Wedding + Reception" is in the register - and the
 * length is the column's own (`project_shoot.shoot`), checked here so a long run of names is
 * refused in words rather than by the server.
 */
const SHOOT_NAME_MAX_LENGTH = 191;

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
    timings.includes("Full Session") && "8-10 Hours (Full)",
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
function ShootDateField({ shoot, onChange, error = "" }) {
  return <div>
    <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
      <div className="shrink-0">
        <span className="block text-[11px] font-semibold text-slate-600 sm:text-xs">Shoot Date Known</span>
        <div className="mt-1.5 flex min-h-9 items-center">
          <ToggleSwitch
            checked={Boolean(shoot.dateKnown)}
            ariaLabel="Shoot date known"
            size="sm"
            helperText="Turn off when the family has not fixed the shoot day yet."
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
        <SharedDateField label="Date" required helperText="The day the shoot happens, shown on the shoot list and schedule." value={String(shoot.dateCreated || "").slice(0, 10)} onChange={(value) => onChange("dateCreated", value)} error={error} />
      </div>}
    </div>
  </div>;
}

function emptyShoot(shoot) {
  const values = shoot ?? {};
  /*
   * Only the types this form offers. Older shoots carry words from before these two existed
   * ("Candid", "Traditional"); read as-is they matched neither radio, so editing one opened with
   * Shoot Type blank and could not be saved until it was re-picked. They open on the default instead.
   */
  const knownTypes = shootTypesOf(values).filter((type) => shootTypeOptions.includes(type));
  // A shoot at several places holds the joined "Chennai + Madurai" in its own three columns; the
  // form's shared fields open on the first place instead, which is what Single would then keep.
  const firstPlace = savedShootLocations(values)[0];
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
    shootPlace: (firstPlace ? firstPlace.shootPlace : values.shootPlace) || "",
    shootTypes: knownTypes.length ? knownTypes : ["Studio / In-House"],
    isMainEvent: Boolean(values.isMainEvent),
    district: (firstPlace ? firstPlace.district : values.district) || "",
    state: (firstPlace ? firstPlace.state : values.state) || "",
    sessionTimings: shootTimingsOf(values).length ? shootTimingsOf(values) : ["Hourly"],
    ...durationForSessionTiming(shootTimingsOf(values).length ? shootTimingsOf(values) : ["Hourly"], values.sessionDurationHours ?? "", values.sessionDurationMinutes ?? ""),
    foodTakenCareBy: values.foodTakenCareBy || "Studio",
    accommodation: values.accommodation || "Studio",
    travel: values.travel || "Studio",
    preference: values.preference || defaultShootPreference,
  };
}

/** What is wrong with the form, field by field - `{}` when nothing is - each said under its own box. */
function validateShoot(shoot, wedding) {
  const problems = {};
  // Only where it is asked: a Date that is not on screen must not be able to refuse a save, which
  // is the same rule Preference below it follows.
  if (shoot.dateKnown && !shoot.dateCreated) problems.dateCreated = "Enter the Date, or set Shoot Date Known to No.";
  /*
   * District and State are **not** asked for. A shoot is booked and planned long before where it is
   * has been settled - a quotation is often raised with nothing but a city in mind - and refusing the
   * shoot for them only had the studio typing a guess it would correct later. Both are still on the
   * form, and picking a district still fills the state in; neither holds the save.
   */
  if (!shoot.shoot) problems.shoot = "Choose the shoot.";
  if (!shoot.shootPlace.trim()) problems.shootPlace = "Enter the shoot place.";
  const types = shootTypesOf(shoot);
  const timings = shootTimingsOf(shoot);
  if (!types.length || types.some((type) => !shootTypeOptions.includes(type))) problems.shootTypes = "Select at least one Shoot Type.";
  if (!timings.length || timings.some((timing) => !sessionTimingOptions.includes(timing))) problems.sessionTimings = "Select at least one Session Timing.";
  for (const field of ["foodTakenCareBy", "accommodation", "travel"]) {
    if (!shootCareOwnerOptions.includes(shoot[field])) problems[field] = "Select Studio or Client.";
  }
  // Only where it is asked. A field that is not on screen must not be able to refuse a save.
  if (wedding && !shootPreferenceOptions.includes(shoot.preference)) problems.preference = "Select a Preference: Groom, Bride, or Both.";
  // Only Hourly is typed, so it is the only timing that can be left blank by mistake.
  if (timings.includes("Hourly") && Number(shoot.sessionDurationHours || 0) === 0 && Number(shoot.sessionDurationMinutes || 0) === 0) problems.duration = "Enter Hours or Minutes for hourly session timing.";
  else if (timings.includes("Hourly") && Number(shoot.sessionDurationMinutes || 0) > 59) problems.duration = "Minutes must be between 0 and 59.";
  return problems;
}

const radioControlClassName = "!mt-0 !min-h-0 border-0 bg-transparent px-0 py-[6px] !gap-y-0";

export function CareOwnerField({ label, name, value, onChange, required = false, error = "", helperText = "" }) {
  return <RadioGroupField label={label} required={required} helperText={helperText} name={name} value={value || "Studio"} options={shootCareOwnerOptions} onChange={onChange} error={error} className="text-[11px] font-semibold text-slate-600 sm:text-xs" controlClassName={radioControlClassName} />;
}

/**
 * How long the shoot runs, following whichever timings are ticked.
 *
 * Hourly is the only one a person types, so it gets the two boxes. The sessions have lengths the
 * studio has already decided, so they are stated rather than asked for. A shoot booked both ways
 * shows both - the typed length, and the sessions beside it.
 */
function DurationField({ shoot, onDurationChange, error = "" }) {
  const timings = shootTimingsOf(shoot);
  const sessions = durationLabelForSessionTiming(timings);

  if (!timings.includes("Hourly")) {
    return <TextField label="Duration" required readOnly helperText="Set by the Session Timing chosen above; pick Hourly to type hours." value={sessions || "Not Available"} />;
  }

  return <fieldset className="block text-[11px] font-semibold text-slate-600 sm:text-xs">
    <legend>Duration<span aria-hidden="true" className="ml-0.5 text-rose-500">*</span></legend>
    <div aria-invalid={error ? true : undefined} className={`mt-1.5 grid min-h-9 grid-cols-2 gap-3 rounded-lg border bg-white px-3 ${error ? "border-red-400" : "border-slate-300"} text-xs font-normal text-slate-700 outline-none transition focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 sm:text-sm`}>
      <label className="flex min-w-0 items-center gap-2 text-slate-500">Hours<input type="number" min="0" inputMode="numeric" value={shoot.sessionDurationHours} onChange={(event) => onDurationChange("sessionDurationHours", event.target.value)} className="min-w-0 flex-1 border-0 bg-transparent p-0 text-slate-800 outline-none" /></label>
      <label className="flex min-w-0 items-center gap-2 text-slate-500">Minutes<input type="number" min="0" max="59" inputMode="numeric" value={shoot.sessionDurationMinutes} onChange={(event) => onDurationChange("sessionDurationMinutes", event.target.value)} className="min-w-0 flex-1 border-0 bg-transparent p-0 text-slate-800 outline-none" /></label>
    </div>
    {/* The sessions are booked as well as the hours, so their lengths are named under the boxes. */}
    {sessions && <p className="mt-1 font-normal text-slate-500">Plus {sessions}</p>}
    {error && <p role="alert" className="mt-1.5 text-xs font-normal text-red-600">{error}</p>}
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
 *
 * Adding lets the Shoot field take several at once, on every screen that adds shoots - the
 * Quotation Generator, Create Project and a project's plan alike. The rest of the form is then the batch's common answers, and Add Shoot List (or Save) makes one
 * ordinary shoot row per chosen shoot, each with those answers; nothing downstream ever sees a list
 * of shoots in one row. Editing a shoot is always the one shoot.
 */
/*
 * `allowCustomText` adds an Additional Text section above Mark as Main Event - the Quotation
 * Generator's, where a shoot is named for the client ("Rituals (Bride Varatham)"): one optional box
 * per selected shoot, since the shoots chosen together are saved as separate shoots and each is named
 * on its own. A project's shoots are rows of their own with no such column, so the project screens
 * leave it off and their shoots are saved exactly as before.
 */
/*
 * `copyOf` is the Shoot List's Duplicate: the dialog opens to add a shoot, filled with every detail of
 * the one being copied except Shoot, which is left for the person to choose (`duplicateShootValues`),
 * and Save adds it as a new shoot. Never the Main Event - one shoot carries the mark, and a copy
 * leaves it where it was.
 */
/*
 * known, so there District is asked but not required. Every project screen leaves it off and keeps
 * District required, as it always was.
 */
export default function AddShootDialog({ initialShoot = null, copyOf = null, existingShoots = [], vertical = "", shootChoices = null, allowCustomText = false, onClose, onSave }) {
  const offeredShoots = Array.isArray(shootChoices) && shootChoices.length ? shootChoices : shootOptions;
  const isEdit = Boolean(initialShoot);
  const wedding = isWeddingVertical(vertical);
  const [currentShoot, setCurrentShoot] = useState(() => emptyShoot(initialShoot || (copyOf ? duplicateShootValues(copyOf) : null)));
  const [shoots, setShoots] = useState([]);
  const [error, setError] = useState("");
  const fields = useFormErrors();
  // Not an error: a batch added with some of its shoots left out because they were already listed.
  const [notice, setNotice] = useState("");
  const [mainEventConfirm, setMainEventConfirm] = useState(null);
  const [saving, setSaving] = useState(false);
  // The shoots chosen for this batch, and - where Main Event is on and more than one is chosen -
  // which of them it is. `currentShoot.shoot` carries the first, so the checks written for one
  // shoot still read the form the same way. Empty to begin with on Add Shoot and on a Duplicate
  // alike: a copy keeps the shoot's details, and which shoot it is for is the one thing it asks.
  // Editing opens on the names the shoot already carries, so "Haldi + Mehandi" opens with both
  // ticked and either can be taken off.
  const [selectedShoots, setSelectedShoots] = useState(() => (initialShoot ? shootNamesOf(initialShoot.shoot) : []));
  /*
   * Each selected shoot's Additional Text, by the shoot's name - a shoot can be chosen once in the
   * selection, so the name is what tells the boxes apart, and what is typed for one is kept while
   * others are added or removed. Opening a saved shoot fills its own.
   */
  const [customTextByShoot, setCustomTextByShoot] = useState(() => {
    // Keyed by the **first** name, not the whole "Haldi + Mehandi": the boxes are one per name now,
    // and the saved text was written as one string for the shoot. Put on the first, it is still
    // there to read and edit, and a shoot of one name - almost all of them - is unchanged.
    const [first] = shootNamesOf(initialShoot?.shoot || "");
    return first && initialShoot?.customText ? { [first]: String(initialShoot.customText) } : {};
  });
  // A Duplicate opens with no shoot chosen, so the copied text has no box to sit in yet: it is held
  // here and becomes the text of whichever shoot is then chosen for the copy.
  const copiedCustomText = copyOf && !initialShoot ? String(copyOf.customText || "").trim() : "";
  const textShoots = selectedShoots;
  /*
   * Location: Single or Multiple, asked once the shoot is made of two or more names. Single is the
   * form as it always was - one Shoot Place, District and State for all of them. Multiple asks the
   * three for each name, and the shoot is still the one "Haldi + Mehandi" row, holding a place per
   * name. What was typed for each is kept by the name, as Additional Text is, so a name added or
   * taken out leaves the others' places alone. Opening a saved or copied shoot at several places
   * opens on Multiple, with its places.
   */
  const sourceLocations = savedShootLocations(initialShoot || copyOf);
  const [locationMode, setLocationMode] = useState(sourceLocations.length ? "Multiple" : "Single");
  const [locationsByShoot, setLocationsByShoot] = useState(() => Object.fromEntries(sourceLocations.map((location) => [location.shoot, {
    shootPlace: location.shootPlace || "", district: location.district || "", state: location.state || "",
  }])));
  const locationShoots = selectedShoots;
  const asksLocationMode = locationShoots.length > 1;
  const multipleLocations = asksLocationMode && locationMode === "Multiple";
  // Once a save has been refused for a missing place, each name still without one is marked.
  const [locationErrorsShown, setLocationErrorsShown] = useState(false);
  const locationGroupId = useId();
  const sharedLocation = () => ({ shootPlace: currentShoot.shootPlace, district: currentShoot.district, state: currentShoot.state });
  // A name with nothing typed yet starts on the shared place, so Multiple opens already filled in.
  const locationOf = (name) => locationsByShoot[name] || sharedLocation();
  /*
   * Back to one place - chosen, or because fewer than two shoots are left to ask it for. The place
   * kept is the first shoot's (or the one left's), so what was typed is not simply thrown away, and
   * the places per name are let go: Multiple chosen again starts every name on the one place, rather
   * than some on it and some on places typed before.
   */
  function leaveMultipleLocations(name) {
    if (locationMode !== "Multiple") return;
    if (asksLocationMode) {
      const kept = locationOf(locationShoots.includes(name) ? name : locationShoots[0]);
      setCurrentShoot((current) => ({ ...current, shootPlace: kept.shootPlace, district: kept.district, state: kept.state }));
    }
    setLocationMode("Single");
    setLocationsByShoot({});
    setLocationErrorsShown(false);
  }
  function chooseLocationMode(mode) {
    if (mode === "Single") leaveMultipleLocations();
    else setLocationMode(mode);
  }
  function updateLocation(name, field, value) {
    // The places have no box of their own in the marks, so editing one takes their mark away.
    fields.clear("shootLocations");
    const matchedState = field === "district" ? stateForDistrict(value) : "";
    setLocationsByShoot((current) => ({
      ...current,
      [name]: { ...(current[name] || sharedLocation()), [field]: value, ...(matchedState ? { state: matchedState } : {}) },
    }));
  }
  const currentLocations = () => shootLocationsFor(locationShoots, Object.fromEntries(locationShoots.map((name) => [name, locationOf(name)])));
  /*
   * The form as the checks read it: with Multiple, the joined place stands for Shoot Place, so the
   * one-place check is answered by every name having one - which is checked first, by name.
   */
  function formProblems() {
    if (!multipleLocations) return validateShoot(currentShoot, wedding);
    // Field by field, as `validateShoot` answers. With Multiple there is no single Shoot Place box:
    // each name's own place answers it, marked under that name, and a problem with them as a whole
    // (too long together) is said on the form's line, which no single box could carry.
    const locationError = shootLocationsError(currentLocations());
    setLocationErrorsShown(Boolean(locationError));
    setError(locationError);
    const problems = validateShoot({ ...currentShoot, shootPlace: shootLocationsSummary(currentLocations()).shootPlace }, wedding);
    delete problems.shootPlace;
    return locationError ? { ...problems, shootLocations: locationError } : problems;
  }
  // Trimmed, and null rather than "" when empty, so clearing it on an edit takes the old text away.
  const customTextFor = (name) => String(customTextByShoot[name] || "").trim() || null;
  function chooseShoots(values) {
    if (values.length < 2) leaveMultipleLocations(values[0]);
    setSelectedShoots(values);
    update("shoot", values[0] || "");
    // A shoot taken out of the selection takes its box with it; the others keep what was typed, and
    // one newly chosen starts on the copied shoot's text (nothing, outside a Duplicate).
    setCustomTextByShoot((current) => Object.fromEntries(values.map((name) => [name, name in current ? current[name] : copiedCustomText])));
  }

  function update(field, value) {
    fields.clear(field);
    // A timing changes what Duration asks for.
    if (field === "sessionTimings") fields.clear("duration");
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
    fields.clear("duration");
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
    // One place for all, or each name's own with the three columns joined from them.
    const locations = multipleLocations ? currentLocations() : null;
    const place = locations ? shootLocationsSummary(locations) : { shootPlace: currentShoot.shootPlace.trim(), district: currentShoot.district.trim(), state: currentShoot.state.trim() };
    return {
      ...values,
      // The one shoot being edited takes its own Additional Text; a batch's rows take theirs in `formRows`.
      ...(allowCustomText ? { customText: customTextFor(currentShoot.shoot) } : {}),
      // No date at all when the answer is No; the toggle clears the field as it is turned off, so
      // what is on screen is what is saved. Where the answer is Yes a date is guaranteed, because
      // `validateShoot` refuses the form without one.
      dateCreated: dateKnown ? currentShoot.dateCreated : null,
      shootPlace: place.shootPlace,
      shootLocations: locations,
      shootTypes: types,
      sessionTimings: timings,
      // The first of each list, so a screen that only knows about one still reads correctly.
      shootType: types[0] || "Studio / In-House",
      sessionTiming: timings[0] || "Hourly",
      isMainEvent: Boolean(currentShoot.isMainEvent),
      district: place.district,
      state: place.state,
      sessionDurationHours: Number(duration.sessionDurationHours || 0),
      sessionDurationMinutes: Number(duration.sessionDurationMinutes || 0),
      foodTakenCareBy: currentShoot.foodTakenCareBy || "Studio",
      accommodation: currentShoot.accommodation || "Studio",
      travel: currentShoot.travel || "Studio",
      preference: currentShoot.preference,
      // Event Start/End Time are not asked for here. They belong to the Pre Production board, which
      // is the stage that knows them, so this form leaves whatever is stored alone.
    };
  }

  /*
   * The row the form stands for: **one**, however many shoots were ticked.
   *
   * Several ticked is one sitting - a Haldi that runs into a Mehandi, shot by one crew on one day -
   * so it is one shoot named for all of them, "Haldi + Mehandi", the way the studio already writes
   * it by hand ("Wedding + Reception" is in the register). It used to become a row each, which gave
   * one afternoon three shoot ids, three pre production records and three production plans to keep
   * in step. One row means one of everything, and one Main Event toggle rather than a question
   * about which of the ticked names carries it.
   *
   * All or nothing: a form that fails a check adds no row at all, and each box it failed on is marked.
   */
  function formRows() {
    if (!fields.check(formProblems())) return { invalid: true };
    const names = selectedShoots;
    const shoot = names.join(SHOOT_NAME_SEPARATOR);
    if (shoot.length > SHOOT_NAME_MAX_LENGTH) {
      fields.check({ shoot: `That is a long name for one shoot (${shoot.length} characters, and ${SHOOT_NAME_MAX_LENGTH} is the most a shoot's name can hold). Add them as separate shoots instead.` });
      return { invalid: true };
    }
    const base = normalizedShoot();
    // The Additional Text of each ticked shoot, in the order they were ticked, so nothing typed is
    // lost when they become one: "Bride Varatham; Groom Varatham".
    const customText = allowCustomText
      ? names.map(customTextFor).filter(Boolean).join("; ") || null
      : undefined;
    return { rows: [{ ...base, ...(allowCustomText ? { customText } : {}), shoot, isMainEvent: Boolean(currentShoot.isMainEvent) }] };
  }

  /*
   * The rows to add to `pending`: in a batch, a shoot already in the list is left out and named,
   * rather than added twice. A single shoot outside a batch is added as it always was.
   */
  function withoutDuplicates(rows, pending) {
    // The same shoot with different Additional Text is a different shoot - Rituals for the bride and
    // for the groom - so the two are compared together.
    const keyOf = (shoot) => `${shoot.shoot}\u0000${String(shoot.customText || "").trim().toLowerCase()}`;
    const listed = new Set(pending.map(keyOf));
    return { rows: rows.filter((row) => !listed.has(keyOf(row))), skipped: rows.filter((row) => listed.has(keyOf(row))).map((row) => shootDisplayName(row)) };
  }
  const alreadyListed = (skipped) => `${skipped.join(", ")} ${skipped.length === 1 ? "is" : "are"} already in the list.`;
  // A new Main Event takes the mark from every row already listed.
  const appendRows = (pending, rows) => [...pending.map((shoot) => rows.some((row) => row.isMainEvent) ? { ...shoot, isMainEvent: false } : shoot), ...rows];

  /*
   * The two row actions on the list below. Both act on the list alone - nothing is written until
   * Save hands the rows to whoever opened the dialog, exactly as for a shoot added by Add Shoot List.
   *
   * Remove takes that one row out and leaves every other row and the form as they are.
   *
   * Duplicate puts a copy straight after its row: every value the row holds, as its own object, so
   * the two are never one item. A copy is never the Main Event - one shoot carries the mark, and
   * duplicating it leaves the mark where it was rather than moving it onto the copy; marking a
   * different shoot is still done on the form, by the same confirmation as always.
   *
   * Each says what it did on the dialog's own status line - a copy looks exactly like its row and may
   * land below the list's scroll edge, so without a word it can look as if nothing happened.
   */
  const removeShoot = (index) => setShoots((current) => current.filter((_, rowIndex) => rowIndex !== index));
  const duplicateShoot = (index) => setShoots((current) => {
    if (!current[index]) return current;
    const copy = { ...structuredClone(current[index]), isMainEvent: false };
    return [...current.slice(0, index + 1), copy, ...current.slice(index + 1)];
  });
  const rowName = (index) => shootDisplayName(shoots[index]) || "Shoot";
  function duplicateRow(index) {
    duplicateShoot(index);
    setNotice(`${rowName(index)} duplicated - the copy is row ${index + 2}.`);
  }
  function removeRow(index) {
    removeShoot(index);
    setNotice(`${rowName(index)} removed from the list.`);
  }

  function addCurrentShoot() {
    setNotice("");
    setError("");
    const built = formRows();
    if (built.invalid) return;
    const { rows, skipped } = withoutDuplicates(built.rows, shoots);
    if (!rows.length) {
      setError(alreadyListed(skipped));
      return;
    }
    setShoots((current) => appendRows(current, rows));
    setCurrentShoot(emptyShoot());
    setSelectedShoots([]);
    setCustomTextByShoot({});
    setLocationMode("Single");
    setLocationsByShoot({});
    setLocationErrorsShown(false);
    setError("");
    setNotice(skipped.length ? `${alreadyListed(skipped)} ${rows.length === 1 ? "The other one was" : "The others were"} added.` : "");
  }

  async function save() {
    /*
     * Editing builds its one row the same way adding builds each of its own (`formRows`): the ticked
     * names joined into the shoot's name, each name's Additional Text carried across, and the length
     * of the joined name checked. It used to take `normalizedShoot()` straight, which held whatever
     * single name the old picker had set - so a shoot named for two could not be re-named here.
     */
    let rows = [];
    if (isEdit) {
      setError("");
      const built = formRows();
      if (built.invalid) return;
      rows = built.rows;
    } else {
      rows = shoots;
    }
    if (!isEdit && (hasCurrentValues || selectedShoots.length)) {
      setError("");
      const built = formRows();
      if (built.invalid) return;
      const { rows: fresh, skipped } = withoutDuplicates(built.rows, rows);
      // Nothing typed is dropped on the way out: a shoot already listed is named, and nothing saves.
      if (skipped.length) {
        setError(`${alreadyListed(skipped)} Take ${skipped.length === 1 ? "it" : "them"} out of the Shoot field, then save.`);
        return;
      }
      rows = appendRows(rows, fresh);
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
    title={isEdit ? "Edit Shoot" : copyOf ? "Duplicate Shoot" : "Add Shoot"}
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
          {/* Several at once, as chips that keep the field one line high; the menu stays open while
              they are ticked. On Add Shoot each becomes its own row on Add Shoot List; **editing**
              one shoot, the ticked names are that one shoot's name - "Haldi + Mehandi" - which is
              why it is the same tick-list here and not a single picker: a shoot named for two was
              otherwise impossible to re-name without typing the joined name by hand. */}
          <MultiSelectField
            label="Shoot"
            required
            searchable
            placeholder="Search or select shoots"
            helperText={multipleLocations
              ? "The details below apply to every shoot selected here, except the place, which each shoot has its own of."
              : isEdit
                ? selectedShoots.length > 1
                  ? `This shoot is named for all of them - "${selectedShoots.join(SHOOT_NAME_SEPARATOR)}". Choose Multiple under Location to give each its own place.`
                  : "The kind of shoot, such as Haldi or Wedding. Tick more than one to name this shoot for all of them."
                : selectedShoots.length > 1
                  ? "The details below apply to every shoot selected here. Choose Multiple under Location to give each its own place."
                  : "The details below apply to every shoot selected here."}
            values={selectedShoots}
            onChange={chooseShoots}
            error={fields.errors.shoot}
            options={offeredShoots.map((option) => ({ label: option, value: option }))}
          />
          <RadioGroupField label="Shoot Type" required helperText="Whether the shoot is at the studio or out on location." name="shootTypes" value={shootTypesOf(currentShoot)[0] || "Studio / In-House"} options={shootTypeOptions} onChange={(value) => update("shootTypes", [value])} error={fields.errors.shootTypes} className="text-[11px] font-semibold text-slate-600 sm:text-xs" controlClassName={radioControlClassName} />
          {/* Asked only once the shoot is two or more names: one place for all of them, or one each. A
              row of its own, so Date and Duration below still sit side by side. */}
          {asksLocationMode && <RadioGroupField label="Location" required helperText="One place for all the shoots selected, or a separate place for each." name="locationMode" value={locationMode} options={LOCATION_MODES} onChange={chooseLocationMode} className="text-[11px] font-semibold text-slate-600 sm:text-xs md:col-span-2" controlClassName={radioControlClassName} />}
          {multipleLocations
            // A Shoot Place, District and State for each name, in the name's order, under its name.
            ? <fieldset className="text-[11px] font-semibold text-slate-600 sm:text-xs md:col-span-2">
              <legend className="w-full border-b border-slate-200 pb-1.5 uppercase tracking-wide">Place for each shoot</legend>
              {/* Each shoot closed by the same hairline as the legend above, so one shoot's place is
                  never read as the next one's. */}
              <div className="mt-3 space-y-4">
                {locationShoots.map((name, index) => {
                  const location = locationOf(name);
                  const nameId = `${locationGroupId}-${index}`;
                  return <div key={name} role="group" aria-labelledby={nameId} className="border-b border-slate-200 pb-4">
                    <p id={nameId} className="break-words text-sm font-semibold text-slate-800">{name}</p>
                    <div className="mt-2 grid gap-x-6 gap-y-3 md:grid-cols-3">
                      <TextField label="Shoot Place" required helperText="The venue or area where this shoot happens." error={locationErrorsShown && !String(location.shootPlace || "").trim() ? `Enter the Shoot Place for ${name}.` : ""} value={location.shootPlace} onChange={(event) => updateLocation(name, "shootPlace", event.target.value)} />
                      <ComboBoxField label="District" helperText="Pick or type the district; choosing one fills the state in." placeholder="Select or enter district" value={location.district} onChange={(value) => updateLocation(name, "district", value)} options={districtOptions} />
                      <ComboBoxField label="State" helperText="The state the shoot place is in." placeholder="Select or enter state" value={location.state} onChange={(value) => updateLocation(name, "state", value)} options={stateOptions} />
                    </div>
                  </div>;
                })}
              </div>
            </fieldset>
            : <>
              <TextField label="Shoot Place" required helperText="The venue or area where the shoot happens." value={currentShoot.shootPlace} onChange={(event) => update("shootPlace", event.target.value)} error={fields.errors.shootPlace} />
              <ComboBoxField label="District" helperText="Pick or type the district; choosing one fills the state in." placeholder="Select or enter district" value={currentShoot.district} onChange={(value) => update("district", value)} options={districtOptions} />
              <ComboBoxField label="State" helperText="The state the shoot place is in." placeholder="Select or enter state" value={currentShoot.state} onChange={(value) => update("state", value)} options={stateOptions} />
            </>}
          <RadioGroupField label="Session Timing" required helperText="How the shoot is booked; this decides the Duration beside it." name="sessionTimings" value={shootTimingsOf(currentShoot)[0] || "Hourly"} options={sessionTimingOptions} onChange={(value) => update("sessionTimings", [value])} error={fields.errors.sessionTimings} className="text-[11px] font-semibold text-slate-600 sm:text-xs" controlClassName={radioControlClassName} />
          {/* The pair that closes the shoot's own details: the date question on the left, and
              Duration beside it on the right, directly under the Session Timing that decides it.
              Duration sat alone on the left before this with an empty half-row beside it. */}
          <ShootDateField shoot={currentShoot} onChange={update} error={fields.errors.dateCreated} />
          <DurationField shoot={currentShoot} onDurationChange={updateDurationField} error={fields.errors.duration} />
          {/* Four across on a wide screen when Preference is among them, three when it is not, so
              the row fills its width either way instead of leaving a gap where it would have sat. */}
          <div className={`grid gap-6 md:col-span-2 md:grid-cols-2 ${wedding ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
            <CareOwnerField label="Food Taken Care by" required helperText="Who arranges the crew's food on the shoot day." name="foodTakenCareBy" value={currentShoot.foodTakenCareBy} onChange={(value) => update("foodTakenCareBy", value)} error={fields.errors.foodTakenCareBy} />
            <CareOwnerField label="Accommodation" required helperText="Who arranges the crew's stay if one is needed." name="accommodation" value={currentShoot.accommodation} onChange={(value) => update("accommodation", value)} error={fields.errors.accommodation} />
            <CareOwnerField label="Travel" required helperText="Who arranges the crew's travel to the shoot venue." name="travel" value={currentShoot.travel} onChange={(value) => update("travel", value)} error={fields.errors.travel} />
            {/* Weddings only - a baby shoot has no groom's side to follow. The same radio group the
                three beside it use, so the row reads as one set of choices rather than three of one
                kind and one of another. */}
            {wedding && <RadioGroupField
              label="Preference"
              required
              helperText="Whose side the crew follows: the groom, the bride or both."
              name="preference"
              value={currentShoot.preference || defaultShootPreference}
              options={shootPreferenceOptions}
              onChange={(value) => update("preference", value)}
              error={fields.errors.preference}
              className="text-[11px] font-semibold text-slate-600 sm:text-xs"
              controlClassName={radioControlClassName}
            />}
          </div>
          {/* One optional box per selected shoot, each printed beside its own shoot's name. */}
          {allowCustomText && textShoots.length > 0 && <fieldset className="text-[11px] font-semibold text-slate-600 sm:text-xs md:col-span-2">
            <legend className="flex w-full items-center justify-between gap-3 border-b border-slate-200 pb-1.5 uppercase tracking-wide">
              <span>Additional Text</span>
              <span className="font-normal normal-case tracking-normal text-slate-500">Optional</span>
            </legend>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {textShoots.map((name, index) => <TextField
                key={name}
                label={name}
                helperText="Optional words printed beside this shoot's name on the quotation."
                placeholder={index === 0 ? "e.g. Bride Varatham" : "Optional additional text"}
                maxLength={CUSTOM_TEXT_MAX_LENGTH}
                value={customTextByShoot[name] || ""}
                onChange={(event) => { const value = event.target.value; setCustomTextByShoot((current) => ({ ...current, [name]: value })); }}
              />)}
            </div>
          </fieldset>}
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
        {(error || fields.summary) && <p role="alert" className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error || fields.summary}</p>}
        {!error && !fields.summary && notice && <p role="status" className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{notice}</p>}
        {/*
          * The list keeps its own width and scrolls sideways when it is wider than the dialog; only
          * the actions column is held at the right edge of that one scroll area, so a shoot's ⋯ is
          * in view however far the row is scrolled. Past a dozen or so rows the same area scrolls down
          * as well, so the dialog does not grow taller than the screen.
          */}
        {!isEdit && <SimpleTable
          variant="form"
          classNames={{ wrapper: "mt-6 !rounded-md max-h-[min(24rem,50dvh)] overflow-y-auto", table: "min-w-full text-sm", head: "!text-sm !tracking-normal", th: "whitespace-nowrap !py-2.5", row: "text-slate-700", td: "whitespace-nowrap !py-2.5", empty: "!py-8" }}
          columns={[
            // Capped: a shoot named for several at once ends in "..." rather than widening the list.
            { key: "shoot", label: "Shoot", maxWidth: NAME_COLUMN_MAX_WIDTH, title: (shoot) => shootDisplayName(shoot), render: (shoot) => shootDisplayName(shoot) },
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
            /*
             * The row's actions behind a ⋯, pinned to the right on the row's own white, with a
             * hairline and a faint shadow on its left so the columns scrolling under it read as
             * passing beneath. The trigger's negative margin and text-bottom alignment keep the row
             * exactly the height it was. The menu opens above the dialog, closes on Escape or a
             * click elsewhere, and only one is ever open.
             */
            { key: "actions", label: "Actions", srOnly: true, headerClassName: "sticky right-0 z-[1] w-10 bg-slate-50 shadow-[inset_1px_0_0_#e2e8f0,-6px_0_8px_-6px_rgba(15,23,42,0.12)]", cellClassName: "sticky right-0 z-[1] w-10 bg-white text-center shadow-[inset_1px_0_0_#e2e8f0,-6px_0_8px_-6px_rgba(15,23,42,0.12)]", render: (shoot, index) => <OptionsMenu
              // The row's number as well as its name: a copy shares its row's name.
              ariaLabel={`Actions for row ${index + 1}, ${shootDisplayName(shoot) || "shoot"}`}
              triggerContent="⋯"
              triggerClassName="-my-2 align-text-bottom"
              menuClassName="w-36"
              menuZIndexClassName="z-[170]"
              items={[
                { label: "Duplicate", onSelect: () => duplicateRow(index) },
                { label: "Remove", tone: "danger", onSelect: () => removeRow(index) },
              ]}
            /> },
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
