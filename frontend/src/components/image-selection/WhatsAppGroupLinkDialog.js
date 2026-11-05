"use client";

import { useEffect, useMemo, useState } from "react";
import Button from "@/components/shared/Button";
import Loader from "@/components/shared/Loader";
import Dialog from "@/components/ui/Dialog";
import { linkProjectWhatsappGroup, listProjectWhatsappGroups } from "@/services/image-selection/image-selection.service";
import { WhatsAppPairingCode, useImageSelectionWhatsappSession } from "./WhatsAppPairing";

/*
 * Which WhatsApp group this project is.
 *
 * The groups are this person's own - read from their paired WhatsApp, not from a list the app
 * keeps - and the one named like the project is picked in advance, because for a linked project
 * the project's name *is* the group's name. A group some other project already holds is shown
 * greyed and named rather than hidden: "why can't I pick it" is answered on the row. Not linked
 * yet? The pairing code takes the list's place until the scan lands, and the list loads on its own
 * after.
 *
 * `canWrite` is passed rather than read: the dialog opens from the rail and from the invite panel,
 * and neither can promise the other hid its control.
 */
export default function WhatsAppGroupLinkDialog({ project, canWrite = true, onClose, onLinked }) {
  const { session, connected, starting, error: pairingError, waiting, start } = useImageSelectionWhatsappSession(true, { autoStart: true });
  // null until the first read answers, so "no groups" is never shown about a list not yet asked for.
  const [groups, setGroups] = useState(null);
  const [selected, setSelected] = useState(project.whatsappGroupJid || "");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Asked for once the link is up - and again if it drops and comes back, since `connected`
  // flips with it. The suggestion only fills an empty choice: a group the reader already picked,
  // or the one linked now, is not second-guessed.
  useEffect(() => {
    if (!connected) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const response = await listProjectWhatsappGroups(project.id);
        if (cancelled) return;
        setGroups(response.data.groups || []);
        setSelected((current) => current || response.data.suggestedJid || "");
        setError("");
      } catch (cause) {
        if (cancelled) return;
        setGroups([]);
        setError(cause?.message || "Unable to read your WhatsApp groups.");
      }
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [connected, project.id]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (groups || []).filter((group) => !needle || (group.subject || "").toLowerCase().includes(needle));
  }, [groups, query]);
  const chosen = (groups || []).find((group) => group.jid === selected) || null;
  const canLink = canWrite && connected && Boolean(chosen) && !chosen.linkedProjectId && selected !== project.whatsappGroupJid;

  async function link() {
    if (!canLink) return;
    setBusy(true);
    setError("");
    try {
      const response = await linkProjectWhatsappGroup(project.id, selected);
      onLinked?.(response.data);
      onClose();
    } catch (cause) {
      setError(cause?.message || "Unable to link the WhatsApp group.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={project.whatsappGroupJid ? "Change WhatsApp Group" : "Link WhatsApp Group"}
      description={connected ? `The group for "${project.projectName}". The invite is sent into it from your own WhatsApp.` : "Link your WhatsApp to see your groups."}
      size="sm"
      // One height while the list is on screen, so the card does not resize as rows are filtered.
      height={connected && groups ? "mid" : "auto"}
      onClose={onClose}
      busy={busy}
      toolbar={connected && groups ? (
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          type="search"
          placeholder="Search groups..."
          aria-label="Search groups"
          className="h-9 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        />
      ) : undefined}
      footer={<>
        <Button type="button" onClick={onClose} disabled={busy} className="max-sm:flex-1">Cancel</Button>
        {canWrite && connected && (
          <Button type="button" variant="primary" onClick={link} disabled={!canLink || busy} className="max-sm:flex-1">
            {busy ? "Linking..." : "Link Group"}
          </Button>
        )}
      </>}
    >
      {!connected ? (
        <WhatsAppPairingCode session={session} starting={starting} error={pairingError} waiting={waiting} onStart={start} />
      ) : groups === null ? (
        <Loader label="Reading your groups..." size="sm" inline />
      ) : (
        <div role="radiogroup" aria-label="WhatsApp groups" className="-mx-1">
          {shown.length === 0 && (
            <p className="px-1 py-2 text-sm text-slate-500">
              {groups.length ? "No group matches that search." : "Your WhatsApp is not in any group."}
            </p>
          )}
          {shown.map((group) => {
            const taken = Boolean(group.linkedProjectId);
            const current = group.jid === project.whatsappGroupJid;
            const picked = selected === group.jid;
            return (
              <label
                key={group.jid}
                className={`flex items-start gap-3 rounded-md px-2 py-2 text-sm ${taken ? "cursor-not-allowed opacity-60" : `cursor-pointer ${picked ? "bg-blue-50" : "hover:bg-slate-50"}`}`}
              >
                <input
                  type="radio"
                  name="whatsapp-group"
                  value={group.jid}
                  checked={picked}
                  disabled={taken || !canWrite}
                  onChange={() => setSelected(group.jid)}
                  className="mt-1 h-4 w-4 shrink-0"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-slate-800">{group.subject || group.jid}</span>
                  <span className="block text-xs text-slate-500">
                    {group.participantCount} member{group.participantCount === 1 ? "" : "s"}
                    {group.matchesProject && !taken ? " · Matches this project" : ""}
                    {current ? " · Linked now" : ""}
                    {taken ? ` · Linked to ${group.linkedProjectName}` : ""}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-xs leading-5 text-red-600">{error}</p>}
    </Dialog>
  );
}
