"use client";

import { useRef, useState } from "react";
import AttendanceWhatsAppReportPanel from "@/components/settings/AttendanceWhatsAppReportPanel";
import MessageSwitch from "@/components/settings/MessageSwitch";
import WishesPanel from "@/components/settings/WishesPanel";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Tabs from "@/components/ui/Tabs";
import { WISH_SWITCH_FOR_TAB } from "@/lib/messageSwitches.mjs";
import {
  clearWishesGroupName,
  getWishesScheduler,
  listWishesSenderCandidates,
  setWishesGroupName,
  setWishesSendAt,
  setWishesSenders,
} from "@/services/settings/wishes.service";

/*
 * The sending half: the WhatsApp group the birthday, anniversary and work anniversary wishes go to,
 * when, and who sends them - Attendance WhatsApp Report's panel, on the wishes' own settings. Priority
 * 1 is chosen on SETTINGS / Wishes Read / Write; each sender connects their own WhatsApp from
 * Attendance WhatsApp Report, once, for both.
 */

const WISHES_API = {
  getStatus: getWishesScheduler,
  listCandidates: listWishesSenderCandidates,
  setGroupName: setWishesGroupName,
  setSendAt: setWishesSendAt,
  setSenders: setWishesSenders,
  clearGroupName: clearWishesGroupName,
};

const WISHES_WORDING = {
  what: "the wishes",
  loadError: "Unable to read the wishes scheduler.",
  sentLabel: "Today's wishes",
  sendAtSaved: (sendAt) => `Wishes will now be sent at ${sendAt}. A wish already sent today is not sent again.`,
  nameSaved: (sendAt) => `Group name saved - checked against each sender's WhatsApp the next time wishes are sent, at ${sendAt}.`,
  cleared: "Group name cleared. No birthday or anniversary wish is sent until one is named again.",
  clearMessage: (groupName) => `No birthday or anniversary wish will be sent until a group name is set again${groupName ? ` (currently "${groupName}")` : ""}.`,
  placeholder: "e.g. Studio Family",
  serverOverride: "",
};

// The three wordings the scheduler sends, as tabs under it - one kind of wish on screen at a time.
const WISH_TABS = [
  { id: "birthday", label: "Birthday Wishes" },
  { id: "weddingAnniversary", label: "Anniversary Wishes" },
  { id: "workAnniversary", label: "Work Anniversary Wishes" },
];

/*
 * Settings → Templates → Wishes Scheduler: where, when and by whom the wishes go, and under it the
 * wishes themselves - Birthday, Anniversary and Work Anniversary as tabs, so the sending and what is
 * sent are one screen. A switch asked for while the open tab has unsaved wording is asked first, as
 * Interview Welcome's wordings are.
 */
export default function WishesSchedulerPanel({ canWrite = false, unsavedRef, onNotice, onError }) {
  const [kind, setKind] = useState(WISH_TABS[0].id);
  const [pendingKind, setPendingKind] = useState(null);
  const ownUnsaved = useRef(false);
  const unsaved = unsavedRef || ownUnsaved;
  const askKind = (next) => { if (next === kind) return; if (unsaved.current) setPendingKind(next); else setKind(next); };
  return <div className="space-y-4">
    <AttendanceWhatsAppReportPanel onNotice={onNotice} api={WISHES_API} wording={WISHES_WORDING} />
    <Tabs tabs={WISH_TABS} value={kind} onChange={askKind} ariaLabel="Which wishes" className="border-b border-slate-200" />
    {/* Whether this kind of wish is sent at all - saved on its own, apart from the wording. */}
    <MessageSwitch key={`switch-${kind}`} switchKey={WISH_SWITCH_FOR_TAB[kind]} canWrite={canWrite} onNotice={onNotice} onError={onError} />
    <WishesPanel key={kind} kind={kind} canWrite={canWrite} unsavedRef={unsaved} onNotice={onNotice} onError={onError} />
    {pendingKind && <ConfirmDialog
      title="Discard your changes?"
      message="These wishes have changes that are not saved. Switching to the other wishes throws them away."
      confirmLabel="Discard"
      onCancel={() => setPendingKind(null)}
      onConfirm={() => { setKind(pendingKind); setPendingKind(null); }}
    />}
  </div>;
}
