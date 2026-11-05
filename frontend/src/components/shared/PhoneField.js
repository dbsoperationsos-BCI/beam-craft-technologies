"use client";

import { useEffect, useRef, useState } from "react";
import Dropdown from "@/components/shared/Dropdown";
import { DEFAULT_DIAL_CODE, DIAL_CODE_OPTIONS, countryByDial, countryByIso } from "@/lib/countryDialCodes";
import { nationalNumberLimits, parsePhoneNumber } from "@/lib/phoneNumber";

/**
 * A phone number, as a country and a national number.
 *
 * The country is picked from a list rather than typed. A code typed by hand is how "+1" becomes
 * "1" and a lead's number stops matching the client it belongs to - and it gives no clue which
 * country a stored code even is. The list carries the flag and the country's name so it can be
 * read and searched; the closed field stays narrow, showing the flag and the code alone.
 *
 * India is the default because that is where the studio's clients almost always are.
 *
 * `readOnly` is the number on a record nobody is editing. It loses the country picker's chevron -
 * there is no list to open - and takes the grey read-back tone the other fields use, so a row of
 * read-only fields is one colour. It was the one control on such a row that stayed white: the
 * wrapper's fill is hardcoded and its inner input is transparent, so a `fieldset disabled` around
 * it greyed every text box beside it and left this one looking live.
 *
 * `readOnly` rather than `disabled` on the number itself, so it can still be selected and copied -
 * which is most of what somebody does with a phone number they are being shown.
 */
/*
 * `note` is a remark about the answer, not a fault in it.
 *
 * Amber and below the box, in the slot `error` uses. The two never appear together: a field that is
 * wrong is told so first, because a remark about a number that has not been accepted yet is a
 * remark about nothing. What it exists for is "this number is already on the register" - worth
 * stopping for, not an error, and something the person filling the form in may well go on with.
 */
export default function PhoneField({ label, field, required, error, note = "", value, onChange, disabled = false, readOnly = false }) {
  const inert = disabled || readOnly;
  const initialPhone = parsePhoneNumber(value);
  const [countryCode, setCountryCode] = useState(initialPhone.countryCode);
  const [nationalNumber, setNationalNumber] = useState(initialPhone.number);
  /*
   * The country last chosen from the picker, remembered only to settle a tie.
   *
   * Several countries share a dialling code - +1 is the United States, Canada and Puerto Rico -
   * and the stored value keeps the code alone, so choosing Canada and reopening the lead would
   * otherwise show the United States. This is not kept in step with the value: it is consulted
   * at render, and ignored the moment the code stops matching it.
   */
  const [chosenIso, setChosenIso] = useState(() => countryByDial(initialPhone.countryCode)?.value || "");
  const lastEmittedValue = useRef(value ?? "");

  useEffect(() => {
    if ((value ?? "") === lastEmittedValue.current) return;
    const nextPhone = parsePhoneNumber(value);
    setCountryCode(nextPhone.countryCode);
    setNationalNumber(nextPhone.number);
    lastEmittedValue.current = value ?? "";
  }, [value]);

  const updatePhone = (nextCountryCode, nextNumber) => {
    const code = String(nextCountryCode || "").replace(/[^\d+]/g, "").replace(/^([^+])/, "+$1").slice(0, 5);
    // Capped by the country, not by India. A flat ten cut the last digit off a Chinese number and
    // stored the result as though it were the whole of it.
    const digits = String(nextNumber || "").replace(/\D/g, "").slice(0, nationalNumberLimits(code).max);
    setCountryCode(code);
    setNationalNumber(digits);
    const storedValue = digits ? `${code || "+91"} ${digits}` : "";
    lastEmittedValue.current = storedValue;
    onChange(field, storedValue);
  };

  // The 5-5 grouping is how an Indian number is read. Everywhere else the grouping differs by
  // country, so the digits are left alone rather than split in a shape that country does not use.
  const groupsAsIndian = nationalNumberLimits(countryCode).max === 10;
  const displayNumber = groupsAsIndian && nationalNumber.length > 5 ? `${nationalNumber.slice(0, 5)}-${nationalNumber.slice(5)}` : nationalNumber;

  /*
   * Which country the flag shows, worked out at render rather than stored.
   *
   * The chosen country wins while its code still matches what the field holds - that is what
   * keeps Canada showing Canada rather than the United States. Once the code changes, whether
   * typed or arriving from the server, the choice is stale and the code decides. Deriving it
   * means there is no second piece of state to keep in step, and nothing to sync in an effect.
   */
  const chosen = countryByIso(chosenIso);
  const country = (chosen && chosen.dial === countryCode ? chosen : countryByDial(countryCode))
    || countryByDial(DEFAULT_DIAL_CODE);

  return <div className="block text-[11px] font-semibold text-slate-600 sm:text-xs">
    <span>{label}{required && <span className="text-red-600"> *</span>}</span>
    {/* The two controls share one outline so they read as one field, the way they did when the
        code was a text box. The picker keeps its own focus ring off - the wrapper carries it. */}
    <span className={`mt-1.5 flex min-h-9 w-full items-stretch overflow-hidden rounded-lg border transition ${readOnly ? "bg-slate-100" : "bg-white focus-within:ring-2"} ${error ? "border-red-500 focus-within:border-red-500 focus-within:ring-red-100" : "border-slate-300 focus-within:border-blue-500 focus-within:ring-blue-100"}`}>
      {/*
        Wide enough for the longest code this list holds (+1264) and the chevron beside it.

        It was 6.25rem with the trigger's own `justify-between` still in force, which pinned the
        code to the left edge and the chevron to the right and left a finger's width of nothing
        between them - most visible on "+91", which is short and by far the most common. The two
        are packed together below, so the box only has to be as wide as they are.

        4.75rem once clipped "+91" to "+9", which is why the old note warned against it; that was
        while the trigger still carried its default `px-3`. The override below cuts the padding to
        `px-1`, which gives back more room than this takes away - the longest code needs about
        3.9rem of the 4.75rem here.
      */}
      <span className="w-[4.75rem] shrink-0 border-r border-slate-300">
        <Dropdown
          mode="input"
          searchable
          // Alphabetical, except India, which the list puts first because it is the default and
          // the one reached for by far the most.
          sorted={false}
          ariaLabel={`${label} country code`}
          value={country?.value || ""}
          disabled={disabled}
          readOnly={readOnly}
          options={DIAL_CODE_OPTIONS}
          // The code alone. The flag belongs in the menu, where there is room to read it beside
          // the country's name; in the field it competed with the number for a few characters of
          // space and pushed the code out of view.
          triggerLabel={country ? country.dial : DEFAULT_DIAL_CODE}
          // The field is deliberately narrow, and a menu matching it wrapped every country over
          // three lines. Wide enough for the longest name and its code on one line.
          menuMinWidth={288}
          onChange={(iso) => {
            const next = countryByIso(iso);
            if (!next) return;
            setChosenIso(next.value);
            updatePhone(next.dial, nationalNumber);
          }}
          /* Stripped of its own outline and padding so the two controls read as one field: the
             wrapper above carries the border and the focus ring. The input keeps a little left
             padding for the code and gives the rest of the box to the chevron. */
          className="[&_button]:mt-0 [&_button]:min-h-9 [&_button]:shrink-0 [&_button]:rounded-none [&_button]:border-0 [&_button]:px-1 [&_button]:!justify-start [&_button]:gap-0.5 [&_button]:focus:ring-0 [&_input]:mt-0 [&_input]:min-h-9 [&_input]:rounded-none [&_input]:border-0 [&_input]:px-2 [&>div]:mt-0 [&>div]:rounded-none [&>div]:border-0 [&>div]:focus-within:ring-0"
        />
      </span>
      <input
        value={displayNumber}
        inputMode="numeric"
        placeholder={inert ? "" : groupsAsIndian ? "12345-12345" : "Phone number"}
        disabled={disabled}
        readOnly={readOnly}
        onChange={(event) => updatePhone(countryCode, event.target.value)}
        aria-label={label}
        className={`min-w-0 flex-1 bg-transparent px-3 text-xs font-normal outline-none disabled:cursor-not-allowed sm:text-sm ${readOnly ? "cursor-default text-slate-600" : "text-slate-700"}`}
      />
    </span>
    {error && <span className="mt-1 block text-[11px] font-normal text-red-600">{error}</span>}
    {!error && note && <span className="mt-1 block text-[11px] font-normal text-amber-700">{note}</span>}
  </div>;
}
