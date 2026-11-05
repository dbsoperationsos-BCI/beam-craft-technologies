"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import TextField from "@/components/shared/TextField";
import { getMonitoringSettings, saveMonitoringSettings } from "@/services/usage/usage.service";

/**
 * How long somebody may sit still before the application stops counting them as using it.
 *
 * One number, held on the server and read by every browser in the studio, so Application Usage
 * means the same thing on every report. It was a constant compiled into the bundle: changing it was
 * a deploy, and until every tab had been reloaded they disagreed with each other about it.
 *
 * The field takes minutes because that is the unit an administrator thinks in. The heartbeat works
 * in seconds and takes its value from the reply to its own beat, so a change here reaches every
 * open tab within a beat or two rather than at their next reload.
 *
 * Read-only for anybody without `ADMIN / System Settings` write. The value still has to be *shown*
 * to them - it explains what the usage figures on the reports mean - but the field is absent rather
 * than present and refused, which is the rule the rest of the application follows.
 */
export default function ApplicationMonitoringPanel({ unsavedRef }) {
  const [minutes, setMinutes] = useState("");
  // What the server last said, so a typed edit can be told from an untouched field.
  const [savedMinutes, setSavedMinutes] = useState("");
  const [bounds, setBounds] = useState({ min: 1, max: 240 });
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await getMonitoringSettings();
      const data = response?.data || {};
      setMinutes(String(data.usageTimeoutMinutes ?? 3));
      setSavedMinutes(String(data.usageTimeoutMinutes ?? 3));
      setBounds({ min: Number(data.minMinutes) || 1, max: Number(data.maxMinutes) || 240 });
      setCanEdit(Boolean(data.canEdit));
      setError("");
    } catch (requestError) {
      setError(requestError.message || "Unable to load application monitoring settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Deferred a tick, the way every other first load in this application is started: a fetch begun
  // straight from an effect body counts as state set during the effect.
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const changed = String(minutes).trim() !== String(savedMinutes).trim();

  /*
   * What Settings asks before it lets this panel go.
   *
   * Closing the overlay or moving to another section throws an unsaved edit away, so the panel
   * that holds the edit is the one that has to say so. Cleared on the way out: a panel that is no
   * longer mounted is holding nothing, and a stale `true` would warn about an edit nobody made.
   */
  useEffect(() => {
    if (!unsavedRef) return undefined;
    unsavedRef.current = changed;
    return () => { unsavedRef.current = false; };
  }, [changed, unsavedRef]);

  async function save() {
    const value = Number(String(minutes).trim());
    // Checked here as well as on the server, so a typo is answered immediately rather than after a
    // round trip. The server is still the authority; this is only the quicker of the two.
    if (!Number.isInteger(value) || value < bounds.min || value > bounds.max) {
      setNotice("");
      setError(`Usage timeout must be a whole number of minutes between ${bounds.min} and ${bounds.max}.`);
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await saveMonitoringSettings({ usageTimeoutMinutes: value });
      setMinutes(String(response?.data?.usageTimeoutMinutes ?? value));
      setSavedMinutes(String(response?.data?.usageTimeoutMinutes ?? value));
      setNotice("Saved. Every signed-in browser picks this up within a minute.");
    } catch (requestError) {
      setError(requestError.message || "Unable to save application monitoring settings.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-slate-500">Loading...</p>;

  return (
    <div className="max-w-xl space-y-4">
      {/* One line. What the number means is in the field's own label and its hint; the rest was
          explaining the feature to somebody who had already found the setting for it. */}
      <p className="text-sm text-slate-600">
        How long somebody may go without touching anything before the application stops counting
        them as using it.
      </p>

      {canEdit ? (
        <>
          {/*
            A number field, so it carries the browser's own steppers and its own keyboard on a
            phone. `min`/`max`/`step` are the same bounds the server enforces - they make the
            steppers stop in the right place, and they are not the guard: `save` checks and the
            endpoint checks again, because a number input can still be typed into.
          */}
          <TextField
            label="Usage Timeout (minutes)"
            type="number"
            min={bounds.min}
            max={bounds.max}
            step={1}
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
            className="max-w-[16rem]"
          />
          <p className="text-xs text-slate-500">
            Between {bounds.min} and {bounds.max} minutes. Three if it has never been set.
          </p>
        </>
      ) : (
        <dl>
          <dt className="text-xs font-semibold text-slate-500">Usage Timeout</dt>
          <dd className="text-sm text-slate-800">
            {minutes} {Number(minutes) === 1 ? "minute" : "minutes"}
          </dd>
        </dl>
      )}

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {notice && <p className="text-sm text-emerald-700">{notice}</p>}

      {canEdit && (
        /*
         * Dead while the box is empty. There is nothing to save then - clearing the field is how
         * somebody starts typing a new number, not a way of asking for no timeout at all - and a
         * button that is pressable only to answer "this is required" is a worse way of saying so
         * than one that is plainly not ready yet.
         *
         * Emptiness only. A number that is out of bounds keeps the button live and is answered by
         * `save`, which names the range: that is a typo worth explaining, not a half-finished edit.
         */
        <Button type="button" variant="primary" onClick={() => void save()} disabled={saving || !String(minutes).trim()}>
          {saving ? "Saving..." : "Save changes"}
        </Button>
      )}
    </div>
  );
}
