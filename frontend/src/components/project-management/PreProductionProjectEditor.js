"use client";

import { useState } from "react";
import RecordViewPanel from "@/components/data-table/RecordViewPanel";
import PreProductionFormPanel from "@/components/project-management/PreProductionFormPanel";
import PreProductionProjectPanel from "@/components/project-management/PreProductionProjectPanel";
import PreProductionFollowups from "@/components/project-management/PreProductionFollowups";
import PreProductionGeneralPanel from "@/components/project-management/PreProductionGeneral";
import { preProductionInfoFormatters, preProductionInfoSectionsFor } from "@/constants/infoPanelConfig";
import { addPreProductionFollowup, setPreProductionShootStatus, completePreProductionFollowup, deletePreProductionFollowup, updatePreProductionFollowup, savePreProductionRow } from "@/services/project-management/pre-production.service";

/**
 * One project's pre production, as the coordinator works it: the shoot cards, General over them,
 * a shoot's form (or, for somebody who may only read, the shoot read back in full), and the
 * project's follow-ups beside whichever is on top.
 *
 * Opened from the Pre Production board and from a project's Status tab, so both edit the same
 * records through the same screens. The caller owns the rows - the board keeps all of them, the
 * Status tab only this project's - and hears about every change through the callbacks, so its own
 * copy stays in step without a reload.
 *
 * `rows` are this project's shoot rows, each already carrying its `completionStatus`. `onBack`, when
 * given, puts a back arrow on the shoot cards - the Status tab's way back to itself.
 */
export default function PreProductionProjectEditor({ rows, employees = [], branches = [], canWrite, openShootId = null, onBack, onClose, onRowSaved, onFollowups, onReload, onSuccess, onError }) {
  // `openShootId`: a shoot to open straight away - its row double-clicked under its project on the
  // board - as its card would: the form for whoever may change it, the record read back otherwise.
  const startRow = openShootId ? rows.find((row) => row.shootRecordId === openShootId) || null : null;
  const [viewingRow, setViewingRow] = useState(() => (startRow && !canWrite ? startRow : null));
  const [editingRow, setEditingRow] = useState(() => (startRow && canWrite ? startRow : null));
  const [generalOpen, setGeneralOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const project = rows[0];
  const projectId = project?.projectId;

  /*
   * The form's Save: the shoot's details, then - when its status was changed at the bottom of the form
   * - that too (WCR's follow-up joins the project's list on the right).
   */
  async function saveRow(values, statusChange) {
    setSaving(true);
    setFormError("");
    try {
      const response = await savePreProductionRow(editingRow.shootRecordId, values);
      let saved = response?.data;
      if (statusChange) {
        const statusResponse = await setPreProductionShootStatus(editingRow.shootRecordId, statusChange);
        saved = statusResponse?.data || saved;
        if (statusResponse?.followups) onFollowups?.(statusResponse.followups);
      }
      if (saved) onRowSaved?.(saved);
      setEditingRow(null);
      onSuccess?.(`${saved?.shootId || "Shoot"} saved.`);
    } catch (error) {
      setFormError(error.message || "Unable to save pre production details.");
    } finally {
      setSaving(false);
    }
  }

  /** Answers true once added, so the follow-ups column knows to clear its form. */
  async function addFollowup(values) {
    try {
      const response = await addPreProductionFollowup(projectId, values);
      onFollowups?.(response?.data);
      onSuccess?.("Follow-up added.");
      return true;
    } catch (error) {
      onError?.(error.message || "Unable to add the follow-up.");
      return false;
    }
  }

  /** Answers true once saved, so the follow-up closes its edit form. */
  async function editFollowup(followupId, values) {
    try {
      const response = await updatePreProductionFollowup(projectId, followupId, values);
      onFollowups?.(response?.data);
      onSuccess?.("Follow-up updated.");
      return true;
    } catch (error) {
      onError?.(error.message || "Unable to save the follow-up.");
      return false;
    }
  }

  /** Answers true once deleted. */
  async function deleteFollowup(followupId) {
    try {
      const response = await deletePreProductionFollowup(projectId, followupId);
      onFollowups?.(response?.data);
      onSuccess?.("Follow-up deleted.");
      return true;
    } catch (error) {
      onError?.(error.message || "Unable to delete the follow-up.");
      return false;
    }
  }

  async function completeFollowup(followupId) {
    try {
      const response = await completePreProductionFollowup(projectId, followupId);
      onFollowups?.(response?.data);
      onSuccess?.("Follow-up marked done.");
    } catch (error) {
      onError?.(error.message || "Unable to mark the follow-up done.");
    }
  }

  if (!project) return null;

  // The same column beside every panel opened on the project, built in one place.
  const followups = <PreProductionFollowups project={project} canWrite={canWrite} onAdd={addFollowup} onComplete={completeFollowup} onEdit={editFollowup} onDelete={deleteFollowup} />;

  return <>
    <PreProductionProjectPanel
      rows={rows}
      followups={followups}
      onOpenGeneral={() => setGeneralOpen(true)}
      onBack={onBack}
      onClose={() => { setGeneralOpen(false); onClose?.(); }}
      // Who may do what decides what a card opens: the coordinator gets the form, a reader gets the
      // record read back in full.
      onOpenShoot={(row) => { setFormError(""); (canWrite ? setEditingRow : setViewingRow)(row); }}
    />
    {viewingRow && <RecordViewPanel
      title={viewingRow.clientName || viewingRow.eventId || "Shoot"}
      description={`Pre Production | ${[viewingRow.shootId, viewingRow.shoot].filter(Boolean).join(" · ") || "Shoot"}`}
      entity={viewingRow}
      sections={preProductionInfoSectionsFor(viewingRow.product)}
      formatters={preProductionInfoFormatters}
      sidebarAriaLabel="Pre production shoot sections"
      onClose={() => setViewingRow(null)}
      aside={followups}
      asideAriaLabel="Project follow-ups"
    />}
    {generalOpen && <PreProductionGeneralPanel
      project={project}
      employees={employees}
      aside={followups}
      // Back and × both return to the shoot cards, the way a shoot's form does.
      onBack={() => setGeneralOpen(false)}
      onClose={() => setGeneralOpen(false)}
      // Reloaded rather than patched: a save here can raise a hard disk or CRD record, and the
      // caller has to read those back from the server. Saved, it closes back to the shoot cards.
      onSaved={async (message) => { await onReload?.(); setGeneralOpen(false); onSuccess?.(message); }}
    />}
    {editingRow && <PreProductionFormPanel
      row={editingRow}
      branches={branches}
      saving={saving}
      error={formError}
      onClose={() => setEditingRow(null)}
      onBack={() => setEditingRow(null)}
      onSave={saveRow}
      canChangeStatus={Boolean(canWrite)}
      aside={followups}
    />}
  </>;
}
