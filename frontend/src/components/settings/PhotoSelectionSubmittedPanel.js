"use client";

import AttendanceWhatsAppReportPanel from "@/components/settings/AttendanceWhatsAppReportPanel";
import {
  clearPhotoSelectionGroupName,
  getPhotoSelectionNotification,
  listPhotoSelectionSenderCandidates,
  setPhotoSelectionGroupName,
  setPhotoSelectionNotificationEnabled,
  setPhotoSelectionSenders,
} from "@/services/settings/automatic-whatsapp.service";

/*
 * Settings → User Settings → Automatic WhatsApp Message → Photo Selection Submitted.
 *
 * When a client submits their photo selection, one message into a WhatsApp group - its switch, who
 * sends it and where it goes exactly as the attendance report sets them: the same panel, with this
 * notification's own api and words, drawing one Notification card with the switch in its header.
 * The wording is not here: it is a message template like every other message the app sends, edited
 * where they all are - Settings → Templates → Photo Selection Submitted, behind
 * `SETTINGS / Message Template`.
 */

const API = {
  getStatus: getPhotoSelectionNotification,
  listCandidates: listPhotoSelectionSenderCandidates,
  setEnabled: setPhotoSelectionNotificationEnabled,
  setGroupName: setPhotoSelectionGroupName,
  setSenders: setPhotoSelectionSenders,
  clearGroupName: clearPhotoSelectionGroupName,
};
const WORDING = {
  what: "the notification",
  loadError: "Unable to read the Photo Selection Submitted notification.",
  sentLabel: "Last notification today",
  nameSaved: () => "Group name saved - checked against each sender's WhatsApp when a client next submits a selection.",
  cleared: "Group name cleared. No notification is sent until a group is named again.",
  clearMessage: (groupName) => `No Photo Selection Submitted notification will be sent until a group name is set again${groupName ? ` (currently "${groupName}")` : ""}.`,
  placeholder: "e.g. Studio Team",
  whereNote: "Sent, when a client submits their selection, into the WhatsApp group with this name - matched against each sender's own groups when it sends, not when you save.",
  serverOverride: "",
  switchNote: "Sent once, after the client's submission has been saved. Nothing is sent while this is off, or while no group is named.",
  switchAria: "Send a WhatsApp message when a client submits their photo selection",
  switchedOn: "On. A client's submitted selection is now announced in the group.",
  switchedOff: "Off. Nothing is sent when a client submits a selection.",
};

/** `canWrite` is this row's own Read / Write, which the switch answers to; the senders and the group answer to it on the server. */
export default function PhotoSelectionSubmittedPanel({ onNotice, canWrite = false }) {
  return <AttendanceWhatsAppReportPanel onNotice={onNotice} api={API} wording={WORDING} canWrite={canWrite} />;
}
