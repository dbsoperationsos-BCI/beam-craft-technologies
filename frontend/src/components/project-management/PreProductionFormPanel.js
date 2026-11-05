"use client";

import { useCallback, useMemo, useState } from "react";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import RepeatableDetailsField, { withRowKey } from "@/components/shared/RepeatableDetailsField";
import PreProductionSummaryGroup from "@/components/project-management/PreProductionSummaryGroup";
import { detailHelpFor } from "@/constants/detailHelp";
import { verticalCode } from "@/components/sales/whatsappGroupNameUtils";
import { emptyValues, preProductionFormSectionsFor, venueFieldName, withShootVenues } from "@/constants/formPanelConfig";
import { dropUnansweredYesNo, yesNoDefaultsToNo } from "@/constants/yesNoField";
import { preProductionVerticalDefaults } from "@/constants/preProductionVerticalFields";
import ProjectHoldBadge from "@/components/project-management/ProjectHoldBadge";
import Button from "@/components/shared/Button";
import { downloadPreProductionFormPdf } from "@/services/project-management/pre-production.service";
import { PreProductionClientBar, PreProductionClientFileField, usePreProductionClientForm } from "@/components/project-management/PreProductionClientSection";
import PreProductionShootStatusField, { shootStatusChange, shootStatusValue } from "@/components/project-management/PreProductionShootStatus";

const dateInput = (value) => (value ? String(value).slice(0, 10) : "");

/** One concept's fields, repeated for each concept the shoot has. */
const conceptFields = [
  { name: "reference", label: "Reference (Link)", colSpan: 2, placeholder: "https://…", props: { type: "url" }, helperText: "A link to a sample photo or video for this concept." },
  { name: "remarks", label: "Remarks", type: "textarea", colSpan: 2, placeholder: "What was agreed with the client", helperText: "What the client agreed for this concept, for the shoot team." },
];

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(date);
}

/**
 * The project and shoot as the studio already knows them.
 *
 * Read-only on purpose: every line here is stored once on the sale or the shoot and read back
 * through the links, so a pre production row can never disagree with what it came from. Changing
 * any of it is still the Projects screen's job.
 */
function ContextSummary({ row }) {
  const groups = [
    ["Project", [
      ["Event ID", row.eventId, detailHelpFor("Project", "eventId")],
      ["Client Name", row.clientName, detailHelpFor("Project", "clientName")],
      ["Client Number", row.clientMainNumber, detailHelpFor("Project", "clientMainNumber")],
      ["Source Branch", row.sourceBranch, detailHelpFor("Project", "sourceBranch")],
      ["Vertical", verticalCode(row.product), detailHelpFor("Project", "product")],
      ["CRD Document", row.crdDocumentStatus, detailHelpFor("Project", "crdDocumentStatus")],
      ["CRM", row.crmName, detailHelpFor("People", "crmName")],
      ["Creative Manager", row.creativeManager, detailHelpFor("People", "creativeManager")],
      ["Post Production Coordinator", row.postProductionCoordinator, detailHelpFor("People", "postProductionCoordinator")],
      ["Main Event Date", formatDate(row.mainEventDate), detailHelpFor("Project", "mainEventDate")],
      // Client Storage's facts, shown here rather than asked again: the record is raised per
      // project and its status ladder starts at "Yet to Receive".
      ["Storage ID", row.storageId, detailHelpFor("Storage", "storageId")],
      ["Received The Storage", row.storageId ? (row.receivedTheStorage ? "Yes" : "No") : null, detailHelpFor("Storage", "receivedTheStorage")],
    ]],
    ["Shoot", [
      ["Shoot ID", row.shootId, detailHelpFor("Shoot", "shootId")],
      ["Shoot", row.shoot, detailHelpFor("Shoot", "shoot")],
      ["Shoot Type", row.shootType, detailHelpFor("Shoot", "shootType")],
      ["Sub Event Date", formatDate(row.subEventDate), detailHelpFor("Shoot", "subEventDate")],
      ["Shoot Place", row.shootPlace, detailHelpFor("Shoot", "shootPlace")],
      ["District", row.district, detailHelpFor("Shoot", "district")],
      ["State", row.state, detailHelpFor("Shoot", "state")],
      ["Session Timing", row.sessionTiming, detailHelpFor("Shoot", "sessionTiming")],
      ["Travel Paid By", row.travelPaidBy, detailHelpFor("Shoot", "travelPaidBy")],
      ["Accommodation Paid By", row.accommodationPaidBy, detailHelpFor("Shoot", "accommodationPaidBy")],
    ]],
  ];
  return <div className="grid gap-4 lg:grid-cols-2">
    {groups.map(([title, rows]) => <PreProductionSummaryGroup key={title} title={title} rows={rows} />)}
    {/* A missing vertical is why a coordinator sees no vertical checklist, and silence there reads
        as the feature being broken rather than the sale being incomplete — so the form says it. */}
    {!row.product?.trim() && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 lg:col-span-2">
      This project has no vertical, so only the shared fields are shown — the Dum Dum or Qua Qua checklist appears once the sale carries one. The vertical comes from the reserved WhatsApp group name on the project.
    </p>}
    {row.salesPreProductionRemarks && <section className="rounded-lg border border-slate-200 bg-slate-50 p-4 lg:col-span-2">
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Sales Pre Production Remarks</h3>
      <p className="whitespace-pre-wrap text-sm text-slate-800">{row.salesPreProductionRemarks}</p>
    </section>}
  </div>;
}

/**
 * Filling in one shoot's pre production details.
 *
 * Only ever opened for somebody who may write: reading a row is the record view the ⋮ menu offers,
 * which every holder of the board gets, and this is asked for by name from the same menu.
 */
// The shoot's pre production status, at the bottom of its form.
const STATUS_SECTION = { id: "shoot-status", title: "Status", fields: [{ name: "shootStatusControl", type: "custom", colSpan: 2 }] };
/*
 * The client's side, woven into the form rather than a section of its own: Send to client at the foot
 * of Project & Shoot, and the three checklist items only the client answers - the invitation, the
 * dresses, the decor - drawn as what the client has done (their files, to download) instead of a
 * Yes/No the team could set.
 */
const CLIENT_FILE_FIELDS = { invitationSoftCopy: "invitation", gettingDressesImages: "dresses", gettingDecorImages: "decor" };
function withClientFields(sections) {
  return sections.map((section) => {
    if (section.id === "context") return { ...section, fields: [...section.fields, { name: "clientBar", type: "custom", colSpan: 2 }] };
    return {
      ...section,
      fields: section.fields.map((field) => (CLIENT_FILE_FIELDS[field.name] ? { ...field, type: "custom", colSpan: 2 } : field)),
    };
  });
}
const CLIENT_FIELD_NAMES = ["clientBar"];
const VENUE_KEYS = ["locationAddress", "locationLink"];

/** A shoot held at several places: each name's venue as the form's values hold it. */
const venueValues = (venues) => Object.fromEntries((venues || []).flatMap((venue, index) => VENUE_KEYS.map((key) => [venueFieldName(key, index), venue[key] || ""])));

export default function PreProductionFormPanel({ row, branches = [], saving, error, onClose, onBack, onSave, aside, canChangeStatus = false }) {
  // The shoot's pre production status last, saved with the rest (`PreProductionShootStatus`).
  // A shoot held at several places is asked a venue under each name (`withShootVenues`); an indoor
  // one is asked its branch instead, wherever its names are.
  const venues = row.indoor ? null : row.locations;
  const sections = useMemo(() => withClientFields([...withShootVenues(preProductionFormSectionsFor(row.product, { indoor: row.indoor }), venues), STATUS_SECTION]), [row.product, row.indoor, venues]);
  const client = usePreProductionClientForm(row.shootRecordId);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  // The whole form as a PDF, as it is saved (an edit not yet saved is not in it).
  async function downloadForm() {
    setDownloading(true);
    setDownloadError("");
    try {
      await downloadPreProductionFormPdf(row.shootRecordId, `Pre Production - ${row.eventId || ""} - ${row.shoot || "Shoot"}.pdf`);
    } catch (problem) {
      setDownloadError(problem.message || "Unable to download the form.");
    } finally {
      setDownloading(false);
    }
  }
  const [statusProblem, setStatusProblem] = useState("");
  const [form, setForm] = useState(() => ({
    ...emptyValues(sections, row),
    // Every yes/no nobody has answered starts on No, and so does an intro call.
    ...yesNoDefaultsToNo(sections, emptyValues(sections, row)),
    ...preProductionVerticalDefaults(row.product, row),
    // The dates arrive as ISO timestamps and the fields want YYYY-MM-DD. The shoot's own date is the
    // row's `subEventDate`.
    shootDate: dateInput(row.subEventDate),
    lastFollowupDate: dateInput(row.lastFollowupDate),
    nextFollowupDate: dateInput(row.nextFollowupDate),
    meetingDate: dateInput(row.meetingDate),
    concepts: (row.concepts || []).map(withRowKey),
    ...venueValues(venues),
    // An indoor shoot's branch starts on the project's own, until somebody chooses another.
    ...(row.indoor ? { shootBranchId: row.shootBranchId ?? row.projectBranchId ?? "" } : {}),
    shootStatusControl: shootStatusValue(row),
    // The client-only checklist items keep their Yes/No as saved (it follows the client's upload).
    ...Object.fromEntries(Object.keys(CLIENT_FILE_FIELDS).map((name) => [name, Boolean(row[name])])),
  }));
  const update = useCallback((field, value) => setForm((current) => ({ ...current, [field]: value })), []);

  const context = useMemo(() => ({
    // The asterisked answers are the ones a shoot is counted on for Planned: each says Pending until filled.
    pendingTags: true,
    options: {
      // The working branches, plus the one this shoot already names if it has since been closed - so
      // the box still reads its name rather than a number.
      branches: [
        ...branches.map((branch) => ({ value: branch.id, label: branch.name })),
        ...(row.shootBranchId && !branches.some((branch) => branch.id === row.shootBranchId) ? [{ value: row.shootBranchId, label: row.shootBranchName || "Closed branch" }] : []),
      ],
    },
    renderers: {
      contextSummary: () => <ContextSummary row={row} />,
      clientBar: () => (row.shootRecordId ? <PreProductionClientBar client={client} /> : null),
      ...Object.fromEntries(Object.entries(CLIENT_FILE_FIELDS).map(([name, kind]) => [name, ({ values, onChange, field }) => <PreProductionClientFileField client={client} kind={kind} label={field.label} value={values[name]} onChange={onChange} />])),
      shootStatusControl: ({ values, onChange }) => <PreProductionShootStatusField row={row} value={values.shootStatusControl} onChange={onChange} problem={statusProblem} readOnly={!canChangeStatus} />,
      concepts: ({ values, onChange }) => <RepeatableDetailsField
        label="Concept List"
        helperText="Add each shoot idea agreed with the client, with a reference link."
        fields={conceptFields}
        value={values.concepts}
        onChange={onChange}
        addLabel="+ Add Concept"
        emptyText="No concepts added yet."
        rowLabel={(index) => `Concept ${index + 1}`}
        // Held to a fixed height; a longer list scrolls inside it rather than stretching the form.
        listClassName="max-h-96 overflow-y-auto overscroll-contain pr-1"
      />,
    },
  }), [branches, canChangeStatus, client, row, statusProblem]);

  function submit(event) {
    event.preventDefault();
    const { contextSummary, concepts, shootStatusControl, coverImageUrl, ...allValues } = form;
    // The client's bar and file lists are shown, not saved.
    const venueNames = new Set(Object.keys(venueValues(venues)));
    const values = Object.fromEntries(Object.entries(allValues).filter(([name]) => !CLIENT_FIELD_NAMES.includes(name) && !venueNames.has(name)));
    // The status is saved with the form, so a status that cannot be saved yet holds the whole save.
    const { change: statusChange, problem } = canChangeStatus ? shootStatusChange(row, shootStatusControl) : { change: null, problem: "" };
    setStatusProblem(problem);
    if (problem) return;
    /*
     * A yes/no nobody answered is left out rather than sent. These columns are `z.boolean().optional()`
     * behind a preprocess that maps only `null` to undefined, so the empty string the form holds for an
     * unanswered pair would have the server refuse the whole save - see `dropUnansweredYesNo`.
     */
    onSave({
      ...dropUnansweredYesNo(sections, values),
      // A cleared date is sent as null: the shoot's date is then not known.
      shootDate: values.shootDate || null,
      // A cleared branch is null too; an outdoor shoot does not send one at all.
      ...("shootBranchId" in values ? { shootBranchId: values.shootBranchId || null } : {}),
      // The row keys are the list's own bookkeeping, not part of a concept. Concepts Needed: No sends
      // an empty list, so the concepts put in before the answer changed do not linger.
      concepts: values.conceptsNeeded === false ? [] : (concepts || []).map(({ reference, remarks }) => ({ reference: reference || null, remarks: remarks || null })),
      // A venue per name, the whole list at once, in place of the one Location Address and Link.
      ...(venues ? { locations: venues.map((venue, index) => ({ shoot: venue.shoot, ...Object.fromEntries(VENUE_KEYS.map((key) => [key, allValues[venueFieldName(key, index)] || null])) })) } : {}),
      // Sent only when it changed: a newly picked picture, or null when the one there was removed.
      ...((coverImageUrl || null) !== (row.coverImageUrl || null) ? { coverImage: coverImageUrl || null } : {}),
    }, statusChange);
  }

  return <SchemaFormPanel
    // The project's name, and beneath it the board and the shoot: "Pre Production | Shoot ID · …".
    title={row.clientName || row.eventId || "Pre Production"}
    titleAddon={<ProjectHoldBadge status={row.projectStatus} holds={row.holds} paymentsDue={row.paymentsDue} />}
    description={`Pre Production | ${[row.shootId || "Shoot", row.shoot, formatDate(row.subEventDate) || "No date"].filter(Boolean).join(" · ")}`}
    sections={sections}
    values={form}
    onChange={update}
    context={context}
    sidebarAriaLabel="Pre production form sections"
    closeAriaLabel="Close pre production form"
    onClose={onClose}
    onBack={onBack}
    backAriaLabel="Back to shoots"
    onSubmit={submit}
    /*
     * The asterisks mark what a shoot is read as Planned on; they do not refuse the save. A shoot's
     * details arrive over days - the venue before the times, the times before the studio start - and
     * a form that refused everything until all of them were in would be a form nobody could use.
     * The percentage on the tile is what says how much is left.
     */
    validateRequired={false}
    error={error || downloadError}
    saving={saving}
    // Send to client (Remind client once sent) and Download, beside Save - always in sight.
    footerExtra={row.shootRecordId ? <div className="flex gap-2 max-sm:flex-col">
      <Button type="button" variant="secondary" className="max-sm:w-full" disabled={client.sending || !client.state} onClick={() => void client.send()}>
        {client.sending ? "Sending…" : client.state?.sentAt ? "Remind client" : "Send to client"}
      </Button>
      <Button type="button" variant="secondary" className="max-sm:w-full" disabled={downloading} onClick={() => void downloadForm()}>{downloading ? "Downloading…" : "Download"}</Button>
    </div> : null}
    submitLabel="Save"
    savingLabel="Saving..."
    // The project's follow-ups, kept beside the shoot form so they do not vanish when a shoot opens.
    aside={aside}
    asideAriaLabel="Project follow-ups"
  />;
}
