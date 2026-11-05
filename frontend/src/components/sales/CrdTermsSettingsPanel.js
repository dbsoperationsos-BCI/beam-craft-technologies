"use client";

import { useCallback, useEffect, useState } from "react";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import { crdSettingsSections } from "@/constants/formPanelConfig";
import { getCrdTermsSettings, saveCrdTermsSettings } from "@/services/sales/crd-terms-settings.service";

/**
 * ⋮ → Settings on the CRD Documents title bar.
 *
 * Both verticals appear one by one in the standard schema form scrollable view:
 * Dum Dum first, then Qua Qua. The left rail scrollspies to whichever section is
 * currently in view and allows quick scrolling between them.
 */
const formState = (settings) => ({
  dumDumTerms: settings.dumDumTerms || "",
  quaQuaTerms: settings.quaQuaTerms || "",
});

export default function CrdTermsSettingsPanel({ onClose, onSaved }) {
  const [values, setValues] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const settings = (await getCrdTermsSettings()).data || {};
      setValues(formState(settings));
      setError("");
    } catch (failure) {
      setError(failure.message || "Unable to load the terms & conditions.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const update = useCallback((name, value) => {
    setValues((current) => ({ ...current, [name]: value }));
  }, []);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await saveCrdTermsSettings({
        dumDumTerms: values.dumDumTerms,
        quaQuaTerms: values.quaQuaTerms,
      });
      if (response?.data) setValues(formState(response.data));
      onSaved?.(response?.data);
      onClose?.();
    } catch (failure) {
      setError(failure.message || "Unable to save the terms & conditions.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SchemaFormPanel
      title="Settings"
      description="Configure settings for CRD Documents."
      sections={crdSettingsSections}
      values={values || {}}
      onChange={update}
      sidebarAriaLabel="CRD settings sections"
      closeAriaLabel="Close Settings"
      onClose={onClose}
      onSubmit={submit}
      error={error}
      saving={saving}
      submitLabel="Update"
      savingLabel="Updating..."
      cancelLabel="Discard"
      loading={loading}
      loadingLabel="Loading settings..."
    />
  );
}
