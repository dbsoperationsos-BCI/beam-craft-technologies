"use client";

import EventCover from "@/components/ai-feature/shared/EventCover";
import SettingsGroupForm, { Section } from "@/components/ai-feature/shared/SettingsGroupForm";
import { formatEventDate, formatEventRange, formatTime } from "@/lib/aiFeature.mjs";
import { eventTypeOf } from "./DetailsStep";

function Fact({ label, value }) {
  if (!value) return null;
  return <div className="min-w-0">
    <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</dt>
    <dd className="mt-0.5 break-words text-sm text-slate-800">{value}</dd>
  </div>;
}

/**
 * The last step: everything the wizard is about to send, read back in one place. Nothing here is
 * editable; the rail goes back to the step that owns a value.
 */
export default function ReviewStep({ details, subEvents, settings, existingCoverUrl }) {
  const cover = details.coverImage === undefined ? existingCoverUrl : details.coverImage;
  return <div className="space-y-6">
    <Section title="Event details">
      <div className="flex gap-3">
        <EventCover src={cover} name={details.name} className="h-20 w-20 shrink-0 rounded-md sm:h-24 sm:w-24" />
        <dl className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
          <Fact label="Name" value={details.name} />
          <Fact label="Type" value={eventTypeOf(details)} />
          <Fact label="Dates" value={formatEventRange(details.startDate, details.endDate)} />
          <Fact label="Timezone" value={details.timezone} />
          <Fact label="Location" value={details.location} />
          <Fact label="Description" value={details.description} />
        </dl>
      </div>
    </Section>
    <Section title={`Sub-events (${subEvents.length})`}>
      {subEvents.length === 0
        ? <p className="text-xs text-slate-500">None - the event is one gallery.</p>
        : <ol className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {subEvents.map((row, index) => <li key={row.id} className="flex gap-3 px-3 py-2">
            <span className="w-5 shrink-0 text-xs tabular-nums text-slate-400">{index + 1}.</span>
            <div className="min-w-0">
              <p className="text-sm text-slate-800">{row.name}</p>
              <p className="text-[11px] text-slate-500">{[formatEventDate(row.date), [formatTime(row.startTime), formatTime(row.endTime)].filter(Boolean).join(" – "), row.location].filter(Boolean).join(" · ")}</p>
            </div>
          </li>)}
        </ol>}
    </Section>
    <SettingsGroupForm values={settings} onChange={() => {}} readOnly />
  </div>;
}
