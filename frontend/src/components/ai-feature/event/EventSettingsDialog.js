"use client";

import { useCallback, useEffect, useState } from "react";
import Dialog from "@/components/ui/Dialog";
import Button from "@/components/shared/Button";
import Loader from "@/components/shared/Loader";
import SettingsGroupForm from "@/components/ai-feature/shared/SettingsGroupForm";
import useFormErrors from "@/components/shared/useFormErrors";
import { eventFormProblems } from "@/lib/aiEventDefaults.mjs";
import { markedFieldsMessage } from "@/lib/formErrors.mjs";
import { getAiEventDefaults, getAiEventSettings, saveAiEventSettings } from "@/services/ai-feature/ai-feature.service";

const GROUPS = ["guestAccess", "ai", "media", "gallery", "privacy", "notifications"];

/** A number field left blank is not a number the server should be given; it is left as it was. */
function cleanForSave(values) {
  const out = {};
  for (const group of GROUPS) if (values[group]) out[group] = Object.fromEntries(Object.entries(values[group]).filter(([, value]) => value !== "" && value !== undefined));
  return out;
}

/** A refused save as one line: the server's message and the first thing each refused field says, so "Invalid settings." never stands alone. */
function serverMessage(cause) {
  const fields = cause?.data?.errors?.fieldErrors;
  const lines = fields ? Object.entries(fields).map(([field, messages]) => `${field}: ${messages[0]}`) : [];
  return [cause?.message || "Unable to save the settings.", ...lines].join(" ");
}

/** This event's copy of the settings. Changing them here changes nothing about the studio defaults or any other event. */
export default function EventSettingsDialog({ eventId, onClose, onSaved }) {
  const [values, setValues] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // While the studio defaults are being read in for Use studio defaults.
  const [copying, setCopying] = useState(false);
  const [notice, setNotice] = useState("");
  /*
   * The rules the server would refuse on, asked first so Save answers with the reason rather than
   * "Invalid settings." Each is said under its own control by the form, as it is broken; a refused
   * Save brings the first into view and the top counts what is left, shrinking as each is fixed.
   */
  const problems = values ? Object.assign({}, ...Object.values(eventFormProblems(values))) : {};
  const fields = useFormErrors();
  const summary = fields.count ? markedFieldsMessage(Object.values(problems).filter(Boolean).length) : "";

  const load = useCallback(async () => {
    try { setValues((await getAiEventSettings(eventId)).data || {}); setError(""); }
    catch (cause) { setError(cause.message || "Unable to load the settings."); }
  }, [eventId]);
  useEffect(() => {
    const timer = window.setTimeout(() => { load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const onChange = (group, key, value) => { setNotice(""); setValues((current) => ({ ...current, [group]: { ...(current?.[group] || {}), [key]: value } })); };

  /**
   * Copies the studio's current Event Default Settings into this form - staged, not saved. An
   * event takes its copy of the defaults when it is created and is never followed by a later change
   * to them, which is right for an event somebody has tuned by hand and a surprise for one they
   * have not: a switch turned off in the defaults leaves an existing event as it was, with nothing
   * on its page to say why. This is the way to bring one event in line, on purpose, one Save away,
   * and Cancel discards it like any other edit.
   */
  async function useStudioDefaults() {
    setCopying(true); setError("");
    try {
      const data = (await getAiEventDefaults())?.data || {};
      setValues((current) => ({ ...current, ...Object.fromEntries(GROUPS.map((group) => [group, { ...(data[group] || current?.[group] || {}) }])) }));
      setNotice("The studio's Event Default Settings have been copied in. Save settings to apply them to this event.");
    } catch (cause) {
      setError(cause.message || "Unable to read the Event Default Settings.");
    } finally {
      setCopying(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!fields.check(problems)) return;
    setBusy(true);
    try {
      await saveAiEventSettings(eventId, cleanForSave(values));
      onSaved();
    } catch (cause) {
      setError(serverMessage(cause));
      setBusy(false);
    }
  }

  return <Dialog
    title="Event settings"
    description="These are this event's own settings. The studio's Event Default Settings and every other event are left as they are."
    size="xl"
    height="tall"
    onClose={onClose}
    busy={busy}
    onSubmit={submit}
    footer={<>
      <Button type="button" className="max-sm:flex-1" onClick={onClose} disabled={busy}>Cancel</Button>
      <Button type="submit" variant="primary" className="max-sm:flex-1" disabled={busy || !values}>{busy ? "Saving..." : "Save settings"}</Button>
    </>}
  >
    {(error || summary) && <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error || summary}</p>}
    {notice && <p role="status" className="mb-3 rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-800">{notice}</p>}
    {values && <div className="mb-4 flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between">
      <span>This event took its copy of the Event Default Settings when it was created; a later change to the defaults does not reach it.</span>
      <Button type="button" size="sm" onClick={useStudioDefaults} disabled={busy || copying} className="shrink-0">{copying ? "Copying..." : "Use studio defaults"}</Button>
    </div>}
    {values ? <SettingsGroupForm values={values} onChange={onChange} groups={GROUPS} /> : !error && <Loader label="Loading settings..." />}
  </Dialog>;
}
