"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Loader from "@/components/shared/Loader";
import HelpTip from "@/components/shared/HelpTip";
import SearchField from "@/components/shared/SearchField";
import MultiSelectField from "@/components/shared/MultiSelectField";
import Button from "@/components/shared/Button";
import IconButton from "@/components/shared/IconButton";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import CloseIcon from "@mui/icons-material/Close";
import JourneyStrip from "@/components/shared/JourneyStrip";
import { filterFlow, flowFacets, flowJourney, groupByDay, stageOf, timeOfDay } from "@/lib/projectFlow.mjs";
import { initialsOf, tint } from "@/lib/boardTone.mjs";
import SupportAgentOutlinedIcon from "@mui/icons-material/SupportAgentOutlined";
import RequestQuoteOutlinedIcon from "@mui/icons-material/RequestQuoteOutlined";
import EventAvailableOutlinedIcon from "@mui/icons-material/EventAvailableOutlined";
import PaymentsOutlinedIcon from "@mui/icons-material/PaymentsOutlined";
import FolderSpecialOutlinedIcon from "@mui/icons-material/FolderSpecialOutlined";
import LightbulbOutlinedIcon from "@mui/icons-material/LightbulbOutlined";
import PhotoCameraOutlinedIcon from "@mui/icons-material/PhotoCameraOutlined";
import CollectionsOutlinedIcon from "@mui/icons-material/CollectionsOutlined";
import RateReviewOutlinedIcon from "@mui/icons-material/RateReviewOutlined";
import CardGiftcardOutlinedIcon from "@mui/icons-material/CardGiftcardOutlined";
import TimelineOutlinedIcon from "@mui/icons-material/TimelineOutlined";

// The picture beside the flow where a stage begins: what the studio is doing at that point.
const STAGE_ICONS = {
  ENQUIRY: SupportAgentOutlinedIcon, QUOTATION: RequestQuoteOutlinedIcon, BOOKING: EventAvailableOutlinedIcon,
  PAYMENTS: PaymentsOutlinedIcon, PROJECT: FolderSpecialOutlinedIcon, PRE_PRODUCTION: LightbulbOutlinedIcon,
  PRODUCTION: PhotoCameraOutlinedIcon, IMAGE_SELECTION: CollectionsOutlinedIcon, FEEDBACK: RateReviewOutlinedIcon,
  GIFTS: CardGiftcardOutlinedIcon,
};

/** Who did a step: their initials in the stage's colour, or a dot for the system. */
function StepPerson({ by, hex }) {
  return <span className="flex min-w-0 items-center gap-2">
    {by
      ? <span title={by} style={{ backgroundColor: tint(hex, 0.14), color: hex }} className="flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold">{initialsOf(by)}</span>
      : <span title="Recorded by the system" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-500">•</span>}
    <span className="truncate text-xs text-slate-600">{by || "System"}</span>
  </span>;
}

/**
 * A project's whole flow, from the enquiry that started it to delivery and feedback, oldest to newest -
 * the Activity tab of a project wherever its panel is shown. The server merges every stage and
 * leaves out the stages the viewer may not see (`backend/src/services/projectFlow.js`); this draws
 * them as a flow: a journey strip of every stage joined by arrows (reached stages lit, the rest still
 * ahead), then one line down the middle, oldest at the top, through a ringed node in each step's stage colour, through a node in each step's stage colour and
 * an arrow into the next, with the person who did it as an avatar on each card. Search and the Stage and Person filters narrow both.
 *
 * Another record's flow draws the same way - a client request, an offer, an invitation design: `stages`
 * is then its own journey (`[{ id, label, hex, icon?, waitsFor? }]`) in place of the project's, and
 * `heading` / `emptyText` / `searchPlaceholder` its own words. Without them it is the project's flow.
 *
 * `load()` fetches the lines (`{ data: [{ id, stage, at, title, detail, by, shoot }] }`); it is asked
 * again whenever `refreshKey` changes or Retry is pressed - never because the caller handed a new
 * function, which is held in a ref so an unstable callback cannot loop the request.
 */
export default function ProjectActivityTab({ load, refreshKey, onError, stages: ownStages, heading = "Project flow, oldest first", emptyText, searchPlaceholder = "Search activity, e.g. advance, reception, Priya" }) {
  const loadRef = useRef(load);
  const onErrorRef = useRef(onError);
  useEffect(() => { loadRef.current = load; onErrorRef.current = onError; }, [load, onError]);
  const [entries, setEntries] = useState(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [stages, setStages] = useState([]);
  const [people, setPeople] = useState([]);
  // The stage not reached yet whose note is open under the journey strip.
  const [explained, setExplained] = useState(null);
  useEffect(() => {
    let live = true;
    loadRef.current()
      .then((response) => { if (live) { setFailed(false); setEntries(Array.isArray(response?.data) ? response.data : []); } })
      .catch((error) => { if (live) { setFailed(true); setEntries([]); onErrorRef.current?.(error.message || "Unable to load the activity."); } });
    return () => { live = false; };
  }, [refreshKey, attempt]);
  const retry = () => { setEntries(null); setAttempt((count) => count + 1); };

  const all = useMemo(() => entries || [], [entries]);
  // A record's own stages when it has them, else the project's.
  const catalog = useMemo(() => new Map((ownStages || []).map((stage) => [stage.id, stage])), [ownStages]);
  const stageFor = (id) => catalog.get(id) || stageOf(id);
  const facets = useMemo(() => {
    const found = flowFacets(all);
    return ownStages ? { ...found, stages: found.stages.map((option) => ({ ...option, label: catalog.get(option.value)?.label || option.label })) } : found;
  }, [all, ownStages, catalog]);
  const journey = useMemo(() => (ownStages
    ? ownStages.map((stage) => ({ ...stage, count: all.filter((entry) => entry.stage === stage.id).length }))
    : flowJourney(all)), [all, ownStages]);
  const toggleStage = (id) => setStages((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  const shown = useMemo(() => filterFlow(all, { query, stages, people }), [all, query, stages, people]);
  // Top to bottom, oldest first, as the project lived it; a step that opens a new stage carries its picture.
  const steps = useMemo(() => groupByDay(shown).reverse()
    .flatMap((group) => [...group.entries].reverse().map((entry) => ({ entry, day: group.heading })))
    .map((step, index, all) => ({ ...step, opensStage: index === 0 || all[index - 1].entry.stage !== step.entry.stage })), [shown]);
  const filtered = Boolean(query.trim() || stages.length || people.length);
  const clear = () => { setQuery(""); setStages([]); setPeople([]); };
  // A step's ring and picture: pressed, the flow shows only that stage; pressed again, every stage.
  const stageButton = (id) => {
    const only = stages.length === 1 && stages[0] === id;
    const label = only ? "Show every stage again" : `Show only ${stageFor(id).label} steps`;
    return { label, title: label, "aria-pressed": only, onClick: () => setStages(only ? [] : [id]) };
  };

  if (!entries) return <Loader label="Loading activity..." className="p-6" />;
  if (failed) return <div className="p-4 text-sm text-slate-600" role="alert">
    <p>Couldn’t load the activity. Check your connection and try again.</p>
    <Button type="button" variant="secondary" className="mt-3" onClick={retry}>Retry</Button>
  </div>;
  if (!all.length) return <p className="p-4 text-sm text-slate-500">{emptyText || "Nothing has been recorded on this project yet. Every step it goes through - enquiry, quotation, booking, payments, planning, shoots, gallery and feedback - is drawn here as a flow, oldest first."}</p>;

  // A container: the tab is shown in panes of very different widths (a full-screen record, a pane beside
  // follow-ups), so the two-sided flow is chosen by the width it is given, not by the window's.
  return <div className="@container p-3 sm:p-4">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h3 className="flex items-center text-sm font-semibold text-slate-800">
        {heading}
        <HelpTip text="Everything that has happened to this project, oldest at the top: each step is a ring on the line, in its stage's colour, with what happened on the left and who did it and when on the right. Press a ring or a stage's picture to see only that stage, and again to see every stage. Stages your role cannot open are not listed." />
      </h3>
      <span className="text-xs text-slate-500" aria-live="polite">{filtered ? `${shown.length} of ${all.length}` : `${all.length} ${all.length === 1 ? "entry" : "entries"}`}</span>
    </div>
    {/* The project's journey: every stage joined by arrows, lit where the project has been. A press
        narrows the timeline to that stage (and again to show every stage). */}
    <JourneyStrip
      ariaLabel="Project journey"
      steps={journey.map((stage) => ({ id: stage.id, label: stage.label, color: stage.hex, count: stage.count }))}
      selected={stages}
      onToggle={toggleStage}
      onExplain={(id) => setExplained((current) => (current === id ? null : id))}
      explained={explained}
      noun="step"
    />
    {/* Why a stage is still grey: nothing is recorded in it yet, and what will put the first line there. */}
    {explained && !journey.find((stage) => stage.id === explained)?.count && <div role="status" className="mb-4 flex items-start gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-600">
      <InfoOutlinedIcon aria-hidden="true" sx={{ fontSize: 20 }} className="mt-px shrink-0 text-slate-400" />
      <p className="min-w-0 flex-1">
        <span className="font-semibold text-slate-800">{stageFor(explained).label}</span>: nothing is recorded {ownStages ? "here" : "on this project"} yet.
        {stageFor(explained).waitsFor && ` It fills in when ${stageFor(explained).waitsFor}.`} A stage your role cannot open also stays grey.
      </p>
      <IconButton onClick={() => setExplained(null)} label="Hide this note" size="sm" className="-my-1 shrink-0 text-slate-500"><CloseIcon aria-hidden="true" sx={{ fontSize: 18 }} /></IconButton>
    </div>}
    <div className="mb-5 grid gap-2 @2xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
      <SearchField value={query} onChange={setQuery} ariaLabel="Search this project's activity" placeholder={searchPlaceholder} />
      <MultiSelectField label="Stage" hideLabel placeholder="All stages" options={facets.stages} values={stages} onChange={setStages} />
      <MultiSelectField label="Person" hideLabel placeholder="Everyone" options={facets.people} values={people} onChange={setPeople} searchable={facets.people.length > 8} />
    </div>
    {!shown.length ? <div className="rounded-md border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
      <p className="break-words">{query.trim() ? `No activity matches “${query.trim()}”.` : "No activity matches these filters."}</p>
      <Button type="button" variant="secondary" className="mt-3" onClick={clear}>Clear search and filters</Button>
    </div> : <ol aria-label={heading} className="mx-auto max-w-5xl">
      {steps.map(({ entry, day, opensStage }, index) => {
        const stage = stageFor(entry.stage);
        const Icon = STAGE_ICONS[entry.stage] || stage.icon || TimelineOutlinedIcon;
        const last = index === steps.length - 1;
        return <li key={entry.id} className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-3 @3xl:grid-cols-[minmax(0,1fr)_3.5rem_minmax(0,1fr)] @3xl:gap-x-6">
          {/* What happened: the stage in its colour, the step in bold, its detail beneath - left of the line in a wide pane. */}
          <div className="order-2 min-w-0 pb-6 @3xl:order-1 @3xl:justify-self-end @3xl:pt-1.5 @3xl:text-right">
            <p style={{ color: stage.hex }} className="text-xs font-semibold">{stage.label}</p>
            <p className="mt-0.5 break-words text-base font-semibold text-slate-800">{entry.title}</p>
            {entry.detail && <p className="mt-1 break-words text-sm text-slate-600">{entry.detail}</p>}
            {entry.shoot && <p className="mt-0.5 break-words text-sm text-slate-600">{entry.shoot}</p>}
            {/* In a narrow pane there is no right-hand side, so who and when follow the words. */}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 @3xl:hidden">
              <StepPerson by={entry.by} hex={stage.hex} />
              <span className="text-xs tabular-nums text-slate-500">{day} · <time dateTime={entry.at}>{timeOfDay(entry.at)}</time></span>
            </div>
          </div>
          {/* The line: a ringed node in the stage's colour, and the line down to the next step in it too.
              The ring is pressable - it narrows the flow to its stage, as the journey strip does. */}
          <div className="relative order-1 flex justify-center @3xl:order-2">
            {!last && <span aria-hidden="true" style={{ backgroundColor: stage.hex }} className="absolute bottom-0 left-1/2 top-4 w-1 -translate-x-1/2 rounded-full" />}
            <IconButton {...stageButton(entry.stage)} variant="plain" shape="circle" size="sm" style={{ borderColor: stage.hex, boxShadow: `0 0 0 3px ${tint(stage.hex, stages.includes(entry.stage) ? 0.3 : 0.12)}` }} className="relative z-10 flex items-center justify-center border-[3px] bg-white transition-transform hover:scale-110">
              <span aria-hidden="true" style={{ backgroundColor: stage.hex }} className="size-3 rounded-full" />
            </IconButton>
          </div>
          {/* Right of the line in a wide pane: the stage's picture where the stage begins, then who did it and when. */}
          <div className="order-3 hidden min-w-0 flex-col items-start gap-2 pb-6 pt-1.5 @3xl:flex">
            {opensStage && <IconButton {...stageButton(entry.stage)} size="md" className="-m-1 hover:bg-slate-100"><Icon aria-hidden="true" style={{ color: stage.hex, fontSize: 32 }} /></IconButton>}
            <StepPerson by={entry.by} hex={stage.hex} />
            <span className="text-xs tabular-nums text-slate-500">{day} · <time dateTime={entry.at}>{timeOfDay(entry.at)}</time></span>
          </div>
        </li>;
      })}
    </ol>}
  </div>;
}
