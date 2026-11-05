"use client";

import { useEffect, useState } from "react";
import { dayLabel, workedDaysLabel } from "@/lib/attendanceTime.mjs";
import { getMyCompOffOptions } from "@/services/hrm/attendance.service";
import HelpTip from "@/components/shared/HelpTip";

/**
 * The day off a comp-off claims, and the weekly off or holiday worked that pays for it - chosen from
 * what the person actually has, not typed into a date box and refused afterwards.
 *
 * Each choice is **one day off**. Usually that is one day worked, granted a whole day by its
 * approvers. Where they granted only half a day it is **two** days worked, paired by the server
 * (`GET /requests/comp-off-options`), because there is no half day off to take - so the choice says
 * both days, says why they go together, and the radio sends both back.
 *
 * Saying **why** matters more than it looks. Somebody who earned half a day twice, weeks apart, is
 * being shown one row she must take or leave; told only that the two "make one day off" she reads the
 * app as bundling her days, so the line under it says a half day cannot be taken on its own.
 *
 * An odd half with nothing to pair with yet leads with what she **has**, in a plain notice rather
 * than a warning: half a day granted must not read as half a day lost. It names the day another half
 * has to be earned by, because a half left alone does lapse on its own expiry.
 *
 * Shared by HRM → Request's Raise Request form and the attendance screen's request dialog.
 */

const timeFormat = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" });

const displayTime = (value) => (value ? timeFormat.format(new Date(value)) : "");

/** What one worked day earned, where it is not the whole day the reader would assume. */
const earnedLabel = (earnedDays) => (Number(earnedDays) === 0.5 ? "half a day" : "");

/**
 * A choice's own identity: the days it spends, **sorted**, so the radio matches whatever order the
 * days arrive in - from the server, or from a request being applied for again.
 */
const keyOf = (...dates) => dates.filter(Boolean).slice().sort().join("+");

export default function CompOffWorkedDayPicker({ value, pairValue = "", onChange, disabled = false, error = "", helperText = "" }) {
  const [options, setOptions] = useState(null);
  const [pendingHalf, setPendingHalf] = useState(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let live = true;
    getMyCompOffOptions()
      .then((response) => {
        if (!live) return;
        setOptions(response?.data?.options || []);
        setPendingHalf(response?.data?.pendingHalf || null);
      })
      .catch((requestError) => { if (live) setLoadError(requestError?.data?.message || requestError?.message || "Unable to read the days you can claim."); });
    return () => { live = false; };
  }, []);

  const legend = <legend className="text-sm font-medium text-slate-700">
    Weekly Off / Holiday Worked<span aria-hidden="true" className="ml-0.5 text-rose-500">*</span><HelpTip text={helperText} />
  </legend>;

  /*
   * The odd half, said the same way wherever the list stands - with choices, or with none at all.
   *
   * Blue rather than amber: amber is this app's caution, and the load error below uses it, so dressing
   * a credit she has earned in the same colour told her something had gone wrong. `role="status"`
   * because it appears when the read finishes rather than when the page renders.
   */
  const waiting = pendingHalf
    ? <p role="status" className="mt-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-slate-700 sm:text-sm">
      You have <span className="font-medium">half a day</span> from {dayLabel(pendingHalf.date)}. It becomes a day off when you earn another half day - a half day cannot be taken on its own.
      {pendingHalf.expiresOn && <span className="mt-0.5 block font-medium text-amber-700">Earn another half day by {dayLabel(pendingHalf.expiresOn)}, or this half day expires.</span>}
    </p>
    : null;

  if (loadError) {
    return <fieldset>{legend}<p role="alert" className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{loadError}</p></fieldset>;
  }
  if (!options) return <fieldset>{legend}<p className="mt-2 text-sm text-slate-500">Loading the days you worked...</p></fieldset>;
  if (!options.length) {
    return <fieldset>{legend}
      {/* With a half day waiting, "you have no comp-off available" is the wrong first sentence: she
          has something, and the notice below says what completes it. */}
      <p className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
        {pendingHalf
          ? "No whole day off to claim yet."
          : "You have no comp-off available. A weekly off or holiday you worked a full day on becomes one once every one of your Leave Approvers has approved it - see Comp-Off Credit under your requests."}
      </p>
      {waiting}
    </fieldset>;
  }

  const chosen = keyOf(value, pairValue);
  const errorId = error ? "comp-off-worked-day-error" : undefined;

  return <fieldset>
    {legend}
    {/* The balance: each choice listed is one whole day off, however many days worked paid for it. */}
    <p className="mt-1 text-xs text-slate-500 sm:text-sm"><span className="font-semibold text-slate-700">{options.length}</span> comp-off {options.length === 1 ? "day" : "days"} available</p>
    <div className={`mt-2 overflow-hidden rounded-md border ${error ? "border-red-400" : "border-slate-300"}`}>
      <div className="hidden grid-cols-[1.5rem_1fr_1fr_1fr] gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 sm:grid">
        <span />
        <span>Date</span>
        <span>Day</span>
        <span>Working Hours</span>
      </div>
      <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
        {options.map((option) => {
          const key = keyOf(option.workedDate, option.workedPairDate);
          const checked = chosen === key;
          const paired = option.days.length > 1;
          const worked = option.days.map((day) => day.date);
          /*
           * What a screen reader hears when it lands on the radio. Without it the accessible name is
           * every word in the choice - the heading, both days, their weekdays, hours and clock times
           * run together - so the summary names the days, what they are worth and the expiry, and the
           * detail stays on screen for the eye.
           */
          const spoken = `${workedDaysLabel(worked)}${paired ? ", half a day each" : ""}, one day off${option.expiresOn ? `, use by ${dayLabel(option.expiresOn)}` : ""}`;
          return <li key={key}>
            {/* The whole choice is one grid, so the heading and the expiry line up under the days by
                construction rather than by a padding that has to be kept equal to the radio column. */}
            <label className={`grid cursor-pointer grid-cols-[1.5rem_1fr] gap-x-3 px-3 py-2.5 text-sm ${checked ? "bg-blue-50" : "hover:bg-slate-50"} ${disabled ? "cursor-not-allowed opacity-60" : ""}`}>
              {/* One radio for the choice, in the first column: picking a pair picks both its days. */}
              <input
                type="radio"
                name="compOffWorkedDate"
                value={key}
                checked={checked}
                disabled={disabled}
                aria-label={spoken}
                // No `aria-invalid`: the radio role does not support it. The error is reached through
                // `aria-describedby` instead, which a radio does carry.
                aria-describedby={errorId}
                onChange={() => onChange({ workedDate: option.workedDate, workedPairDate: option.workedPairDate || "", expiresOn: option.expiresOn || "", lastWorked: worked[worked.length - 1] })}
                className="col-start-1 row-start-1 mt-0.5 h-4 w-4 focus-visible:ring-2 focus-visible:ring-blue-500 sm:mt-0"
              />
              <span className="col-start-2 row-start-1 min-w-0">
                {/* Why the two days go together, not only that they do. Slate, because this is how the
                    choice works rather than something to beware of. */}
                {paired && <span className="mb-1 block text-xs text-slate-600">
                  <span className="font-medium text-slate-700">Two half days make one day off.</span> A half day cannot be taken on its own, so these two are used together.
                </span>}
                {option.days.map((day, at) => <span
                  key={day.date}
                  // A hairline between the two days of a pair: at phone width they stack into six
                  // lines, and without it the second day reads as a choice of its own.
                  className={`grid min-w-0 items-start gap-x-3 gap-y-0.5 sm:grid-cols-[1fr_1fr_1fr] sm:items-center ${at ? "mt-1.5 border-t border-slate-100 pt-1.5" : ""}`}
                >
                  <span className="min-w-0 break-words font-medium text-slate-800">
                    {dayLabel(day.date)}
                    {earnedLabel(day.earnedDays) && <span className="ml-1.5 text-xs font-normal text-slate-500">({earnedLabel(day.earnedDays)})</span>}
                  </span>
                  <span className="min-w-0 break-words text-slate-600">
                    {day.weekday}
                    {day.holidayName && <span className="ml-1.5 rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">{day.holidayName}</span>}
                  </span>
                  <span className="min-w-0 break-words text-slate-600">
                    <span className="font-medium text-slate-800">{day.workedLabel}</span>
                    <span className="block text-xs text-slate-500">{day.logoutAt ? `${displayTime(day.loginAt)} - ${displayTime(day.logoutAt)}` : `In at ${displayTime(day.loginAt)}`}</span>
                  </span>
                </span>)}
                {/* The expiry belongs to the choice, not to either day: on a pair it is the earlier
                    half's, which is the credit that runs out first. */}
                {option.expiresOn && <span className="mt-0.5 block text-xs font-medium text-amber-700">Use by {dayLabel(option.expiresOn)}</span>}
              </span>
            </label>
          </li>;
        })}
      </ul>
    </div>
    {waiting}
    {error && <p id={errorId} role="alert" className="mt-1.5 text-xs text-red-600">{error}</p>}
  </fieldset>;
}
