"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Button from "@/components/shared/Button";
import HelpTip from "@/components/shared/HelpTip";
import DateField from "@/components/shared/DateField";
import Dropdown from "@/components/shared/Dropdown";
import TextAreaField from "@/components/shared/TextAreaField";
import TextField from "@/components/shared/TextField";
import SendMessageDialog from "@/components/shared/SendMessageDialog";
import SendWhatsAppButton from "@/components/shared/SendWhatsAppButton";
import ShareableMessage from "@/components/shared/ShareableMessage";
import useMessageTemplate from "@/components/shared/useMessageTemplate";
import { useWhatsappSenders } from "@/components/shared/useWhatsappSender";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Dialog from "@/components/ui/Dialog";
import OptionsMenu from "@/components/ui/OptionsMenu";
import DataTable from "@/components/data-table/DataTable";
import KanbanBoard from "@/components/data-table/KanbanBoard";
import TableBoardSwitch, { useTableBoardLayout } from "@/components/data-table/TableBoardSwitch";
import useTableSelection from "@/components/data-table/useTableSelection";
import { layers } from "@/constants/layers";
import DataTableShell from "@/components/data-table/DataTableShell";
import { buildTableColumns, defaultVisibilityFor } from "@/components/data-table/tableCells";
import useCompactView from "@/components/shared/useCompactView";
import { dayLabel as dayOf } from "@/lib/attendanceTime";
import { copyToClipboard } from "@/lib/clipboard";
import { avatarOf } from "@/lib/employeeAvatar.mjs";
import formatDateTime from "@/lib/formatDateTime.mjs";
import { columnCount, expiresSoon } from "@/lib/kanbanSummary.mjs";
import { renderMessageOr } from "@/lib/messageTemplate.mjs";
import { dayFromToday, lastWorkingDayFrom, noticePeriodLabel } from "@/lib/offboardingNotice.mjs";
import {
  cancelOffboardingInvite,
  deleteOffboardingInvite,
  createOffboardingInvite,
  getOffboardingCandidates,
  getOffboardingInvites,
  reviewOffboardingInvite,
  sendBackOffboardingInvite,
  sendOffboardingInviteWhatsApp,
  updateOffboardingInvite,
} from "@/services/hrm/offboarding-invites.service";

/*
 * Offboarding forms: HR's side of an exit that somebody is filling in themselves.
 *
 * The onboarding invite dialog's own arrangement, read the other way round. Three things happen
 * here and nothing else does:
 *
 *   **Raise** - pick the employee from the dropdown (the server says who may be picked: working,
 *   not already serving notice, no form open), say how many days of notice is to be served, and
 *   send. The notice period is asked **here**, when the form goes out, so it is the studio's answer
 *   rather than something the leaver proposes.
 *
 *   **Chase** - copy the link, email it again, or cancel a form nobody has filled in.
 *
 *   **Review** - read what they sent, and approve or reject it. Approving is what writes the
 *   separation and so what moves them to Serving Notice; where they still hold work, the server
 *   refuses and names it, and the hand-over is picked before trying again.
 *
 * Nothing about an employee is written from this dialog: every write goes to the offboarding routes,
 * and the separation is the server's to record.
 */

/*
 * The register's columns.
 *
 * The two days the employee answers with are calendar days, read into the studio's own midnight
 * (`dayAt`) so they print and sort as the instants beside them do and never slip to the day before.
 * Status is the leaver's **stage** (`stage` from the server): an Approved form reads Serving Notice,
 * Relieved or Withdrawn, so the register says where each leaver stands.
 */
const FORM_FIELDS = [
  ["offboardingId", "Form ID", undefined, 170, 150],
  ["employeeName", "Employee", undefined, 220, 170],
  ["employeeCode", "Employee ID", undefined, 160, 140],
  ["designation", "Designation", undefined, 200, 160],
  ["stage", "Status", "status", 150, 130],
  ["noticePeriodDays", "Notice (days)", "number", 150, 130],
  ["resignationDay", "Resignation date", "date", 170, 150],
  ["lastWorkingDay", "Proposed last day", "date", 180, 150],
  ["reason", "Reason", undefined, 220, 170],
  ["submittedAt", "Submitted on", "date", 160, 140],
  ["expiresAt", "Open until", "date", 150, 130],
  ["createdAt", "Sent on", "date", 150, 130],
];

// The same words the repository's own status column is coloured by: a live form is blue, one waiting
// on HR amber, a decided one green or red.
const STATUS_STYLES = {
  Sent: "bg-blue-500",
  Verified: "bg-sky-500",
  Submitted: "bg-amber-500",
  // Back with the employee, like a form that has been sent but not filled in - which is what it is.
  "Sent Back": "bg-violet-500",
  Approved: "bg-emerald-500",
  // What an approved form came to: on notice, gone, or taken back.
  "Serving Notice": "bg-amber-600",
  Relieved: "bg-slate-600",
  Absconded: "bg-red-700",
  Fired: "bg-red-700",
  Withdrawn: "bg-slate-400",
  Rejected: "bg-red-500",
  Cancelled: "bg-slate-500",
  Expired: "bg-orange-400",
};

// Status and designation are sets; the rest are a person, a code, a date or a sentence, and are
// looked up rather than picked from a menu (`tableCells.distinctFilterValues` would say so too).
const LIST_FILTERS = ["stage", "designation"];

// The Board's columns: the statuses in the order a form moves through them, coloured as the table's pills.
// Not Approved: an approved form always reads where its leaver now stands (Serving Notice, Relieved,
// Withdrawn), so an Approved column could never hold a card.
const BOARD_COLUMNS = Object.entries(STATUS_STYLES).filter(([value]) => value !== "Approved").map(([value, colour]) => ({ value, className: `${colour} text-white` }));
// A form still with the employee, which is what the menu's Cancel form is offered on.
const OPEN_STATUSES = ["Sent", "Verified", "Sent Back"];
// In a column still with the employee, a link that runs out from the start of today to the end of the
// day after tomorrow is tagged with its date; the column counts exactly those cards.
const expiringFlag = (invite, column) => {
  if (!OPEN_STATUSES.includes(column.value)) return "";
  return expiresSoon(invite.expiresAt);
};

const errorMessage = (error, fallback) => error?.data?.message || error?.message || fallback;
/*
 * A stored day as "5 Nov 2026", through the one formatter that reads it as the day written down
 * rather than an instant in the reader's zone - and "Not set" where there is none, because a date
 * nobody has given yet is not a dash.
 */
// A stored calendar day ("2026-11-03", or its midnight-UTC instant) as the studio's own midnight that day.
const dayAt = (value) => {
  const key = value ? String(value).slice(0, 10) : "";
  const [year, month, day] = key.split("-").map(Number);
  return year && month && day ? new Date(year, month - 1, day) : null;
};
const dayLabel = (value) => (value ? dayOf(String(value).slice(0, 10)) || "Not set" : "Not set");

/**
 * What a form says, drawn the same way wherever it is read.
 *
 * Two screens show it - **View**, from any row, and **Review**, which puts the three answers under
 * it - and a second copy of the list is how the two would come to disagree about what a form is.
 * Everything a reader needs is here, the letter included: HR was being asked to approve a
 * resignation without being shown the letter sent with it.
 */
/** The ⓘ beside each fact of an offboarding form, by its label - what it is and who gave it. */
const OFFBOARDING_FACT_HELP = {
  Employee: "The employee this resignation form was sent to, with their employee ID.",
  Designation: "Their job title on the employee record.",
  Status: "Where the form stands: Sent, Verified (opened), Submitted, Approved, Rejected, Cancelled or Expired.",
  "Notice period": "The days of notice HR asked them to serve when sending the form; it sets the earliest last working day.",
  "Resignation date": "The day the employee says they are resigning, given on the form.",
  "Proposed last working day": "The last day the employee asks to work; earlier than the notice allows is a request for early release.",
  Reason: "Why they are leaving, picked from the studio's list of resignation reasons.",
  "Their note": "The employee's own words about why they are leaving.",
  "Note from HR": "What HR wrote to the employee with the link, if anything.",
  "Sent on": "When HR created and sent this resignation form.",
  "Submitted on": "When the employee sent the form back to HR.",
  "Open until": "The last moment the form's link opens; after it the link expires.",
  "Sent back on": "When HR handed the form back to the employee for a correction.",
  "Asked to correct": "What HR asked the employee to fix when sending the form back.",
  "Decided on": "When HR approved or rejected this resignation.",
  "Decided by": "The HR person who approved or rejected it.",
  "HR's remark": "What HR wrote with the decision.",
  "Cancelled on": "When HR cancelled this form, so its link no longer opens.",
};

function OffboardingFormFacts({ invite }) {
  return <>
    <dl className="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
      {[
        ["Employee", `${invite.employeeName || "Not set"}${invite.employeeCode ? ` · ${invite.employeeCode}` : ""}`],
        ["Designation", invite.designation || "Not set"],
        ["Status", invite.status],
        ["Notice period", noticePeriodLabel(invite.noticePeriodDays)],
        ["Resignation date", dayLabel(invite.resignationDate)],
        ["Proposed last working day", dayLabel(invite.proposedLastWorkingDate)],
        ["Reason", invite.reason || "Not set"],
        ["Their note", invite.detailedReason || "Not set"],
        ["Note from HR", invite.hrNote || "Not set"],
        ["Sent on", formatDateTime(invite.createdAt)],
        ["Submitted on", formatDateTime(invite.submittedAt)],
        ["Open until", formatDateTime(invite.expiresAt)],
        // Only where each of these happened, so a form that is simply waiting is not a list of
        // blanks: "Not set" against five things that have not happened yet reads as missing data.
        ...(invite.sentBackAt ? [["Sent back on", formatDateTime(invite.sentBackAt)], ["Asked to correct", invite.sendBackRemark || "Not set"]] : []),
        ...(invite.reviewedAt ? [["Decided on", formatDateTime(invite.reviewedAt)], ["Decided by", invite.reviewedBy || "Not set"], ["HR's remark", invite.reviewRemark || "Not set"]] : []),
        ...(invite.cancelledAt ? [["Cancelled on", formatDateTime(invite.cancelledAt)]] : []),
      ].map(([label, value]) => <div key={label} className="min-w-0">
        <dt className="text-xs font-semibold text-slate-500">{label}<HelpTip text={OFFBOARDING_FACT_HELP[label]} /></dt>
        <dd className="mt-0.5 break-words text-slate-800">{value}</dd>
      </div>)}
    </dl>
    {invite.letterUrl
      ? <p className="mt-3 text-sm"><a href={invite.letterUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-800">{invite.letterFileName || "Open the resignation letter"}</a></p>
      : <p className="mt-3 text-xs text-slate-500">No resignation letter was attached.</p>}
  </>;
}

/*
 * `employee`, when given, is who the form is for - a row's Offboarding Form - and is chosen
 * in the form as it opens, rather than looked for in the list.
 */
export default function OffboardingInviteDialog({ mode = "list", employee = null, canWrite = false, onClose, onNotice, onError, onChanged }) {
  const { density } = useCompactView();
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState(mode === "create" ? "create" : "list");
  const [candidates, setCandidates] = useState([]);
  const [draft, setDraft] = useState({ employeeId: employee?.id ? String(employee.id) : "", noticePeriodDays: "30", resignationDate: dayFromToday(), hrNote: "" });
  const [busyId, setBusyId] = useState("");
  const [saving, setSaving] = useState(false);
  const [raised, setRaised] = useState(null);
  const [reviewing, setReviewing] = useState(null);
  const [review, setReview] = useState({ remark: "", handOverToEmployeeId: "" });
  const [pending, setPending] = useState(null);
  /*
   * The confirm step in front of the three writes nobody can take back: approving records the
   * resignation, rejecting tells somebody their form was refused, and cancelling kills the link
   * they were sent. `{ kind, invite }`, and `decide`/`cancel` run only from here.
   */
  const [confirming, setConfirming] = useState(null);
  // The form being read, and the one being corrected with the draft of its two editable answers.
  const [viewing, setViewing] = useState(null);
  const [editing, setEditing] = useState(null);
  const [editDraft, setEditDraft] = useState({ noticePeriodDays: "", hrNote: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getOffboardingInvites();
      setInvites(response?.data || []);
    } catch (error) {
      onError?.(errorMessage(error, "Unable to load resignation forms."));
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  /*
   * `mode="review"`: Pending → HR Offboarding Pending's ⋮ Review Resignation, for `employee`. Only
   * their submitted form's Review is shown - no register behind it - and closing or deciding it
   * closes the lot. Review happens here, on somebody waiting for approval, and nowhere else.
   */
  const reviewOnly = mode === "review";
  const [reviewOpened, setReviewOpened] = useState(false);
  useEffect(() => {
    if (!reviewOnly || reviewOpened || loading) return undefined;
    const timer = window.setTimeout(() => {
      setReviewOpened(true);
      const submitted = invites.find((invite) => String(invite.employeeId) === String(employee?.id) && invite.status === "Submitted");
      if (submitted) { setReview({ remark: "", handOverToEmployeeId: "" }); setPending(null); setReviewing(submitted); return; }
      onError?.(`${employee?.employeeName || "This employee"} has no resignation waiting for review.`);
      onClose?.();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [employee, invites, loading, onClose, onError, reviewOnly, reviewOpened]);
  // Closing a review: back to the register, or - opened for one employee's review - shut altogether.
  const endReview = useCallback(() => { setReviewing(null); if (reviewOnly) onClose?.(); }, [onClose, reviewOnly]);

  /*
   * Only when somebody actually needs the dropdown: raising a form, or reviewing one, where the
   * hand-over asks who takes the leaver's work. The list is a read of every working employee, and
   * the common case - looking at the register - needs none of it.
   *
   * The same list serves both, and rightly: it leaves out anybody with a form open, so the person
   * being offboarded is never offered as the one to hand their own work to.
   */
  useEffect(() => {
    if ((screen !== "create" && !reviewing) || candidates.length) return undefined;
    const timer = window.setTimeout(() => {
      void getOffboardingCandidates()
        .then((response) => {
          const list = response?.data || [];
          setCandidates(list);
          /*
           * A row's employee who is not among those a form can be sent to - one is already open for
           * them, or they are no longer working. Said, and the register shown, where their open form
           * is, rather than a form whose employee box stays empty for no reason given.
           */
          if (employee?.id && screen === "create" && !list.some((candidate) => String(candidate.id) === String(employee.id))) {
            onError?.(`${employee.employeeName || "This employee"} already has an open resignation form, or cannot be sent one. Their form is in the list.`);
            setDraft((current) => ({ ...current, employeeId: "" }));
            setScreen("list");
          }
        })
        .catch((error) => onError?.(errorMessage(error, "Unable to load the employees a form can be sent to.")));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [candidates.length, employee, onError, reviewing, screen]);

  const employeeOptions = useMemo(() => candidates.map((employee) => ({
    value: String(employee.id),
    label: `${employee.employeeName}${employee.employeeId ? ` · ${employee.employeeId}` : ""}`,
    avatar: avatarOf(employee),
  })), [candidates]);

  const noticeDays = Number(draft.noticePeriodDays);
  const draftProblem = !draft.employeeId
    ? "Pick the employee this form is for."
    : !Number.isInteger(noticeDays) || noticeDays < 0 || noticeDays > 365
      ? "Enter the notice period in days."
      : !draft.resignationDate
        ? "Pick the resignation date."
        : "";

  async function raise(event) {
    event.preventDefault();
    if (draftProblem) { onError?.(draftProblem); return; }
    setSaving(true);
    try {
      const response = await createOffboardingInvite({
        employeeId: Number(draft.employeeId),
        noticePeriodDays: noticeDays,
        resignationDate: draft.resignationDate || undefined,
        hrNote: draft.hrNote.trim() || null,
      });
      setRaised(response?.data || null);
      setScreen("sent");
      setDraft({ employeeId: "", noticePeriodDays: "30", resignationDate: dayFromToday(), hrNote: "" });
      setCandidates([]);
      await load();
      onChanged?.();
    } catch (error) {
      onError?.(errorMessage(error, "Unable to raise the resignation form."));
    } finally {
      setSaving(false);
    }
  }

  /*
   * The link, on the clipboard.
   *
   * Through `copyToClipboard` rather than `navigator.clipboard` directly: the studio reaches the VPS
   * over plain http, where `navigator.clipboard` does not exist, and the direct call threw and said
   * nothing for a link that was on screen the whole time. A refusal now says what to do instead.
   */
  async function copyLink(url) {
    if (await copyToClipboard(url)) onNotice?.("Link copied.");
    else onError?.("Could not reach the clipboard. Select the link and copy it yourself.");
  }

  async function remove(invite) {
    setBusyId(invite.id);
    try {
      await deleteOffboardingInvite(invite.id);
      onNotice?.(`${invite.offboardingId || "Resignation form"} for ${invite.employeeName} deleted.`);
      await load();
      onChanged?.();
    } catch (error) {
      onError?.(errorMessage(error, "Unable to delete the form."));
    } finally {
      setBusyId("");
    }
  }

  async function cancel(invite) {
    setBusyId(invite.id);
    try {
      await cancelOffboardingInvite(invite.id);
      onNotice?.(`Resignation form for ${invite.employeeName} cancelled.`);
      await load();
      onChanged?.();
    } catch (error) {
      onError?.(errorMessage(error, "Unable to cancel the form."));
    } finally {
      setBusyId("");
    }
  }

  /*
   * The message that hands the form over, worded in Settings → Message Template → Offboarding Form.
   *
   * `renderMessageOr` falls back to the sentences below, so a studio that has not written this one -
   * or a row somebody deleted - still gets a usable message, and a reader whose permissions do not
   * reach the template is not left with an empty box. The email the form also sends is a different
   * wording and is untouched: this is the copy somebody pastes into WhatsApp, which is the one that
   * has to work when the mail never arrives.
   */
  const formTemplate = useMessageTemplate("EMPLOYEE_OFFBOARDING_FORM");
  const reminderTemplate = useMessageTemplate("EMPLOYEE_OFFBOARDING_REMINDER");
  const approvedTemplate = useMessageTemplate("EMPLOYEE_OFFBOARDING_APPROVED");
  const notAcceptedTemplate = useMessageTemplate("EMPLOYEE_OFFBOARDING_NOT_ACCEPTED");
  const builtInFormMessage = [
    `Hi ${raised?.employeeName || "there"},`,
    "",
    "Please confirm your resignation details here:",
    raised?.offboardingUrl || "",
    "",
    `Your notice period is ${noticePeriodLabel(raised?.noticePeriodDays)}. The form asks when your notice starts and shows the last working day it works out to.`,
    "",
    `The link is open until ${dayLabel(raised?.expiresAt)}. You will be asked for the email or phone number on your record to open it.`,
    "",
    "HR will confirm the dates with you. Nothing about your employment changes until they do.",
  ].join("\n");
  const formMessage = renderMessageOr(builtInFormMessage, formTemplate, {
    "employee name": raised?.employeeName || "there",
    "offboarding link": raised?.offboardingUrl || "",
    "notice period": noticePeriodLabel(raised?.noticePeriodDays),
    "expiry date": dayLabel(raised?.expiresAt),
  });

  /*
   * The message a decided form is owed: the confirmed dates once HR has recorded the resignation,
   * and the refusal with HR's own remark.
   *
   * Offered from the row rather than pushed when the decision is made, because the decision and the
   * telling are two acts: HR approves a form now and writes to the person when they are ready, from
   * whichever thread they talk to them in. Each falls back to the sentences here, so a studio that
   * has not worded one still gets a usable message.
   */
  const messageFor = useCallback((invite) => {
    const name = invite?.employeeName || "there";
    const period = noticePeriodLabel(invite?.noticePeriodDays);
    if (invite.status === "Approved") {
      // The day the full and final settlement is paid, as the server works it out from the payroll
      // settings - with the salary held through the notice, where Payroll rules held it.
      const settlement = invite.finalSettlementOn ? dayLabel(invite.finalSettlementOn) : "";
      const settlementLine = !settlement
        ? "We will be in touch about the handover and your final settlement."
        : invite.salaryHeld
          ? `We will be in touch about the handover. Your final settlement is paid on ${settlement}. Your salary during your notice is held and paid with it.`
          : `We will be in touch about the handover. Your final settlement is paid on ${settlement}.`;
      return renderMessageOr([
        `Hi ${name},`,
        "",
        `Your resignation has been recorded. Your notice runs from ${dayLabel(invite.resignationDate)} and your last working day with us is ${dayLabel(invite.proposedLastWorkingDate)}.`,
        "",
        `You keep your login and mark attendance as usual until then. ${settlementLine}`,
        "",
        "Thank you for everything.",
      ].join("\n"), approvedTemplate, {
        "employee name": name,
        "notice start date": dayLabel(invite.resignationDate),
        "last working day": dayLabel(invite.proposedLastWorkingDate),
        "notice period": period,
        "final settlement date": settlement || "your final settlement date",
        "salary hold": invite.salaryHeld && settlement ? "Your salary during your notice is held and paid with it." : "",
      });
    }
    return renderMessageOr([
      `Hi ${name},`,
      "",
      "Your resignation form has not been accepted, so nothing about your employment has changed.",
      "",
      invite.reviewRemark || "",
      "",
      "Please speak to HR before filling in another one.",
    ].join("\n"), notAcceptedTemplate, {
      "employee name": name,
      "hr remark": invite.reviewRemark || "",
    });
  }, [approvedTemplate, notAcceptedTemplate]);

  /*
   * The reminder an open form is owed when it is still waiting - worded in Settings → Templates →
   * Offboarding Reminder, falling back to that message's own first wording.
   */
  const reminderFor = useCallback((invite) => renderMessageOr([
    `Hi ${invite?.employeeName || "there"},`,
    "",
    "A reminder that your offboarding form is still waiting for you:",
    invite?.offboardingUrl || "",
    "",
    `It only asks when your notice starts. The link is open until ${dayLabel(invite?.expiresAt)}, and your notice period is ${noticePeriodLabel(invite?.noticePeriodDays)}.`,
    "",
    "Let HR know if the link will not open for you.",
  ].join("\n"), reminderTemplate, {
    "employee name": invite?.employeeName || "there",
    "offboarding link": invite?.offboardingUrl || "",
    "notice period": noticePeriodLabel(invite?.noticePeriodDays),
    "expiry date": dayLabel(invite?.expiresAt),
  }), [reminderTemplate]);

  /*
   * Send WhatsApp for the form's four messages: the form on the sent screen, and from a row's menu the
   * reminder (open form), the confirmation (approved) or the refusal (rejected) - each opened in a
   * small dialog with the message and its Copy. Each is offered only while this person's WhatsApp is
   * linked and that message is switched on under Settings → Templates; the server asks both again.
   */
  const { canSend: canSendMessage } = useWhatsappSenders();
  const [whatsappMessage, setWhatsappMessage] = useState(null);
  const [formText, setFormText] = useState("");
  const [formResult, setFormResult] = useState(null);
  const sendOnWhatsApp = useCallback(async (invite, kind, body) => {
    const response = await sendOffboardingInviteWhatsApp(invite.id, kind, body);
    return response?.message || "Sent on WhatsApp.";
  }, []);
  async function sendFormOnWhatsApp(body) {
    setFormResult(null);
    try {
      setFormResult({ tone: "success", text: await sendOnWhatsApp(raised, "FORM", body) });
    } catch (error) {
      setFormResult({ tone: "error", text: error?.message || "Unable to send this message on WhatsApp." });
    }
  }

  /** One of those messages, on the clipboard, said in words either way. */
  const copyMessage = useCallback(async (invite, what) => {
    if (await copyToClipboard(messageFor(invite))) onNotice?.(`${what} copied.`);
    else onError?.("Could not reach the clipboard. Open the form and copy the message yourself.");
  }, [messageFor, onError, onNotice]);

  const rejectionNeedsReason = !review.remark.trim();
  /*
   * What is still on the leaver's name, read off the 409's own shape: every count beside `total`,
   * named as the server named it. Unknown keys are drawn rather than mapped, so a kind of work
   * added to the separation's hand-over appears here without this screen being told about it.
   */
  const pendingKinds = useMemo(() => Object.entries(pending || {})
    .filter(([key, value]) => key !== "total" && Number(value) > 0)
    .map(([key, value]) => `${value} ${key.replace(/([A-Z])/g, " $1").toLowerCase().trim()}`), [pending]);
  const handOverMissing = Boolean(pending) && !review.handOverToEmployeeId;

  /**
   * Hands the submission back for a correction, on HR's remark.
   *
   * The move between approving and rejecting: a wrong date is not a resignation to refuse. The
   * reopening has already happened by the time this answers, so a `warning` about the email is said
   * as one rather than treated as a failure - what it costs is only that they have not been told,
   * and the form's link, copied from its row, is how somebody tells them by hand.
   */
  async function sendBack() {
    setConfirming(null);
    setSaving(true);
    try {
      const response = await sendBackOffboardingInvite(reviewing.id, { remark: review.remark.trim() });
      if (response?.warning) onError?.(`${response.warning} Copy the reminder message from the form's row and send it to them.`);
      else onNotice?.(`Sent back to ${reviewing.employeeName} to correct. Their answers are still on the form.`);
      setPending(null);
      setReview({ remark: "", handOverToEmployeeId: "" });
      endReview();
      await load();
      onChanged?.();
    } catch (error) {
      onError?.(errorMessage(error, "Unable to send this form back."));
    } finally {
      setSaving(false);
    }
  }

  async function decide(decision) {
    setConfirming(null);
    setSaving(true);
    try {
      await reviewOffboardingInvite(reviewing.id, {
        decision,
        remark: review.remark.trim() || null,
        ...(review.handOverToEmployeeId ? { handOverToEmployeeId: Number(review.handOverToEmployeeId) } : {}),
      });
      onNotice?.(decision === "Approved"
        ? `${reviewing.employeeName} is serving notice until ${dayLabel(reviewing.proposedLastWorkingDate)}.`
        : `Resignation form for ${reviewing.employeeName} was not accepted.`);
      setPending(null);
      setReview({ remark: "", handOverToEmployeeId: "" });
      endReview();
      await load();
      onChanged?.();
    } catch (error) {
      // The hand-over question: the server refuses and says what is pending, and nothing was
      // written - so the picker appears and the same decision is sent again with an answer.
      if (error?.data?.pending) {
        setPending(error.data.pending);
        onError?.(error.data.message);
        return;
      }
      onError?.(errorMessage(error, "Unable to record this decision."));
    } finally {
      setSaving(false);
    }
  }

  /** Opens the review on a submitted form - from the row's menu, and from the row itself. */
  const menuItemsFor = useCallback((invite) => {
    if (!canWrite) return [];
    const items = [];
    /*
     * Every row's actions in the one place, in the order somebody reaches for them: look at it,
     * decide it, correct it, chase it, call it off.
     *
     * **View** is on every row and is the only one that is always there - a decided form is history
     * and still worth reading. **Review** is the submitted row's own, and opens the same facts with
     * the three answers under them. **Edit** is for a form still open, where the notice period or
     * the note was typed wrongly; once somebody has filled it in, changing the notice period would
     * move a last working day they have already agreed to, which is Send back's job instead.
     */
    items.push({ label: "View", onSelect: () => setViewing(invite) });
    // No Review here: a submitted form is reviewed from Pending → HR Offboarding Pending, on the
    // employee waiting for approval (`mode="review"`), so there is one place the decision is made.
    if (["Sent", "Verified", "Sent Back"].includes(invite.status)) {
      items.push({ label: "Edit form", onSelect: () => { setEditDraft({ noticePeriodDays: String(invite.noticePeriodDays ?? ""), hrNote: invite.hrNote || "" }); setEditing(invite); } });
    }
    // The message this form's state is owed, whatever else the row offers.
    if (invite.status === "Approved") items.push({ label: "Copy confirmation message", onSelect: () => void copyMessage(invite, "Confirmation message") });
    if (invite.status === "Approved" && canSendMessage("EMPLOYEE_OFFBOARDING_APPROVED")) items.push({ label: "Send confirmation on WhatsApp", onSelect: () => setWhatsappMessage({ invite, kind: "APPROVED", title: "Send the confirmation", message: messageFor(invite) }) });
    if (invite.status === "Rejected") items.push({ label: "Copy the refusal message", onSelect: () => void copyMessage(invite, "Message") });
    if (invite.status === "Rejected" && canSendMessage("EMPLOYEE_OFFBOARDING_NOT_ACCEPTED")) items.push({ label: "Send the refusal on WhatsApp", onSelect: () => setWhatsappMessage({ invite, kind: "NOT_ACCEPTED", title: "Send the refusal", message: messageFor(invite) }) });
    if (["Sent", "Verified", "Sent Back"].includes(invite.status)) {
      if (invite.offboardingUrl) items.push({ label: "Copy link", onSelect: () => void copyLink(invite.offboardingUrl) });
      // A reminder only while the link still opens: past its last day it would send them to a dead page.
      if (invite.offboardingUrl && new Date(invite.expiresAt) > new Date() && canSendMessage("EMPLOYEE_OFFBOARDING_REMINDER")) items.push({ label: "Send reminder on WhatsApp", onSelect: () => setWhatsappMessage({ invite, kind: "REMINDER", title: "Send a reminder", message: reminderFor(invite) }) });
      items.push({ label: "Cancel form", tone: "danger", disabled: busyId === invite.id, onSelect: () => setConfirming({ kind: "cancel", invite }) });
    }
    // Last, on every row: the form gone from the register altogether - asked first, like Cancel.
    items.push({ label: "Delete", tone: "danger", disabled: busyId === invite.id, onSelect: () => setConfirming({ kind: "delete", invite }) });
    return items;
  // The WhatsApp items change once the session and the switches are read (`canSendMessage`).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busyId, canWrite, copyMessage, onNotice, canSendMessage, messageFor, reminderFor]);

  /** Saves a correction to a form still open. The link is untouched, so their copy keeps working. */
  async function saveEdit(event) {
    event.preventDefault();
    const days = Number(editDraft.noticePeriodDays);
    if (!Number.isInteger(days) || days < 0 || days > 365) { onError?.("Enter the notice period as a whole number of days, up to 365."); return; }
    setSaving(true);
    try {
      await updateOffboardingInvite(editing.id, { noticePeriodDays: days, hrNote: editDraft.hrNote.trim() || null });
      onNotice?.(`${editing.employeeName}'s form updated. Their link is unchanged.`);
      setEditing(null);
      await load();
      onChanged?.();
    } catch (error) {
      onError?.(errorMessage(error, "Unable to edit this resignation form."));
    } finally {
      setSaving(false);
    }
  }

  const columns = useMemo(() => buildTableColumns({
    fields: FORM_FIELDS,
    statusStyles: STATUS_STYLES,
    listFilters: LIST_FILTERS,
    renderActions: (invite) => {
      const items = menuItemsFor(invite);
      /*
       * `menuZIndexClassName`, or the menu is invisible.
       *
       * `OptionsMenu` portals its menu to the body, where it is a sibling of this dialog rather than
       * a child of it - so its default `z-[60]` put every row's actions **behind** the dialog they
       * belong to, and pressing the ⋮ appeared to do nothing at all. `menuOverPanel` is the scale's
       * answer for a menu inside a dialog (`constants/layers`), which is what the onboarding invite
       * table passes for the same reason.
       */
      return items.length ? <OptionsMenu ariaLabel={`Actions for ${invite.employeeName}`} menuZIndexClassName={layers.menuOverPanel} items={items} /> : null;
    },
  }), [menuItemsFor]);
  const defaultVisibility = useMemo(() => defaultVisibilityFor(FORM_FIELDS), []);
  // The rows as the register reads them: each leaver's stage, and the two days as days.
  const registerRows = useMemo(() => invites.map((invite) => ({
    ...invite,
    stage: invite.stage || invite.status,
    resignationDay: dayAt(invite.resignationDate),
    lastWorkingDay: dayAt(invite.proposedLastWorkingDate),
  })), [invites]);
  /*
   * Tick boxes and Select All, for a role holding `ADMIN / Table Select All` - to export the forms
   * picked, and for a writer to delete them (`/offboarding-invites/bulk`, the same delete as a row's
   * ⋮ Delete). Deleting a form leaves the separation it recorded alone.
   */
  const bulk = useTableSelection({
    prefix: "/api/hrm/offboarding-invites",
    rows: registerRows,
    noun: "resignation form",
    canDelete: canWrite,
    showSuccess: onNotice,
    showError: onError,
    onDeleted: () => { void load(); onChanged?.(); },
  });

  /*
   * Table or Board. A drop runs only what the row's own menu offers: an open form dropped on
   * Cancelled asks the same confirmation as Cancel form. Nothing is decided by a drop - a submitted
   * form is reviewed from HR Offboarding Pending.
   */
  const [layout, setLayout] = useTableBoardLayout("offboarding-forms");
  const onBoard = layout === "board";
  // Only Cancel by a drop: a submitted form is decided in its Review, from HR Offboarding Pending.
  const canDropAt = (invite, to) => canWrite && OPEN_STATUSES.includes(invite.status) && to === "Cancelled" && busyId !== invite.id;
  const dropInvite = (invite, to) => {
    if (to === "Cancelled") setConfirming({ kind: "cancel", invite });
  };

  /*
   * Opened from an employee's row: the form is theirs, so their name is shown rather than offered
   * as a choice, and there is no list behind it to go back to or explain.
   */
  const fixedEmployee = screen === "create" && Boolean(employee?.id) && draft.employeeId === String(employee.id);
  const title = screen === "create" ? "Resignation Form" : screen === "sent" ? "Form sent" : "HR Offboarding";
  const description = screen === "create"
    ? undefined
    : screen === "sent"
      ? "Copy this and send it to them. They fill in when their notice begins."
      : "Every resignation form, newest first.";

  const isList = screen === "list";
  const listActions = <>
    <TableBoardSwitch value={layout} onChange={setLayout} />
    {canWrite && <Button type="button" onClick={() => setScreen("create")}>Raise a form</Button>}
  </>;
  const register = <>
    {onBoard && <div className="flex h-full min-h-0 min-w-0">
      <KanbanBoard
        rows={registerRows}
        columns={BOARD_COLUMNS}
        statusOf={(invite) => invite.stage}
        // Under a column still with the employee (Sent, Verified, Sent Back), how many links run out within two days.
        columnAmount={(rows, column) => (OPEN_STATUSES.includes(column.value) ? columnCount(rows, (invite) => Boolean(expiringFlag(invite, column)), "Expiring soon", "Expiring soon: within 2 days") : null)}
        cardFlag={expiringFlag}
        card={{
          title: (invite) => invite.employeeName,
          subtitle: (invite) => [invite.offboardingId, invite.employeeCode].filter(Boolean).join(" · "),
          meta: (invite) => [invite.designation, invite.proposedLastWorkingDate ? `Last day ${dayLabel(invite.proposedLastWorkingDate)}` : ""].filter(Boolean).join(" · "),
        }}
        getRowId={(invite) => String(invite.id)}
        onOpen={setViewing}
        // The card's ⋮ is the row's ⋮.
        cardActions={menuItemsFor}
        cardMenuProps={{ menuZIndexClassName: layers.menuOverPanel }}
        canDropAt={canDropAt}
        onDrop={dropInvite}
        loading={loading}
        noun="forms"
        ariaLabel="Resignation forms board"
      />
    </div>}
    {!onBoard && <DataTableShell className="min-h-0 flex-1">
      <DataTable
        columns={columns}
        data={registerRows}
        getRowId={(invite) => invite.id}
        density={density}
        loading={loading}
        loadingMessage="Loading resignation forms..."
        emptyMessage={canWrite ? "No resignation forms yet. Raise one when somebody resigns and they will fill in their notice dates themselves." : "No resignation forms yet."}
        noMatchMessage="No matching forms found."
        defaultColumnVisibility={defaultVisibility}
        ariaLabel="Resignation forms"
        // The table's own menus (Manage Columns, the filter lists) are portalled too, so they
        // need the same answer as the row menus above.
        menuZIndexClassName={layers.menuOverPanel}
        features={{ filtering: true, sorting: true, columnVisibility: true, infiniteScroll: { pageSize: 50 }, selection: bulk.selection }}
      />
    </DataTableShell>}
  </>;
  return <>
    {reviewOnly ? null : <Dialog
      title={title}
      description={description}
      // The register holds its size whether it is loading, empty or long, and its rows scroll
      // inside it - the onboarding list's own arrangement, and what `DataTableShell`'s `flex-1`
      // needs a height to fill. The two short screens are a form's width and no taller than they
      // are.
      size={isList ? "full" : "md"}
      height={isList ? "tall" : "auto"}
      busy={saving}
      onClose={onClose}
      // The create screen *is* the dialog's form, so its footer button submits it the way a footer
      // button does anywhere else, and Enter in a field sends it.
      onSubmit={screen === "create" ? raise : undefined}
      // Back where there is somewhere to go back to: the register. Not on the sent screen, where
      // going back would suggest undoing a form already sent.
      {...(screen === "create" && !fixedEmployee ? { onBack: () => setScreen("list"), backAriaLabel: "Back to the resignation forms" } : {})}
      headerActions={isList ? listActions : null}
      bodyClassName="p-0"
      footer={<>
        {screen === "sent" && raised && canSendMessage("EMPLOYEE_OFFBOARDING_FORM") && <SendWhatsAppButton className="max-sm:flex-1" message={formText} onSend={sendFormOnWhatsApp} />}
        <Button type="button" className="max-sm:flex-1" onClick={onClose}>Close</Button>
        {screen === "create" && <Button className="max-sm:flex-1" variant="primary" disabled={saving || Boolean(draftProblem)}>{saving ? "Sending..." : "Send the form"}</Button>}
      </>}
    >
      {screen === "create" && <div className="flex flex-col gap-4 px-5 py-5 sm:px-6">
        {fixedEmployee
          ? <TextField
            label="Employee"
            helperText="The employee who is leaving; the form link is made for them."
            readOnly
            value={`${employee.employeeName || ""}${employee.employeeId ? ` · ${employee.employeeId}` : ""}`}
          />
          : <Dropdown
            label="Employee"
            helperText="The employee who is leaving; the form link is made for them. Anybody working here who is not already serving notice and has no form open."
            required
            searchable
            placeholder={employeeOptions.length ? "Select employee" : "Nobody to raise a form for"}
            options={employeeOptions}
            value={draft.employeeId}
            onChange={(value) => setDraft((current) => ({ ...current, employeeId: value }))}
          />}
        <TextField
          label="Notice period (days)"
          helperText="Days they must serve. Their last working day is counted from this when they fill the form in, so changing it changes the date they will be shown."
          required
          type="number"
          min="0"
          max="365"
          value={draft.noticePeriodDays}
          onChange={(event) => setDraft((current) => ({ ...current, noticePeriodDays: event.target.value }))}
          // What is wrong, where the answer goes - rather than in a toast the disabled button can
          // never fire. Nothing is said under it otherwise; the ⓘ explains the field.
          error={draft.noticePeriodDays !== "" && !Number.isInteger(noticeDays) || noticeDays < 0 || noticeDays > 365 ? "Enter the notice period as a whole number of days, up to 365." : ""}
        />
        {/* The resignation date HR already knows, and the last working day it comes to - the same two
            the employee's own form shows. Their form opens on this date; they can still change it. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <DateField
            required
            label="Resignation date"
            helperText="The day they resign; the notice period counts from this date. Their form opens on it, and they can still change it."
            minDate={dayFromToday(-30)}
            maxDate={dayFromToday(90)}
            value={draft.resignationDate}
            onChange={(value) => setDraft((current) => ({ ...current, resignationDate: value }))}
          />
          <TextField
            label="Proposed last working day"
            helperText="Worked out from the resignation date and notice period."
            readOnly
            value={lastWorkingDayFrom(draft.resignationDate, draft.noticePeriodDays) ? dayLabel(lastWorkingDayFrom(draft.resignationDate, draft.noticePeriodDays)) : "Not set"}
          />
        </div>
        {/* The event, not a value: `TextAreaField` spreads its props onto the `<textarea>`. And no
            `note` prop - it has none, so the word would have been spread onto the element itself. */}
        <TextAreaField
          label="Note to them"
          helperText="A short message from HR shown with the form they open."
          maxLength={2000}
          value={draft.hrNote}
          onChange={(event) => setDraft((current) => ({ ...current, hrNote: event.target.value }))}
        />
        <p className="text-xs text-slate-500">Sent with the link, in the message and the email they receive.</p>
      </div>}

      {/*
        * The form as the message that sends it, and nothing else.
        *
        * It was the link in a read-only box under a line summarising what had just been typed on the
        * screen before - three things to read where only one is used - and it left whoever was
        * sending it to write the sentences around the link every time: what this is, how long their
        * notice is, that the link expires, and that nothing changes until HR confirms. All of that is
        * in the message, so the message is the screen, with its own Copy and nothing beside it. The
        * same control the onboarding invite and the login credentials hand their own messages over
        * with.
        *
        * No buttons of its own: the form was raised the moment this screen appeared, so there is
        * nothing further to do to it here, and the studio sends the message itself - Copy link on the
        * register's row is there for every form rather than only the one just raised.
        */}
      {screen === "sent" && raised && <div className="space-y-2 px-5 py-5 sm:px-6">
        <ShareableMessage label="Message to send them" rows={10} message={formMessage} onTextChange={setFormText} />
        {formResult && <p role={formResult.tone === "error" ? "alert" : "status"} className={`text-xs ${formResult.tone === "error" ? "text-red-600" : "text-emerald-700"}`}>{formResult.text}</p>}
      </div>}

      {isList && register}
    </Dialog>}

    {whatsappMessage && <SendMessageDialog
      title={whatsappMessage.title}
      description={`To ${whatsappMessage.invite.employeeName || "the employee"}, on the WhatsApp number on their record.`}
      message={whatsappMessage.message}
      canSend={canSendMessage({ REMINDER: "EMPLOYEE_OFFBOARDING_REMINDER", APPROVED: "EMPLOYEE_OFFBOARDING_APPROVED", NOT_ACCEPTED: "EMPLOYEE_OFFBOARDING_NOT_ACCEPTED" }[whatsappMessage.kind])}
      onSend={(body) => sendOnWhatsApp(whatsappMessage.invite, whatsappMessage.kind, body)}
      onClose={() => setWhatsappMessage(null)}
    />}

    {reviewing && <Dialog
      title={`Review ${reviewing.employeeName}'s form`}
      description={reviewing.offboardingId || undefined}
      size="lg"
      layer="dialogOverPanel"
      onClose={endReview}
      busy={saving}
      footer={<>
        <Button type="button" className="max-sm:flex-1" onClick={endReview} disabled={saving}>Close</Button>
        {/* Rejecting tells somebody their resignation form was refused, so it says why; approving
            records the resignation, so it cannot be done with the hand-over question unanswered. */}
        {/* Between Close and Reject on purpose: it is the ordinary answer to a form that is nearly
            right, and it needs the same remark a rejection does - the employee is being asked to
            change something, which means being told what. */}
        <Button type="button" className="max-sm:flex-1" disabled={saving || rejectionNeedsReason} onClick={() => setConfirming({ kind: "sendBack", invite: reviewing })}>Send back</Button>
        <Button type="button" variant="danger" className="max-sm:flex-1" disabled={saving || rejectionNeedsReason} onClick={() => setConfirming({ kind: "reject", invite: reviewing })}>Reject</Button>
        <Button type="button" variant="primary" className="max-sm:flex-1" disabled={saving || handOverMissing} onClick={() => setConfirming({ kind: "approve", invite: reviewing })}>Approve</Button>
      </>}
    >
      <OffboardingFormFacts invite={reviewing} />
      {/*
        * Approving writes the separation, which is what puts them on Serving Notice until the date
        * above - and the studio's own rule is that HR commits an exit, not the form.
        */}
      <p className="mt-4 rounded-md border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
        Approving records the resignation and puts {reviewing.employeeName} on Serving Notice until {dayLabel(reviewing.proposedLastWorkingDate)}. They keep their login, their team and their own work until then, and are relieved the day after - their pending work is handed over from their row once they have gone.
      </p>
      {/*
        * What the server refused over, and the question it refused for. The counts come back with
        * the 409 (`separations/handover.js` `pendingWork`), so this names the work rather than only
        * its total - "3 items" tells HR nothing about who should take them.
        */}
      {pending && <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3">
        <p className="text-xs font-semibold text-red-800">{pending.total} {pending.total === 1 ? "item" : "items"} still on their name</p>
        {pendingKinds.length > 0 && <p className="mt-0.5 text-xs text-red-800">{pendingKinds.join(", ")}</p>}
        <Dropdown
          className="mt-2"
          label="Hand it over to"
          helperText="The employee who takes over the work still on their name."
          required
          searchable
          placeholder="Select employee"
          options={employeeOptions}
          value={review.handOverToEmployeeId}
          onChange={(value) => setReview((current) => ({ ...current, handOverToEmployeeId: value }))}
        />
      </div>}
      <TextAreaField
        className="mt-4"
        label="Remarks"
        helperText="Your note on this form; the employee sees it if you send it back or reject it."
        required={rejectionNeedsReason}
        value={review.remark}
        maxLength={5000}
        onChange={(event) => setReview((current) => ({ ...current, remark: event.target.value }))}
        error={rejectionNeedsReason ? "Needed to send the form back or reject it - it is what the employee is shown. Optional when approving." : ""}
      />
    </Dialog>}

    {/* Reading a form, from any row: the same facts the review draws, with nothing to decide. */}
    {viewing && <Dialog
      title={`${viewing.employeeName}'s resignation form`}
      description={viewing.offboardingId || undefined}
      size="lg"
      layer="dialogOverPanel"
      onClose={() => setViewing(null)}
      footer={<Button type="button" className="max-sm:flex-1" onClick={() => setViewing(null)}>Close</Button>}
    >
      <OffboardingFormFacts invite={viewing} />
    </Dialog>}

    {/*
      * Correcting a form already sent. Two answers, because they are the two HR gave: the notice
      * period and the note. Who the form is for is not among them - a form raised against the wrong
      * person is cancelled and raised again, so nobody is left holding a link that names somebody
      * else - and the link itself never changes, so the copy they already have keeps working.
      */}
    {editing && <Dialog
      title={`Edit ${editing.employeeName}'s form`}
      description="The link does not change, so the one they already have keeps working."
      size="md"
      layer="dialogOverPanel"
      busy={saving}
      onClose={() => setEditing(null)}
      onSubmit={saveEdit}
      footer={<>
        <Button type="button" className="max-sm:flex-1" onClick={() => setEditing(null)} disabled={saving}>Close</Button>
        <Button className="max-sm:flex-1" variant="primary" disabled={saving}>{saving ? "Saving..." : "Save changes"}</Button>
      </>}
    >
      <div className="flex flex-col gap-4">
        <TextField
          label="Notice period (days)"
          helperText="Days they must serve. Their last working day is counted from this when they fill the form in, so changing it changes the date they will be shown."
          required
          type="number"
          min="0"
          max="365"
          value={editDraft.noticePeriodDays}
          onChange={(event) => setEditDraft((current) => ({ ...current, noticePeriodDays: event.target.value }))}
        />
        <TextAreaField
          label="Note to them"
          helperText="A short message from HR shown with the form they open."
          maxLength={2000}
          value={editDraft.hrNote}
          onChange={(event) => setEditDraft((current) => ({ ...current, hrNote: event.target.value }))}
        />
      </div>
    </Dialog>}

    {/*
      * The step in front of the three writes nobody can take back. Each says what will happen in
      * the studio's own words rather than asking "are you sure": approving starts a notice period,
      * rejecting is read by the person who sent the form, and cancelling kills the link they hold.
      */}
    {confirming && <ConfirmDialog
      layer="dialogOverPanel"
      title={confirming.kind === "approve" ? "Record this resignation?" : confirming.kind === "sendBack" ? "Send this form back?" : confirming.kind === "reject" ? "Reject this form?" : confirming.kind === "delete" ? "Delete this form?" : "Cancel this form?"}
      message={confirming.kind === "approve"
        ? `${confirming.invite.employeeName} will serve notice until ${dayLabel(confirming.invite.proposedLastWorkingDate)} and be relieved the day after. Their login and attendance carry on until then.`
        : confirming.kind === "sendBack"
          ? `${confirming.invite.employeeName} gets their form back on the same link, with everything they filled in still on it and your remark saying what to change. Their resignation is not refused and nothing about their employment changes.`
          : confirming.kind === "reject"
          ? `${confirming.invite.employeeName} will be told their form was not accepted, with the remark you wrote. Nothing about their employment changes.`
          : confirming.kind === "delete"
          ? `${confirming.invite.offboardingId || "This form"} for ${confirming.invite.employeeName} is removed from the register for good, with its letter. Their employment is not changed: a notice or relieving already recorded from it stays.`
          : `${confirming.invite.employeeName}'s link stops working and they cannot fill the form in. Raise another one to send them a new link.`}
      confirmLabel={confirming.kind === "approve" ? "Record it" : confirming.kind === "sendBack" ? "Send it back" : confirming.kind === "reject" ? "Reject the form" : confirming.kind === "delete" ? "Delete the form" : "Cancel the form"}
      busyLabel={confirming.kind === "approve" ? "Recording..." : "Saving..."}
      tone={confirming.kind === "approve" || confirming.kind === "sendBack" ? "primary" : "danger"}
      loading={saving || busyId === confirming.invite.id}
      onCancel={() => setConfirming(null)}
      onConfirm={() => {
        if (confirming.kind === "cancel") { const invite = confirming.invite; setConfirming(null); void cancel(invite); return; }
        if (confirming.kind === "delete") { const invite = confirming.invite; setConfirming(null); void remove(invite); return; }
        if (confirming.kind === "sendBack") { void sendBack(); return; }
        void decide(confirming.kind === "approve" ? "Approved" : "Rejected");
      }}
    />}
  </>;
}
