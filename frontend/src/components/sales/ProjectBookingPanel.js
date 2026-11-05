"use client";

import { useEffect, useState } from "react";
import { createSalesProject } from "@/services/sales/projects.service";
import CreateProjectFormPanel from "./CreateProjectFormPanel";
import ClientLoginReadyDialog from "./ClientLoginReadyDialog";
import { createProjectPayload, validationDetail } from "./projectBooking";
import { recordProjectAdvance } from "@/services/sales/projects.service";
import { saveProjectPaymentSchedule } from "@/services/project-management/project-workflow.service";
import { bookingSchedulePrefix } from "@/constants/accountsConfig";
import useProjectFormPickers from "./useProjectFormPickers";

/**
 * Booking a project: the form, the save, and the advance handed over with it.
 *
 * Two screens book a project - Bookings & Converted from a CRM lead, from nothing, or as a duplicate
 * of a project sold at no quotation, and Quotations from the quotation the client agreed to - and
 * each books it where it stands rather than sending anybody to the other screen to finish. What booking a project *means* is therefore stated once,
 * here: the same payload, the same two-call save, the same refusals read the same way.
 *
 * The host keeps what is its own. It says what to prefill, it hears that a project was saved so it
 * can re-read its own list, and it shows the notices in its own place; nothing about creating a
 * project is left for it to repeat.
 */
/**
 * The advance as the server takes it once the schedule is saved: the form named the payment it
 * settles by its place among the rows the save keeps (`schedule-0`), which is its place in the saved
 * schedule too - a booking lays the schedule down fresh, in the form's order. With no saved payment
 * there (the schedule was not saved), the advance is recorded as money received, settling nothing.
 */
function withSavedPayment(payment, savedSchedule) {
  const named = payment?.settles?.paymentScheduleId || "";
  if (!named.startsWith(bookingSchedulePrefix)) return payment;
  const saved = savedSchedule[Number(named.slice(bookingSchedulePrefix.length))];
  const { settles, ...rest } = payment;
  return saved ? { ...rest, settles: { ...settles, paymentScheduleId: saved.id } } : rest;
}

export default function ProjectBookingPanel({ prefill = null, prefillPlan = null, draft = null, draftId = "", findDraft, onUseDraft, onSaveDraft, onClose, onSaved, onNotice, onError }) {
  /*
   * The client's login, once the project made with it is saved: shown as Client Login Ready in place
   * of the form, because the password is readable only now. The panel closes when that does.
   */
  const [handover, setHandover] = useState(null);
  const pickers = useProjectFormPickers({ onError });
  const { loadPickers } = pickers;

  // The panel is open the moment this renders, so the lists it picks from are fetched now rather
  // than on a button the host would have had to remember to wire.
  useEffect(() => { void loadPickers({ notifyOnError: false }); }, [loadPickers]);

  /**
   * Saves the project, then the advance handed over for it.
   *
   * Two calls rather than one, because the payment is a cash entry: it belongs to Accounts, is
   * written through Accounts' own endpoint under Accounts' own permission, and reads its client and
   * branch off the project - which is why it can only be sent once that project has an id.
   *
   * They are therefore not all-or-nothing, and the failure worth handling is the second one. The
   * project is already created by then and re-submitting the form would create a second, so the
   * form closes and the notice says where the payment can be recorded instead. `payment` is empty
   * whenever the section was skipped or the viewer never saw it.
   */
  async function saveProject(project, payment, schedule) {
    let created;
    try {
      created = await createSalesProject(createProjectPayload(project));
    } catch (error) {
      onError?.(validationDetail(error) || error.message || "Unable to save project.");
      throw error;
    }

    // The Schedule Payment, saved against the project now that it has an id - the rows Accounts ->
    // Scheduled Payments then works. Before the advance, which may settle one of them. Like the
    // advance, a failure here leaves the project made.
    let scheduleError = "";
    let savedSchedule = [];
    if (schedule?.length && created?.data?.id) {
      try {
        // A payment following one of the new shoots named it by its place in the list sent; the save
        // hands back the shoots' ids in that order.
        const shootIds = created.data.createdShootIds || [];
        const rows = schedule.map(({ dueShootIndex, ...row }) => (Number.isInteger(dueShootIndex) ? { ...row, dueShootId: shootIds[dueShootIndex] || null } : row));
        savedSchedule = (await saveProjectPaymentSchedule(created.data.id, rows, { creating: true }))?.data || [];
      } catch (error) {
        scheduleError = error.message || "the payment schedule could not be saved";
      }
    }

    let paymentError = "";
    if (payment) {
      try {
        // The project's own advance endpoint, so booking one does not need the cash book's
        // permission. The project id goes in the path - the server files the entry against it
        // rather than trusting a body to name which project the money was for.
        await recordProjectAdvance(created?.data?.id, withSavedPayment(payment, savedSchedule));
      } catch (error) {
        paymentError = validationDetail(error) || error.message || "the payment could not be recorded";
      }
    }

    if (project.clientLogin && created?.data?.id) {
      setHandover({
        projectId: created.data.id,
        projectName: created.data.whatsappGroupName,
        username: project.clientLogin.username,
        temporaryPassword: project.clientLogin.temporaryPassword,
      });
    } else {
      onClose?.();
    }
    if (paymentError) {
      onError?.(`Project saved, but the payment was not recorded: ${paymentError} Record it on the project's Payments tab.`);
    } else if (scheduleError) {
      onError?.(`Project saved, but its payment schedule was not: ${scheduleError} Enter it again on Projects → Edit Project.`);
    } else {
      onNotice?.(payment ? "Project and payment saved successfully." : "Project saved successfully.");
    }
    // After the notice, so the host's re-read cannot swallow what the save had to say. The form as
    // sent goes with it, so a host holding a draft of this booking knows which one is now done.
    await onSaved?.(created?.data || null, project);
  }

  if (handover) return <ClientLoginReadyDialog {...handover} onClose={() => { setHandover(null); onClose?.(); }} />;

  return <CreateProjectFormPanel
    project={prefill}
    /* The shoots, services and deliverables a duplicate carries across. Null for every other way in:
       a booking from nothing has no plan yet, and one from a quotation reads the quotation's. */
    prefillPlan={prefillPlan}
    /* A booking put aside with Save Draft and reopened; `onSaveDraft` is the host's, which keeps it. */
    draft={draft}
    draftId={draftId}
    findDraft={findDraft}
    onUseDraft={onUseDraft}
    onSaveDraft={onSaveDraft}
    onClose={onClose}
    onSave={saveProject}
    groupNames={pickers.groupNames}
    isLoadingGroupNames={pickers.isLoadingGroupNames}
    crmEmployees={pickers.crmEmployees}
    isLoadingCrmEmployees={pickers.isLoadingCrmEmployees}
  />;
}
