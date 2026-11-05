import { matchesWordChunks } from "./wordChunks.mjs";

/**
 * A project's Activity tab - its whole flow, enquiry to feedback (`backend/src/services/projectFlow.js`).
 * The stages in the order a project lives through them, each with the label and the colour its chip
 * carries everywhere (`tone` for chips, `hex` for the flow line's nodes), so a stage reads the same
 * on every line, in the journey strip and in the filter. `waitsFor` finishes the sentence "It fills in
 * when ..." - what puts the first line in a stage the project has not reached, told when one is pressed.
 */
export const FLOW_STAGES = [
  { id: "ENQUIRY", label: "Enquiry", tone: "bg-sky-50 text-sky-700 ring-sky-200", hex: "#0284c7", waitsFor: "the lead comes in, and as calls, remarks and meetings are logged on it in the CRM" },
  { id: "QUOTATION", label: "Quotation", tone: "bg-indigo-50 text-indigo-700 ring-indigo-200", hex: "#4f46e5", waitsFor: "a quotation is raised for this enquiry, or its link is renewed" },
  { id: "BOOKING", label: "Booking", tone: "bg-violet-50 text-violet-700 ring-violet-200", hex: "#7c3aed", waitsFor: "the enquiry is converted and booked as a project" },
  { id: "PAYMENTS", label: "Payments", tone: "bg-emerald-50 text-emerald-700 ring-emerald-200", hex: "#059669", waitsFor: "money is recorded against the project in Accounts, or an extra is requested" },
  { id: "PROJECT", label: "Project", tone: "bg-slate-100 text-slate-700 ring-slate-200", hex: "#475569", waitsFor: "the project's stages are updated or its services and deliverables are changed" },
  { id: "PRE_PRODUCTION", label: "Pre Production", tone: "bg-amber-50 text-amber-800 ring-amber-200", hex: "#b45309", waitsFor: "the team plans a shoot in Pre Production - crew, schedule, venue details" },
  { id: "PRODUCTION", label: "Production", tone: "bg-orange-50 text-orange-700 ring-orange-200", hex: "#ea580c", waitsFor: "a shoot is worked in Production - the team leaving, reaching, starting and completing it" },
  { id: "IMAGE_SELECTION", label: "Image Selection", tone: "bg-pink-50 text-pink-700 ring-pink-200", hex: "#db2777", waitsFor: "an Image Selection project is made, its gallery is published, or the client opens or submits it" },
  { id: "FEEDBACK", label: "Feedback", tone: "bg-teal-50 text-teal-700 ring-teal-200", hex: "#0d9488", waitsFor: "the client's feedback is recorded for a shoot or the project" },
  { id: "GIFTS", label: "Client Gifts", tone: "bg-rose-50 text-rose-700 ring-rose-200", hex: "#e11d48", waitsFor: "a client gift is marked sent, or received by the client" },
];
const BY_ID = new Map(FLOW_STAGES.map((stage) => [stage.id, stage]));
// A stage this screen does not know yet reads as words, "SOME_STAGE" → "Some Stage", in the neutral tone.
const titleCase = (id) => String(id || "Other").toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
export const stageOf = (id) => BY_ID.get(id) || { id, label: titleCase(id), tone: "bg-slate-100 text-slate-700 ring-slate-200", hex: "#475569" };

/**
 * The project's journey, for the flow strip over the timeline: every stage in flow order, each with
 * how many lines it holds in these entries, so the stages already reached light up and those still
 * ahead stay grey - where the project is, read left to right.
 */
export function flowJourney(entries) {
  const counts = new Map();
  for (const entry of entries) counts.set(entry.stage, (counts.get(entry.stage) || 0) + 1);
  const extra = [...counts.keys()].filter((id) => !BY_ID.has(id)).map(stageOf);
  return [...FLOW_STAGES, ...extra].map((stage) => ({ ...stage, count: counts.get(stage.id) || 0 }));
}

/** The stages and the people present in these lines, for the two filters - stages in flow order. */
export function flowFacets(entries) {
  const present = new Set(entries.map((entry) => entry.stage));
  const stages = [...FLOW_STAGES.filter((stage) => present.has(stage.id)), ...[...present].filter((id) => !BY_ID.has(id)).map(stageOf)]
    .map((stage) => ({ value: stage.id, label: stage.label }));
  const people = [...new Set(entries.map((entry) => entry.by).filter(Boolean))].sort((a, b) => a.localeCompare(b))
    .map((name) => ({ value: name, label: name }));
  return { stages, people };
}

/** The lines matching the search (word chunks over every field a line shows) and both filters. */
export function filterFlow(entries, { query = "", stages = [], people = [] } = {}) {
  return entries.filter((entry) => (!stages.length || stages.includes(entry.stage))
    && (!people.length || people.includes(entry.by))
    && matchesWordChunks([entry.title, entry.detail, entry.by, entry.shoot, stageOf(entry.stage).label].filter(Boolean).join(" "), query));
}

const dayKey = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
};
const dayHeading = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Undated";
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" }).format(date);
};

/** Lines (already newest first) grouped by the local day they happened on: `[{ key, heading, entries }]`. */
export function groupByDay(entries) {
  const groups = [];
  for (const entry of entries) {
    const key = dayKey(entry.at);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.entries.push(entry);
    else groups.push({ key, heading: dayHeading(entry.at), entries: [entry] });
  }
  return groups;
}

/** A line's time of day, "14:05". */
export function timeOfDay(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(date);
}
