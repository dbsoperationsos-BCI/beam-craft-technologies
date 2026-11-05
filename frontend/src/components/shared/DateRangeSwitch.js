"use client";

import Dropdown from "@/components/shared/Dropdown";
import DateField from "@/components/shared/DateField";
import { CUSTOM_RANGE, dateRangeOptions } from "@/lib/crmDateRange.mjs";

/**
 * "Today, Yesterday, This Week, This Month, Custom Date", as one control on a module header.
 *
 * The switch is the application's own `Dropdown` in switch mode - the same control the CRM board
 * picker beside it is - so it carries the same height, the same chevron with no gap in front of it,
 * and the same trick that sizes it to its longest option and no wider. That last part is what keeps
 * it from resizing as the reader moves between "Today" and "This Month", which on a header row
 * would shift everything to its right by a few pixels each time.
 *
 * Custom Date is the one option that needs more than a name, so the two day pickers appear beside
 * the switch only once it is chosen, and disappear again when it is not - and they are **labelled**
 * `From` and `To`. They come *before* the switch when they are drawn: the row then reads left to
 * right as the answer - from this day, to that day - and the control that chose the mode sits after
 * it rather than in front of two boxes it is no longer the subject of.
 *
 * They were unlabelled `compact` fields carrying the words as placeholders, on the reasoning that
 * three controls of the same height read as one control. What that actually produced was two bare
 * calendar icons: the placeholder is the first thing a narrow box truncates, so the pair arrived on
 * the header saying nothing about which end each was, and a range picker whose two ends cannot be
 * told apart is a range picker nobody can set. A label above each is two words that cannot be
 * truncated away, and it is how every other pair of dates in this application is drawn.
 *
 * The component holds nothing. The value, the two custom days and what to do about them are the
 * caller's, because the caller is what has to send them to a server - see `resolveDateRange`.
 */
export default function DateRangeSwitch({
  ariaLabel = "Date range",
  className = "",
  custom = {},
  onChange,
  onCustomChange,
  value,
}) {
  const isCustom = value === CUSTOM_RANGE;

  /*
   * The switch, and — while Custom Date is chosen — the two days it stands for.
   *
   * `min-w-0` so the header row may make this narrower than its three controls want to be: the
   * action row is `flex-nowrap` from `sm` up, and without it a custom range would widen the header
   * past the screen rather than wrapping onto a second line inside its own box.
   *
   * `items-end`, because the two pickers carry labels above them and the switch does not: aligning
   * on the bottom puts all three boxes on one line whatever is written over them.
   */
  const range = <>
    <DateField
      label="From"
      placeholder="Start date"
      value={custom.from || ""}
      // Never past the other end: a start after its end is a range nobody meant, and saying
      // so in the calendar is better than accepting it and answering with an empty board.
      maxDate={custom.to || ""}
      onChange={(next) => onCustomChange?.({ ...custom, from: next })}
      className="w-40 shrink-0 sm:w-44"
    />
    <DateField
      label="To"
      placeholder="End date"
      value={custom.to || ""}
      minDate={custom.from || ""}
      onChange={(next) => onCustomChange?.({ ...custom, to: next })}
      className="w-40 shrink-0 sm:w-44"
    />
  </>;

  const switcher = <Dropdown
    mode="switch"
    ariaLabel={ariaLabel}
    value={value}
    onChange={(next) => onChange?.(next)}
    options={dateRangeOptions}
    // The list widens from a day to a month and ends with the one that asks its own question.
    // Alphabetised it would read All Time, Custom Date, This Month, This Week, Today, Yesterday,
    // which is five ranges in no order anybody thinks about time in.
    sorted={false}
    /*
     * The switch keeps reading "Custom Date" rather than the two days it stands for.
     *
     * Putting the range on the trigger was tried and is wrong here: a switch is sized to its
     * longest *option*, and "2026-08-01 - 2026-08-31" is twice the width of "Custom Date", so it
     * arrived truncated in a box that could not grow to hold it. The days are on screen anyway -
     * the two pickers beside this are only drawn while Custom Date is chosen, and they are what
     * the reader set them with.
     */
    className="shrink-0"
  />;

  return (
    <div className={`flex min-w-0 flex-wrap items-end gap-2 ${className}`}>
      {/*
        The two calendars come first and the switch follows them.

        It leads the row every other time, because there is nothing else on it and the switch is what
        the reader presses. Once Custom Date is chosen the row reads left to right as the answer -
        from this day, to that day - and the control that chose the mode belongs after it rather than
        in front of two boxes it is no longer the subject of.
      */}
      {isCustom ? <>{range}{switcher}</> : switcher}
    </div>
  );
}
