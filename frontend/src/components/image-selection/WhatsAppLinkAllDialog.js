"use client";

import { useState } from "react";
import Button from "@/components/shared/Button";
import Loader from "@/components/shared/Loader";
import Dialog from "@/components/ui/Dialog";
import { linkAllImageSelectionWhatsappGroups } from "@/services/image-selection/image-selection.service";
import { WhatsAppPairingCode, useImageSelectionWhatsappSession } from "./WhatsAppPairing";

/*
 * Every unlinked project, linked to the group carrying its name in one pass.
 *
 * From this person's own groups, so it links only what they are in; exact names only, so nothing
 * is guessed; and it writes links and sends nothing. What it left alone is listed by reason - a
 * name with no group, a name with two, a group some other project already holds - because a count
 * on its own says nothing about what to do next.
 */
function Names({ label, names }) {
  if (!names?.length) return null;
  return (
    <div>
      <dt className="text-xs font-semibold text-slate-700">{label} ({names.length})</dt>
      <dd className="mt-1 text-xs leading-5 text-slate-600">{names.join(", ")}</dd>
    </div>
  );
}

export default function WhatsAppLinkAllDialog({ onClose, onLinked }) {
  const { session, connected, starting, error: pairingError, waiting, start } = useImageSelectionWhatsappSession(true, { autoStart: true });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setBusy(true);
    setError("");
    try {
      const response = await linkAllImageSelectionWhatsappGroups();
      setResult(response.data);
      if (response.data.linked?.length) onLinked?.();
    } catch (cause) {
      setError(cause?.message || "Unable to match WhatsApp groups.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="Match WhatsApp Groups"
      description={connected ? "Links every project that has no group yet to the group in your WhatsApp with the same name. Nothing is sent." : "Link your WhatsApp to read your groups."}
      size="sm"
      onClose={onClose}
      busy={busy}
      footer={<>
        <Button type="button" onClick={onClose} disabled={busy} className="max-sm:flex-1">{result ? "Close" : "Cancel"}</Button>
        {connected && !result && (
          <Button type="button" variant="primary" onClick={run} disabled={busy} className="max-sm:flex-1">
            {busy ? "Matching..." : "Match Groups"}
          </Button>
        )}
      </>}
    >
      {!connected ? (
        <WhatsAppPairingCode session={session} starting={starting} error={pairingError} waiting={waiting} onStart={start} />
      ) : busy ? (
        <Loader label="Matching projects to your groups..." size="sm" inline />
      ) : result ? (
        <dl className="space-y-3">
          {result.linked.length === 0 && <p className="text-sm text-slate-600">No project was linked.</p>}
          <Names label="Linked" names={result.linked} />
          <div>
            <dt className="text-xs font-semibold text-slate-700">Already linked</dt>
            <dd className="mt-1 text-xs text-slate-600">{result.alreadyLinked}</dd>
          </div>
          <Names label="No group with this name" names={result.unmatched} />
          <Names label="More than one group with this name — pick one in the project" names={result.ambiguous} />
        </dl>
      ) : (
        <p className="text-sm leading-6 text-slate-600">
          Your WhatsApp is linked. Match Groups links every project whose name is exactly one of your groups&apos; names, and skips a group another project already holds.
        </p>
      )}
      {error && <p role="alert" className="mt-3 text-xs leading-5 text-red-600">{error}</p>}
    </Dialog>
  );
}
