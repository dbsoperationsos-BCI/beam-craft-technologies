"use client";

import SimpleTable from "@/components/data-table/SimpleTable";

import { Fragment, useEffect, useMemo, useState } from "react";
import Button from "@/components/shared/Button";
import DateField from "@/components/shared/DateField";
import ComboBoxField from "@/components/shared/ComboBoxField";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import Loader from "@/components/shared/Loader";
import PhoneField from "@/components/shared/PhoneField";
import ShareableMessage from "@/components/shared/ShareableMessage";
import useMessageTemplate from "@/components/shared/useMessageTemplate";
import { renderMessageOr } from "@/lib/messageTemplate.mjs";
import TextField from "@/components/shared/TextField";
import Dialog from "@/components/ui/Dialog";
import { copyToClipboard } from "@/lib/clipboard";
import {
  cancelApplicationInvite,
  createApplicationInvite,
  getApplicationInvites,
  sendApplicationInviteEmail,
  updateApplicationInvite,
} from "@/services/hrm/interview.service";

/**
 * The screening form sent to a candidate, and the list of every form sent.
 *
 * The Employee Repository's onboarding invite dialog for candidates rather than new hires - the
 * same three screens in one card (create, the message to send, the list of everything raised), the
 * same rules about what can still be done to one, and the same wording control. It is the same
 * dialog because it is the same job: HR has a name and a number, and what they want is the rest of
 * the application from the person themselves.
 *
 * `initialMode` is "create" from a row's **Send Screening Form** and "list" from **View All
 * Invites** in the header's ⋮, exactly as the repository's own menu entry opens it.
 */

const initialForm = (candidate = null) => ({
  candidateName: candidate?.name || "",
  candidateEmail: candidate?.email || "",
  candidatePhone: candidate?.phone || "",
  position: candidate?.position || "",
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
});

/** An invite as the form holds it. One rule, so both ways into Edit fill the same boxes. */
function formFromInvite(invite) {
  return {
    candidateName: invite?.candidateName || "",
    candidateEmail: invite?.candidateEmail || "",
    candidatePhone: invite?.candidatePhone || "",
    position: invite?.position || "",
    // The invite's own expiry. Moving it forward is how a lapsed form is brought back without
    // issuing a new link.
    expiresAt: invite?.expiresAt ? new Date(invite.expiresAt).toISOString().slice(0, 10) : initialForm().expiresAt,
  };
}

function formatDate(value) {
  return value ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
}

function statusClass(status) {
  if (status === "Created") return "bg-blue-50 text-blue-700";
  if (status === "Verified") return "bg-emerald-50 text-emerald-700";
  if (status === "Submitted") return "bg-teal-50 text-teal-700";
  if (status === "Cancelled") return "bg-slate-100 text-slate-600";
  if (status === "Expired") return "bg-amber-50 text-amber-700";
  return "bg-slate-100 text-slate-700";
}

export default function InterviewApplicationInviteDialog({
  initialMode = "create",
  initialCandidate = null,
  initialEditInvite = null,
  options = {},
  onClose,
  onBack,
  backAriaLabel,
  onInviteCreated,
  onInviteChanged,
  onInviteSent,
  onInviteSendFailed,
}) {
  const [mode, setMode] = useState(initialMode);
  /*
   * Seeded into the form's initial state rather than applied by an effect: the form would otherwise
   * render once empty and fill in a tick later, which reads as a flash of a blank screen - and an
   * effect that writes state on mount is the pattern this codebase keeps out of components.
   */
  const [form, setForm] = useState(() => (initialEditInvite ? formFromInvite(initialEditInvite) : initialForm(initialCandidate)));
  const [createdInvite, setCreatedInvite] = useState(null);
  const [editingInvite, setEditingInvite] = useState(initialEditInvite);
  // Whether the success screen is showing a corrected invite or a new one. `editingInvite` cannot
  // answer it: it is cleared as the save lands, so the form is not left in edit mode.
  const [savedAnEdit, setSavedAnEdit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sendMessage, setSendMessage] = useState("");
  const [sendError, setSendError] = useState("");
  const [invites, setInvites] = useState([]);
  const [loadingInvites, setLoadingInvites] = useState(() => initialMode === "list");
  const { notice, showSuccess, showError, clearNotice } = useNotice();
  const [cancellingId, setCancellingId] = useState("");
  const [openCandidates, setOpenCandidates] = useState(() => new Set());

  /*
   * The studio's own wording for this message, under `INTERVIEW_APPLICATION_INVITE` in the shared
   * message-template store, filled in with this invite.
   *
   * The sentences below are what this screen prints where the studio has not written one, which is
   * every studio today: no Settings rail entry offers this key yet, so the fallback *is* the
   * message. It is written to be usable as it stands rather than as a stand-in for something else. The email the invite sends is a different wording and is untouched -
   * this is the copy somebody pastes into WhatsApp, which is the one that has to work when the mail
   * never arrives.
   */
  const inviteTemplate = useMessageTemplate("INTERVIEW_APPLICATION_INVITE");
  const builtInMessage = [
    `Hi ${createdInvite?.candidateName || "there"},`,
    "",
    createdInvite?.position
      ? `Thank you for your interest in the ${createdInvite.position} position. Please complete your application here:`
      : "Thank you for your interest in joining us. Please complete your application here:",
    createdInvite?.applicationUrl || "",
    "",
    `The link is open until ${formatDate(createdInvite?.expiresAt)}. You will be asked for your email or phone number to open it — use the one you gave us.`,
    "",
    "Please keep this link to yourself.",
  ].join("\n");
  const inviteMessage = renderMessageOr(builtInMessage, inviteTemplate, {
    "candidate name": createdInvite?.candidateName || "there",
    "application link": createdInvite?.applicationUrl || "",
    position: createdInvite?.position || "",
    "expiry date": formatDate(createdInvite?.expiresAt),
  });

  const setField = (name, value) => setForm((current) => ({ ...current, [name]: value }));
  const updateField = (event) => setField(event.target.name, event.target.value);

  useEffect(() => {
    if (initialMode !== "list") return undefined;
    let active = true;
    void getApplicationInvites()
      .then((result) => { if (active) setInvites(result.data || []); })
      .catch((requestError) => { if (active) showError(requestError.status === 401 || requestError.status === 403 ? "Your session has expired. Please sign in again." : requestError.message || "Failed to load screening forms."); })
      .finally(() => { if (active) setLoadingInvites(false); });
    return () => { active = false; };
  }, [initialMode, showError]);

  /*
   * Every field is answered before a form is sent. The browser refuses the empty text boxes itself,
   * but the phone and the expiry are not native inputs the form can validate - so they are checked
   * here. Named rather than counted: "fill in the required fields" on a form of five is a sentence
   * somebody has to solve.
   */
  const OUTSTANDING = [
    ["candidateName", "Candidate Name"],
    ["candidateEmail", "Candidate Email"],
    ["candidatePhone", "Candidate Phone"],
    ["expiresAt", "Expiry Date"],
  ];
  const missingFields = () => OUTSTANDING.filter(([field]) => !String(form[field] ?? "").trim()).map(([, label]) => label);

  async function submit(event) {
    event.preventDefault();
    const missing = missingFields();
    if (missing.length) {
      setError(`Fill in ${missing.join(", ")}.`);
      return;
    }
    setSubmitting(true);
    setError("");
    const answers = {
      candidateName: form.candidateName.trim(),
      candidateEmail: form.candidateEmail.trim(),
      candidatePhone: form.candidatePhone.trim(),
      position: form.position.trim() || null,
      expiresAt: new Date(`${form.expiresAt}T23:59:59`).toISOString(),
    };
    try {
      /*
       * Correcting a form and raising one are the same four answers going to two endpoints. The
       * edit keeps the invite's token and short code, so what comes back carries the link the
       * candidate already has - which is why both land on the same screen, with the message to
       * send and the button that sends it.
       */
      const result = editingInvite
        ? await updateApplicationInvite(editingInvite.id, answers)
        : await createApplicationInvite({ ...answers, candidateId: initialCandidate?.id || null });
      const saved = { ...result.invite, applicationUrl: result.applicationUrl || result.invite?.applicationUrl };
      setSavedAnEdit(Boolean(editingInvite));
      setCreatedInvite(saved);
      setInvites((current) => [saved, ...current.filter((invite) => invite.id !== saved.id)]);
      // The register behind is rebuilt from this either way: sending a form moves a candidate to
      // Form Submission Pending, and a corrected row has to stop showing what was typed wrong.
      (editingInvite ? onInviteChanged : onInviteCreated)?.(saved);
      setEditingInvite(null);
      setMode("success");
    } catch (requestError) {
      setError(requestError.status === 401 || requestError.status === 403
        ? "Your session has expired. Please sign in again."
        : requestError.data?.message || requestError.message || (editingInvite ? "Unable to update this screening form." : "Unable to send this screening form."));
    } finally {
      setSubmitting(false);
    }
  }

  /** Opens the form on an existing invite, so a mistyped address or number can be put right. */
  function editInvite(invite) {
    clearNotice();
    setError("");
    setEditingInvite(invite);
    setSavedAnEdit(false);
    setForm(formFromInvite(invite));
    setMode("create");
  }

  /**
   * The link, on the clipboard. Through `copyToClipboard` rather than `navigator.clipboard`
   * directly: the async Clipboard API exists only on https and localhost, so on a studio reaching
   * the OS over plain http the call throws for a link that is on the screen the whole time.
   */
  async function copyLink() {
    if (!createdInvite?.applicationUrl) return;
    const copied = await copyToClipboard(createdInvite.applicationUrl);
    setCopyMessage(copied ? "Link copied." : "Unable to copy. Select the link and copy it manually.");
  }

  /**
   * Emails the form, and then gets out of the way.
   *
   * Sending is the last thing this dialog is open for, so it closes and says so on the page behind
   * rather than staying up with a green line inside it. A refused send closes it too: the message,
   * with the link in it, is on this screen with its own Copy before Send is pressed at all, so
   * whoever is going to send it by hand already holds it. Both notices are raised through the
   * parent's handlers, because this dialog is about to unmount and a snackbar inside it would go
   * with it.
   */
  async function sendInvite() {
    if (!createdInvite?.applicationUrl) return;
    setSending(true);
    setSendMessage("");
    setSendError("");
    try {
      const url = new URL(createdInvite.applicationUrl);
      const token = url.pathname.split("/").filter(Boolean).at(-1);
      if (!token) throw new Error("The screening form link is unavailable.");
      const result = await sendApplicationInviteEmail(createdInvite.id, { token });
      const message = result.message || "Screening form email sent successfully.";
      setSendMessage(message);
      if (onInviteSent) {
        onInviteSent(message, createdInvite);
        onClose?.();
      }
    } catch (requestError) {
      const reason = requestError.data?.message || requestError.message || "Unable to send the screening form email.";
      setSendError(reason);
      if (onInviteSendFailed) {
        onInviteSendFailed(reason, createdInvite);
        onClose?.();
      }
    } finally {
      setSending(false);
    }
  }

  async function cancelInvite(id) {
    setCancellingId(id);
    try {
      const result = await cancelApplicationInvite(id);
      setInvites((current) => current.map((invite) => invite.id === id ? result.invite : invite));
      onInviteChanged?.(result.invite);
      showSuccess("Screening form cancelled.");
    } catch (requestError) {
      showError(requestError.data?.message || requestError.message || "Unable to cancel this screening form.");
    } finally {
      setCancellingId("");
    }
  }

  /**
   * Sends the form again to somebody whose link was cancelled or left to expire.
   *
   * It opens the form on their details rather than raising a link straight away, because the old
   * link cannot be revived: the token is stored hashed, so nothing - this server included - can
   * reconstruct it, and cancelling is what somebody does when a link went to the wrong address.
   * The cancelled row stays where it is as the record of what happened.
   */
  function resendInvite(invite) {
    clearNotice();
    setForm({
      candidateName: invite.candidateName || "",
      candidateEmail: invite.candidateEmail || "",
      candidatePhone: invite.candidatePhone || "",
      position: invite.position || "",
      expiresAt: initialForm().expiresAt,
    });
    setEditingInvite(null);
    setSavedAnEdit(false);
    setError("");
    setMode("create");
  }

  /** Correcting a form, offered wherever its details are still the studio's to change. */
  const editAction = (invite) => <button
    type="button"
    onClick={() => editInvite(invite)}
    className="whitespace-nowrap text-sm font-medium text-blue-600 hover:text-blue-700"
  >Edit</button>;

  /**
   * The link off a row in the list, on the clipboard.
   *
   * The link is the thing somebody opens this screen for most often - a candidate says they never
   * got the email, or it is being sent over WhatsApp instead - and without this the only way to it
   * was to raise a *second* form, whose success screen carries one. Through `copyToClipboard` for
   * the reason `copyLink` gives: the async Clipboard API is refused over plain http.
   */
  async function copyInviteLink(invite) {
    const copied = await copyToClipboard(invite?.applicationUrl || "");
    if (copied) showSuccess("Link copied.");
    // Not an error worth a stack trace: over plain http the clipboard is simply refused, so the
    // answer is the link itself, which whoever is sending it can select out of the notice.
    else showError(invite?.applicationUrl || "This form has no link to copy.");
  }

  const copyAction = (invite) => (invite.applicationUrl ? <button
    type="button"
    onClick={() => void copyInviteLink(invite)}
    className="whitespace-nowrap text-sm font-medium text-blue-600 hover:text-blue-700"
  >Copy Link</button> : null);

  /**
   * What can still be done to a form, which depends on how far it got. A live one can be cancelled,
   * a cancelled or expired one sent again, and a submitted one is finished - the candidate is on
   * the register - so it offers nothing rather than a control that would only refuse.
   */
  function inviteAction(invite) {
    if (invite.status === "Created" || invite.status === "Verified") {
      return <span className="flex items-center gap-3">
        {copyAction(invite)}
        {editAction(invite)}
        <button
          type="button"
          disabled={cancellingId === invite.id}
          onClick={() => void cancelInvite(invite.id)}
          className="whitespace-nowrap text-sm font-medium text-red-600 hover:text-red-700 disabled:cursor-not-allowed disabled:text-slate-400"
        >{cancellingId === invite.id ? "Cancelling..." : "Cancel"}</button>
      </span>;
    }
    if (invite.status === "Expired") {
      return <span className="flex items-center gap-3">
        {editAction(invite)}
        <button type="button" onClick={() => resendInvite(invite)} className="whitespace-nowrap text-sm font-medium text-blue-600 hover:text-blue-700">Send Again</button>
      </span>;
    }
    if (invite.status === "Cancelled") {
      return <button type="button" onClick={() => resendInvite(invite)} className="whitespace-nowrap text-sm font-medium text-blue-600 hover:text-blue-700">Send Again</button>;
    }
    return <span className="text-sm text-slate-400">—</span>;
  }

  /**
   * One row per candidate rather than one per form.
   *
   * Somebody sent a form twice has two invites and had two rows, which read as the same person
   * listed twice rather than as one person asked twice. So each candidate is shown by their latest
   * form - the one there is anything to do about - and the attempts behind it fold away under it.
   * Grouped on the email, which is what the server treats as the candidate when it refuses a
   * second live form.
   */
  const candidateGroups = useMemo(() => {
    const byCandidate = new Map();
    for (const invite of invites) {
      const key = (invite.candidateEmail || invite.candidatePhone || invite.id).trim().toLocaleLowerCase();
      byCandidate.set(key, [...(byCandidate.get(key) || []), invite]);
    }
    const newestFirst = (first, second) => new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime();
    return [...byCandidate.entries()]
      .map(([key, all]) => {
        const [current, ...earlier] = [...all].sort(newestFirst);
        return { key, current, earlier };
      })
      .sort((first, second) => newestFirst(first.current, second.current));
  }, [invites]);

  const toggleCandidate = (key) => setOpenCandidates((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  const isList = mode === "list";
  const isSuccess = mode === "success";

  const title = isList ? "Screening Forms"
    : isSuccess ? (savedAnEdit ? "Screening Form Updated" : "Screening Form Ready")
      : editingInvite ? "Edit Screening Form" : "Send Screening Form";
  const description = isList || isSuccess ? undefined
    : editingInvite
      ? "Correct the candidate's details. Their link does not change, so the one already sent keeps working — send it again below if they never received it."
      : "Create a secure, one-time link for the candidate to fill in their own application.";

  return <>
    <FloatingNotice notice={notice} onClose={clearNotice} />
    <Dialog
      title={title}
      description={description}
      size={isList ? "full" : "md"}
      // The list holds its size whether it is loading, empty, or long; the rows scroll inside it.
      height={isList ? "tall" : "auto"}
      busy={submitting}
      onClose={onClose}
      // Only on the form itself: the list is reached from its own menu entry, and going back
      // mid-success would suggest undoing a form already raised.
      {...(!isList && !isSuccess ? { onBack, backAriaLabel } : {})}
      onSubmit={isList || isSuccess ? undefined : submit}
      headerActions={isList ? <Button type="button" onClick={() => { setEditingInvite(null); setSavedAnEdit(false); setForm(initialForm()); setError(""); setMode("create"); }}>Send a Form</Button> : null}
      footer={isList ? null : isSuccess ? <>
        <Button className="max-sm:flex-1" type="button" onClick={onClose}>Close</Button>
        {sendError && <Button className="max-sm:flex-1" type="button" onClick={() => void copyLink()}>Copy Link</Button>}
        <Button className="max-sm:flex-1" type="button" variant="primary" disabled={sending || Boolean(sendMessage)} onClick={() => void sendInvite()}>{sendMessage ? "Form Sent" : sending ? "Sending..." : "Send Form"}</Button>
      </> : <>
        <Button className="max-sm:flex-1" type="button" disabled={submitting} onClick={onClose}>Cancel</Button>
        <Button className="max-sm:flex-1" variant="primary" disabled={submitting}>{submitting ? (editingInvite ? "Saving..." : "Creating...") : editingInvite ? "Save Changes" : "Create Link"}</Button>
      </>}
    >
      {/* The three states each fill the card, so it reads as one box that is loading, empty, or
          full rather than as a box that changes size depending on which of the three it is. */}
      {isList ? <div className="flex h-full flex-col">
        {loadingInvites && <div className="flex flex-1 items-center justify-center"><Loader label="Loading screening forms..." /></div>}
        {!loadingInvites && invites.length === 0 && <p className="flex flex-1 items-center justify-center text-sm text-slate-500">No screening forms sent yet.</p>}
        {/* Scrolling belongs to the table rather than to the dialog body, so the header row holds
            its place at the top of it. A collapsed border would not paint while stuck, hence the
            shadow standing in for the rule under the header. */}
        {!loadingInvites && invites.length > 0 && <SimpleTable
          variant="plain"
          classNames={{ table: "min-w-[820px]" }}
          columns={[{ key: "candidatename", label: "Candidate Name" }, { key: "email", label: "Email" }, { key: "phone", label: "Phone" }, { key: "position", label: "Position" }, { key: "candidateid", label: "Candidate ID" }, { key: "status", label: "Status" }, { key: "expiresat", label: "Expires At" }, { key: "sentat", label: "Sent At" }, { key: "action", label: "Action" }]}
          rows={candidateGroups}
          rowKey={(group) => group.key}
          /* One record is the current invite and, folded under it, the earlier attempts - so a
             record is more than one row, and the rows are drawn here rather than by the table. */
          renderRow={({ key, current, earlier }) => {
          const showingEarlier = openCandidates.has(key);
          return <Fragment key={key}>
            <tr className="border-b border-slate-100 text-slate-700">
              <td className="whitespace-nowrap px-3 py-3 font-medium">
                {current.candidateName}
                {/* The attempts behind this one, counted rather than listed: the count is the whole
                    reason to open it, and a candidate asked once says nothing at all. */}
                {earlier.length > 0 && <button
                  type="button"
                  onClick={() => toggleCandidate(key)}
                  aria-expanded={showingEarlier}
                  className="ml-2 whitespace-nowrap rounded text-xs font-medium text-blue-600 hover:text-blue-700"
                >
                  {showingEarlier ? "Hide" : `${earlier.length} earlier`}
                </button>}
              </td>
              <td className="whitespace-nowrap px-3 py-3">{current.candidateEmail}</td>
              <td className="whitespace-nowrap px-3 py-3">{current.candidatePhone}</td>
              <td className="whitespace-nowrap px-3 py-3">{current.position || "—"}</td>
              <td className="whitespace-nowrap px-3 py-3">{current.candidateCode || "—"}</td>
              <td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-xs font-medium ${statusClass(current.status)}`}>{current.status}</span></td>
              <td className="whitespace-nowrap px-3 py-3">{formatDate(current.expiresAt)}</td>
              <td className="whitespace-nowrap px-3 py-3">{formatDate(current.createdAt)}</td>
              <td className="whitespace-nowrap px-3 py-3">{inviteAction(current)}</td>
            </tr>
            {/* What was tried before. Recessed, and carrying no action of its own: whatever is to be
                done about this candidate is done to the form above, which is the live one. */}
            {showingEarlier && earlier.map((invite) => <tr key={invite.id} className="border-b border-slate-100 bg-slate-50 text-slate-500">
              <td className="whitespace-nowrap px-3 py-2 pl-8 text-xs">Earlier attempt</td>
              <td className="whitespace-nowrap px-3 py-2 text-xs">{invite.candidateEmail}</td>
              <td className="whitespace-nowrap px-3 py-2 text-xs">{invite.candidatePhone}</td>
              <td className="whitespace-nowrap px-3 py-2 text-xs">{invite.position || "—"}</td>
              <td className="whitespace-nowrap px-3 py-2 text-xs">{invite.candidateCode || "—"}</td>
              <td className="px-3 py-2"><span className={`rounded-full px-2 py-1 text-xs font-medium ${statusClass(invite.status)}`}>{invite.status}</span></td>
              <td className="whitespace-nowrap px-3 py-2 text-xs">{formatDate(invite.expiresAt)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-xs">{formatDate(invite.createdAt)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-xs">—</td>
            </tr>)}
          </Fragment>;
        }}
        />}
      </div> : isSuccess ? <div>
        {/* The form as the message that sends it, and nothing else - the same control the onboarding
            invite and the login credentials end on. The link alone would leave whoever is sending
            it to write the sentences around it every time: what this is, that it expires, and that
            the candidate proves who they are with the email or phone the studio already holds. */}
        <ShareableMessage label="Message to send them" rows={9} message={inviteMessage} />
        {sendMessage && <p role="status" className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Screening form email sent successfully.</p>}
        {sendError && <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{sendError}</p>}
        {copyMessage && <p className={`mt-2 text-sm ${copyMessage === "Link copied." ? "text-emerald-700" : "text-red-600"}`}>{copyMessage}</p>}
      </div> : <div className="space-y-4">
        {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <TextField required label="Candidate Name" name="candidateName" value={form.candidateName} onChange={updateField} />
        <TextField required type="email" label="Candidate Email" name="candidateEmail" value={form.candidateEmail} onChange={updateField} />
        {/* The application's phone control, with its country picker, rather than a bare text box:
            it stores the `+91 9876543210` shape the register keeps a number in, so the number a
            candidate is asked on is already the number their row carries. */}
        <PhoneField required label="Candidate Phone" field="candidatePhone" value={form.candidatePhone} onChange={setField} />
        {/* A combobox rather than a closed list: the studio's designations are what it hires for
            most of the time and not all of it, and the position goes into the email the candidate
            reads - so a role that is not on the list is still worth naming. */}
        <ComboBoxField
          label="Position"
          value={form.position}
          onChange={(value) => setField("position", value)}
          options={options.positions || []}
          placeholder="Select or type the position"
        />
        <DateField required label="Expiry Date" value={form.expiresAt} onChange={(value) => setField("expiresAt", value)} restriction="past" />
      </div>}
    </Dialog>
  </>;
}
