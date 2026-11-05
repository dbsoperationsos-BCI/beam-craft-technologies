"use client";

import HelpTip from "@/components/shared/HelpTip";
import ToggleSwitch from "@/components/shared/ToggleSwitch";

/**
 * What the client may do in the album. Each switch saves the moment it is pressed. Require PIN
 * comes first - whether the client is asked for the Access PIN (shown under Client Access while it
 * is on) before the album opens; a new album starts without one. Allow Download puts one Download
 * Album control on the client's page, which hands over the whole album as a single PDF; the
 * endpoint behind it refuses the download whenever the switch is off, so the switch is the
 * permission and not only the control.
 */
function Row({ label, description, checked, onChange, disabled }) {
  return <div className="flex items-center justify-between gap-3">
    <p className="flex items-center text-xs font-medium text-slate-700">{label}<HelpTip text={description} /></p>
    <ToggleSwitch ariaLabel={label} checked={checked} disabled={disabled} onCheckedChange={onChange} />
  </div>;
}

export default function ClientPermissions({ album, canWrite, busy = false, onChange }) {
  const permissions = album.permissions;
  const set = (patch) => onChange?.(patch);
  // Every switch waits for the save in flight, so two quick toggles cannot race and leave the
  // switch showing what the server did not keep.
  return <div className="space-y-3">
    <Row label="Require PIN" description="The client enters it to open the album" checked={album.link.requiresPin} disabled={!canWrite || busy} onChange={(value) => set({ requirePin: value })} />
    <Row label="Allow Download" description={permissions.allowDownload ? "A Download Album button hands over the whole album as one PDF" : "No download in the album"} checked={permissions.allowDownload} disabled={!canWrite || busy} onChange={(value) => set({ allowDownload: value })} />
    <Row label="Allow Social Share" description="A share button for the album link" checked={permissions.allowShare} disabled={!canWrite || busy} onChange={(value) => set({ allowShare: value })} />
  </div>;
}
