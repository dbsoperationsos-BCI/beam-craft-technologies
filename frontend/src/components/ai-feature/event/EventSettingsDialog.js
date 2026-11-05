"use client";

import { useCallback, useEffect, useState } from "react";
import Dialog from "@/components/ui/Dialog";
import Button from "@/components/shared/Button";
import Loader from "@/components/shared/Loader";
import SettingsGroupForm from "@/components/ai-feature/shared/SettingsGroupForm";
import { getAiEventSettings, saveAiEventSettings } from "@/services/ai-feature/ai-feature.service";

const GROUPS = ["guestAccess", "ai", "media", "gallery", "privacy", "notifications"];

/** A number field left blank is not a number the server should be given; it is left as it was. */
function cleanForSave(values) {
  const out = {};
  for (const group of GROUPS) if (values[group]) out[group] = Object.fromEntries(Object.entries(values[group]).filter(([, value]) => value !== "" && value !== undefined));
  return out;
}

/** This event's copy of the settings. Changing them here changes nothing about the studio defaults or any other event. */
export default function EventSettingsDialog({ eventId, onClose, onSaved }) {
  const [values, setValues] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setValues((await getAiEventSettings(eventId)).data || {}); setError(""); }
    catch (cause) { setError(cause.message || "Unable to load the settings."); }
  }, [eventId]);
  useEffect(() => {
    const timer = window.setTimeout(() => { load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const onChange = (group, key, value) => setValues((current) => ({ ...current, [group]: { ...(current?.[group] || {}), [key]: value } }));

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await saveAiEventSettings(eventId, cleanForSave(values));
      onSaved();
    } catch (cause) {
      setError(cause.message || "Unable to save the settings.");
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
    {error && <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
    {values ? <SettingsGroupForm values={values} onChange={onChange} groups={GROUPS} /> : !error && <Loader label="Loading settings..." />}
  </Dialog>;
}
