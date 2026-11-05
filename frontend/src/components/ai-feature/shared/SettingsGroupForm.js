"use client";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import TextField from "@/components/shared/TextField";
import Dropdown from "@/components/shared/Dropdown";
import WatermarkField from "@/components/ai-feature/watermarks/WatermarkField";
import { shownVisibility } from "@/lib/aiEventDefaults.mjs";

/**
 * The settings groups an event and the studio defaults share, drawn once from data so the wizard's
 * step, the event's own Settings and More → Event Default Settings cannot describe three different
 * configurations. `values` is `{ guestAccess, ai, media, gallery, privacy, notifications }` (and
 * `general` for the defaults); `onChange(group, key, value)` writes one key.
 *
 * `groups` limits which groups are drawn, so the wizard can show Guest Configuration and Media / AI
 * on steps of their own. `readOnly` draws the values and offers no control. `watermarkDefaultId` is
 * the preset Event Default Settings names, so Create Event can mark it as the default.
 *
 * What an event's form leaves out on purpose: the face-matching thresholds and their handling
 * (the studio's tuning, under Event Default Settings → Face Matching, copied into each new event
 * and carried through `values.ai` untouched), and compression (always on; the presets come from
 * Event Default Settings → Media Upload the same way). The AI Feature takes photos only and keeps
 * no original, so neither is offered.
 */
const VISIBILITY = [{ label: "Every photo in the event", value: "ALL" }, { label: "Only the photos they are in", value: "MATCHED_ONLY" }];

export const GROUP_TITLES = { general: "General", guestAccess: "Guest access", ai: "AI", media: "Media", gallery: "Gallery", privacy: "Privacy", notifications: "Notifications" };

function Toggle({ group, name, label, helperText, values, onChange, readOnly, disabled = false, title }) {
  return <ToggleSwitch label={label} helperText={helperText} title={title} checked={Boolean(values[group]?.[name])} disabled={readOnly || disabled} onCheckedChange={(checked) => onChange(group, name, checked)} className="w-full justify-between sm:w-auto sm:justify-start" />;
}
function Number_({ group, name, label, helperText, values, onChange, readOnly, min, max, step = 1 }) {
  return <TextField label={label} helperText={helperText} type="number" min={min} max={max} step={step} readOnly={readOnly} value={values[group]?.[name] ?? ""} onChange={(event) => onChange(group, name, event.target.value === "" ? "" : Number(event.target.value))} />;
}

export default function SettingsGroupForm({ values, onChange, groups = ["guestAccess", "ai", "media", "gallery", "privacy", "notifications"], readOnly = false, eventTypes, watermarkDefaultId }) {
  const props = { values, onChange, readOnly };
  const has = (group) => groups.includes(group) && values[group];
  const faceOn = Boolean(values.ai?.faceRecognition);
  return <div className="space-y-6">
    {has("general") && <Section title={GROUP_TITLES.general}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Dropdown label="Default event type" helperText="The type a new event starts with in the Create Event wizard." options={(eventTypes || values.general.eventTypes || []).map((type) => ({ label: type, value: type }))} value={values.general.defaultEventType || ""} readOnly={readOnly} onChange={(value) => onChange("general", "defaultEventType", value)} sorted={false} />
        <TextField label="Default timezone" helperText="Time zone new events start with, written like Asia/Kolkata." readOnly={readOnly} value={values.general.defaultTimezone || ""} onChange={(event) => onChange("general", "defaultTimezone", event.target.value)} />
        <Number_ group="general" name="defaultDurationDays" label="Default event duration (days)" helperText="How many days a new event is assumed to run, from 1 to 30." min={1} max={30} {...props} />
        <TextField label="Event types (comma separated)" helperText="The event types the wizard offers, separated by commas." readOnly={readOnly} value={(values.general.eventTypes || []).join(", ")} onChange={(event) => onChange("general", "eventTypes", event.target.value.split(",").map((item) => item.trim()).filter(Boolean))} />
      </div>
    </Section>}
    {has("guestAccess") && <Section title={GROUP_TITLES.guestAccess}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Toggle group="guestAccess" name="allowRegistration" label="Allow guest registration" helperText="Lets guests join the event themselves from the guest link." {...props} />
        <Toggle group="guestAccess" name="enableRsvp" label="Enable RSVP" helperText="Lets guests say whether they are coming to the event." {...props} />
        <Toggle group="guestAccess" name="requireName" label="Require name" helperText="Guests must give their name before they can join." {...props} />
        <Toggle group="guestAccess" name="requirePhone" label="Require phone number" helperText="Guests must give a phone number before they can join." {...props} />
        <Toggle group="guestAccess" name="verifyPhone" label="Confirm phone numbers by SMS" helperText="Guests confirm their number with a texted code before joining." title="Guests joining with a phone number confirm it with a texted code first (a number we cannot text may only join as a new guest). Guests who already have photos here are always asked on a new device, even with this off. Needs SMS to be set up - ask your administrator." {...props} />
        <Toggle group="guestAccess" name="enableSelfie" label="Enable guest selfie" helperText="Lets guests use a selfie to find the photos they are in." {...props} />
        <Toggle group="guestAccess" name="enableGuestUploads" label="Enable guest uploads" helperText="Lets guests add their own photos to the event." {...props} />
        {/* The two ways into Find My Photos, inert while the guest selfie is off; their answers
            are kept for when it is turned back on. Not the same thing as guest uploads above. */}
        <Toggle group="guestAccess" name="allowTakeSelfie" label="Allow Take Selfie (camera)" helperText="Guests may take their selfie with the phone or laptop camera." disabled={!values.guestAccess?.enableSelfie} title={values.guestAccess?.enableSelfie ? undefined : "Turn on Enable guest selfie first."} {...props} />
        <Toggle group="guestAccess" name="allowUploadSelfie" label="Allow Upload Selfie (from device)" helperText="Guests may pick an existing selfie from their device." disabled={!values.guestAccess?.enableSelfie} title={values.guestAccess?.enableSelfie ? undefined : "Turn on Enable guest selfie first."} {...props} />
      </div>
      {values.guestAccess?.enableSelfie && values.guestAccess?.allowTakeSelfie === false && values.guestAccess?.allowUploadSelfie === false && <p role="alert" className="mt-2 text-xs text-red-600">Enable at least one selfie option: Take Selfie or Upload Selfie.</p>}
    </Section>}
    {has("ai") && <Section title={GROUP_TITLES.ai}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Toggle group="ai" name="faceRecognition" label="Enable face recognition" helperText="Finds faces in the event photos so guests can be matched." {...props} />
        {faceOn && <>
          <Toggle group="ai" name="faceClustering" label="Face clustering (People)" helperText="Groups the same face across photos into people on the People tab." {...props} />
          <Toggle group="ai" name="selfieSearch" label="Selfie search (Find My Photos)" helperText="Lets a guest's selfie find the photos they appear in." {...props} />
          <Toggle group="ai" name="automaticMatching" label="Automatic face matching" helperText="Matches faces to guests on its own as photos are added." {...props} />
        </>}
      </div>
    </Section>}
    {has("media") && <Section title={GROUP_TITLES.media}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Toggle group="media" name="photoUpload" label="Photo upload" helperText="Allows photos to be uploaded to the event." {...props} />
        <Number_ group="media" name="maxFileSizeMb" label="Max file size (MB)" helperText="Largest photo, in MB, that may be uploaded, from 1 to 500." min={1} max={500} {...props} />
        <TextField label="Allowed photo formats (comma separated)" helperText="File types accepted on upload, such as jpg, png, separated by commas." readOnly={readOnly} value={(values.media.allowedFormats || []).join(", ")} onChange={(event) => onChange("media", "allowedFormats", event.target.value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean))} className="sm:col-span-2" />
      </div>
      <p className="mt-2 text-[11px] text-slate-500">Photos are compressed automatically before they are stored; originals are never kept.</p>
    </Section>}
    {has("gallery") && <Section title={GROUP_TITLES.gallery}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Toggle group="gallery" name="showMyPhotos" label="Show My Photos" helperText="Shows guests the photos they were matched in." {...props} />
        <Toggle group="gallery" name="allowDownloads" label="Allow downloads" helperText="Guests can save photos from the event page." {...props} />
        <Toggle group="gallery" name="allowSharing" label="Allow sharing" helperText="Guests can share a photo from the event page." {...props} />
      </div>
      <div className="mt-3"><WatermarkField gallery={values.gallery} onChange={(key, value) => onChange("gallery", key, value)} readOnly={readOnly} defaultPresetId={watermarkDefaultId} /></div>
    </Section>}
    {has("privacy") && <Section title={GROUP_TITLES.privacy}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Dropdown label="Guest photo visibility" helperText="Which photos each guest is allowed to see on the guest page." options={VISIBILITY} value={shownVisibility(values.privacy.guestPhotoVisibility)} readOnly={readOnly} onChange={(value) => onChange("privacy", "guestPhotoVisibility", value)} sorted={false} />
        <Number_ group="privacy" name="selfieRetentionDays" label="Keep selfies for (days)" helperText="Days a guest's selfie is kept after it is registered." min={1} max={3650} {...props} />
        <Number_ group="privacy" name="faceDataRetentionDays" label="Keep face data for (days)" helperText="Days detected faces and their face data are kept." min={1} max={3650} {...props} />
      </div>
    </Section>}
    {has("notifications") && <Section title={GROUP_TITLES.notifications}>
      <div className="grid gap-3 sm:grid-cols-2">
        {/* The one notification: the guest's WhatsApp match message. Stored as `guestWhatsAppSummary` (off by default); the old studio switches (newPhoto, processingCompleted, newMatch) never sent anything and are no longer shown. */}
        <Toggle group="notifications" name="guestWhatsAppSummary" label="New match notification" helperText="Guests who ask get one WhatsApp message when photos uploaded later are matched to them." title="Guests who tick for it get one WhatsApp message when photos uploaded later are matched to them - never for an upload alone, a failed match or the same photo twice. Offered only where the event asks guests for a phone number, and only when the server's WhatsApp messages are on." {...props} />
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
