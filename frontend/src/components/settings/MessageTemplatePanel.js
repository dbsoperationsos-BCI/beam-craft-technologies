"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import Loader from "@/components/shared/Loader";
import TextAreaField from "@/components/shared/TextAreaField";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import MessagePreview from "@/components/settings/MessagePreview";
import MessageSwitch from "@/components/settings/MessageSwitch";
import { hasMessageSwitch } from "@/lib/messageSwitches.mjs";
import { ATTENDANCE_REPORT_PLACEHOLDERS } from "@/lib/attendanceReport.mjs";
import { PRODUCTION_MESSAGE_PLACEHOLDERS } from "@/lib/productionSteps.mjs";
import { renderTemplate } from "@/lib/messageTemplate.mjs";
import { getMessageTemplate, saveMessageTemplate, setMessageTemplateEnabled } from "@/services/settings/message-templates.service";

/**
 * One message the studio sends, as its wording.
 *
 * The facts are left as `{placeholders}` and filled in by whichever screen sends the message - the
 * receipt below is filled from the cash entry that was just recorded. So this edits prose, and the
 * only thing the application asks of it is which placeholders it uses.
 *
 * The list under the box is the point of the screen: a placeholder is only filled if the sending
 * module knows it, and there is no other way to find out what those are. One typed that nothing
 * fills is left in the message exactly as written rather than blanked - visible, in the one place it
 * will be read, instead of a hole in a sentence sent to a client.
 */

/**
 * What each placeholder means, in the words of the record it comes from - per message.
 *
 * Keyed by template, because a placeholder is only filled by the screen that sends that message: the
 * receipt knows an outstanding balance and the onboarding invite does not. Listing all of them under
 * every message would offer `{payment mode}` to somebody wording a login handover and leave it in
 * the message unanswered, which is the one mistake this list exists to prevent.
 */
/** What every `VENDOR_SHOOT_*` wording may say - see the note in the catalogue below. */
const VENDOR_SHOOT_PLACEHOLDERS = {
  "vendor name": "The vendor being told, as Vendor Management names them",
  shoot: "The shoot's name - \"Reception\", \"Haldi + Mehandi\"",
  "shoot id": "The shoot's own id, DBS-SID-DD-CBE-000256",
  project: "The project's WhatsApp group name, or its Event ID where it has none",
  "event id": "The project's Event ID",
  date: "The shoot's day, as 20 Nov 2026",
  day: "The weekday it falls on, as Friday",
  time: "When it runs - \"6:30 pm to 11:00 pm\", or the session timing where no clock is set",
  place: "Where it is; every place of a multi-location shoot, in the shoots' order",
  district: "The district, and every district of a multi-location shoot",
  service: "The service they are confirmed on - both where they hold two on one shoot",
  "manager name": "The project's Production Manager, whose WhatsApp this is sent from",
};

const PLACEHOLDER_HELP_BY_KEY = {
  CRM_LEAD_WELCOME: {
    "client name": "The lead's name, as the sheet gave it (\"there\" when the sheet had none)",
    "sender name": "Whoever the lead is assigned to - the message is sent from their WhatsApp",
    greeting: "Good morning, Good afternoon or Good evening, for the time the lead came in",
    date: "The day the lead came in, as 28 Oct 2026",
    day: "The weekday the lead came in, as Wednesday",
    time: "The time the lead came in, as 6:45 pm",
    vertical: "The lead's vertical, as Dum Dum",
    branch: "The branch the lead is assigned to (empty when none is)",
    "enquiry id": "The lead's Enquiry ID on the CRM",
  },
  INTERVIEW_WELCOME: {
    "candidate name": "The candidate's name, as the sheet gave it (\"there\" when the sheet had none)",
    "sender name": "The HR person chosen above - the message is sent from their WhatsApp",
    greeting: "Good morning, Good afternoon or Good evening, for the time the candidate came in",
    date: "The day the candidate came in, as 28 Oct 2026",
    day: "The weekday the candidate came in, as Wednesday",
    time: "The time the candidate came in, as 6:45 pm",
    position: "The position the candidate applied for, as the sheet gave it",
    department: "The department, as the sheet gave it",
    branch: "The branch the candidate is being interviewed for",
    city: "The candidate's city",
    "candidate id": "The candidate's ID in the Interview register",
  },
  PHOTO_SELECTION_SUBMITTED: {
    "client name": "The client on the Image Selection project, or on its sales project",
    "project name": "The Image Selection project's name",
    "event name": "The shoot the submitted selection items belong to",
    "category breakdown": "One line per selection item this submission sent, with its count - \"- Retouches: 5 photos selected\"; a Submit All lists every item it sent",
    "total selected count": "The photos selected across the items this submission sent",
    "deliverables": "The same items on one line - Retouches (5), Frames (3)",
    "selected count": "The same total as a bare number",
    "submitted at": "When the client pressed Submit, as 20 Oct 2026, 12:00 pm",
  },
  CASH_RECEIVED: {
    "payment amount": "What was received, as ₹2,000.00",
    "payment date": "The date on the entry, as 07 Sep 2026",
    "shoot name": "The shoot it was received towards, or the project where no shoot was chosen",
    "payment mode": "Cash, UPI, Bank Transfer — the mode recorded on the entry",
    "outstanding balance": "The quotation and its approved extras, less everything received so far",
    "payment id": "The entry's own id, DBS-MR-QQ-ERD-000004",
    "client name": "The client the project is for",
    "project id": "The project's Event ID",
    "invoice link": "The client's link to open this payment's invoice, no sign-in needed - added at the end when the wording leaves it out",
  },
  SHOOT_CREW_ASSIGNED: {
    "employee name": "Who is being told, as their employee record names them",
    shoot: "The shoot's name - \"Reception\", \"Haldi + Mehandi\"",
    "shoot id": "The shoot's own id, DBS-SID-DD-CBE-000256",
    project: "The project's WhatsApp group name, or its Event ID where it has none",
    "event id": "The project's Event ID",
    date: "The shoot's day, as 02 Nov 2026",
    day: "The weekday it falls on, as Monday",
    time: "When it runs - \"6:30 pm to 11:00 pm\", or the session timing where no clock is set",
    place: "Where it is; every place of a multi-location shoot, in the shoots' order",
    district: "The district, and every district of a multi-location shoot",
    service: "The service they are on - both where they hold two on one shoot",
    coordinator: "The shoot's Production Coordinator",
  },
  SHOOT_CREW_REMOVED: {
    "employee name": "Who is being told they are off the shoot",
    shoot: "The shoot they are no longer on",
    "shoot id": "The shoot's own id, DBS-SID-DD-CBE-000256",
    project: "The project's WhatsApp group name, or its Event ID where it has none",
    "event id": "The project's Event ID",
    date: "The shoot's day, as 02 Nov 2026",
    day: "The weekday it falls on, as Monday",
    time: "When it runs",
    place: "Where it is",
    district: "The district",
    service: "Empty - they are on none now",
    coordinator: "The shoot's Production Coordinator",
  },
  // Filled by Interview → Send Application Invite's sent screen, the copy sent on WhatsApp.
  INTERVIEW_APPLICATION_INVITE: {
    "candidate name": "Who the invite was raised for, as it was typed on the invite",
    "application link": "The candidate's own link to the application form",
    position: "The position the invite is for",
    "expiry date": "When the link stops working, as 23 Sep 2026",
  },
  /*
   * The six vendor wordings. All of them take the same placeholders, so the studio can move a detail
   * from one message into another; what differs is what each is *for*. One map, named once: typed out
   * six times it would drift, and six slightly different lists for one set of facts is how a
   * placeholder ends up documented in five messages and missing from the sixth.
   */
  ...Object.fromEntries(["VENDOR_SHOOT_CONFIRMED", "VENDOR_SHOOT_REMINDER", "VENDOR_SHOOT_DATE_CHANGED", "VENDOR_SHOOT_PLACE_CHANGED", "VENDOR_SHOOT_SERVICE_CHANGED", "VENDOR_SHOOT_REMOVED"]
    .map((key) => [key, VENDOR_SHOOT_PLACEHOLDERS])),
  EMPLOYEE_ONBOARDING_INVITE: {
    "candidate name": "Who the invite was raised for, as it was typed on the invite",
    "onboarding link": "The candidate's own link to the onboarding form",
    "expiry date": "When the link stops working, as 23 Sep 2026, 17:30",
  },
  // Filled by the offboarding form's sent screen: the other end of the employment, beside the
  // onboarding invite above.
  EMPLOYEE_OFFBOARDING_FORM: {
    "employee name": "Who the form was raised for, as their record names them",
    "offboarding link": "Their own link to the offboarding form",
    "notice period": "How long they are to serve, as 30 days",
    "expiry date": "When the link stops working, as 23 Sep 2026, 17:30",
  },
  EMPLOYEE_OFFBOARDING_REMINDER: {
    "employee name": "Who the form was raised for, as their record names them",
    "offboarding link": "Their own link to the offboarding form",
    "notice period": "How long they are to serve, as 30 days",
    "expiry date": "When the link stops working, as 23 Sep 2026, 17:30",
  },
  // The message a leaver keeps: the dates HR has just recorded, which are the ones they are held to.
  EMPLOYEE_OFFBOARDING_APPROVED: {
    "employee name": "Who is leaving, as their record names them",
    "notice start date": "The day they said their notice starts, as 5 Nov 2026",
    "last working day": "Their last working day, as 4 Dec 2026",
    "notice period": "How long they are serving, as 30 days",
    "final settlement date": "The payday their full and final settlement is paid on, as 10 Jan 2027",
    "salary hold": "Where Payroll rules held their salary during notice, a sentence saying it is paid with the final settlement; otherwise nothing",
  },
  EMPLOYEE_OFFBOARDING_NOT_ACCEPTED: {
    "employee name": "Who filled the form in, as their record names them",
    "hr remark": "What HR wrote when they refused it - the remark is required, so there is always one",
  },
  LOGIN_CREDENTIALS: {
    "employee name": "Whose account this is",
    username: "What they sign in with",
    "login email": "The email the account was created against",
    "temporary password": "The one-time password, which they are made to change at first sign-in",
    "login link": "Where to sign in — the application's own address",
  },
  // Filled by Create Project's Client Login Ready. A client has no login email and keeps this password.
  CLIENT_LOGIN_CREDENTIALS: {
    "project name": "The project the login was made with",
    username: "What the client signs in with",
    password: "The password the studio gave them, which they keep",
    "login link": "Where to sign in — the application's own address",
  },
  CRD_DOCUMENT_LINK: {
    "client name": "The project's name, as its WhatsApp group is named",
    "event id": "The project's Event ID",
    "crd link": "The client's CRD form — opens without a sign-in",
  },
  // Filled by the Feedback page once a feedback is given: Completed (Excellent or Good) is thanked
  // and asked for a review and a follow; Issues (Average or Poor) is told the team will sort it out.
  FEEDBACK_THANK_YOU: {
    "client name": "The client, as the project names them",
    shoot: "The shoot the feedback is about, as Wedding or Reception",
    "event id": "The project's Event ID",
    "google review link": "The branch's Review Link (Settings → Organization → Branches → External URLs)",
    "social links": "The branch's social media links (Settings → Organization → Branches), one line each it has",
  },
  FEEDBACK_ISSUES: {
    "client name": "The client, as the project names them",
    shoot: "The shoot the feedback is about, as Wedding or Reception",
    "feedback id": "The feedback's Feedback ID, as DBS-FB-00001-01 (the project's ID and this feedback's version), for the client to quote",
    "event id": "The project's Event ID",
  },
  // Filled by the Attendance Register's Send, from the register as it stands at that moment.
  ATTENDANCE_DAILY_REPORT: ATTENDANCE_REPORT_PLACEHOLDERS,
  // The three production messages, posted to the project's WhatsApp group by the coordinator's steps.
  PRODUCTION_STARTED_FROM_STUDIO: PRODUCTION_MESSAGE_PLACEHOLDERS,
  PRODUCTION_REACHED_SHOOT_PLACE: PRODUCTION_MESSAGE_PLACEHOLDERS,
  PRODUCTION_SHOOT_COMPLETED: PRODUCTION_MESSAGE_PLACEHOLDERS,
  // Posted to the project's WhatsApp group two days before a payment is due (Project Management → Payment reminder).
  PAYMENT_DUE_REMINDER: {
    "client name": "The project's name, as its WhatsApp group is named",
    "event id": "The project's Event ID",
    payment: "The payment's category, as Advance or Partial Payment 2",
    amount: "What is still to be received on it, in rupees",
    "due date": "When it is due, as 02 Nov 2026",
  },
};

/*
 * The answer for a key nothing has declared placeholders for - a studio-written message is allowed
 * to have none. One shared object rather than a `{}` written at the point of use, which would be a
 * new reference on every render and is exactly the kind of thing that stops React Compiler being
 * able to preserve this component's memoization.
 */
const NO_PLACEHOLDERS = {};

// What each message is for, and who reads it, is the Settings heading's helper line (`settingsHelp.js`).

/**
 * A sample record per message that has one, so the wording is previewed as it is typed - the
 * placeholders filled the way the sender fills them. A message without a sample has no preview.
 */
const SAMPLE_BY_KEY = {
  INTERVIEW_WELCOME: { "candidate name": "Karthik", "sender name": "Divya", greeting: "Good evening", date: "28 Oct 2026", day: "Wednesday", time: "6:45 pm", position: "Photographer", department: "Production", branch: "Erode TN", city: "Coimbatore", "candidate id": "DBS-CAND-0042" },
  CRM_LEAD_WELCOME: { "client name": "Arun", "sender name": "Priya Raman", greeting: "Good evening", date: "28 Oct 2026", day: "Wednesday", time: "6:45 pm", vertical: "Dum Dum", branch: "Erode TN", "enquiry id": "DBS-ENQ-000123" },
  ATTENDANCE_DAILY_REPORT: { date: "Monday, 2 Nov 2026", time: "10:00 am", branch: "Erode TN", "total employees": "12", "present count": "9", "present list": "1. Divya (DBS-003)\n2. Karthik (DBS-007)", "late count": "1", "late list": "1. Karthik (DBS-007) - in 10:25 am", "absent count": "3", "absent list": "1. Priya (DBS-010) - On leave\n2. Arun (DBS-012)", "leave count": "2", "leave list": "1. Priya (DBS-010)\n2. Meera (DBS-011) (approval pending)", "uninformed leave count": "1", "uninformed leave list": "1. Arun (DBS-012)", "on leave count": "1", "on leave list": "1. Priya (DBS-010)", "comp-off count": "0", "comp-off list": "None", "permission count": "1", "permission list": "1. Divya (DBS-003) - 2:00 pm to 3:00 pm", "not checked out count": "0", "not checked out list": "None" },
  PAYMENT_DUE_REMINDER: { "client name": "Arun & Meera · Reception", "event id": "DBS-EV-0123", payment: "Advance", amount: "₹30,000", "due date": "02 Nov 2026" },
  PHOTO_SELECTION_SUBMITTED: { "client name": "Arun", "project name": "Arun & Meera · Reception", "event name": "Reception", "category breakdown": "- Retouches: 120 photos selected\n- Frames: 30 photos selected", "total selected count": "150", "deliverables": "Retouches (120), Frames (30)", "selected count": "150", "submitted at": "20 Oct 2026, 12:00 pm" },
  CASH_RECEIVED: { "payment amount": "₹25,000.00", "payment date": "07 Sep 2026", "shoot name": "Reception", "payment mode": "UPI", "outstanding balance": "₹75,000.00", "payment id": "DBS-MR-QQ-ERD-000004", "client name": "Arun", "project id": "DBS-EV-0123", "invoice link": "https://app.example.com/invoice/sample" },
  EMPLOYEE_ONBOARDING_INVITE: { "candidate name": "Karthik", "onboarding link": "https://app.example.com/onboarding/apply/sample", "expiry date": "23 Sep 2026, 17:30" },
  INTERVIEW_APPLICATION_INVITE: { "candidate name": "Karthik", "application link": "https://app.example.com/interview/apply/sample", position: "Photographer", "expiry date": "23 Sep 2026" },
  EMPLOYEE_OFFBOARDING_FORM: { "employee name": "Divya", "offboarding link": "https://app.example.com/offboarding/sample", "notice period": "30 days", "expiry date": "23 Sep 2026, 17:30" },
  EMPLOYEE_OFFBOARDING_REMINDER: { "employee name": "Divya", "offboarding link": "https://app.example.com/offboarding/sample", "notice period": "30 days", "expiry date": "23 Sep 2026, 17:30" },
  EMPLOYEE_OFFBOARDING_APPROVED: { "employee name": "Divya", "notice start date": "5 Nov 2026", "last working day": "4 Dec 2026", "notice period": "30 days", "final settlement date": "10 Jan 2027", "salary hold": "Your salary during your notice is held and paid with it." },
  EMPLOYEE_OFFBOARDING_NOT_ACCEPTED: { "employee name": "Divya", "hr remark": "Please give your notice start date as the date you spoke to your manager." },
  LOGIN_CREDENTIALS: { "employee name": "Divya", username: "divya", "login email": "divya@example.com", "temporary password": "Temp@4821", "login link": "https://app.example.com/login" },
  CLIENT_LOGIN_CREDENTIALS: { "project name": "Arun & Meera · Reception", username: "arun.meera", password: "Arun@2026", "login link": "https://app.example.com/login" },
  CRD_DOCUMENT_LINK: { "client name": "Arun & Meera · Reception", "event id": "DBS-EV-0123", "crd link": "https://app.example.com/crd/sample" },
  FEEDBACK_THANK_YOU: { "client name": "Arun", shoot: "Reception", "event id": "DBS-EV-0123", "google review link": "https://g.page/r/sample/review", "social links": "Instagram: https://instagram.com/sample\nYouTube: https://youtube.com/@sample" },
  FEEDBACK_ISSUES: { "client name": "Arun", shoot: "Reception", "feedback id": "DBS-FB-00001-01", "event id": "DBS-EV-0123" },
  SHOOT_CREW_ASSIGNED: { "employee name": "Karthik", shoot: "Reception", "shoot id": "DBS-SID-DD-CBE-000256", project: "Arun & Meera · Reception", "event id": "DBS-EV-0123", date: "02 Nov 2026", day: "Monday", time: "6:30 pm to 11:00 pm", place: "Sri Krishna Mahal, Erode", district: "Erode", service: "Candid Photography", coordinator: "Divya" },
  // Somebody taken off the shoot is on no service now, so `{service}` is filled with nothing.
  SHOOT_CREW_REMOVED: { "employee name": "Karthik", shoot: "Reception", "shoot id": "DBS-SID-DD-CBE-000256", project: "Arun & Meera · Reception", "event id": "DBS-EV-0123", date: "02 Nov 2026", day: "Monday", time: "6:30 pm to 11:00 pm", place: "Sri Krishna Mahal, Erode", district: "Erode", service: "", coordinator: "Divya" },
  PRODUCTION_STARTED_FROM_STUDIO: { "project name": "Arun & Meera · Reception", shoot: "Reception", date: "02 Nov 2026", location: "Sri Krishna Mahal, Erode", coordinator: "Divya" },
  PRODUCTION_REACHED_SHOOT_PLACE: { "project name": "Arun & Meera · Reception", shoot: "Reception", date: "02 Nov 2026", location: "Sri Krishna Mahal, Erode", coordinator: "Divya" },
  PRODUCTION_SHOOT_COMPLETED: { "project name": "Arun & Meera · Reception", shoot: "Reception", date: "02 Nov 2026", location: "Sri Krishna Mahal, Erode", coordinator: "Divya" },
};

/*
 * What the sender adds after filling the wording, so the preview shows what is sent: the receipt
 * always carries its invoice link, as a line of its own at the end where the wording leaves
 * `{invoice link}` out (`accounts/cash-entries/receiptMessage.js`).
 */
const AFTER_FILL_BY_KEY = {
  CASH_RECEIVED: (text, sample) => (text.includes(sample["invoice link"]) ? text : `${text.trimEnd()}\n\nInvoice: ${sample["invoice link"]}`),
};

/**
 * `helpKey` reads the intro, the placeholders and the sample of another key - for a wording that is a
 * variant of it, such as a vertical's own New Lead Welcome. `name` is what a template saved for the
 * first time is called; an existing one keeps its own.
 */
export default function MessageTemplatePanel({ templateKey, helpKey = templateKey, name, canWrite = false, switchable = true, onNotice, onError, unsavedRef }) {
  const PLACEHOLDER_HELP = PLACEHOLDER_HELP_BY_KEY[helpKey] || NO_PLACEHOLDERS;
  const sample = SAMPLE_BY_KEY[helpKey] || null;
  const [template, setTemplate] = useState(null);
  const [body, setBody] = useState("");
  const [savedBody, setSavedBody] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // The switch saves the moment it is pressed, so it keeps its own busy state rather than sharing the
  // wording's Save - pressing one must never look like it published the other.
  const [switching, setSwitching] = useState(false);
  const enabled = template ? template.enabled !== false : true;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getMessageTemplate(templateKey);
      setTemplate(response?.data || null);
      setBody(response?.data?.body || "");
      setSavedBody(response?.data?.body || "");
    } catch (error) {
      // A message the studio has not written yet is not a failure: the box opens empty and saving
      // it is what creates it.
      if (error?.status === 404) {
        setTemplate(null);
        setBody("");
        setSavedBody("");
      } else {
        onError?.(error.message || "Unable to load this message.");
      }
    } finally {
      setLoading(false);
    }
  }, [onError, templateKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const changed = savedBody !== null && body !== savedBody;

  /*
   * What Settings asks before it lets this panel go: closing the overlay or moving to another
   * section throws an unsaved edit away, so the panel holding the edit is the one that says so.
   */
  useEffect(() => {
    if (!unsavedRef) return undefined;
    unsavedRef.current = changed;
    return () => { unsavedRef.current = false; };
  }, [changed, unsavedRef]);

  async function save() {
    setSaving(true);
    try {
      const response = await saveMessageTemplate(templateKey, { body, ...(name ? { name } : {}) });
      setTemplate(response?.data || null);
      setSavedBody(response?.data?.body ?? body);
      onNotice?.("Message saved. It is used the next time this message is sent.");
    } catch (error) {
      onError?.(error?.data?.message || error.message || "Unable to save this message.");
    } finally {
      setSaving(false);
    }
  }

  async function switchIt(next) {
    setSwitching(true);
    try {
      const response = await setMessageTemplateEnabled(templateKey, next);
      setTemplate(response?.data || template);
      onNotice?.(next
        ? "This message is on. It is sent the next time its moment comes."
        : "This message is off. Nothing is sent for it until it is switched back on.");
    } catch (error) {
      onError?.(error?.data?.message || error.message || "Unable to switch this message on or off.");
    } finally {
      setSwitching(false);
    }
  }

  if (loading) return <Loader label="Loading the message..." />;

  const used = template?.placeholders || [];
  const filled = sample && body.trim() ? renderTemplate(body, sample) : "";
  const preview = filled && AFTER_FILL_BY_KEY[helpKey] ? AFTER_FILL_BY_KEY[helpKey](filled, sample) : filled;

  return <div className="space-y-4">
    {/*
      * **Whether this message is sent at all**, above its wording - because somebody who has come to
      * switch a message off should not have to read the words first, and because the answer is about
      * this message rather than about the feature that sends it. A studio wanting "shoot completed"
      * and not "started from studio" had to take both or neither.
      *
      * `switchable={false}` leaves it out, for a message whose own notification panel already carries
      * the switch - the attendance report, Photo Selection Submitted, New Lead Welcome. Two switches
      * for one message is one too many, and the reader cannot tell from the screen which of them
      * decides: there the panel above is the switch, and this is the wording.
      *
      * Off is said plainly rather than left to the switch's colour: the wording below it stays
      * editable and still looks live, so the one line is what tells a reader nothing is going out.
      */}
    {switchable && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-800">{enabled ? "This message is sent" : "This message is switched off"}</p>
        <p className="text-xs text-slate-500">
          {enabled
            ? "Switch it off to stop it being sent, without losing the wording below."
            : "The wording below is kept, and nothing is sent until this is switched back on."}
        </p>
      </div>
      {canWrite
        ? <ToggleSwitch
          label={enabled ? "On" : "Off"}
          ariaLabel={`Send ${name || templateKey}`}
          checked={enabled}
          disabled={switching}
          onCheckedChange={(next) => { void switchIt(next); }}
        />
        : <span className={`text-sm font-medium ${enabled ? "text-emerald-700" : "text-slate-500"}`}>{enabled ? "On" : "Off"}</span>}
    </div>}
    <TextAreaField
      label="Message"
      value={body}
      readOnly={!canWrite}
      rows={14}
      onChange={(event) => setBody(event.target.value)}
      inputClassName="text-sm sm:text-sm"
      helperText={"Words in {braces} are filled in from the record each time it is sent."}
    />

    {/* What may be used, and what this wording currently uses. A placeholder nothing fills is left
        in the message as typed, so the list is the only way to know which those are. */}
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 sm:p-4">
      <p className="text-[11px] font-semibold text-slate-600 sm:text-xs">Placeholders you can use</p>
      <dl className="mt-2 grid gap-x-4 gap-y-2 sm:grid-cols-2">
        {Object.entries(PLACEHOLDER_HELP).map(([name, meaning]) => <div key={name} className="min-w-0">
          <dt className={`font-mono text-[11px] ${used.includes(name) ? "text-blue-700" : "text-slate-500"}`}>{`{${name}}`}</dt>
          <dd className="text-[11px] text-slate-500">{meaning}</dd>
        </div>)}
      </dl>
      {used.some((name) => !(name in PLACEHOLDER_HELP)) && <p className="mt-3 text-[11px] text-amber-700">
        This message uses {used.filter((name) => !(name in PLACEHOLDER_HELP)).map((name) => `{${name}}`).join(", ")},
        which nothing fills in — it will be sent exactly as written.
      </p>}
    </div>

    {/* The draft as the reader will see it, filled from the sample - the draft as typed, not the saved copy. */}
    <MessagePreview text={preview} />

    {canWrite && <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary" disabled={!changed || saving} onClick={() => void save()}>{saving ? "Saving..." : "Save message"}</Button>
      {changed && <Button type="button" disabled={saving} onClick={() => setBody(savedBody)}>Discard changes</Button>}
    </div>}
  </div>;
}
