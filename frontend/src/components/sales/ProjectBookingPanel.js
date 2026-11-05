"use client";

import { useEffect } from "react";
import { createSalesProject } from "@/services/sales/projects.service";
import CreateProjectFormPanel from "./CreateProjectFormPanel";
import { createProjectPayload, validationDetail } from "./projectBooking";
import { recordProjectAdvance } from "@/services/sales/projects.service";
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
export default function ProjectBookingPanel({ prefill = null, prefillPlan = null, onClose, onSaved, onNotice, onError }) {
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
  async function saveProject(project, payment) {
    let created;
    try {
      created = await createSalesProject(createProjectPayload(project));
    } catch (error) {
      onError?.(validationDetail(error) || error.message || "Unable to save project.");
      throw error;
    }

    let paymentError = "";
    if (payment) {
      try {
        // The project's own advance endpoint, so booking one does not need the cash book's
        // permission. The project id goes in the path - the server files the entry against it
        // rather than trusting a body to name which project the money was for.
        await recordProjectAdvance(created?.data?.id, payment);
      } catch (error) {
        paymentError = validationDetail(error) || error.message || "the payment could not be recorded";
      }
    }

    onClose?.();
    if (paymentError) {
      onError?.(`Project saved, but the payment was not recorded: ${paymentError} Record it on the project's Payments tab.`);
    } else {
      onNotice?.(payment ? "Project and payment saved successfully." : "Project saved successfully.");
    }
    // After the notice, so the host's re-read cannot swallow what the save had to say.
    await onSaved?.(created?.data || null);
  }

  return <CreateProjectFormPanel
    project={prefill}
    /* The shoots, services and deliverables a duplicate carries across. Null for every other way in:
       a booking from nothing has no plan yet, and one from a quotation reads the quotation's. */
    prefillPlan={prefillPlan}
    onClose={onClose}
    onSave={saveProject}
    groupNames={pickers.groupNames}
    isLoadingGroupNames={pickers.isLoadingGroupNames}
    crmEmployees={pickers.crmEmployees}
    isLoadingCrmEmployees={pickers.isLoadingCrmEmployees}
  />;
}
