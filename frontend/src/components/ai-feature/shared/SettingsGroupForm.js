"use client";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import TextField from "@/components/shared/TextField";
import Dropdown from "@/components/shared/Dropdown";

/**
 * The settings groups an event and the studio defaults share, drawn once from data so the wizard's
 * step, the event's own Settings and More → Event Default Settings cannot describe three different
 * configurations. `values` is `{ guestAccess, ai, media, gallery, privacy, notifications }` (and
 * `general` for the defaults); `onChange(group, key, value)` writes one key.
 *
 * `groups` limits which groups are drawn, so the wizard can show Guest Configuration and Media / AI
 * on steps of their own. `readOnly` draws the values and offers no control.
 */
const HANDLING = [{ label: "Auto match", value: "AUTO" }, { label: "Send to review queue", value: "REVIEW" }, { label: "Do not show", value: "HIDE" }];
const VISIBILITY = [{ label: "Every photo in the event", value: "ALL" }, { label: "Only the photos they are in", value: "MATCHED_ONLY" }, { label: "Their group's sub-events", value: "SUB_EVENT" }];

export const GROUP_TITLES = { general: "General", guestAccess: "Guest access", ai: "AI", media: "Media", gallery: "Gallery", privacy: "Privacy", notifications: "Notifications" };

function Toggle({ group, name, label, values, onChange, readOnly }) {
  return <ToggleSwitch label={label} checked={Boolean(values[group]?.[name])} disabled={readOnly} onCheckedChange={(checked) => onChange(group, name, checked)} className="w-full justify-between sm:w-auto sm:justify-start" />;
}
function Number_({ group, name, label, values, onChange, readOnly, min, max, step = 1 }) {
  return <TextField label={label} type="number" min={min} max={max} step={step} readOnly={readOnly} value={values[group]?.[name] ?? ""} onChange={(event) => onChange(group, name, event.target.value === "" ? "" : Number(event.target.value))} />;
}

export default function SettingsGroupForm({ values, onChange, groups = ["guestAccess", "ai", "media", "gallery", "privacy", "notifications"], readOnly = false, eventTypes }) {
  const props = { values, onChange, readOnly };
  const has = (group) => groups.includes(group) && values[group];
  const faceOn = Boolean(values.ai?.faceRecognition);
  return <div className="space-y-6">
    {has("general") && <Section title={GROUP_TITLES.general}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Dropdown label="Default event type" options={(eventTypes || values.general.eventTypes || []).map((type) => ({ label: type, value: type }))} value={values.general.defaultEventType || ""} readOnly={readOnly} onChange={(value) => onChange("general", "defaultEventType", value)} sorted={false} />
        <TextField label="Default timezone" readOnly={readOnly} value={values.general.defaultTimezone || ""} onChange={(event) => onChange("general", "defaultTimezone", event.target.value)} />
        <Number_ group="general" name="defaultDurationDays" label="Default event duration (days)" min={1} max={30} {...props} />
        <TextField label="Event types (comma separated)" readOnly={readOnly} value={(values.general.eventTypes || []).join(", ")} onChange={(event) => onChange("general", "eventTypes", event.target.value.split(",").map((item) => item.trim()).filter(Boolean))} />
      </div>
    </Section>}
    {has("guestAccess") && <Section title={GROUP_TITLES.guestAccess}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Toggle group="guestAccess" name="allowRegistration" label="Allow guest registration" {...props} />
        <Toggle group="guestAccess" name="enableRsvp" label="Enable RSVP" {...props} />
        <Toggle group="guestAccess" name="requireName" label="Require name" {...props} />
        <Toggle group="guestAccess" name="requirePhone" label="Require phone number" {...props} />
        <Toggle group="guestAccess" name="enableSelfie" label="Enable guest selfie" {...props} />
        <Toggle group="guestAccess" name="enableGuestUploads" label="Enable guest uploads" {...props} />
      </div>
    </Section>}
    {has("ai") && <Section title={GROUP_TITLES.ai}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Toggle group="ai" name="faceRecognition" label="Enable face recognition" {...props} />
        {faceOn && <>
          <Toggle group="ai" name="faceClustering" label="Face clustering (People)" {...props} />
          <Toggle group="ai" name="selfieSearch" label="Selfie search (Find My Photos)" {...props} />
          <Toggle group="ai" name="automaticMatching" label="Automatic face matching" {...props} />
        </>}
      </div>
      {faceOn && <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Number_ group="ai" name="minFaceQuality" label="Minimum face quality (0-1)" min={0} max={1} step={0.05} {...props} />
        <Number_ group="ai" name="similarityHigh" label="High-confidence similarity (0-1)" min={0} max={1} step={0.01} {...props} />
        <Number_ group="ai" name="similarityMedium" label="Medium-confidence similarity (0-1)" min={0} max={1} step={0.01} {...props} />
        <Number_ group="ai" name="clusterThreshold" label="Same-person threshold (0-1)" min={0} max={1} step={0.01} {...props} />
        <Dropdown label="Medium confidence" options={HANDLING} value={values.ai.mediumConfidenceHandling} readOnly={readOnly} onChange={(value) => onChange("ai", "mediumConfidenceHandling", value)} sorted={false} />
        <Dropdown label="Low confidence" options={HANDLING} value={values.ai.lowConfidenceHandling} readOnly={readOnly} onChange={(value) => onChange("ai", "lowConfidenceHandling", value)} sorted={false} />
      </div>}
      {faceOn && <p className="mt-2 text-[11px] text-slate-500">High confidence matches automatically. Similarity is cosine similarity between face vectors; the defaults suit the ArcFace model the engine runs.</p>}
    </Section>}
    {has("media") && <Section title={GROUP_TITLES.media}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Toggle group="media" name="photoUpload" label="Photo upload" {...props} />
        <Toggle group="media" name="videoUpload" label="Video upload" {...props} />
        <Toggle group="media" name="keepOriginals" label="Keep original files (more storage)" {...props} />
        <Number_ group="media" name="maxFileSizeMb" label="Max file size (MB)" min={1} max={500} {...props} />
        <TextField label="Allowed formats (comma separated)" readOnly={readOnly} value={(values.media.allowedFormats || []).join(", ")} onChange={(event) => onChange("media", "allowedFormats", event.target.value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean))} className="sm:col-span-2" />
      </div>
    </Section>}
    {has("gallery") && <Section title={GROUP_TITLES.gallery}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Toggle group="gallery" name="showAllPhotos" label="Show All Photos" {...props} />
        <Toggle group="gallery" name="showMyPhotos" label="Show My Photos" {...props} />
        <Toggle group="gallery" name="showPeople" label="Show People to guests" {...props} />
        <Toggle group="gallery" name="allowDownloads" label="Allow downloads" {...props} />
        <Toggle group="gallery" name="allowSharing" label="Allow sharing" {...props} />
        <Toggle group="gallery" name="watermark" label="Watermark" {...props} />
      </div>
    </Section>}
    {has("privacy") && <Section title={GROUP_TITLES.privacy}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Dropdown label="Guest photo visibility" options={VISIBILITY} value={values.privacy.guestPhotoVisibility} readOnly={readOnly} onChange={(value) => onChange("privacy", "guestPhotoVisibility", value)} sorted={false} />
        <Number_ group="privacy" name="selfieRetentionDays" label="Keep selfies for (days)" min={1} max={3650} {...props} />
        <Number_ group="privacy" name="faceDataRetentionDays" label="Keep face data for (days)" min={1} max={3650} {...props} />
      </div>
    </Section>}
    {has("notifications") && <Section title={GROUP_TITLES.notifications}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Toggle group="notifications" name="newPhoto" label="New photo notification" {...props} />
        <Toggle group="notifications" name="processingCompleted" label="Processing completed" {...props} />
        <Toggle group="notifications" name="newMatch" label="New match notification" {...props} />
      </div>
    </Section>}
  </div>;
}

export function Section({ title, children }) {
  return <section>
    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
    {children}
  </section>;
}
