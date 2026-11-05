"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import TextField from "@/components/shared/TextField";
import { INSTALMENT_INTERVAL_MONTHS, instalmentLabel, previewSplit, readInstalmentCount } from "@/components/hrm/referralPayouts";
import { getReferralSettings, saveReferralSettings } from "@/services/hrm/referrals.service";

/**
 * What the studio pays for a referral, and over how many months.
 *
 * **Two figures, and neither is assumed.** The amount is the total; the instalments are how many
 * payments it is handed over in. One question rather than a list of months, because "how many" is
 * what a studio actually has an answer to — the spacing has never varied, so the count is turned
 * into dates here: one instalment every three months, starting at the referred employee's third.
 * Two is the third month and the sixth, which is what the register has always paid; three is 3-6-9.
 * The schedule used to be a constant in the referrals service, so a studio that paid any other way
 * had to have the application changed.
 *
 * The two belong on one form because neither means anything alone: an amount without a schedule is
 * not a payment and a schedule without an amount is not a figure. So the panel answers the question
 * they are really being asked together — **how much falls due in each month** — and states it in
 * money rather than leaving it to be worked out. An odd total does not divide as cleanly as it looks,
 * and these are the figures that reach somebody's pay.
 *
 * A section of the application's Settings, beside everything else the studio configures once and
 * reads everywhere. It lived in the ⋮ of the Employee Referral register for a while, on the
 * reasoning that a figure is best set by whoever is looking at what it produced; the studio would
 * rather have its settings in one place, so the register is now only a register and this is only a
 * setting.
 *
 * Changing either is never retrospective. Each instalment keeps the figure it was created with, and
 * a referral already recorded keeps the months it was recorded with — so somebody referred under the
 * old amount is paid the old amount, on the old dates.
 *
 * **Its permission is `HRM / Employee Referral`, not the administrator's `ADMIN / System
 * Settings`** — that is what the routes behind it enforce, and a section offered on any other
 * permission would be a form whose Save the server refuses. `canWrite` is passed by Settings: with
 * `READ` both are figures to look at and Save is absent rather than present and refused.
 */

const currency = (value) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(value) || 0);

export default function ReferralAmountPanel({ canWrite = false, onNotice, onError, unsavedRef }) {
  const [amount, setAmount] = useState("");
  const [savedAmount, setSavedAmount] = useState(null);
  // The count as the studio types it, rather than as a number, so a cleared box stays cleared
  // instead of snapping back to a zero nobody typed.
  const [countText, setCountText] = useState("");
  const [savedCount, setSavedCount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  /*
   * Why the settings could not be read, when they could not be.
   *
   * Held rather than only announced, because a failed load leaves `savedAmount` and `savedCount`
   * null and "changed" is measured against those - so the form rendered a Save that could never
   * enable, and the section read as a button that does nothing. It says what went wrong and offers
   * the read again instead.
   */
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getReferralSettings();
      const next = String(response?.data?.referralAmount ?? 0);
      setAmount(next);
      setSavedAmount(next);
      // Stored as the offsets a payout row carries; read back as the count this form asks for.
      const schedule = String((response?.data?.instalmentMonths || []).length || "");
      setCountText(schedule);
      setSavedCount(schedule);
      setLoadError("");
    } catch (error) {
      const message = error.message || "Unable to load the referral settings.";
      setLoadError(message);
      onError?.(message);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const { count, months, error: countError } = readInstalmentCount(countText);
  const parts = previewSplit(amount, months);
  // Either field, because both save together - an edit to one is an unsaved edit to the section.
  const changed = (savedAmount !== null && amount !== savedAmount) || (savedCount !== null && countText !== savedCount);

  /*
   * What Settings asks before it lets this section go: closing the overlay or moving to another
   * section throws an unsaved edit away, so the section holding the edit is the one that says so.
   */
  useEffect(() => {
    if (!unsavedRef) return undefined;
    unsavedRef.current = changed;
    return () => { unsavedRef.current = false; };
  }, [changed, unsavedRef]);

  async function save() {
    setSaving(true);
    try {
      /*
       * Both in one request, so the two can never be saved half way and leave an amount divided over
       * a schedule nobody chose.
       *
       * The count is sent rather than the months it works out to: the server applies the three-month
       * interval itself, so the schedule that lands in the database cannot disagree with the one
       * previewed above because of anything this form did.
       */
      const response = await saveReferralSettings({ referralAmount: Number(amount) || 0, instalmentCount: count });
      const next = String(response?.data?.referralAmount ?? 0);
      setAmount(next);
      setSavedAmount(next);
      const schedule = String((response?.data?.instalmentMonths || []).length || "");
      setCountText(schedule);
      setSavedCount(schedule);
      onNotice?.("Referral settings saved. Referrals already made keep the amount and the months they were made under.");
    } catch (error) {
      onError?.(error.message || "Unable to save the referral settings.");
    } finally {
      setSaving(false);
    }
  }

  /*
   * Nothing to edit until there is something to edit against.
   *
   * Showing the form over a failed read would offer two boxes whose Save is disabled for a reason
   * the screen never gives, which is exactly how this looked when the column behind it had not been
   * migrated yet.
   */
  if (!loading && loadError) {
    return <div className="space-y-3">
      <p className="text-xs text-rose-600 sm:text-sm">{loadError}</p>
      <Button type="button" onClick={() => void load()}>Try again</Button>
    </div>;
  }

  return <div className="space-y-3">
    <p className="text-xs text-slate-500 sm:text-sm">
      What the studio pays for a referral, and how many instalments it is paid in. One falls due every
      three months from the referred employee&rsquo;s joining date, so two instalments are their third
      month and their sixth. The amount is divided equally between them, and what each one comes to is
      shown below. A referral is recorded by
      naming a <span className="font-medium text-slate-700">Referred By</span>{" "}on an employee&rsquo;s record,
      and what it owes is tracked on <span className="font-medium text-slate-700">HRM → Employee Referral</span>.
    </p>

    {/* The two questions, side by side on anything wider than a phone and stacked below it - an
        amount without a schedule is not a payment, so they are asked together rather than in two
        places. */}
    <div className="grid gap-x-6 gap-y-4 sm:max-w-md sm:grid-cols-2">
      <TextField
        label="Referral amount"
        inputMode="decimal"
        value={loading ? "" : amount}
        readOnly={!canWrite || loading}
        placeholder={loading ? "Loading..." : "0"}
        onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1"))}
      />
      <div>
        <TextField
          label="Number of instalments"
          inputMode="numeric"
          value={loading ? "" : countText}
          readOnly={!canWrite || loading}
          placeholder={loading ? "Loading..." : "2"}
          error={loading ? "" : countError || ""}
          onChange={(event) => setCountText(event.target.value.replace(/\D/g, ""))}
        />
        <p className="mt-1.5 text-[11px] font-normal text-slate-500 sm:text-xs">
          One every {INSTALMENT_INTERVAL_MONTHS} months, from the employee&rsquo;s joining date.
        </p>
      </div>
    </div>

    {/* What the two answers come to, per month. Worked out rather than described: this is the
        question the studio is really asking, and the figures here are the ones that reach a payslip. */}
    <div className="sm:max-w-md">
      <div className="text-[11px] font-semibold text-slate-600 sm:text-xs">
        <span>{parts.length === 1 ? "The instalment" : `Each instalment (${parts.length})`}</span>
        <div className="mt-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-normal text-slate-600 sm:text-sm">
          {!parts.length && <span>{loading ? "Loading..." : "Say how many instalments to see the split."}</span>}
          {parts.length > 0 && <ul className="space-y-1">
            {parts.map((part) => (
              <li key={part.monthOffset} className="flex items-center justify-between gap-3">
                <span>{instalmentLabel(part.monthOffset)}</span>
                <span className="font-medium tabular-nums text-slate-800">{currency(part.amount)}</span>
              </li>
            ))}
          </ul>}
          {parts.length > 1 && <p className="mt-2 border-t border-slate-200 pt-2 text-[11px] text-slate-500">
            Divided equally, with any remainder on the last so the parts add back up to {currency(amount)}.
          </p>}
        </div>
      </div>
    </div>

    {canWrite && <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary" disabled={!changed || saving || loading || Boolean(countError)} onClick={() => void save()}>{saving ? "Saving..." : "Save settings"}</Button>
      {changed && <Button type="button" disabled={saving} onClick={() => { setAmount(savedAmount); setCountText(savedCount); }}>Discard changes</Button>}
      <p className="text-xs text-slate-500">Applies to referrals made from now on. Anyone already referred keeps the amount and the months their referral was made under.</p>
    </div>}
  </div>;
}
