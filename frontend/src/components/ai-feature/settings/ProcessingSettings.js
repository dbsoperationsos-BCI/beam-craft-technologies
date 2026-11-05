"use client";

import ChipListField from "./ChipListField";
import NumberSetting from "./NumberSetting";
import SettingRow from "./SettingRow";
import SettingsCard from "./SettingsCard";

/**
 * Processing: what an event accepts on upload (the stored `media` group) - photos only, and only
 * their compressed preview and thumbnail are kept, so neither video nor originals is offered - and
 * which processing events raise a notification (the `notifications` group). Two stored groups, one
 * screen, because both are about what happens to a photo after it is handed over.
 */
export default function ProcessingSettings({ values, onChange, readOnly = false }) {
  const media = values.media || {};
  const notifications = values.notifications || {};
  const setMedia = (key) => (value) => onChange("media", key, value);
  const setNotify = (key) => (value) => onChange("notifications", key, value);

  return <div className="space-y-4">
    <SettingsCard title="Uploads" description="What the studio and, where allowed, guests can add to an event. Every photo is compressed before it is stored; originals are never kept.">
      <SettingRow label="Photo upload" description="Accept photographs." checked={media.photoUpload} onChange={setMedia("photoUpload")} disabled={readOnly} />
    </SettingsCard>
    <SettingsCard title="File limits" description="Refused at upload, before anything is stored.">
      <div className="grid gap-4 py-4 sm:grid-cols-2">
        <NumberSetting label="Max file size" unit="MB" min={1} max={500} readOnly={readOnly} value={media.maxFileSizeMb} onChange={setMedia("maxFileSizeMb")} description="A file larger than this is refused." />
        <div className="sm:col-span-2">
          <ChipListField
            label="Allowed formats"
            description="By file extension, lower-case. Anything else is refused at upload."
            values={media.allowedFormats || []}
            onChange={setMedia("allowedFormats")}
            placeholder="e.g. jpg"
            addLabel="Add format"
            max={20}
            maxLength={10}
            normalize={(text) => text.replace(/^\./, "").toLowerCase()}
            disabled={readOnly}
          />
        </div>
      </div>
    </SettingsCard>
    {/* The one notification: the guest's WhatsApp match message. Stored as `guestWhatsAppSummary` (off by default); the old studio switches (newPhoto, processingCompleted, newMatch) never sent anything and are no longer shown. */}
    <SettingsCard title="Notifications" description="The one message the AI Feature sends: to a guest, on WhatsApp.">
      <SettingRow label="New match notification" description="Guests who tick for it get one WhatsApp message when photos uploaded later are matched to them - never for an upload alone, a failed match or the same photo twice. Offered only where the event asks guests for a phone number, and only when the server's WhatsApp messages are on." checked={notifications.guestWhatsAppSummary} onChange={setNotify("guestWhatsAppSummary")} disabled={readOnly} />
    </SettingsCard>
  </div>;
}
