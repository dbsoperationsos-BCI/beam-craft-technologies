"use client";

import { useEffect, useState } from "react";
import SimpleTable from "@/components/data-table/SimpleTable";
import Button from "@/components/shared/Button";
import DateField from "@/components/shared/DateField";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import Loader from "@/components/shared/Loader";
import PhoneField from "@/components/shared/PhoneField";
import ShareableMessage from "@/components/shared/ShareableMessage";
import TextField from "@/components/shared/TextField";
import Dialog from "@/components/ui/Dialog";
import { clearDraft, useDraft } from "@/lib/stayOnRefresh";
import { cancelClientInvite, createClientInvite, listClientInvites, sendClientInvite, updateClientInviteContact } from "@/services/subscribe/client-onboarding.service";

/*
 * Client Details -> Create Onboarding Invite / ⋮ -> View All Invites: the employee invite's flow
 * (OnboardingInviteDialog), for a client company. The form asks who the link is for and until when;
 * Create Invite shows the message to send with Send Invite beside it; the list keeps every invite with
 * what became of it, and Edit / Cancel Invite / Resend Invite on the ones still the team's to act on.
 */

// A week from today, Indian time - the default the employee invite uses.
const weekOut = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
const initialForm = () => ({ contactName: "", contactEmail: "", contactPhone: "", expiresAt: weekOut() });
const dayOf = (value) => (value ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(value)) : "");

function formFromInvite(invite) {
  return {
    contactName: invite?.contactName || "",
    contactEmail: invite?.contactEmail || "",
    contactPhone: invite?.contactPhone || "",
    // The invite's own expiry while it is still ahead; a lapsed one is offered a fresh week, which is
    // how an expired invite is brought back without a new link.
    expiresAt: dayOf(invite?.expiresAt) >= dayOf(new Date()) ? dayOf(invite.expiresAt) : weekOut(),
  };
}

const formatDate = (value) => (value ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(value)) : "—");
// What the list calls each state, in the employee list's words.
const STATUS_LABELS = { Pending: "Created", Submitted: "Submitted", Cancelled: "Cancelled", Expired: "Expired" };
const STATUS_CLASS = { Pending: "bg-blue-50 text-blue-700", Submitted: "bg-emerald-50 text-emerald-700", Cancelled: "bg-slate-100 text-slate-600", Expired: "bg-amber-50 text-amber-700" };
const errorMessage = (error, fallback) => error?.data?.message || error?.message || fallback;

const REQUIRED = [["contactName", "Company Name"], ["contactEmail", "Company Email ID"], ["contactPhone", "Company Phone Number"], ["expiresAt", "Expiry Date"]];

export default function ClientOnboardingInviteDialog({ initialMode = "create", onClose, onInviteCreated, onInviteSent }) {
  const [mode, setMode] = useState(initialMode);
  // What is typed survives a refresh until it is saved or the dialog is closed.
  const [form, setForm] = useDraft("client-invite", initialForm);
  const [editingInvite, setEditingInvite] = useState(null);
  const [savedAnEdit, setSavedAnEdit] = useState(false);
  const [created, setCreated] = useState(null); // { invite, message }
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [invites, setInvites] = useState([]);
  const [loadingInvites, setLoadingInvites] = useState(() => initialMode === "list");
  const [busyId, setBusyId] = useState("");
  const { notice, showSuccess, showError, clearNotice } = useNotice();

  const setField = (name, value) => setForm((current) => ({ ...current, [name]: value }));
  const updateField = (event) => setField(event.target.name, event.target.value);
  const close = () => { clearDraft("client-invite"); onClose?.(); };

  useEffect(() => {
    if (initialMode !== "list") return undefined;
    let active = true;
    listClientInvites()
      .then((result) => { if (active) setInvites(result?.data || []); })
      .catch((requestError) => { if (active) showError(errorMessage(requestError, "Unable to load invites.")); })
      .finally(() => { if (active) setLoadingInvites(false); });
    return () => { active = false; };
  }, [initialMode, showError]);

  // The answers as the server takes them.
  const answers = () => ({
    contactName: form.contactName.trim(),
    contactEmail: form.contactEmail.trim(),
    contactPhone: form.contactPhone.trim(),
    expiresAt: form.expiresAt,
  });

  async function saveInvite(event) {
    event?.preventDefault?.();
    const missing = REQUIRED.filter(([field]) => !String(form[field] ?? "").trim()).map(([, label]) => label);
    if (missing.length) return setError(`Fill in ${missing.join(", ")}.`);
    setSubmitting(true);
    setError("");
    try {
      // Correcting an invite keeps its link, so both land on the same screen with the message to send.
      const result = editingInvite ? await updateClientInviteContact(editingInvite.id, answers()) : await createClientInvite(answers());
      const saved = { invite: result.data.invite, message: result.data.message };
      clearDraft("client-invite");
      setSavedAnEdit(Boolean(editingInvite));
      setCreated(saved);
      setInvites((current) => [saved.invite, ...current.filter((invite) => invite.id !== saved.invite.id)]);
      onInviteCreated?.(saved.invite);
      setEditingInvite(null);
      setMode("success");
    } catch (requestError) {
      setError(errorMessage(requestError, editingInvite ? "Unable to update this invite." : "Unable to create the invite."));
    } finally {
      setSubmitting(false);
    }
  }

  function editInvite(invite) {
    clearNotice();
    setError("");
    setEditingInvite(invite);
    setSavedAnEdit(false);
    setForm(formFromInvite(invite));
    setMode("create");
  }

  // Emails the link, then gets out of the way; a refusal closes it too, with the reason on the page behind.
  async function sendInvite() {
    if (!created?.invite) return;
    setSending(true);
    try {
      const result = await sendClientInvite(created.invite.id);
      onInviteSent?.(result?.message || "Onboarding invite sent.", false);
      close();
    } catch (requestError) {
      onInviteSent?.(errorMessage(requestError, "Unable to send the invite email. Copy the message and send it yourself."), true);
      close();
    } finally {
      setSending(false);
    }
  }

  async function cancelInvite(invite) {
    setBusyId(invite.id);
    try {
      const result = await cancelClientInvite(invite.id);
      setInvites((current) => current.map((row) => (row.id === invite.id ? { ...row, ...result.data } : row)));
      onInviteCreated?.(result.data);
      showSuccess("Onboarding invite cancelled.");
    } catch (requestError) {
      showError(errorMessage(requestError, "Unable to cancel the invite."));
    } finally {
      setBusyId("");
    }
  }

  // A cancelled or expired invite is invited again with a new link; the old row stays as the record.
  async function resendInvite(invite) {
    const again = { ...formFromInvite(invite), expiresAt: weekOut() };
    if (REQUIRED.some(([field]) => !String(again[field] ?? "").trim())) {
      setEditingInvite(null);
      setForm(again);
      setError("This invite was made before every detail was asked for. Fill in the rest to send it again.");
      setMode("create");
      return;
    }
    setBusyId(invite.id);
    clearNotice();
    try {
      const result = await createClientInvite(again);
      const saved = { invite: result.data.invite, message: result.data.message };
      setInvites((current) => [saved.invite, ...current]);
      setCreated(saved);
      setSavedAnEdit(false);
      onInviteCreated?.(saved.invite);
      setMode("success");
    } catch (requestError) {
      showError(errorMessage(requestError, "Unable to send this invite again."));
    } finally {
      setBusyId("");
    }
  }

  const link = (label, onClick, tone = "blue") => <button type="button" disabled={Boolean(busyId)} onClick={onClick} className={`whitespace-nowrap text-sm font-medium disabled:cursor-not-allowed disabled:text-slate-400 ${tone === "red" ? "text-red-600 hover:text-red-700" : "text-blue-600 hover:text-blue-700"}`}>{label}</button>;

  function inviteAction(invite) {
    if (invite.state === "Pending") return <span className="flex items-center gap-3">{link("Edit", () => editInvite(invite))}{link(busyId === invite.id ? "Cancelling..." : "Cancel Invite", () => void cancelInvite(invite), "red")}</span>;
    if (invite.state === "Expired") return <span className="flex items-center gap-3">{link("Edit", () => editInvite(invite))}{link(busyId === invite.id ? "Inviting..." : "Resend Invite", () => void resendInvite(invite))}</span>;
    if (invite.state === "Cancelled") return link(busyId === invite.id ? "Inviting..." : "Resend Invite", () => void resendInvite(invite));
    return <span className="text-sm text-slate-400">—</span>;
  }

  const isList = mode === "list";
  const isSuccess = mode === "success";
  const title = isList ? "Onboarding Invites"
    : isSuccess ? (savedAnEdit ? "Onboarding Invite Updated" : "Onboarding Invite Created")
      : editingInvite ? "Edit Onboarding Invite" : "Create Onboarding Invite";
  const description = isList || isSuccess ? undefined
    : editingInvite ? "Correct the client's details. Their link does not change, so the one already sent keeps working."
      : "Create a secure, one-time onboarding link for a client.";

  return <>
    <FloatingNotice notice={notice} onClose={clearNotice} />
    <Dialog
      title={title}
      description={description}
      size={isList ? "full" : "md"}
      height={isList ? "tall" : "auto"}
      busy={submitting}
      onClose={close}
      onSubmit={isList || isSuccess ? undefined : saveInvite}
      headerActions={isList ? <Button type="button" onClick={() => { setEditingInvite(null); setSavedAnEdit(false); setForm(initialForm()); setError(""); setMode("create"); }}>Create Invite</Button> : null}
      footer={isList ? null : isSuccess ? <>
        <Button className="max-sm:flex-1" type="button" onClick={close}>Close</Button>
        <Button className="max-sm:flex-1" type="button" variant="primary" disabled={sending} onClick={() => void sendInvite()}>{sending ? "Sending..." : "Send Invite"}</Button>
      </> : <>
        <Button className="max-sm:flex-1" type="button" disabled={submitting} onClick={close}>Cancel</Button>
        <Button className="max-sm:flex-1" variant="primary" disabled={submitting}>{submitting ? (editingInvite ? "Saving..." : "Creating...") : editingInvite ? "Save Changes" : "Create Invite"}</Button>
      </>}
    >
      {isList ? <div className="flex h-full flex-col">
        {loadingInvites && <div className="flex flex-1 items-center justify-center"><Loader label="Loading invites..." /></div>}
        {!loadingInvites && invites.length === 0 && <p className="flex flex-1 items-center justify-center text-sm text-slate-500">No onboarding invites created yet.</p>}
        {!loadingInvites && invites.length > 0 && <SimpleTable
          variant="plain"
          classNames={{ table: "min-w-[860px]" }}
          columns={[{ key: "name", label: "Company Name" }, { key: "email", label: "Company Email ID" }, { key: "phone", label: "Company Phone Number" }, { key: "status", label: "Status" }, { key: "expires", label: "Expires At" }, { key: "created", label: "Created At" }, { key: "action", label: "Action" }]}
          rows={invites}
          rowKey={(invite) => invite.id}
          renderRow={(invite) => <tr key={invite.id} className="border-b border-slate-100 text-slate-700">
            <td className="whitespace-nowrap px-3 py-3 font-medium">{invite.contactName || invite.client?.companyName || "—"}</td>
            <td className="whitespace-nowrap px-3 py-3">{invite.contactEmail || "—"}</td>
            <td className="whitespace-nowrap px-3 py-3">{invite.contactPhone || "—"}</td>
            <td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_CLASS[invite.state] || "bg-slate-100 text-slate-700"}`}>{STATUS_LABELS[invite.state] || invite.state}</span></td>
            <td className="whitespace-nowrap px-3 py-3">{formatDate(invite.expiresAt)}</td>
            <td className="whitespace-nowrap px-3 py-3">{formatDate(invite.createdAt)}</td>
            <td className="whitespace-nowrap px-3 py-3">{inviteAction(invite)}</td>
          </tr>}
        />}
      </div> : isSuccess ? <div>
        <ShareableMessage label="Message to send them" rows={9} message={created?.message || ""} />
      </div> : <div className="space-y-4">
        {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <TextField required label="Company Name" name="contactName" value={form.contactName} onChange={updateField} />
        <TextField required type="email" label="Company Email ID" name="contactEmail" value={form.contactEmail} onChange={updateField} />
        <PhoneField required label="Company Phone Number" field="contactPhone" value={form.contactPhone} onChange={setField} />
        <DateField required label="Expiry Date" value={form.expiresAt} onChange={(value) => setField("expiresAt", value)} />
      </div>}
    </Dialog>
  </>;
}
