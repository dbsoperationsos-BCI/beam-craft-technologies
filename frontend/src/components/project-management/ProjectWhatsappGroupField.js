"use client";

import { useEffect, useRef, useState } from "react";
import Button from "@/components/shared/Button";
import Dropdown from "@/components/shared/Dropdown";
import TextField from "@/components/shared/TextField";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import PreProductionSummaryGroup from "@/components/project-management/PreProductionSummaryGroup";
import { formatDate } from "@/lib/preProductionFormat";
import { autoLinkPreProductionWhatsappGroup, getPreProductionWhatsappGroups, linkPreProductionWhatsappGroup, savePreProductionWhatsappInviteLink } from "@/services/project-management/pre-production.service";

/**
 * The project's WhatsApp group, on General. While none is linked, opening the panel links it by
 * itself when the viewer's WhatsApp holds exactly one group named like the project - the viewer then
 * being the one production sends from. Otherwise it says why it could not, and Choose group lists
 * the viewer's groups with the one named like the project chosen by default. Production messages
 * are sent from the WhatsApp of whoever links it, which the field says.
 */
export default function ProjectWhatsappGroupField({ project, canWrite, onLinked }) {
  const [groups, setGroups] = useState(null);
  const [chosen, setChosen] = useState("");
  const [error, setError] = useState("");
  const [autoNote, setAutoNote] = useState("");
  const reading = useSubmitOnce();

  // Once, on opening, for a project with no group yet: link the one named like it, or say why not.
  const needsLink = canWrite && !project.whatsappGroupJid;
  // Asked once per project, whatever re-renders the panel - the group list comes from WhatsApp.
  const triedFor = useRef(null);
  useEffect(() => {
    if (!needsLink || triedFor.current === project.projectId) return undefined;
    triedFor.current = project.projectId;
    let alive = true;
    autoLinkPreProductionWhatsappGroup(project.projectId)
      .then(async (response) => {
        if (!alive) return;
        if (response?.data?.linked) await onLinked?.("WhatsApp group linked automatically.");
        else setAutoNote(response?.data?.reason || "");
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [needsLink, project.projectId, onLinked]);
  const linking = useSubmitOnce();
  // The group's invite link for the client's app (beside their booking's payments).
  const [inviteLink, setInviteLink] = useState(project.whatsappGroupInviteLink || "");
  const savingInvite = useSubmitOnce();

  async function saveInvite() {
    await savingInvite.run(async () => {
      setError("");
      try {
        const response = await savePreProductionWhatsappInviteLink(project.projectId, inviteLink.trim());
        await onLinked?.(response?.message || "Invite link saved.");
      } catch (requestError) {
        setError(requestError.message || "Unable to save the invite link.");
      }
    });
  }

  async function loadGroups() {
    await reading.run(async () => {
      setError("");
      try {
        const response = await getPreProductionWhatsappGroups(project.projectId);
        setGroups(response?.data?.groups || []);
        setChosen(response?.data?.suggestedJid || "");
      } catch (requestError) {
        setError(requestError.message || "Unable to read your WhatsApp groups.");
      }
    });
  }

  async function link() {
    await linking.run(async () => {
      setError("");
      try {
        await linkPreProductionWhatsappGroup(project.projectId, chosen);
        setGroups(null);
        await onLinked?.("WhatsApp group linked.");
      } catch (requestError) {
        setError(requestError.message || "Unable to link the WhatsApp group.");
      }
    });
  }

  return <div className="flex min-w-0 flex-col gap-3">
    <PreProductionSummaryGroup rows={[
      ["Linked Group", project.whatsappGroupSubject, "The project's WhatsApp group, chosen from the linker's own WhatsApp. Production messages are sent into it."],
      ["Linked By", project.whatsappGroupLinkedBy, "Who linked the group. Messages go out from that person's paired WhatsApp."],
      ["Linked On", project.whatsappGroupLinkedAt ? formatDate(project.whatsappGroupLinkedAt) : null, "The day the group was linked to this project."],
    ]} />
    {canWrite && !groups && <Button type="button" size="lg" className="self-start max-sm:w-full" busy={reading.busy} busyLabel="Reading your groups..." onClick={() => void loadGroups()}>
      {project.whatsappGroupJid ? "Change group" : "Choose group"}
    </Button>}
    {canWrite && groups && <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end">
      <Dropdown
        label="WhatsApp group"
        helperText="The project's group in your WhatsApp; production messages go to it."
        value={chosen}
        onChange={setChosen}
        options={groups.map((group) => ({ value: group.jid, label: `${group.subject || group.jid}${group.matchesProject ? " (matches project)" : ""}` }))}
        placeholder={groups.length ? "Select group" : "Your WhatsApp is in no groups"}
        className="min-w-0 flex-1"
      />
      <Button type="button" variant="primary" size="lg" className="max-sm:w-full" disabled={!chosen} busy={linking.busy} busyLabel="Linking..." onClick={() => void link()}>Link group</Button>
    </div>}
    {/* The invite link: what the client taps in their app to join the group. */}
    {canWrite ? <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end">
      <TextField
        label="Invite link for the client"
        helperText="The group's invite link; the client taps it to join from their portal."
        value={inviteLink}
        onChange={(event) => setInviteLink(event.target.value)}
        placeholder="https://chat.whatsapp.com/..."
        className="min-w-0 flex-1"
      />
      <Button type="button" variant="primary" size="lg" className="max-sm:w-full" busy={savingInvite.busy} busyLabel="Saving..." onClick={() => void saveInvite()}>Save link</Button>
    </div> : project.whatsappGroupInviteLink ? <PreProductionSummaryGroup rows={[["Invite Link", project.whatsappGroupInviteLink, "The group's invite link. The client taps it in their portal to join the group."]]} /> : null}
    {canWrite && <p className="text-xs text-slate-500">In WhatsApp: group info → Invite via link → Copy link. The client sees a WhatsApp group button beside their payments.</p>}
    {needsLink && autoNote && <p className="text-xs text-amber-700">Not linked yet: {autoNote}</p>}
    {canWrite && <p className="text-xs text-slate-500">Production messages for this project are sent from the WhatsApp of whoever links the group.</p>}
    {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
  </div>;
}
