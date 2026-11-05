"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import CompressionSettingsSection from "./compression/CompressionSettingsSection";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import useUnsavedGuard from "@/components/shared/useUnsavedGuard";
import TargetDownloadPathField from "./TargetDownloadPathField";
import SignatureAlbumSettingsField from "./SignatureAlbumSettingsField";
import CullingTrainingConsentField from "./CullingTrainingConsentField";
import { imageSelectionSettingsSections } from "@/constants/formPanelConfig";
import { getImageSelectionSettings, saveImageSelectionSettings } from "@/services/image-selection/image-selection.service";

/**
 * ⋮ → Settings on the Image Selection title bar: the settings shared by every project.
 *
 * There is one record behind this form, not one per project, which is why it takes no project and
 * is reachable from anywhere in the module. A single project's own settings — its validity toggles,
 * its per-item limits — live in the Selection Settings rail beside the workspace.
 *
 * The panel edits Downloads and the studio's Processing / Compression presets. Gallery link validity, the
 * default selection limit and the studio's Global Name and Logo are part of the same record and the
 * API expects the whole of it, so they are read here and written back exactly as they were found —
 * a save changes what the form asked for and nothing else. The validity and the limit stay
 * defaults applied at the moment something is created: neither one moves the expiry of a gallery
 * already published or rewrites a deliverable that carries its own quantity or override.
 *
 * The Target Download Path is the exception: it is a folder this browser was granted rather than a
 * value on the record, so it saves itself the moment it is picked and takes no part in submit.
 */
const formState = (settings) => ({
  galleryValidityMonths: String(settings.galleryValidityMonths ?? 6),
  defaultSelectionLimit: String(settings.defaultSelectionLimit ?? 50),
  // Read but never shown. The API takes the whole record and treats a missing field as "clear it",
  // so a form that left any of these out wiped it every time it saved — see submit(). The two
  // server paths have always been in this group; the name and logo joined it when their editor here
  // was removed in favour of the one in Settings → Organization → Branding Logo.
  originalStoragePath: settings.originalStoragePath || "",
  selectedOutputPath: settings.selectedOutputPath || "",
  studioName: settings.studioName || "",
  galleryLogoUrl: settings.galleryLogoUrl || "",
});

export default function ImageSelectionSettingsForm({ onClose, onSaved }) {
  // The Signature Album defaults save by their own button, so the panel's Save never writes them:
  // closing the panel - X, Cancel, Escape, or after Save Settings - asks first while any are unsaved.
  // A ref, so a keystroke there does not redraw the whole panel.
  const albumDefaultsDirty = useRef(false);
  const leave = useUnsavedGuard(() => albumDefaultsDirty.current, {
    title: "Signature Album defaults not saved",
    message: "The Signature Album defaults you changed have not been saved. Go back and use Save Signature Album Defaults to keep them.",
  });
  const close = () => leave.guard(() => onClose?.());
  const [values, setValues] = useState(null);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const settings = (await getImageSelectionSettings()).data || {};
      setValues(formState(settings));
      setError("");
    } catch (failure) {
      setError(failure.message || "Unable to load Image Selection settings.");
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
    setErrors((current) => (current[name] ? { ...current, [name]: undefined } : current));
  }, []);

  async function submit(event) {
    event.preventDefault();
    const nextErrors = {};
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      setError("Check the highlighted fields and try again.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await saveImageSelectionSettings({
        // Not edited by this form — sent back as they were read so the record survives the save. The
        // two server paths belong to this list as much as the numbers do: the API reads a missing one
        // as an instruction to clear it, so leaving them out turned a save here into a silent reset
        // of where the studio's masters and selected copies live.
        galleryValidityMonths: Number(values.galleryValidityMonths),
        defaultSelectionLimit: Number(values.defaultSelectionLimit),
        originalStoragePath: values.originalStoragePath || null,
        selectedOutputPath: values.selectedOutputPath || null,
        /*
         * The studio's Global Name and Global Logo, which this form no longer shows — they are
         * edited in Settings → Organization → Branding Logo, where studio-wide branding belongs.
         *
         * Still read in and sent straight back out, for the reason above: the API reads a missing
         * field as an instruction to clear it, so omitting these would blank the studio's name and
         * logo from the top bar, the login page, every quotation PDF and the client gallery the
         * first time anybody saved a download path here.
         */
        studioName: values.studioName.trim(),
        // Whatever was read: an existing link, which the backend echoes back untouched, or — for a
        // record last saved from Settings — the uploaded URL it compressed that picture down to.
        galleryLogoUrl: values.galleryLogoUrl || null,
      });
      // Show back what was stored: the logo comes back as its uploaded URL, not the data URI that
      // was sent, so a second save does not re-upload the same image.
      if (response?.data) setValues(formState(response.data));
      onSaved?.(response?.data);
      close();
    } catch (failure) {
      setError(failure.message || "Unable to save Image Selection settings.");
    } finally {
      setSaving(false);
    }
  }

  // The Target Download Path draws itself, because it is the browser's folder picker rather than an
  // input; passing it as a renderer keeps that JSX out of the field list the same way every other
  // custom field does. Rendered as an element rather than called as a plain function, so its hooks
  // belong to it and not to the field that draws it.
  const renderers = useMemo(() => ({
    targetDownloadPath: () => <TargetDownloadPathField />,
    // The studio's compression presets, one card per Virtual Curation module: their own record
    // and their own endpoint, each change saved as it is made - submit never touches them.
    processingSettings: () => <CompressionSettingsSection />,
    // The Signature Album defaults: their own record, saved by their own button.
    signatureAlbumSettings: () => <SignatureAlbumSettingsField onDirtyChange={(dirty) => { albumDefaultsDirty.current = dirty; }} />,
    // The studio's culling-training consent: its own record, saved as the switch moves.
    cullingTrainingSettings: () => <CullingTrainingConsentField />,
  }), []);

  return <>
  <ConfirmDialog {...leave.confirmProps} layer="confirmOverDialog" />
  <SchemaFormPanel
    title="Settings"
    description="Applies to every Image Selection project. A single project's own settings stay in its Selection Settings panel."
    sections={imageSelectionSettingsSections}
    values={values || {}}
    onChange={update}
    errors={errors}
    context={{ renderers }}
    sidebarAriaLabel="Image Selection settings sections"
    closeAriaLabel="Close Image Selection settings"
    onClose={close}
    onSubmit={submit}
    error={error}
    saving={saving}
    submitLabel="Save Settings"
    savingLabel="Saving..."
    loading={loading}
    loadingLabel="Loading Image Selection settings..."
  />
  </>;
}
