"use client";

import Dropdown from "@/components/shared/Dropdown";
import { VISIBILITY_OPTIONS, shownVisibility } from "@/lib/aiEventDefaults.mjs";
import WatermarkField from "@/components/ai-feature/watermarks/WatermarkField";
import NumberSetting from "./NumberSetting";
import SettingRow from "./SettingRow";
import SettingsCard from "./SettingsCard";

/**
 * Privacy & Access: what a guest may see and take away (the stored `gallery` group), how far
 * their view reaches and how long personal data is kept (the `privacy` group).
 */
export default function PrivacySettings({ values, onChange, readOnly = false }) {
  const privacy = values.privacy || {};
  const gallery = values.gallery || {};
  const setPrivacy = (key) => (value) => onChange("privacy", key, value);
  const setGallery = (key) => (value) => onChange("gallery", key, value);

  return <div className="space-y-4">
    <SettingsCard title="Guest photo visibility" description="How far a guest's view of the event reaches.">
      <div className="grid gap-4 py-4 sm:grid-cols-2">
        <Dropdown label="Guest photo visibility" helperText="Every photo, or only the photos the guest was matched in." options={VISIBILITY_OPTIONS} value={shownVisibility(privacy.guestPhotoVisibility)} readOnly={readOnly} onChange={setPrivacy("guestPhotoVisibility")} sorted={false} />
      </div>
    </SettingsCard>
    <SettingsCard title="Guest gallery" description="What the event page offers a guest.">
      <SettingRow label="Show My Photos" description="Guests see only the photos their selfie matched." checked={gallery.showMyPhotos} onChange={setGallery("showMyPhotos")} disabled={readOnly} />
      <SettingRow label="Allow downloads" description="Guests can save the photos their selfie matched." checked={gallery.allowDownloads} onChange={setGallery("allowDownloads")} disabled={readOnly} />
      <SettingRow label="Allow sharing" description="Guests can share a photo from the event page." checked={gallery.allowSharing} onChange={setGallery("allowSharing")} disabled={readOnly} />
    </SettingsCard>
    <SettingsCard title="Watermark" description="The watermark new events start with. Each event can choose another, or none, for itself.">
      <div className="py-4"><WatermarkField gallery={gallery} onChange={(key, value) => setGallery(key)(value)} readOnly={readOnly} manage /></div>
    </SettingsCard>
    <SettingsCard title="Data retention" description="How long personal data taken for matching is kept.">
      <div className="grid gap-4 py-4 sm:grid-cols-2">
        <NumberSetting label="Keep selfies for" unit="days" min={1} max={3650} readOnly={readOnly} value={privacy.selfieRetentionDays} onChange={setPrivacy("selfieRetentionDays")} description="How long a guest's selfie is kept after it is registered." />
        <NumberSetting label="Keep face data for" unit="days" min={1} max={3650} readOnly={readOnly} value={privacy.faceDataRetentionDays} onChange={setPrivacy("faceDataRetentionDays")} description="How long detected faces and their vectors are kept." />
      </div>
    </SettingsCard>
  </div>;
}
