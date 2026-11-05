"use client";

import SimpleTable from "@/components/data-table/SimpleTable";

import { Fragment, useEffect, useMemo, useState } from "react";
import { cancelOnboardingInvite, createOnboardingInvite, getOnboardingInvites, sendOnboardingInviteEmail, updateOnboardingInvite } from "@/services/hrm/onboarding-invites.service";
import Button from "@/components/shared/Button";
import DateField from "@/components/shared/DateField";
import Dropdown from "@/components/shared/Dropdown";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import Loader from "@/components/shared/Loader";
import PhoneField from "@/components/shared/PhoneField";
import ShareableMessage from "@/components/shared/ShareableMessage";
import useMessageTemplate from "@/components/shared/useMessageTemplate";
import { renderMessageOr } from "@/lib/messageTemplate.mjs";
import TextField from "@/components/shared/TextField";
import Dialog from "@/components/ui/Dialog";
import { copyToClipboard } from "@/lib/clipboard";
import { designationOptions } from "@/constants/employeeOptions";
import { getMasterData } from "@/services/hrm/master-data.service";

const initialForm = () => ({
  candidateName: "",
  candidateEmail: "",
  candidatePhone: "",
  intendedDesignation: "",
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
});

/** An invite as the form holds it. One rule, so both ways into Edit fill the same boxes. */
function formFromInvite(invite) {
  return {
    candidateName: invite?.candidateName || "",
    candidateEmail: invite?.candidateEmail || "",
    candidatePhone: invite?.candidatePhone || "",
    intendedDesignation: invite?.intendedDesignation || "",
    // The invite's own expiry, as the date field holds it. Moving it forward is how a lapsed
    // invite is brought back without issuing a new link.
    expiresAt: invite?.expiresAt ? new Date(invite.expiresAt).toISOString().slice(0, 10) : initialForm().expiresAt,
  };
}

function formatDate(value) {
  return value ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
}

function statusClass(status) {
  if (status === "Created") return "bg-blue-50 text-blue-700";
  if (status === "Verified") return "bg-emerald-50 text-emerald-700";
  if (status === "Cancelled") return "bg-slate-100 text-slate-600";
  if (status === "Expired") return "bg-amber-50 text-amber-700";
  return "bg-slate-100 text-slate-700";
}

export default function OnboardingInviteDialog({ initialMode = "create", initialEditInvite = null, prefill = null, onClose, onBack, backAriaLabel, onInviteCreated, onInviteCancelled, onInviteSent, onInviteSendFailed }) {
  const [mode, setMode] = useState(initialMode);
  /*
   * The invite this dialog was opened to correct, when it was opened from the repository's own row
   * menu rather than from the list inside it.
   *
   * Seeded into the form's initial state rather than applied by an effect: the form would otherwise
   * render once empty and fill in a tick later, which reads as a flash of a blank Create screen -
   * and an effect that writes state on mount is the pattern this codebase keeps out of components.
   */
  /*
   * `prefill` fills a **new** invite from somewhere that already knows the answers - the Interview
   * register, where a Selected candidate's name, email, number and the position they applied for
   * are exactly the four questions this asks. Seeded into the initial state for the reason
   * `initialEditInvite` is: writing it in an effect renders one blank frame first.
   *
   * It applies only to Create. An invite opened to be corrected shows itself, and letting a caller
   * overwrite that would be a screen quietly editing something other than what it is displaying.
   */
  const [form, setForm] = useState(() => (initialEditInvite ? formFromInvite(initialEditInvite) : { ...initialForm(), ...(prefill || {}) }));
  const [createdInvite, setCreatedInvite] = useState(null);
  /*
   * The studio's wording, from Settings → Employee Invite Template, filled in with this invite.
   *
   * The sentences in `builtInInviteMessage` are what this screen printed before the wording was the
   * studio's, and they stay as the fallback rather than as the message: a studio that has not
   * written this one, or a row somebody deleted, must still be handed a usable invite here. The
   * email the invite also sends is a different wording and is untouched - this is the copy somebody
   * pastes into WhatsApp, which is the one that has to work when the mail never arrives.
   */
  const inviteTemplate = useMessageTemplate("EMPLOYEE_ONBOARDING_INVITE");
  const builtInInviteMessage = [
    `Hi ${createdInvite?.candidateName || "there"},`,
    "",
    // No studio name in the wording: what the studio calls itself is a Settings value
    // (Branding → Login Credential Name), and a second copy hardcoded here would be the one
    // that goes stale.
    "Welcome aboard. Please complete your onboarding details here:",
    createdInvite?.onboardingUrl || "",
    "",
    `The link is open until ${formatDate(createdInvite?.expiresAt)}. You will be asked for your email or phone number to open it — use the one you gave us.`,
    "",
    "Please keep this link to yourself.",
  ].join("\n");
  const inviteMessage = renderMessageOr(builtInInviteMessage, inviteTemplate, {
    "candidate name": createdInvite?.candidateName || "there",
    "onboarding link": createdInvite?.onboardingUrl || "",
    "expiry date": formatDate(createdInvite?.expiresAt),
  });
  /*
   * The invite the form is correcting, or null when it is creating one.
   *
   * The same form does both, because it asks exactly the same five questions - and an edit that
   * looked different from a create would be a second place for those questions to drift. What
   * changes is where Save sends them, and that this one keeps the invite's link.
   */
  const [editingInvite, setEditingInvite] = useState(initialEditInvite);
  // Whether the success screen is showing a corrected invite or a new one. `editingInvite` cannot
  // answer it: it is cleared as the save lands, so that the form is not left in edit mode.
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
  const [resendingId, setResendingId] = useState("");
  const [openCandidates, setOpenCandidates] = useState(() => new Set());

  function updateField(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  const setField = (name, value) => setForm((current) => ({ ...current, [name]: value }));

  /**
   * The designations HR maintains for itself, from the Employee Repository's Settings dialog — the
   * same list the employee form offers, so the role a candidate is invited as is one the record can
   * actually be set to later. A typed designation could only ever be a near miss of one of these.
   *
   * A list that has not been populated, or that cannot be reached, leaves the field on the values
   * the employee form has always offered rather than on an empty menu.
   */
  const [designations, setDesignations] = useState(designationOptions);
  useEffect(() => {
    let live = true;
    void getMasterData("designations", { active: true })
      .then((result) => {
        const names = (result.data || []).map((record) => record.name).filter(Boolean);
        if (live && names.length) setDesignations(names);
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (initialMode !== "list") return undefined;
    let active = true;
    async function loadInitialInvites() {
      try {
        const result = await getOnboardingInvites();
        if (active) setInvites(result.data || []);
      } catch (requestError) {
        if (active) showError(requestError.status === 401 || requestError.status === 403 ? "Your session has expired. Please sign in again." : requestError.message || "Failed to load invites.");
      } finally {
        if (active) setLoadingInvites(false);
      }
    }
    void loadInitialInvites();
    return () => { active = false; };
  }, [initialMode, showError]);

  /*
   * Every field on this form is answered before an invite is created.
   *
   * The browser refuses the empty text boxes itself - they carry `required` - but the designation
   * and the expiry are a `Dropdown` and a `DateField`, neither of which is a native input the form
   * can validate, so they are checked here. Named rather than counted: "fill in the required
   * fields" on a form of five is a sentence somebody has to solve.
   */
  const OUTSTANDING = [
    ["candidateName", "Candidate Name"],
    ["candidateEmail", "Candidate Email"],
    ["candidatePhone", "Candidate Phone"],
    ["intendedDesignation", "Intended Designation"],
    ["expiresAt", "Expiry Date"],
  ];
  const missingFields = () => OUTSTANDING.filter(([field]) => !String(form[field] ?? "").trim()).map(([, label]) => label);

  async function createInvite(event) {
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
      intendedDesignation: form.intendedDesignation.trim(),
      expiresAt: new Date(`${form.expiresAt}T23:59:59`).toISOString(),
    };
    try {
      /*
       * Correcting an invite and creating one are the same five answers going to two endpoints.
       * The edit keeps the invite's token and short code, so what comes back carries the link the
       * candidate already has - which is why both land on the success screen the same way, with
       * the message to send and the button that sends it.
       */
      const result = editingInvite
        ? await updateOnboardingInvite(editingInvite.id, answers)
        : await createOnboardingInvite(answers);
      const saved = { ...result.invite, onboardingUrl: result.onboardingUrl };
      setSavedAnEdit(Boolean(editingInvite));
      setCreatedInvite(saved);
      // The list behind is rebuilt from this either way: a corrected row has to stop showing the
      // number that was typed wrong.
      onInviteCreated?.(saved);
      setEditingInvite(null);
      setMode("success");
    } catch (requestError) {
      setError(requestError.status === 401 || requestError.status === 403
        ? "Your session has expired. Please sign in again."
        : requestError.message || (editingInvite ? "Unable to update this onboarding invite." : "Unable to create onboarding invite."));
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
   * The link, on the clipboard.
   *
   * Through `copyToClipboard` rather than `navigator.clipboard` directly, which is the fault this
   * replaces: the async Clipboard API exists only on https and localhost, so on a studio reaching
   * the OS over plain http the call threw and the only answer was "Unable to copy link." for a link
   * that was on the screen the whole time. The shared helper falls back to the textarea trick there.
   *
   * It answers in words on the line below rather than by changing an icon: the success screen is
   * `ShareableMessage` now, which hands over the whole message with its own Copy, and this is the
   * narrower thing offered in the footer when the invite email could not be sent - the bare link,
   * for somebody who is about to paste it somewhere themselves.
   */
  async function copyLink() {
    if (!createdInvite?.onboardingUrl) return;
    const copied = await copyToClipboard(createdInvite.onboardingUrl);
    setCopyMessage(copied ? "Link copied." : "Unable to copy. Select the link and copy it manually.");
  }

  /**
   * Emails the link, and then gets out of the way.
   *
   * Sending is the last thing this dialog is open for, so on success it closes and says so on the
   * page behind it rather than staying up with a green line inside it. It used to do the latter: the
   * card stayed exactly as it was, with a disabled button reading "Invite Sent" and a message under
   * the link, and the only thing left to do to it was press Close - a dialog asking to be dismissed
   * after the work it was opened for is finished.
   *
   * The notice is raised through `onInviteSent` on the parent rather than through this component's
   * own `FloatingNotice`, and it has to be: this dialog is about to unmount, and a snackbar rendered
   * inside it would go with it. `sendMessage` is still set first, so a parent that passes no handler
   * keeps the old behaviour instead of a send that appears to do nothing.
   *
   * ── A refused send closes it too ──
   *
   * It used to hold the card open with the reason inside it and a Copy Link button beside it, on the
   * reasoning that a failure is something to act on *here*. That was true while the card was the
   * only place the link could be reached; it is not now — the message, with the link in it, is on
   * this screen with its own Copy before Send Invite is pressed at all, so whoever is going to send
   * it by hand already holds it. Staying open asked them to read the same wording a second time and
   * then dismiss it. The reason goes to the page behind through `onInviteSendFailed`, the same way
   * the send-back reports its own, and for the same reason: the snackbar has to outlive the dialog.
   */
  async function sendInvite() {
    if (!createdInvite?.onboardingUrl) return;
    setSending(true);
    setSendMessage("");
    setSendError("");
    try {
      const url = new URL(createdInvite.onboardingUrl);
      const token = url.pathname.split("/").filter(Boolean).at(-1);
      if (!token) throw new Error("The onboarding link is unavailable.");
      const result = await sendOnboardingInviteEmail(createdInvite.id, { token });
      const message = result.message || "Onboarding invite email sent successfully.";
      setSendMessage(message);
      if (onInviteSent) {
        onInviteSent(message, createdInvite);
        onClose?.();
      }
    } catch (requestError) {
      const reason = requestError.data?.message || requestError.message || "Unable to send onboarding invite email.";
      // Set first, so a parent that wires no handler keeps the old in-card behaviour rather than a
      // dialog that closes on a failure without saying anything - the same hedge the success path
      // above makes with `sendMessage`.
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
      const result = await cancelOnboardingInvite(id);
      setInvites((current) => current.map((invite) => invite.id === id ? result.invite : invite));
      onInviteCancelled?.(result.invite);
      showSuccess("Onboarding invite cancelled.");
    } catch (requestError) {
      showError(requestError.message || "Unable to cancel invite.");
    } finally {
      setCancellingId("");
    }
  }

  /**
   * Invites a candidate again after their invite was cancelled or left to expire.
   *
   * It creates a **new** invite rather than reviving the old one, and that is not a shortcut. The
   * token is stored hashed with only a four-and-four preview kept, so the original link cannot be
   * reconstructed by anyone, this server included. Nor should it be: cancelling is what somebody
   * does when a link went to the wrong address, and handing the same link out again would defeat
   * the cancelling. The cancelled row stays where it is as the record of what happened.
   *
   * The candidate's details come off the old invite, so re-inviting is one press rather than the
   * form typed out a second time from memory. What comes back is a fresh link, shown on the same
   * screen a newly created invite is shown on — including the button that emails it.
   */
  async function resendInvite(invite) {
    /*
     * An invite is a complete record now - every field on the create form is required - and the old
     * invite may not be one. Most of the studio's existing invites were raised before the
     * designation was asked for, so re-inviting one of those cannot be a single press: there is a
     * required answer it does not have and this must not invent one.
     *
     * So the form opens instead, carrying everything the old invite does know. It is the same
     * number of presses as before for an invite that is complete, and for one that is not it asks
     * the one question rather than failing with the server's refusal.
     */
    if (!String(invite.intendedDesignation || "").trim()) {
      setForm({
        candidateName: invite.candidateName || "",
        candidateEmail: invite.candidateEmail || "",
        candidatePhone: invite.candidatePhone || "",
        intendedDesignation: "",
        expiresAt: initialForm().expiresAt,
      });
      setError("This invite was raised before an Intended Designation was asked for. Choose one to send it again.");
      setMode("create");
      return;
    }
    setResendingId(invite.id);
    clearNotice();
    try {
      const result = await createOnboardingInvite({
        candidateName: invite.candidateName,
        candidateEmail: invite.candidateEmail,
        candidatePhone: invite.candidatePhone,
        intendedDesignation: invite.intendedDesignation,
        // A fresh seven days, computed here rather than left to the server: the expiry is a required
        // answer now, so there is no default on the other side to fall back to. The old invite's own
        // is no use - it is in the past, or was cut short by being cancelled.
        expiresAt: new Date(`${initialForm().expiresAt}T23:59:59`).toISOString(),
      });
      const created = { ...result.invite, onboardingUrl: result.onboardingUrl };
      setInvites((current) => [result.invite, ...current]);
      setCreatedInvite(created);
      onInviteCreated?.(created);
      setMode("success");
    } catch (requestError) {
      // The server refuses a second live invite for the same person, which is the answer worth
      // reading rather than a generic failure: somebody has already re-invited them.
      showError(requestError.data?.message || requestError.message || "Unable to send this invite again.");
    } finally {
      setResendingId("");
    }
  }

  /**
   * What can still be done to an invite, which depends on how far it got.
   *
   * A live invite can be cancelled. A cancelled or expired one can be sent again. A submitted one
   * is finished — the person is in the repository — and offers nothing, shown as a dash rather than
   * as a control that would only refuse.
   */
  /** Edit, offered wherever the invite's details are still the studio's to correct. */
  const editAction = (invite) => <button
    type="button"
    onClick={() => editInvite(invite)}
    className="whitespace-nowrap text-sm font-medium text-blue-600 hover:text-blue-700"
  >Edit</button>;

  function inviteAction(invite) {
    /*
     * Correcting an invite, beside cancelling it.
     *
     * A mistyped address or phone number used to leave only Cancel and re-invite, which issues a
     * new link and kills the one already sent - right when the link went to the wrong person, and
     * heavy-handed when the studio simply typed a digit wrong and nobody received anything. Edit
     * keeps the link and changes only what the candidate is contacted on.
     *
     * An **Expired** invite is editable too: its expiry is one of the fields, so moving that
     * forward is how a lapsed invite is brought back without a new link. **Submitted** is not -
     * those details are what the candidate filled the form in against - and neither is
     * **Cancelled**, because cancelling is a decision and an edit must not quietly undo it.
     */
    if (invite.status === "Created" || invite.status === "Verified") {
      return <span className="flex items-center gap-3">
        {editAction(invite)}
        <button
          type="button"
          disabled={cancellingId === invite.id}
          onClick={() => void cancelInvite(invite.id)}
          className="whitespace-nowrap text-sm font-medium text-red-600 hover:text-red-700 disabled:cursor-not-allowed disabled:text-slate-400"
        >{cancellingId === invite.id ? "Cancelling..." : "Cancel Invite"}</button>
      </span>;
    }
    if (invite.status === "Expired") {
      return <span className="flex items-center gap-3">
        {editAction(invite)}
        <button
          type="button"
          disabled={Boolean(resendingId)}
          onClick={() => void resendInvite(invite)}
          className="whitespace-nowrap text-sm font-medium text-blue-600 hover:text-blue-700 disabled:cursor-not-allowed disabled:text-slate-400"
        >{resendingId === invite.id ? "Inviting..." : "Resend Invite"}</button>
      </span>;
    }
    if (invite.status === "Cancelled") {
      return <button
        type="button"
        disabled={Boolean(resendingId)}
        onClick={() => void resendInvite(invite)}
        className="whitespace-nowrap text-sm font-medium text-blue-600 hover:text-blue-700 disabled:cursor-not-allowed disabled:text-slate-400"
      >{resendingId === invite.id ? "Inviting..." : "Resend Invite"}</button>;
    }
    return <span className="text-sm text-slate-400">—</span>;
  }

  /**
   * One row per candidate rather than one per invite.
   *
   * Somebody re-invited after a cancellation has two invites and had two rows, which read as the
   * same person listed twice rather than as one person invited twice. So each candidate is shown by
   * their latest invite — the one there is anything to do about — and the attempts behind it are
   * folded away under it, still there to be opened.
   *
   * Grouped on the email, which is what the server treats as the candidate when it refuses a second
   * live invite. Two invites sharing a phone but not an email stay apart, which is honest: nothing
   * here knows they are the same person.
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

  /*
   * The form does two jobs and says which. Correcting an invite is not creating one, and a screen
   * headed "Create Onboarding Invite" over a filled-in form is a screen that looks like it is about
   * to make a second invite for the same candidate - which is exactly what Edit exists to avoid.
   */
  const title = isList ? "Onboarding Invites"
    : isSuccess ? (savedAnEdit ? "Onboarding Invite Updated" : "Onboarding Invite Created")
      : editingInvite ? "Edit Onboarding Invite" : "Create Onboarding Invite";
  const description = isList || isSuccess ? undefined
    : editingInvite
      ? "Correct the candidate's details. Their link does not change, so the one already sent keeps working — send it again below if they never received it."
      : "Create a secure, one-time onboarding link for a candidate.";

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
      // Only on the form itself: the list is reached from its own menu entry rather than the
      // chooser, and going back mid-success would suggest undoing an invite already created.
      {...(!isList && !isSuccess ? { onBack, backAriaLabel } : {})}
      onSubmit={isList || isSuccess ? undefined : createInvite}
      // The list is reached from the repository's own options menu, so the create form does not
      // repeat that route; only the list offers the way across to creating one.
      headerActions={isList ? <Button type="button" onClick={() => { setEditingInvite(null); setSavedAnEdit(false); setForm(initialForm()); setError(""); setMode("create"); }}>Create Invite</Button> : null}
      footer={isList ? null : isSuccess ? <>
        <Button className="max-sm:flex-1" type="button" onClick={onClose}>Close</Button>
        {sendError && <Button className="max-sm:flex-1" type="button" onClick={() => void copyLink()}>Copy Link</Button>}
        <Button className="max-sm:flex-1" type="button" variant="primary" disabled={sending || Boolean(sendMessage)} onClick={() => void sendInvite()}>{sendMessage ? "Invite Sent" : sending ? "Sending..." : "Send Invite"}</Button>
      </> : <>
        <Button className="max-sm:flex-1" type="button" disabled={submitting} onClick={onClose}>Cancel</Button>
        <Button className="max-sm:flex-1" variant="primary" disabled={submitting}>{submitting ? (editingInvite ? "Saving..." : "Creating...") : editingInvite ? "Save Changes" : "Create Invite"}</Button>
      </>}
    >
      {/* The three states each fill the card, so it reads as one box that is loading, empty, or
          full rather than as a box that changes size depending on which of the three it is. */}
      {isList ? <div className="flex h-full flex-col">
        {loadingInvites && <div className="flex flex-1 items-center justify-center"><Loader label="Loading invites..." /></div>}
        {!loadingInvites && invites.length === 0 && <p className="flex flex-1 items-center justify-center text-sm text-slate-500">No onboarding invites created yet.</p>}
        {/* Scrolling belongs to the table rather than to the dialog body, so the header row can hold
            its place at the top of it. A collapsed border would not paint while stuck, hence the
            shadow standing in for the rule under the header. */}
        {!loadingInvites && invites.length > 0 && <SimpleTable
          variant="plain"
          classNames={{ table: "min-w-[760px]" }}
          columns={[{ key: "candidatename", label: "Candidate Name" }, { key: "email", label: "Email" }, { key: "phone", label: "Phone" }, { key: "intendeddesignation", label: "Intended Designation" }, { key: "status", label: "Status" }, { key: "expiresat", label: "Expires At" }, { key: "createdat", label: "Created At" }, { key: "action", label: "Action" }]}
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
                    reason to open it, and a candidate invited once says nothing at all. */}
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
              <td className="whitespace-nowrap px-3 py-3">{current.intendedDesignation || "—"}</td>
              <td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-xs font-medium ${statusClass(current.status)}`}>{current.status}</span></td>
              <td className="whitespace-nowrap px-3 py-3">{formatDate(current.expiresAt)}</td>
              <td className="whitespace-nowrap px-3 py-3">{formatDate(current.createdAt)}</td>
              <td className="whitespace-nowrap px-3 py-3">{inviteAction(current)}</td>
            </tr>
            {/* What was tried before. Recessed, and carrying no action of its own: whatever is to be
                done about this candidate is done to the invite above, which is the live one. */}
            {showingEarlier && earlier.map((invite) => <tr key={invite.id} className="border-b border-slate-100 bg-slate-50 text-slate-500">
              <td className="whitespace-nowrap px-3 py-2 pl-8 text-xs">Earlier attempt</td>
              <td className="whitespace-nowrap px-3 py-2 text-xs">{invite.candidateEmail}</td>
              <td className="whitespace-nowrap px-3 py-2 text-xs">{invite.candidatePhone}</td>
              <td className="whitespace-nowrap px-3 py-2 text-xs">{invite.intendedDesignation || "—"}</td>
              <td className="px-3 py-2"><span className={`rounded-full px-2 py-1 text-xs font-medium ${statusClass(invite.status)}`}>{invite.status}</span></td>
              <td className="whitespace-nowrap px-3 py-2 text-xs">{formatDate(invite.expiresAt)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-xs">{formatDate(invite.createdAt)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-xs">—</td>
            </tr>)}
          </Fragment>;
        }}
        />}
      </div> : isSuccess ? <div>
        {/*
          * The invite as the message that sends it, and nothing else.
          *
          * It used to be the link in a read-only box under a summary of what had just been typed on
          * the previous screen — three things to read where only one is used. The link alone also
          * left whoever was sending it to write the sentences around it every time: what this is,
          * that it expires, and that the candidate proves who they are with the email or phone the
          * studio already holds. All of that is in the message, so the message is the screen. The
          * same control the login credentials use.
          */}
        <ShareableMessage
          label="Message to send them"
          rows={9}
          message={inviteMessage}
        />
        {sendMessage && <p role="status" className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Onboarding invite email sent successfully.</p>}
        {sendError && <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{sendError}</p>}
        {copyMessage && <p className={`mt-2 text-sm ${copyMessage === "Link copied." ? "text-emerald-700" : "text-red-600"}`}>{copyMessage}</p>}
      </div> : <div className="space-y-4">
        {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <TextField required label="Candidate Name" name="candidateName" value={form.candidateName} onChange={updateField} />
        <TextField required type="email" label="Candidate Email" name="candidateEmail" value={form.candidateEmail} onChange={updateField} />
        {/* The application's phone control, with its country picker, rather than a bare text box.
            It was the one number in the studio typed as free text, which let an invite be created
            for "98765 43210" and the same candidate invited again as "+91 9876543210" — two numbers
            to the duplicate check and one number to everybody else. It stores the `+91 9876543210`
            shape the employee record is validated against, so the number the candidate is invited
            on is already the number their record will carry. */}
        <PhoneField required label="Candidate Phone" field="candidatePhone" value={form.candidatePhone} onChange={setField} />
        {/* Searchable, because the list runs to two dozen roles. There is no "Not specified" entry
            any more: it existed to put the field back to unanswered while the designation was
            optional, and an option whose whole job is to leave a required field empty is a way
            round the rule rather than a choice. A mis-click is undone by picking the right one. */}
        <Dropdown
          searchable
          required
          label="Intended Designation"
          value={form.intendedDesignation}
          onChange={(value) => setField("intendedDesignation", value)}
          options={designations}
          placeholder="Select the designation"
        />
        {/* Prefilled a week out, which is what the server used to fall back to. Required does not
            have to mean empty: the studio still has to look at it, and almost never has to type. */}
        <DateField required label="Expiry Date" value={form.expiresAt} onChange={(value) => setField("expiresAt", value)} />
      </div>}
    </Dialog>
  </>;
}
