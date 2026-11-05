"use client";

import { useState } from "react";
import Button from "@/components/shared/Button";
import DateField from "@/components/shared/DateField";
import Dropdown from "@/components/shared/Dropdown";
import RadioGroupField from "@/components/shared/RadioGroupField";
import TextField from "@/components/shared/TextField";
import useFormErrors from "@/components/shared/useFormErrors";
import Dialog from "@/components/ui/Dialog";
import { SHOOT_TIMINGS, shootLinkLabel } from "@/lib/paymentSchedule.mjs";

const DATE_KNOWN = [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }];
const MAIN_EVENT = "";

/** A shoot as the picker names it: what it is, its date where it has one, and whether it is the main event. */
function shootOption(shoot) {
  const date = shoot.dateCreated ? new Date(shoot.dateCreated).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "date not set";
  return { value: String(shoot.id), label: `${shoot.shoot || "Shoot"} · ${date}${shoot.isMainEvent ? " · Main event" : ""}` };
}

/**
 * When one Schedule Payment row falls due - asked in a dialog because the row's Date cell has room
 * for a date and nothing more.
 *
 * **Date known?** Yes is the date itself. No ties it to a shoot instead: which one (the main event
 * unless another is picked), and Before, On or After it - with how many days for Before and After.
 * The date is then worked out from the shoot, and moves when the shoot does; until the shoot has a
 * date the payment waits for it. Nothing is saved here: Done hands the answer back to the row, and
 * the form's own Save keeps it.
 */
export default function PaymentDueDialog({ row, shoots = [], layer = "dialogOverPanel", onClose, onDone }) {
  const [known, setKnown] = useState(row.dateKnown === false ? "no" : "yes");
  const [date, setDate] = useState(row.date || "");
  const [shootKey, setShootKey] = useState(row.shootKey || MAIN_EVENT);
  const [timing, setTiming] = useState(row.timing || "ON");
  const [days, setDays] = useState(row.days || "");
  const fields = useFormErrors();
  const linked = known === "no";
  const options = [{ value: MAIN_EVENT, label: "Main event" }, ...shoots.filter((shoot) => shoot?.id).map(shootOption)];

  function done() {
    const dayCount = Number(days);
    if (!fields.check({
      date: !linked && !date ? "Choose the date it is due." : "",
      days: linked && timing !== "ON" && (!Number.isInteger(dayCount) || dayCount < 1 || dayCount > 365) ? "Enter the days, 1 to 365." : "",
    })) return;
    onDone(linked
      ? { dateKnown: false, date: "", shootKey, timing, days: timing === "ON" ? "" : String(dayCount) }
      : { dateKnown: true, date, shootKey: "", timing: "ON", days: "" });
  }

  const preview = linked ? shootLinkLabel({ shootKey, timing, days }, shoots) : "";

  return <Dialog
    title="When is this payment due?"
    layer={layer}
    onClose={onClose}
    footer={<>
      <Button type="button" className="max-sm:flex-1" onClick={onClose}>Cancel</Button>
      <Button type="button" variant="primary" className="max-sm:flex-1" onClick={done}>Done</Button>
    </>}
  >
    <div className="flex flex-col gap-4">
      <RadioGroupField label="Date known?" value={known} onChange={(value) => { setKnown(value); fields.clear("date"); fields.clear("days"); }} options={DATE_KNOWN} helperText="No ties it to a shoot, and the date follows that shoot's." />
      {!linked && <DateField label="Due date" required value={date} onChange={(value) => { setDate(value); fields.clear("date"); }} error={fields.errors.date} />}
      {linked && <>
        <Dropdown label="Shoot" value={shootKey} onChange={(value) => setShootKey(value || MAIN_EVENT)} options={options} searchable={false} sorted={false} helperText="The main event unless another shoot is picked." />
        <RadioGroupField label="When" value={timing} onChange={(value) => { setTiming(value); fields.clear("days"); }} options={SHOOT_TIMINGS} layout="column" />
        {timing !== "ON" && <TextField label="Days" required type="number" inputMode="numeric" min={1} max={365} value={days} onChange={(event) => { setDays(event.target.value.replace(/[^\d]/g, "")); fields.clear("days"); }} error={fields.errors.days} helperText={`How many days ${timing === "BEFORE" ? "before" : "after"} the shoot.`} />}
        <p className="text-sm text-slate-600">Due: <span className="font-medium text-slate-900">{preview}</span>. Until that shoot has a date, the payment waits for it and gets no reminder.</p>
      </>}
    </div>
  </Dialog>;
}
