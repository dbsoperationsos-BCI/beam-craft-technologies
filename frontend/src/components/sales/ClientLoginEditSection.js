"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import RecordSummaryCard from "@/components/shared/RecordSummaryCard";
import ClientCredentialsSection from "@/components/sales/ClientCredentialsSection";
import ClientLoginReadyDialog from "@/components/sales/ClientLoginReadyDialog";
import ExistingClientLogin, { clientPasswordLabel } from "@/components/sales/ExistingClientLogin";
import { clientLoginPayload, clientLoginProblems, clientUsernameFor, emptyClientLogin } from "@/lib/clientLogin.mjs";
import { createClientLogin, getClientLogin } from "@/services/sales/projects.service";

/**
 * Edit Sale Details → Client Credentials.
 *
 * A project that already has a client login shows it - the username, and whether it is live - and
 * nothing more: the password is held only as a hash, and was handed over when the login was made.
 * One booked without a login offers Create Project's fields and makes it here and now, the way
 * this form writes a shoot change straight away rather than waiting for Update Project. The login
 * is then handed over in the same Client Login Ready dialog, over this form.
 */
export default function ClientLoginEditSection({ projectId, projectName, clientMainNumber }) {
  const [state, setState] = useState({ loading: true, login: null, error: "" });
  const [draft, setDraft] = useState(emptyClientLogin);
  const [showProblems, setShowProblems] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [handover, setHandover] = useState(null);

  const load = useCallback(async () => {
    try {
      const response = await getClientLogin(projectId);
      setState({ loading: false, login: response?.data || null, error: "" });
    } catch (error) {
      setState({ loading: false, login: null, error: error.message || "Unable to read the client login." });
    }
  }, [projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // The username the login will have: the client's mobile number, as the project is saved with it.
  const username = clientUsernameFor(clientMainNumber);
  const problems = showProblems ? clientLoginProblems(draft, { clientMainNumber }) : {};

  async function create() {
    if (Object.keys(clientLoginProblems(draft, { clientMainNumber })).length) { setShowProblems(true); return; }
    setSaving(true);
    setSaveError("");
    try {
      const payload = clientLoginPayload(draft, { clientMainNumber });
      const made = await createClientLogin(projectId, payload);
      // The username the server made, from the number it holds for the project.
      setHandover({ projectId, projectName, username: made?.data?.username || payload.username, temporaryPassword: payload.temporaryPassword });
    } catch (error) {
      setSaveError((error.message || "Unable to create the client login.").replace(/^Client Credentials[^:]*:\s*/, ""));
    } finally {
      setSaving(false);
    }
  }

  if (state.loading) return <p className="text-xs text-slate-500 sm:text-sm">Reading the client login...</p>;
  if (state.error) return <p role="alert" className="text-xs text-red-600 sm:text-sm">{state.error}</p>;

  return <>
    {state.login?.shared
      ? <ExistingClientLogin login={state.login} />
      : state.login
      ? <div className="space-y-2">
        <RecordSummaryCard rows={[["Username", state.login.username], ["Status", state.login.active ? "Active" : "Switched off"], ["Password", clientPasswordLabel(state.login)]]} />
        <p className="text-xs text-slate-500">The password was given when the login was made and is not shown again.</p>
      </div>
      : <div className="space-y-4">
        <p className="text-xs text-slate-500 sm:text-sm">This project has no client login yet.</p>
        <ClientCredentialsSection value={draft} username={username} onChange={(field, value) => { setSaveError(""); setDraft((current) => ({ ...current, [field]: value })); }} errors={{ ...problems, ...(saveError && /username|mobile number/i.test(saveError) ? { username: saveError } : {}) }} disabled={saving} usernameHint="The client's mobile number, from the Client Main Number saved on this project. Save a changed number with Update Project first." hint="Generated for this login. Creating it shows the WhatsApp message that sends it to the client." />
        {saveError && !/username|mobile number/i.test(saveError) && <p role="alert" className="text-xs text-red-600 sm:text-sm">{saveError}</p>}
        <Button type="button" variant="primary" onClick={() => { void create(); }} disabled={saving}>{saving ? "Creating..." : "Create Client Login"}</Button>
      </div>}
    {handover && <ClientLoginReadyDialog {...handover} layer="dialogOverPanel" onClose={() => { setHandover(null); setDraft(emptyClientLogin()); setShowProblems(false); void load(); }} />}
  </>;
}
