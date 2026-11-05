"use client";

import { useState } from "react";
import DateField from "@/components/shared/DateField";
import Dropdown from "@/components/shared/Dropdown";
import { customRangeProblem, dayKey, DEFAULT_PRESET, fromKey, presetRange, RANGE_PRESETS, shortDate } from "@/lib/shootBoard.mjs";

/*
 * The Dates filter of the boards that read shoots over a range of days - the Shoot Board and the
 * Production Schedule: a preset looking ahead (Next 30 days by default) or Custom From / To up to 92
 * days. `useShootDateRange` holds it; `ShootDateRangeFilter` draws it from what the hook answers.
 */
const REVERSED = "The last day comes before the first.";
// A custom day as a person reads it: "5 Oct 2026".
const dateLabel = (key) => { const day = fromKey(key); return `${shortDate(day)} ${day.getFullYear()}`; };

/**
 * `range` `{ from, to }` is the one in use; a custom pair is taken into it only once it is a valid
 * range, its problem said on the field (`customProblem`). `reset` goes back to the default preset,
 * and `changed` says it is not on it.
 *
 * `presets` and `defaultPreset` are for a screen that offers other choices than the Shoot Board's: an
 * `ALL_DATES` preset has no range (`range` null) - every date, the Production Schedule's default - and
 * a preset may bring its own `range()`, such as `UPCOMING`: from today, with no last day (`to` null).
 */
export const ALL_DATES = "all";
export const UPCOMING = { value: "upcoming", label: "Upcoming", range: () => ({ from: fromKey(dayKey(new Date())), to: null }) };
/**
 * The shoots with no date yet, and only those: a range with no days (`undated`), which a screen that
 * offers it reads as "keep the undated" rather than as a span of days.
 */
export const UNKNOWN_DATE = { value: "unknown", label: "Unknown date", range: () => ({ undated: true }) };

export function useShootDateRange({ presets = RANGE_PRESETS, defaultPreset = DEFAULT_PRESET } = {}) {
  const rangeOf = (value) => (value === ALL_DATES ? null : presets.find((option) => option.value === value)?.range?.() || presetRange(value));
  const [preset, setPreset] = useState(defaultPreset);
  const [range, setRange] = useState(() => rangeOf(defaultPreset));
  // The two custom boxes as typed; `range` takes them only once they make a valid range. Upcoming has
  // no last day and Unknown date no days at all, so the boxes start from what there is.
  const [custom, setCustom] = useState(() => (range?.from ? { from: dayKey(range.from), to: dayKey(range.to || range.from) } : { from: "", to: "" }));

  function choosePreset(value) {
    setPreset(value);
    if (value === ALL_DATES) { setRange(null); return; }
    const next = rangeOf(value);
    if (next) setRange(next);
    // Custom starts from the range already on screen, so the boxes are never blank - from today, after
    // All dates or Unknown date, which have no days to start from.
    else setCustom(range?.from ? { from: dayKey(range.from), to: dayKey(range.to || range.from) } : { from: dayKey(new Date()), to: dayKey(new Date()) });
  }

  const customProblem = preset === "custom" ? customRangeProblem(custom.from && fromKey(custom.from), custom.to && fromKey(custom.to)) : "";
  function changeCustom(end, key) {
    const next = { ...custom, [end]: key || "" };
    setCustom(next);
    if (!customRangeProblem(next.from && fromKey(next.from), next.to && fromKey(next.to))) setRange({ from: fromKey(next.from), to: fromKey(next.to) });
  }

  function reset() {
    setPreset(defaultPreset);
    setRange(rangeOf(defaultPreset));
  }

  return { presets, preset, range, custom, customProblem, choosePreset, changeCustom, reset, changed: preset !== defaultPreset };
}

export default function ShootDateRangeFilter({ dates }) {
  const { presets = RANGE_PRESETS, preset, custom, customProblem, choosePreset, changeCustom } = dates;
  return <>
    <Dropdown hideLabel label="Dates" className="w-full sm:w-44" value={preset} onChange={choosePreset} options={presets} searchable={false} sorted={false} />
    {/*
      * Custom dates: the two days as one group on the same line, read as dates, a dash
      * between.
      *
      * **Neither box greys a day out.** `To` used to be held to `From` and to the 92nd day
      * after it, so with a From in the past most of the calendar was unpickable and nothing
      * said why - and picking an earlier From meant clearing To first. The rule is a sentence
      * on the field instead (`customRangeProblem`), and a pair that does not make a range
      * simply leaves the board on the one it is showing.
      */}
    {preset === "custom" && <div role="group" aria-label="Custom dates" className="flex w-full items-start gap-1.5 sm:w-auto">
      <DateField hideLabel label="From" placeholder="From" formatValue={dateLabel} className="min-w-0 flex-1 sm:w-40 sm:flex-none" value={custom.from} onChange={(key) => changeCustom("from", key)} error={customProblem && customProblem !== REVERSED ? customProblem : ""} />
      <span aria-hidden="true" className="flex min-h-9 items-center text-slate-400">–</span>
      <DateField hideLabel label="To" placeholder="To" formatValue={dateLabel} className="min-w-0 flex-1 sm:w-40 sm:flex-none" value={custom.to} onChange={(key) => changeCustom("to", key)} error={customProblem === REVERSED ? customProblem : ""} />
    </div>}
  </>;
}
