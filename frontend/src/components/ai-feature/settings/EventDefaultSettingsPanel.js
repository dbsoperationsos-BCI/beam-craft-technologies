"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useModuleAccess } from "@/components/auth/PermissionsProvider";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import SchemaFormSection from "@/components/schema-form/SchemaFormSection";
import Button from "@/components/shared/Button";
import useUnsavedGuard, { useUnloadWarning } from "@/components/shared/useUnsavedGuard";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { layers } from "@/constants/layers";
import { SECTIONS, formState, hasChanges, hasProblems, payloadOf, settingsProblems } from "@/lib/aiEventDefaults.mjs";
import { getAiEventDefaults, saveAiEventDefaults } from "@/services/ai-feature/ai-feature.service";
import AiFaceSettings from "./AiFaceSettings";
import FaceMatchingSettings from "./FaceMatchingSettings";
import GeneralSettings from "./GeneralSettings";
import GuestAccessSettings from "./GuestAccessSettings";
import MediaUploadSettings from "./MediaUploadSettings";
import PrivacySettings from "./PrivacySettings";
import ProcessingSettings from "./ProcessingSettings";

/**
 * More → Event Default Settings: the studio's template for new events, as a full-size settings
 * workspace on the shared `SchemaFormPanel` - the shell Image Selection's Settings wears, with a
 * rail on the left, one section on the right, and Cancel / Save Settings fixed along the bottom.
 * Only the shell is shared; nothing here reads or writes Image Selection's record.
 *
 * One record, read whole and saved whole. It shapes an event only at the moment the wizard opens -
 * every event keeps its own copy from then on (`snapshotForEvent` on the server) - which the note
 * under the title says, because the obvious reading of "default settings" is that changing them
 * changes everything.
 *
 * The rail moves between sections without asking: every section edits the same unsaved copy and one
 * Save sends all of it, so nothing is lost by looking at another section. Closing is what can lose
 * an edit, so ×, Cancel, Escape and a browser refresh all ask first.
 *
 * IMAGE_SELECTION / AI Event Default Settings: READ sees every value, dimmed and refused;
 * READ_WRITE is offered Save. The server guard is the authority either way.
 */
const SECTION_INTRO = {
  general: "What a new event starts as, and the event types the wizard offers.",
  guestAccess: "How a guest joins the event page and what they may do there.",
  ai: "What the face engine does with each uploaded photo.",
  matching: "How a match is handled at each confidence, and the numbers that draw the bands.",
  processing: "What an event accepts on upload, what it keeps, and which processing events raise a notification.",
  mediaUpload: "How a photo is optimized before it is stored, and how many the uploader works on at once. Future uploads only.",
  privacy: "What a guest may see and take away, and how long personal data is kept.",
};

const SECTION_BODIES = {
  general: GeneralSettings,
  guestAccess: GuestAccessSettings,
  ai: AiFaceSettings,
  matching: FaceMatchingSettings,
  processing: ProcessingSettings,
  mediaUpload: MediaUploadSettings,
  privacy: PrivacySettings,
};

export default function EventDefaultSettingsPanel({ onClose }) {
  const { canWrite } = useModuleAccess("IMAGE_SELECTION", "AI Event Default Settings");
  const [values, setValues] = useState(null);
  // What the server last said, so Save knows whether there is anything to send and a value typed
  // and put back leaves the button off.
  const [saved, setSaved] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [activeId, setActiveId] = useState(SECTIONS[0].id);

  const dirty = hasChanges(saved, values);
  const problems = values ? settingsProblems(values) : {};
  const blocked = hasProblems(problems);
  const { guard, confirmProps } = useUnsavedGuard(dirty && !saving, {
    title: "Discard unsaved changes?",
    message: "Your changes to the Event Default Settings have not been saved.",
    cancelLabel: "Keep Editing",
    confirmLabel: "Discard Changes",
  });
  useUnloadWarning(true, dirty && !saving);

  const load = useCallback(async () => {
    setLoading(true); setLoadError("");
    try {
      const data = (await getAiEventDefaults())?.data || {};
      setValues(formState(data));
      setSaved(formState(data));
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

  const change = useCallback((group, key, value) => {
    setNotice(null);
    setValues((current) => ({ ...current, [group]: { ...current[group], [key]: value } }));
  }, []);

  async function submit(submitEvent) {
    submitEvent.preventDefault();
    if (!canWrite || !values || saving || blocked) return;
    setSaving(true); setNotice(null);
    try {
      const data = (await saveAiEventDefaults(payloadOf(values)))?.data || {};
      // Show back what was stored, so the screen and the record agree without a reload.
      setValues(formState(data));
      setSaved(formState(data));
      // Said again here, where somebody has just changed a value expecting a live event to follow:
      // an existing event keeps its own copy, and is changed under its own Event Settings.
      setNotice({ message: "Saved successfully. New events will start from these settings; an existing event keeps its own copy, changed under More → Event Settings on the event.", tone: "success" });
    } catch (caught) {
      // The edit stays on screen: a refused save is something to correct, not something to retype.
      const fields = caught?.data?.errors?.fieldErrors;
      const lines = fields ? Object.entries(fields).map(([field, messages]) => `${field}: ${messages[0]}`) : [];
      setNotice({ message: [caught?.message || "Unable to save Event Default Settings.", ...lines].join(" "), tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  // The pane scrolls, not the page; a new section starts at its top rather than wherever the last
  // one was left.
  const bodyRef = useRef(null);
  useEffect(() => { bodyRef.current?.closest("main")?.scrollTo({ top: 0 }); }, [activeId]);

  const close = () => guard(() => onClose?.());
  const section = SECTIONS.find((item) => item.id === activeId) || SECTIONS[0];
  const Body = SECTION_BODIES[section.id];
  const shownNotice = loadError ? { message: loadError, tone: "error" } : notice;

  return <SchemaFormPanel
    title="Event Default Settings"
    description="Defaults for newly created events only. An existing event keeps its own copy of these settings."
    sections={SECTIONS.map(({ id, title }) => [id, title])}
    activeSectionId={section.id}
    onSectionSelect={setActiveId}
    values={{}}
    onChange={() => {}}
    errors={{}}
    validateRequired={false}
    sidebarAriaLabel="Event Default Settings sections"
    closeAriaLabel="Close Event Default Settings"
    onClose={close}
    onSubmit={canWrite ? submit : (event) => event.preventDefault()}
    readOnly={!canWrite}
    readOnlyReason="You can read these settings but not change them."
    error={shownNotice}
    saving={saving}
    loading={loading && !values}
    loadingLabel="Loading Event Default Settings..."
    submitLabel={canWrite ? "Save Settings" : undefined}
    savingLabel="Saving..."
    submitDisabled={!values || !dirty || blocked || Boolean(loadError)}
    footer={canWrite ? undefined : <Button type="button" className="max-sm:flex-1" onClick={close}>Close</Button>}
    zIndexClassName={layers.formPanel}
  >
    <div ref={bodyRef}>
      {loadError && !values
        ? <SchemaFormSection id={section.id} title={section.title}>
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <p>{loadError}</p>
            <Button type="button" size="sm" className="mt-3" onClick={load}>Retry</Button>
          </div>
        </SchemaFormSection>
        : values && <SchemaFormSection id={section.id} title={section.title}>
          <p className="mb-4 text-sm text-slate-500">{SECTION_INTRO[section.id]}</p>
          <Body values={values} onChange={change} readOnly={!canWrite} problems={problems[section.id] || {}} />
        </SchemaFormSection>}
    </div>
    {/* Inside the panel so it stacks over it; see `layers.dialogOverPanel`. */}
    <ConfirmDialog {...confirmProps} layer="dialogOverPanel" />
  </SchemaFormPanel>;
}
