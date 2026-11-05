"use client";

import AttendanceWhatsAppReportPanel from "@/components/settings/AttendanceWhatsAppReportPanel";
import {
  getPaymentReminder,
  listPaymentReminderSenderCandidates,
  setPaymentReminderSendAt,
  setPaymentReminderSenders,
} from "@/services/settings/paymentReminder.service";

/*
 * Settings → Project Management → Payment reminder: two days before a payment is due, a reminder goes
 * into the project's own WhatsApp group - from the senders chosen here, in their order or their turn,
 * at the time set here - and the Cash Received message goes there from them the moment money
 * received is recorded. No group name to type (each project has its own). Each sender connects their
 * own WhatsApp from Attendance WhatsApp Report.
 */

const PAYMENT_REMINDER_API = {
  getStatus: getPaymentReminder,
  listCandidates: listPaymentReminderSenderCandidates,
  setSendAt: setPaymentReminderSendAt,
  setSenders: setPaymentReminderSenders,
};

const PAYMENT_REMINDER_WORDING = {
  what: "the payment reminders",
  loadError: "Unable to read the payment reminder.",
  sentLabel: "Today's reminders",
  sentText: (status) => (status.sentTodayCount
    ? <span className="text-emerald-700">{status.sentTodayCount} sent</span>
    : <span className="text-slate-500">None sent yet</span>),
  sendAtSaved: (sendAt) => `Payment reminders will now be sent at ${sendAt}. A payment already reminded is not reminded again.`,
};

export default function PaymentReminderPanel({ onNotice }) {
  return <AttendanceWhatsAppReportPanel onNotice={onNotice} api={PAYMENT_REMINDER_API} wording={PAYMENT_REMINDER_WORDING} />;
}
