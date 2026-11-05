"use client";

import Button from "@/components/shared/Button";
import Dialog from "@/components/ui/Dialog";
import { WhatsAppPairingCode, useWhatsappPairingSession } from "@/components/image-selection/WhatsAppPairing";
import { connectAttendanceReportWhatsapp, getAttendanceReportWhatsappSession } from "@/services/hrm/attendance.service";

/**
 * Connects this person's own WhatsApp for the Attendance Register's daily report.
 *
 * Built the way Image Selection's pairing is, from the same parts (`WhatsAppPairingCode`,
 * `useWhatsappPairingSession`): only pairing, nothing to pick. The WhatsApp group the report goes to
 * is a name an administrator types in Settings, not a group picked from any one person's own list -
 * at send time, whichever sender is being tried has their own joined groups searched for a match. So
 * once this person's WhatsApp is connected there is nothing further to choose here: their turn
 * succeeds the day their own WhatsApp is in a group of that name.
 */
export default function AttendanceReportGroupDialog({ status, onClose }) {
  const { session, connected, starting, error, waiting, start } = useWhatsappPairingSession(true, {
    autoStart: true,
    readSession: getAttendanceReportWhatsappSession,
    connectSession: connectAttendanceReportWhatsapp,
  });

  return <Dialog
    title="Connect WhatsApp"
    description={connected
      ? `Connected. The report can go from your WhatsApp when it is your turn, if it is in a group named "${status?.groupName || "the one set in Settings"}".`
      : "Link your WhatsApp so it can send the attendance report when it is your turn."}
    size="sm"
    onClose={onClose}
    footer={<Button type="button" onClick={onClose} className="max-sm:flex-1">Close</Button>}
  >
    {!connected
      ? <WhatsAppPairingCode session={session} starting={starting} error={error} waiting={waiting} onStart={start} />
      : <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">Your WhatsApp is connected.</p>}
  </Dialog>;
}
