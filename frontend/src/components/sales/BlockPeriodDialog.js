"use client";

import { useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import DateField from "@/components/shared/DateField";
import Dropdown from "@/components/shared/Dropdown";
import TextAreaField from "@/components/shared/TextAreaField";
import TimeField from "@/components/shared/TimeField";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import useUnsavedGuard from "@/components/shared/useUnsavedGuard";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Dialog from "@/components/ui/Dialog";
import { createCalendarBlock, getBlockBranches } from "@/services/schedule/calendarBlocks.service";

/*
 * Calendar → a day's ⋮ → Block Period: hold a branch's hours on that day - a repair, a walkthrough, a
 * client still deciding. A placeholder on the calendar only: it blocks no booking. The branch, the day (the one the ⋮ was on), from
 * and to, and why. The block shows on the calendar for everybody who may see that branch's blocks,
 * and is removed from its details to free the hours.
 *
 * Only offered to a writer of `SALES / Block Period`; the branches are those that permission reaches.
 */

// A quick way to set To: From plus one of these, in minutes.
const DURATION_OPTIONS = [
  { value: "15", label: "15 min" },
  { value: "30", label: "30 min" },
  { value: "45", label: "45 min" },
  { value: "60", label: "1 hr" },
  { value: "120", label: "2 hr" },
  { value: "180", label: "3 hr" },
];
const toMinutes = (time) => { const [hours, minutes] = String(time).split(":").map(Number); return hours * 60 + minutes; };
const toClock = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
// A block ends on its own day: a duration running past midnight stops at 11:59 pm.
const plus = (time, duration) => (time && duration ? toClock(Math.min(toMinutes(time) + Number(duration), 23 * 60 + 59)) : "");

// `startTime` ("14:00") is the hour whose ⋮ it was opened from on the Day view, or "".
export default function BlockPeriodDialog({ date, startTime = "", onClose, onSaved }) {
  const [branches, setBranches] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [initial] = useState(() => ({ branchId: "", date, startTime, endTime: "", reason: "" }));
  const [values, setValues] = useState(initial);
  // A field's own error under it, and what the server said at the foot.
  const [errors, setErrors] = useState({});
  const [error, setError] = useState("");
  const { busy, run } = useSubmitOnce();
  const change = (name, value) => { setValues((current) => ({ ...current, [name]: value })); setErrors((current) => ({ ...current, [name]: "" })); setError(""); };
  /*
   * Duration only sets To - it is not sent. Picked, To is From plus it, and follows From when From
   * moves. To set by hand is kept as it is; Duration then shows the one it matches, or none.
   */
  const [duration, setDuration] = useState("");
  function changeStart(value) {
    change("startTime", value);
    if (duration && value) change("endTime", plus(value, duration));
  }
  function changeDuration(value) {
    setDuration(value || "");
    if (value && values.startTime) change("endTime", plus(values.startTime, value));
  }
  function changeEnd(value) {
    change("endTime", value);
    const match = DURATION_OPTIONS.find((option) => values.startTime && value && plus(values.startTime, option.value) === value);
    setDuration(match ? match.value : "");
  }
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  const { guard, confirmProps } = useUnsavedGuard(dirty, { message: "The branch, times and reason you entered will be lost." });
  const close = () => { if (!busy) guard(onClose); };

  // The branches this viewer may block in; one alone is chosen for them.
  useEffect(() => {
    let live = true;
    getBlockBranches()
      .then((response) => {
        if (!live) return;
        const list = Array.isArray(response?.data) ? response.data : [];
        setBranches(list);
        if (list.length === 1) setValues((current) => ({ ...current, branchId: String(list[0].id) }));
      })
      .catch((requestError) => { if (live) setLoadError(requestError?.data?.message || requestError?.message || "Unable to load the branches."); });
    return () => { live = false; };
  }, []);

  function submit(event) {
    event?.preventDefault?.();
    const found = {
      branchId: values.branchId ? "" : "Choose the branch.",
      date: values.date ? "" : "Choose the date.",
      startTime: values.startTime ? "" : "Choose when the block starts.",
      endTime: !values.endTime ? "Choose when the block ends." : values.startTime && values.endTime <= values.startTime ? "End after the start time." : "",
      reason: values.reason.trim() ? "" : "Say why the period is blocked.",
    };
    if (Object.values(found).some(Boolean)) { setErrors(found); return; }
    void run(async () => {
      try {
        const response = await createCalendarBlock({
          branchId: Number(values.branchId),
          date: values.date,
          startTime: values.startTime,
          endTime: values.endTime,
          reason: values.reason.trim(),
        });
        onSaved(response?.data);
      } catch (requestError) {
        setError(requestError?.data?.message || requestError?.message || "Unable to block the period.");
      }
    });
  }

  const noBranch = Array.isArray(branches) && !branches.length;
  const branchOptions = (branches || []).map((branch) => ({ value: String(branch.id), label: branch.name }));

  return <><Dialog
    title="Block Period"
    description="A placeholder on the calendar for a branch's hours on this day. It blocks no booking; remove it from its details when it is no longer needed."
    size="md"
    busy={busy}
    onClose={close}
    onSubmit={submit}
    footer={<>
      <Button type="button" variant="secondary" onClick={close} disabled={busy}>Discard</Button>
      <Button type="submit" variant="primary" busy={busy} disabled={noBranch || Boolean(loadError) || branches === null}>Block Period</Button>
    </>}
  >
    {loadError || noBranch
      ? <p role="alert" className="text-sm text-red-600">{loadError || "No branch is open to you for Block Period. Ask an administrator to give your role a branch in Role Management."}</p>
      : <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Dropdown className="sm:col-span-2" label="Branch" helperText="The branch whose hours are held on the calendar." required ariaLabel="Branch" placeholder={branches === null ? "Loading branches..." : "Select a branch"} options={branchOptions} value={values.branchId} onChange={(value) => change("branchId", value)} disabled={branches === null} error={errors.branchId} />
        <DateField className="sm:col-span-2" label="Date" helperText="The day the hours are held on." required value={values.date} onChange={(value) => change("date", value)} error={errors.date} />
        {/* From with Duration under it; To beside them. On a phone: From, Duration, To. */}
        <div className="space-y-4">
          <TimeField twelveHour label="From" helperText="When the held hours start." required value={values.startTime} onChange={(event) => changeStart(event.target.value)} error={errors.startTime} />
          <Dropdown mode="input" label="Duration" helperText="Pick one to fill To from the start time." ariaLabel="Duration" placeholder="Select a duration" options={DURATION_OPTIONS} value={duration} onChange={changeDuration} sorted={false} searchable={false} />
        </div>
        <TimeField twelveHour label="To" helperText="When the held hours end, on the same day." required value={values.endTime} onChange={(event) => changeEnd(event.target.value)} error={errors.endTime} />
        <TextAreaField className="sm:col-span-2" label="Reason" helperText="Why the hours are held, shown on the calendar block." required rows={3} maxLength={300} placeholder="e.g. Lighting repair, studio walkthrough" value={values.reason} onChange={(event) => change("reason", event.target.value)} error={errors.reason} />
        {error && <p role="alert" className="text-sm text-red-600 sm:col-span-2">{error}</p>}
      </div>}
  </Dialog>
  <ConfirmDialog {...confirmProps} layer="confirmOverDialog" /></>;
}
