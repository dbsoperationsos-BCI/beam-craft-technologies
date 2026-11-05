"use client";

import { avatarOf } from "@/lib/employeeAvatar.mjs";
import { useCallback, useEffect, useMemo, useState } from "react";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import Button from "@/components/shared/Button";
import PreProductionSummaryGroup from "@/components/project-management/PreProductionSummaryGroup";
import { detailHelpFor } from "@/constants/detailHelp";
import ProjectWhatsappGroupField from "@/components/project-management/ProjectWhatsappGroupField";
import { usePermissions } from "@/components/auth/PermissionsProvider";
import { CLIENT_GIFT_STATUSES } from "@/constants/clientGifts";
import { HARD_DISK_STATUS_OPTIONS, hardDiskLabel } from "@/constants/formPanelConfig";
import { formatDate } from "@/lib/preProductionFormat";
import { getPreProductionStorageRecord, savePreProductionGeneral, savePreProductionGiftStatus } from "@/services/project-management/pre-production.service";
import { verticalCode } from "@/components/sales/whatsappGroupNameUtils";
import ProjectHoldBadge from "@/components/project-management/ProjectHoldBadge";

/*
 * What holds for the project rather than for any one of its shoots: the two gifts, the hard disk and
 * the CRD document. Decided once and applying to every shoot, so it is a bar of its own above the
 * shoot cards, and it opens into a panel of its own where it can be changed.
 *
 * Who runs the project is **not** here. The Production Manager was this panel's one seat for a
 * while, on the reasoning that it is settled once pre production is under way; it is asked for with
 * the other four seats on Edit Project instead, because staffing a project is one question and
 * answering half of it on another screen left studios hunting for the half they had missed. The
 * name still shows on the board's **Production Manager** column and in the record panel.
 *
 * Whoever may write this screen may change everything it shows, so every part saves under
 * `PROJECT / Pre Production` through the pre production router, which reuses each owning module's
 * own logic:
 *   - Welcome Kit / Shoot Completed Gift, their Assigned To, Storage Needed and CRD Document are the
 *     project's own answers, saved the way Edit Project saves them;
 *   - a gift's Status moves as Client Gifts moves it, and its sent and received dates stamp
 *     themselves as it moves;
 *   - the hard disk moves along the Client Storage flow with the same moves and dialogs as the
 *     Client Storage screen.
 * A viewer holding Pre Production at READ sees it all filled in and read-only rather than hidden.
 */

const GIFT_CHOICES = ["Applicable", "Not Applicable"];
const STORAGE_CHOICES = ["Yes", "No"];
const CRD_CHOICES = ["Applicable", "Not Applicable"];

const dash = (value) => (value && value !== "—" ? value : null);

/*
 * Whether each of the four answers counts as applying — the same test the server keeps its history
 * by. CRD Document carries which sides were received too, so anything but "Not Applicable" applies.
 */
const APPLIES = {
  welcomeGift: (value) => value === "Applicable",
  shootCompletedGift: (value) => value === "Applicable",
  storageNeeded: (value) => value === "Yes",
  crdDocumentStatus: (value) => Boolean(value) && value !== "Not Applicable",
};

/** Whether this form switches `item` between applicable and not, against what was saved. */
const switches = (item, values, context) => APPLIES[item](values[item]) !== APPLIES[item](context?.original?.[item]);

/**
 * Switching an item on or off asks why, and the reason is kept with the change. Shown only while
 * the form switches it, so leaving it as it was asks nothing.
 */
const reasonField = (item) => ({
  name: `${item}Reason`,
  label: "Reason for the change",
  type: "textarea",
  required: true,
  colSpan: 2,
  placeholder: "Why it is being changed",
  when: (values, context) => switches(item, values, context),
});

/** The reason the item was last switched off — the one change worth reading back. */
const notApplicableRemarks = (item, changes = []) => {
  const latest = changes.find((change) => change.item === item);
  return latest && !APPLIES[item](latest.toValue) ? latest.remarks : null;
};

/** Shown while the item stays not applicable and a reason was given for switching it off. */
const remarksField = (item) => ({
  name: `${item}Remarks`,
  type: "custom",
  colSpan: 2,
  when: (values, context) => !APPLIES[item](values[item]) && !switches(item, values, context) && Boolean(notApplicableRemarks(item, context?.changes)),
});

/*
 * Whether an item belongs on General at all, read off the **saved** project rather than the form.
 *
 * Only what the project has as applicable is shown - a gift nobody is giving, a disk nobody needs
 * and a CRD document nobody asked for have nothing to track here. An item switched off here or on
 * Edit Project **with a reason** stays, showing Not Applicable and that reason, so the register can
 * say why it stopped. Read from the save, so switching an item off in this panel does not take its
 * section away before the reason box under it has been answered.
 */
const shownOnGeneral = (item, project) => APPLIES[item](project[item]) || Boolean(notApplicableRemarks(item, project.applicabilityChanges));

function crdState(project) {
  return project.crdDocumentState && project.crdDocumentState !== "Not Issued" ? project.crdDocumentState : null;
}

/** What the bar above the shoot cards says for each item - the same items the panel shows. */
function barItems(project) {
  return [
    shownOnGeneral("welcomeGift", project) && ["Welcome Kit", project.welcomeGift],
    shownOnGeneral("shootCompletedGift", project) && ["Shoot Completed Gift", project.shootCompletedGift],
    // Yes / No from the sale, and - once it is Yes - where the disk itself has got to.
    shownOnGeneral("storageNeeded", project) && ["Hard Disk", project.storageNeeded === "Yes" ? hardDiskLabel(project.hardDiskStatus) : project.storageNeeded],
    // What the CRD Documents page knows once a document exists; the sale's own note until then.
    shownOnGeneral("crdDocumentStatus", project) && ["CRD Document", crdState(project) || project.crdDocumentStatus],
  ].filter(Boolean);
}

/** The bar above the shoot cards: each item's value, filled in, and a click to open it. */
export function GeneralBar({ project, onOpen }) {
  /*
   * A project may apply none of them - no gift, no disk, no CRD document - and until the Production
   * Manager seat moved off this bar there was always one item to draw. With none, the list is left
   * out and the bar says what is still behind it, rather than opening a gap under the heading: the
   * WhatsApp group is in the panel whatever the project applies.
   */
  const items = barItems(project);
  return <Button
    type="button"
    variant="plain"
    size="none"
    onClick={onOpen}
    className="group flex w-full min-w-0 flex-col items-stretch rounded-xl border border-slate-300 bg-slate-50 p-4 text-left shadow-sm transition hover:border-blue-400 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
  >
    <span className="flex items-center justify-between gap-2">
      <span className="text-sm font-semibold text-slate-900">General</span>
      <span className="shrink-0 text-[11px] font-semibold text-slate-400 group-hover:text-blue-600">Open →</span>
    </span>
    <span className="mt-0.5 text-[11px] text-slate-400">Applies to every shoot</span>
    {items.length ? <dl className="mt-3 grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map(([label, value]) => <div key={label} className="min-w-0">
        <dt className="text-xs font-semibold text-slate-500">{label}</dt>
        <dd className="mt-0.5 truncate text-sm text-slate-800">{value || "—"}</dd>
      </div>)}
    </dl> : <span className="mt-3 text-xs text-slate-500">Nothing to track on this project - open it for the WhatsApp group.</span>}
  </Button>;
}

/** The answers the form edits, as the row carries them. */
function formFrom(project) {
  return {
    welcomeGift: project.welcomeGift || "",
    welcomeGiftEmployeeId: project.welcomeGiftEmployeeId ?? "",
    welcomeGiftStatus: project.welcomeGiftStatus || "",
    shootCompletedGift: project.shootCompletedGift || "",
    shootCompletedGiftEmployeeId: project.shootCompletedGiftEmployeeId ?? "",
    shootCompletedGiftStatus: project.shootCompletedGiftStatus || "",
    storageNeeded: project.storageNeeded || "",
    // A project saved before it was asked reads as the disk not having come back yet.
    hardDiskStatus: project.hardDiskStatus || "NOT_RECEIVED",
    crdDocumentStatus: project.crdDocumentStatus || "",
  };
}

const PROJECT_FIELDS = ["welcomeGift", "welcomeGiftEmployeeId", "shootCompletedGift", "shootCompletedGiftEmployeeId", "storageNeeded", "hardDiskStatus", "crdDocumentStatus"];
const GIFTS = [["welcome", "welcomeGift", "welcomeGiftStatus"], ["shoot-completed", "shootCompletedGift", "shootCompletedGiftStatus"]];

const idOrNull = (value) => (value === "" || value === null || value === undefined ? null : Number(value));

function giftSection(id, title, prefix, canWrite) {
  const applies = (values) => values[prefix] === "Applicable";
  return {
    id,
    title,
    fields: [
      { name: prefix, label: title, type: "select", options: "giftChoices", placeholder: "Select", props: { disabled: !canWrite } },
      { name: `${prefix}EmployeeId`, label: "Assigned To", type: "select", options: "employees", placeholder: "Select employee", props: { searchable: true, disabled: !canWrite }, when: applies },
      { name: `${prefix}Status`, label: "Status", type: "select", options: "giftStatuses", placeholder: "Select status", props: { disabled: !canWrite }, when: applies },
      { name: `${prefix}Dates`, type: "custom", colSpan: 2, when: applies },
      reasonField(prefix),
      remarksField(prefix),
    ],
  };
}

/** General opened: the four items, editable where the viewer may change them, over the shoot cards. */
export default function PreProductionGeneralPanel({ project, employees = [], aside, onBack, onClose, onSaved }) {
  const { hasPermission } = usePermissions();
  // The screen's own permission decides everything on it; the routes behind it ask the same.
  const canWrite = hasPermission("PROJECT", "Pre Production", "READ_WRITE");

  const [form, setForm] = useState(() => formFrom(project));
  const update = useCallback((field, value) => setForm((current) => ({ ...current, [field]: value })), []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // The hard disk's own record, with the moves it may make next; the facts the board row already
  // carries stand in until it arrives, or if it cannot be read.
  const [storageRecord, setStorageRecord] = useState(null);
  const loadStorage = useCallback(async () => {
    if (!project.storageRecordId) { setStorageRecord(null); return; }
    try {
      const response = await getPreProductionStorageRecord(project.projectId, project.storageRecordId);
      setStorageRecord(response?.data || null);
    } catch {
      setStorageRecord(null);
    }
  }, [project.projectId, project.storageRecordId]);
  useEffect(() => { const timer = setTimeout(() => void loadStorage(), 0); return () => clearTimeout(timer); }, [loadStorage]);

  const sections = useMemo(() => [
    // Every section here is an item the project either applies or does not, with the reason it was
    // switched - the Production Manager seat that sat above them is Edit Project's now.
    {
      id: "whatsapp-group",
      title: "WhatsApp Group",
      fields: [{ name: "whatsappGroup", type: "custom", colSpan: 2 }],
    },
    shownOnGeneral("welcomeGift", project) && giftSection("welcome-kit", "Welcome Kit", "welcomeGift", canWrite),
    shownOnGeneral("shootCompletedGift", project) && giftSection("shoot-completed-gift", "Shoot Completed Gift", "shootCompletedGift", canWrite),
    shownOnGeneral("storageNeeded", project) && {
      id: "hard-disk",
      title: "Hard Disk",
      fields: [
        { name: "storageNeeded", label: "Storage Needed", type: "select", options: "storageChoices", placeholder: "Select", props: { disabled: !canWrite } },
        /*
         * Where the disk has got to, as pre production tracks it: it comes back and is handed on.
         * Three answers, where Client Storage runs on eight - handing it over starts the record
         * there, and from that point the disk is Client Storage's. Asked only where the project
         * said it needs storage.
         */
        {
          name: "hardDiskStatus",
          label: "Hard Disk Status",
          type: "select",
          options: "hardDiskStatuses",
          placeholder: "Select status",
          when: (values) => values.storageNeeded === "Yes",
          helperText: "Handed Over starts this project's record on Client Storage.",
          props: { disabled: !canWrite },
        },
        /*
         * Drawn only once there **is** a disk. Storage Needed is the project's answer and the disk is
         * Client Storage's record, raised by the server when that answer becomes Yes - so between
         * choosing Yes and saving there is nothing to show. It used to say so in a dashed box, which
         * explained the mechanism to somebody who had just used it: they chose Yes, they are about to
         * save, and the disk appears when they do. The field waits instead, rather than the renderer
         * returning nothing and leaving its own div holding a column of the grid.
         */
        { name: "storageRecord", type: "custom", colSpan: 2, when: (values) => values.storageNeeded === "Yes" && Boolean(project.storageRecordId) },
        reasonField("storageNeeded"),
        remarksField("storageNeeded"),
      ],
    },
    shownOnGeneral("crdDocumentStatus", project) && {
      id: "crd-document",
      title: "CRD Document",
      fields: [
        { name: "crdDocumentStatus", label: "CRD Document", type: "select", options: "crdChoices", placeholder: "Select", props: { disabled: !canWrite } },
        { name: "crdSummary", type: "custom", colSpan: 2, when: (values) => Boolean(values.crdDocumentStatus) && values.crdDocumentStatus !== "Not Applicable" },
        reasonField("crdDocumentStatus"),
        remarksField("crdDocumentStatus"),
      ],
    },
    /*
     * `project` is in here because which sections exist, and the Hard Disk field, are drawn from the
     * saved row: the disk is raised by the **save**, and a section switched off with a reason stays
     * only once that save lands, so without the dependency both would lag a render behind it.
     */
  ].filter(Boolean), [canWrite, project]);

  const storage = storageRecord || null;
  const context = useMemo(() => ({
    // What was saved, so a field can tell whether the form is switching it; and the switches, for
    // the reason an item was turned off.
    original: formFrom(project),
    changes: project.applicabilityChanges || [],
    options: {
      giftChoices: GIFT_CHOICES,
      giftStatuses: CLIENT_GIFT_STATUSES,
      storageChoices: STORAGE_CHOICES,
      hardDiskStatuses: HARD_DISK_STATUS_OPTIONS,
      crdChoices: CRD_CHOICES,
      employees: employees.map((employee) => ({ value: employee.id, label: `${employee.employeeName}${employee.employeeId ? ` (${employee.employeeId})` : ""}`, avatar: avatarOf(employee) })),
    },
    renderers: {
      whatsappGroup: () => <ProjectWhatsappGroupField project={project} canWrite={canWrite} onLinked={onSaved} />,
      welcomeGiftDates: () => <PreProductionSummaryGroup rows={[["Sent On", dash(formatDate(project.welcomeGiftSentAt)), "The day the welcome gift was marked Sent in Client Gifts."], ["Received On", dash(formatDate(project.welcomeGiftReceivedAt)), "The day the welcome gift was marked Received by Client in Client Gifts."]]} />,
      shootCompletedGiftDates: () => <PreProductionSummaryGroup rows={[["Sent On", dash(formatDate(project.shootCompletedGiftSentAt)), "The day the shoot completed gift was marked Sent in Client Gifts."], ["Received On", dash(formatDate(project.shootCompletedGiftReceivedAt)), "The day the shoot completed gift was marked Received by Client in Client Gifts."]]} />,
      /*
       * Where the disk stands, read-only.
       *
       * It used to carry the whole Client Storage flow - a button per legal move, Yet to Start
       * through Delivered - which is not pre production's to run: this board sets one status, and
       * it sets it from the shoot. A coordinator answers **Hard Disk** on the shoot's own form
       * (Not Received / Received / Handed Over), and Handed Over is what starts the record off.
       * The rest of the journey belongs to Client Storage and its own permission.
       */
      storageRecord: () => <div className="flex flex-col gap-3">
        <PreProductionSummaryGroup rows={[
          ["Storage ID", storage?.storageId || project.storageId, detailHelpFor("Storage", "storageId")],
          ["Status", storage?.status || project.storageStatus, detailHelpFor("Storage", "storageStatus")],
          ["Assigned To", storage?.assignedToName || project.storageAssignee, "The employee Client Storage has given this hard disk to look after."],
          ["Received The Storage", (storage?.status || project.storageStatus) ? ((storage?.status || project.storageStatus) !== "Yet to Receive" ? "Yes" : "No") : null, detailHelpFor("Storage", "receivedTheStorage")],
        ]} />
        <p className="text-xs text-slate-500">Each shoot&apos;s Hard Disk answer is on the shoot itself; handing one over starts its record here.</p>
      </div>,
      ...Object.fromEntries(Object.keys(APPLIES).map((item) => [`${item}Remarks`, () => <PreProductionSummaryGroup rows={[["Remarks", notApplicableRemarks(item, project.applicabilityChanges), "Why this item was switched to Not Applicable, written by whoever switched it."]]} />])),
      crdSummary: () => <PreProductionSummaryGroup rows={[
        ["Document State", crdState(project) || "Not Issued", detailHelpFor("Project", "crdDocumentState")],
        ["Sides Received", project.crdSidesReceived, detailHelpFor("Project", "crdSidesReceived")],
        ["Completion", typeof project.crdCompletion === "number" ? `${project.crdCompletion}%` : null, detailHelpFor("Project", "crdCompletion")],
      ]} />,
    },
  }), [canWrite, employees, onSaved, project, storage]);

  async function submit(event) {
    event.preventDefault();
    const original = formFrom(project);
    setSaving(true);
    setError("");
    try {
      // The project's own answers first, so a gift made Applicable here exists before its status
      // is set below.
      const changed = PROJECT_FIELDS.filter((field) => String(form[field] ?? "") !== String(original[field] ?? ""));
      if (changed.length) {
        const payload = Object.fromEntries(changed.map((field) => [field, field.endsWith("EmployeeId") ? idOrNull(form[field]) : (form[field] || null)]));
        // The reason for each item switched on or off travels with the switch, and is kept beside it.
        const reasons = Object.fromEntries(Object.keys(APPLIES)
          .filter((item) => switches(item, form, { original }))
          .map((item) => [item, (form[`${item}Reason`] || "").trim()]));
        if (Object.values(reasons).some((reason) => !reason)) throw new Error("Give a reason for each item switched on or off.");
        if (Object.keys(reasons).length) payload.applicabilityRemarks = reasons;
        await savePreProductionGeneral(project.projectId, payload);
      }
      for (const [gift, giftField, statusField] of GIFTS) {
        if (form[giftField] === "Applicable" && form[statusField] && form[statusField] !== original[statusField]) {
          await savePreProductionGiftStatus(gift, project.projectId, form[statusField]);
        }
      }
      await onSaved?.("General saved.");
      /*
       * Saved, so the reasons are cleared rather than asked again of the next change - but only once
       * `onSaved` has reloaded the project. Cleared straight after the write, the form still read as
       * switching the item against the project it was opened with, so the required reason box came
       * back empty and "Complete required fields" flashed up before "General saved".
       */
      setForm((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.endsWith("Reason"))));
    } catch (requestError) {
      setError(requestError.message || "Unable to save General.");
    } finally {
      setSaving(false);
    }
  }

  return <>
    <SchemaFormPanel
      title={`General — ${project.clientName || project.eventId || "Project"}`}
      titleAddon={<ProjectHoldBadge status={project.projectStatus} holds={project.holds} paymentsDue={project.paymentsDue} />}
      description={`${project.eventId || ""}${project.product ? ` · ${verticalCode(project.product)}` : ""} · Applies to every shoot`}
      sections={sections}
      values={form}
      onChange={update}
      context={context}
      sidebarAriaLabel="General sections"
      closeAriaLabel="Close general"
      onClose={onClose}
      onBack={onBack}
      backAriaLabel="Back to shoots"
      onSubmit={submit}
      error={error}
      saving={saving}
      {...(canWrite
        ? { submitLabel: "Save", savingLabel: "Saving..." }
        : { footer: <Button className="max-sm:w-full" type="button" variant="primary" onClick={onBack}>Back to Shoots</Button> })}
      aside={aside}
      asideAriaLabel="Project follow-ups"
    />
  </>;
}
