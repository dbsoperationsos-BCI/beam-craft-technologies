"use client";

import SettingRow from "./SettingRow";
import SettingsCard from "./SettingsCard";

/**
 * Guest Access: how a guest gets into an event page and what they may do once in. Every switch is
 * enforced on the server (`public/service.js`); the descriptions say what each one changes there.
 *
 * Require name / phone are asked of everybody who joins, invited or not, so they stay live while
 * registration is off - the server checks them before it looks the guest up.
 */
export default function GuestAccessSettings({ values, onChange, readOnly = false, problems = {} }) {
  const guest = values.guestAccess || {};
  const set = (key) => (value) => onChange("guestAccess", key, value);
  // The two ways into Find My Photos hang off the guest selfie: inert while it is off, their
  // answers kept for when it is turned back on.
  const selfieOn = Boolean(guest.enableSelfie);
  const wayNote = selfieOn ? undefined : "Turn on Enable guest selfie to use this.";

  return <div className="space-y-4">
    <SettingsCard title="Guest registration" description="Who may join from the event link.">
      <SettingRow label="Allow guest registration" description="Anyone with the link can join. Off, only guests the studio has added by phone number are let in." checked={guest.allowRegistration} onChange={set("allowRegistration")} disabled={readOnly} />
    </SettingsCard>
    <SettingsCard title="Registration fields" description="What a guest is asked for when joining. Asked of invited guests as well.">
      <SettingRow label="Require name" description="The join form refuses an empty name." checked={guest.requireName} onChange={set("requireName")} disabled={readOnly} />
      <SettingRow label="Require phone number" description="The join form refuses an empty phone number. The number is also how an invited guest is recognised." checked={guest.requirePhone} onChange={set("requirePhone")} disabled={readOnly} />
      <SettingRow label="Confirm phone numbers by SMS" description="Guests joining with a phone number confirm it with a texted code first (a number we cannot text may only join as a new guest). Guests who already have photos here are always asked on a new device, even with this off. Needs SMS to be set up - ask your administrator." checked={guest.verifyPhone} onChange={set("verifyPhone")} disabled={readOnly} />
    </SettingsCard>
    <SettingsCard title="Guest experience" description="What a guest can do on the event page.">
      <SettingRow label="Enable guest selfie" description="Enables Find My Photos for guests: a selfie matched against the event's faces. Also needs Selfie search under AI & Face Recognition." checked={guest.enableSelfie} onChange={set("enableSelfie")} disabled={readOnly} />
      <SettingRow label="Allow Take Selfie" description="Guests can capture a selfie using their device camera." note={wayNote} checked={guest.allowTakeSelfie !== false} onChange={set("allowTakeSelfie")} disabled={readOnly || !selfieOn} />
      <SettingRow label="Allow Upload Selfie" description="Guests can select an existing selfie from their device for Find My Photos. Not the same as guest uploads below." note={wayNote} checked={guest.allowUploadSelfie !== false} onChange={set("allowUploadSelfie")} disabled={readOnly || !selfieOn} />
      {problems.allowTakeSelfie && <p role="alert" className="py-2 text-xs text-red-600">{problems.allowTakeSelfie}</p>}
      <SettingRow label="Enable guest uploads" description="Guests can upload their own event photographs into the event." checked={guest.enableGuestUploads} onChange={set("enableGuestUploads")} disabled={readOnly} />
    </SettingsCard>
    <SettingsCard title="RSVP" description="Attendance answers on the event page.">
      <SettingRow label="Enable RSVP" description="Guests can say whether they are coming; the Guests tab shows the answers." checked={guest.enableRsvp} onChange={set("enableRsvp")} disabled={readOnly} />
    </SettingsCard>
  </div>;
}
