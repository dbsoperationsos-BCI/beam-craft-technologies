"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Button from "@/components/shared/Button";
import RadioGroupField from "@/components/shared/RadioGroupField";
import DateField from "@/components/shared/DateField";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { formatDateTime } from "@/lib/formatDateTime.mjs";
import { CUSTOM_PERIOD, customRangeError, resolveActivityPeriod } from "@/lib/activityLogs.mjs";
import { previewActivityLogPurge, purgeActivityLog } from "@/services/settings/activityLogPurge.service";

const CHOICES = [
  { value: "1", label: "Older than 1 month" },
  { value: "2", label: "Older than 2 months" },
  { value: "3", label: "Older than 3 months" },
  { value: "6", label: "Older than 6 months" },
  { value: CUSTOM_PERIOD, label: "Custom range" },
];

const count = new Intl.NumberFormat("en-IN");
const lines = (value) => `${count.format(value)} ${value === 1 ? "line" : "lines"}`;

/** Where the lines are, as the server answered: before a cutoff, or between two moments. */
const describe = (answer) => (answer?.cutoff
  ? `older than ${formatDateTime(answer.cutoff)}`
  : answer?.from ? `from ${formatDateTime(answer.from)} to ${formatDateTime(answer.to)}` : "");

/**
 * Settings → Activity Log Purge: deleting the User Activity Logs' older lines by hand.
 *
 * "Older than 3 months" keeps the last three months and deletes everything before them; "Custom
 * range" deletes the lines between a From and a To, both picked to the minute, and keeps everything
 * either side - the same pickers and the same end-of-minute rule as the log screen's own custom
 * period, so a range reads the same in both places. Before the
 * delete is offered, the panel asks the server how many lines that is and from before when, so the
 * button says exactly what it will do, and a period with nothing older offers no delete at all. The
 * delete itself waits for a confirmation, because it cannot be undone.
 *
 * `canWrite` is the reader's `SETTINGS / Activity Log Purge` level: with Read alone the panel shows
 * what a purge would delete but not the way to do it - the server refuses that delete as well.
 */
export default function ActivityLogPurgePanel({ canWrite = false }) {
  const [choice, setChoice] = useState("3");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [purging, setPurging] = useState(false);
  const { notice, showSuccess, showError, clearNotice } = useNotice();
  // A later choice may answer before an earlier one; only the answer to the choice on screen is kept.
  const requestRef = useRef(0);

  /*
   * What the choice deletes, as the endpoint takes it: `{ months }`, or a custom range's `{ from, to }`
   * once both ends are set and in order - until then there is nothing to ask about yet (`null`).
   */
  const isCustom = choice === CUSTOM_PERIOD;
  const rangeError = isCustom ? customRangeError(custom) : "";
  const target = useMemo(() => {
    if (!isCustom) return { months: Number(choice) };
    if (!custom.from || !custom.to || rangeError) return null;
    return resolveActivityPeriod(CUSTOM_PERIOD, custom);
  }, [choice, custom, isCustom, rangeError]);

  const load = useCallback(async (asked) => {
    const request = ++requestRef.current;
    if (!asked) {
      setPreview(null);
      setLoading(false);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await previewActivityLogPurge(asked);
      if (request === requestRef.current) setPreview(result);
    } catch (loadError) {
      if (request !== requestRef.current) return;
      setPreview(null);
      setError(loadError?.message || "Unable to count the lines to delete.");
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(target); }, 0);
    return () => window.clearTimeout(timer);
  }, [load, target]);

  async function purge() {
    setPurging(true);
    try {
      const result = await purgeActivityLog(target);
      setConfirming(false);
      showSuccess(`Deleted ${lines(result?.removed || 0)} ${describe(result)}.`);
      await load(target);
    } catch (purgeError) {
      setConfirming(false);
      showError(purgeError?.message || "Unable to delete the activity log lines.");
    } finally {
      setPurging(false);
    }
  }

  const total = Number(preview?.count) || 0;
  const span = describe(preview);

  return (
    <div className="max-w-xl space-y-4">
      <RadioGroupField
        label="Delete"
        value={choice}
        onChange={setChoice}
        options={CHOICES}
        helperText="Lines inside the chosen period are deleted; everything else is kept."
        disabled={purging}
      />

      {isCustom && <div className="grid gap-3 sm:grid-cols-2">
        <DateField label="From" withTime value={custom.from} maxDate={custom.to} onChange={(from) => setCustom((current) => ({ ...current, from }))} placeholder="Start" helperText="Lines from this date and time onwards are deleted." disabled={purging} />
        <DateField label="To" withTime value={custom.to} minDate={custom.from} onChange={(to) => setCustom((current) => ({ ...current, to }))} placeholder="End" error={rangeError} helperText="Lines up to the end of this minute are deleted; later ones stay." disabled={purging} />
      </div>}

      <div aria-live="polite" className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
        {!target
          ? <p className="text-slate-500">{rangeError || "Choose a From and a To date and time to see what would be deleted."}</p>
          : loading
          ? <p className="text-slate-500">Counting the lines...</p>
          : error
            ? <div className="flex flex-wrap items-center gap-3">
              <p role="alert" className="text-red-600">{error}</p>
              <Button type="button" variant="secondary" size="sm" onClick={() => void load(target)}>Try again</Button>
            </div>
            : total
              ? <p className="text-slate-700"><strong className="font-semibold text-slate-900">{lines(total)}</strong> {span} will be deleted.</p>
              : <p className="text-slate-600">There are no lines {span}, so there is nothing to delete.</p>}
      </div>

      {canWrite
        ? <Button type="button" variant="danger" onClick={() => setConfirming(true)} disabled={!target || loading || Boolean(error) || !total || purging}>
          {total ? `Delete ${lines(total)}` : "Delete"}
        </Button>
        : <p className="text-sm text-slate-500">You can see what a purge would delete, but deleting needs Read / Write on Activity Log Purge.</p>}

      <ConfirmDialog
        open={confirming}
        title="Delete activity log lines?"
        message={`${lines(total)} ${span} will be permanently deleted. This cannot be undone.`}
        confirmLabel={`Delete ${lines(total)}`}
        busyLabel="Deleting..."
        loading={purging}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void purge()}
      />
      <FloatingNotice notice={notice} onClose={clearNotice} />
    </div>
  );
}
