"use client";

import { useCallback, useEffect, useState } from "react";
import SettingsGroupForm from "@/components/ai-feature/shared/SettingsGroupForm";
import { useModuleAccess } from "@/components/auth/PermissionsProvider";
import Button from "@/components/shared/Button";
import { CardState } from "@/components/shared/DashboardCard";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import useUnsavedGuard from "@/components/shared/useUnsavedGuard";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Dialog from "@/components/ui/Dialog";
import { getAiEventDefaults, saveAiEventDefaults } from "@/services/ai-feature/ai-feature.service";

/**
 * More → Event Default Settings: the studio's template for new events.
 *
 * One record, read whole and saved whole. It shapes an event only at the moment the wizard opens -
 * every event keeps its own copy from then on - which the note under the title says, because the
 * obvious reading of "default settings" is that changing them changes everything.
 *
 * IMAGE_SELECTION / AI Event Default Settings: READ sees the values, READ_WRITE is offered Save.
 */
const GROUPS = ["general", "guestAccess", "ai", "media", "gallery", "privacy", "notifications"];

/** The groups as the server takes them: a number field left empty is not sent. */
function payloadOf(values) {
  const out = {};
  for (const group of GROUPS) {
    if (!values[group]) continue;
    out[group] = Object.fromEntries(Object.entries(values[group]).filter(([, value]) => value !== "" && value !== undefined));
  }
  return out;
}

export default function EventDefaultSettingsPanel({ onClose }) {
  const { canWrite } = useModuleAccess("IMAGE_SELECTION", "AI Event Default Settings");
  const { notice, showSuccess, clearNotice } = useNotice();
  const [values, setValues] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const { guard, confirmProps } = useUnsavedGuard(dirty && !saving);

  const load = useCallback(async () => {
    setLoading(true); setLoadError("");
    try {
      const data = (await getAiEventDefaults())?.data || {};
      setValues(Object.fromEntries(GROUPS.map((group) => [group, { ...(data[group] || {}) }])));
      setDirty(false);
    } catch (caught) {
      setLoadError(caught?.message || "Unable to load Event Default Settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const change = (group, key, value) => { setDirty(true); setValues((current) => ({ ...current, [group]: { ...current[group], [key]: value } })); };

  async function submit(submitEvent) {
    submitEvent.preventDefault();
    if (!canWrite || !values) return;
    setSaving(true); setError("");
    try {
      const data = (await saveAiEventDefaults(payloadOf(values)))?.data || {};
      setValues(Object.fromEntries(GROUPS.map((group) => [group, { ...(data[group] || values[group] || {}) }])));
      setDirty(false);
      showSuccess("Event Default Settings saved.");
    } catch (caught) {
      const fields = caught?.data?.errors?.fieldErrors;
      const lines = fields ? Object.entries(fields).map(([field, messages]) => `${field}: ${messages[0]}`) : [];
      setError([caught?.message || "Unable to save Event Default Settings.", ...lines].join(" "));
    } finally {
      setSaving(false);
    }
  }

  const close = () => guard(onClose);
  return <>
    <Dialog
      title="Event Default Settings"
      description="These are defaults for new events only; existing events keep their own copy."
      size="xl"
      height="tall"
      busy={saving}
      onClose={close}
      onSubmit={canWrite ? submit : undefined}
      bodyClassName="pb-4"
      footer={<>
        <Button type="button" className="max-sm:flex-1" onClick={close} disabled={saving}>{canWrite ? "Cancel" : "Close"}</Button>
        {canWrite && <Button type="submit" variant="primary" className="max-sm:flex-1" disabled={saving || loading || !values || !dirty}>{saving ? "Saving..." : "Save"}</Button>}
      </>}
    >
      <CardState loading={loading && !values} error={loadError} onRetry={load} rows={8}>
        {values && <SettingsGroupForm values={values} onChange={change} groups={GROUPS} readOnly={!canWrite} />}
      </CardState>
      {error && <p role="alert" className="mt-4 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
    </Dialog>
    <ConfirmDialog {...confirmProps} layer="confirmOverDialog" />
    <FloatingNotice notice={notice} onClose={clearNotice} />
  </>;
}
