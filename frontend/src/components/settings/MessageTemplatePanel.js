"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import Loader from "@/components/shared/Loader";
import { getMessageTemplate, saveMessageTemplate } from "@/services/settings/message-templates.service";

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
const PLACEHOLDER_HELP_BY_KEY = {
  CASH_RECEIVED: {
    "payment amount": "What was received, as ₹2,000.00",
    "payment date": "The date on the entry, as 07 Sep 2026",
    "shoot name": "The shoot it was received towards, or the project where no shoot was chosen",
    "payment mode": "Cash, UPI, Bank Transfer — the mode recorded on the entry",
    "outstanding balance": "The quotation and its approved extras, less everything received so far",
    "payment id": "The entry's own id, DBS-MR-QQ-ERD-000004",
    "client name": "The client the project is for",
    "project id": "The project's Event ID",
  },
  EMPLOYEE_ONBOARDING_INVITE: {
    "candidate name": "Who the invite was raised for, as it was typed on the invite",
    "onboarding link": "The candidate's own link to the onboarding form",
    "expiry date": "When the link stops working, as 23 Sep 2026, 17:30",
  },
  LOGIN_CREDENTIALS: {
    "employee name": "Whose account this is",
    username: "What they sign in with",
    "login email": "The email the account was created against",
    "temporary password": "The one-time password, which they are made to change at first sign-in",
    "login link": "Where to sign in — the application's own address",
  },
};

/*
 * The answer for a key nothing has declared placeholders for - a studio-written message is allowed
 * to have none. One shared object rather than a `{}` written at the point of use, which would be a
 * new reference on every render and is exactly the kind of thing that stops React Compiler being
 * able to preserve this component's memoization.
 */
const NO_PLACEHOLDERS = {};

export default function MessageTemplatePanel({ templateKey, canWrite = false, onNotice, onError, unsavedRef }) {
  const PLACEHOLDER_HELP = PLACEHOLDER_HELP_BY_KEY[templateKey] || NO_PLACEHOLDERS;
  const [template, setTemplate] = useState(null);
  const [body, setBody] = useState("");
  const [savedBody, setSavedBody] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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
      const response = await saveMessageTemplate(templateKey, { body });
      setTemplate(response?.data || null);
      setSavedBody(response?.data?.body ?? body);
      onNotice?.("Message saved. It is used the next time this message is sent.");
    } catch (error) {
      onError?.(error?.data?.message || error.message || "Unable to save this message.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Loader label="Loading the message..." />;

  const used = template?.placeholders || [];

  return <div className="space-y-4">
    <p className="text-xs text-slate-500 sm:text-sm">
      The wording sent to the client. Anything in <span className="font-medium text-slate-700">{"{braces}"}</span> is
      filled in from the record when the message is sent; the rest is sent exactly as written.
    </p>

    <label className="block text-[11px] font-semibold text-slate-600 sm:text-xs">
      <span>Message</span>
      <textarea
        value={body}
        readOnly={!canWrite}
        rows={14}
        onChange={(event) => setBody(event.target.value)}
        className={`mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 ${canWrite ? "bg-white text-slate-700" : "bg-slate-100 text-slate-600"}`}
      />
    </label>

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

    {canWrite && <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary" disabled={!changed || saving} onClick={() => void save()}>{saving ? "Saving..." : "Save message"}</Button>
      {changed && <Button type="button" disabled={saving} onClick={() => setBody(savedBody)}>Discard changes</Button>}
    </div>}
  </div>;
}
