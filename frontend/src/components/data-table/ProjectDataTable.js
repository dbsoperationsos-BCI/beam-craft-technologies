"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import DataTableShell from "./DataTableShell";
import OptionsMenu from "@/components/ui/OptionsMenu";
import { usePermissions } from "@/components/auth/PermissionsProvider";
import { boardJumpItems } from "@/lib/boardJumps.mjs";
import DataTableInfoPanel from "./DataTableInfoPanel";
import ProjectPaymentsView from "@/components/project-management/ProjectPaymentsView";
import ProjectStageView from "@/components/project-management/ProjectStageView";
import ProjectActivityTab from "@/components/project-management/ProjectActivityTab";
import ProjectLinesTab from "@/components/project-management/ProjectLinesTab";
import { getProjectActivity } from "@/services/project-management/project-workflow.service";
import RecordViewPanel from "./RecordViewPanel";
import TableFooter from "./TableFooter";
import DataTable from "./DataTable";
import projectInfoFormatters from "@/components/project-management/projectInfoFormatters";
import { commonProjectInfoSections, productionProjectInfoSections, projectManagementInfoSections } from "@/constants/infoPanelConfig";
import { formatSessionTiming } from "@/components/project-management/AddShootDialog";
import { canDuplicateProject } from "@/components/sales/projectBooking";
import { verticalCode } from "@/components/sales/whatsappGroupNameUtils";
// The one name every screen gives a deliverable line - its brand and size where it was sold as a variant.
import { deliverableRowLabel } from "@/lib/deliverableBrands.mjs";
import ProjectHoldBadge from "@/components/project-management/ProjectHoldBadge";
import { holdLabel, paymentsDueLabel } from "@/lib/projectHolds.mjs";

// `shootLabel`: the heading where the column also carries each shoot's value (Projects, ▸).
const projectManagementColumns = [
  { id: "projectStatus", label: "Project Status", shootLabel: "Project Status / Shoot Type" },
  { id: "eventId", label: "Event ID", shootLabel: "Event ID / Shoot ID" },
  { id: "enquiryId", label: "Enquiry ID" },
  { id: "whatsappGroupName", label: "WhatsApp Group Name", shootLabel: "WhatsApp Group Name / Shoot" },
  { id: "clientMainNumber", label: "Client Main Number" },
  { id: "vertical", label: "Vertical" },
  { id: "waBranch", label: "W/A Branch" },
  { id: "waOfferName", label: "W/A Offer Name" },
  { id: "waClientName", label: "W/A Client Name" },
  { id: "waPlace", label: "W/A Place" },
  { id: "waGou", label: "W/A GOU" },
  { id: "waHouseType", label: "W/A House Type" },
  { id: "waSocialMediaPosting", label: "W/A Social Media Posting" },
  { id: "waGeneratorCreatedAt", label: "W/A Generator Created At", type: "date" },
  { id: "waGeneratorExpiresAt", label: "W/A Generator Expires At", type: "date" },
  { id: "waGeneratorUsedStatus", label: "W/A Generator Used Status" },
  { id: "sourceBranch", label: "Source Branch" },
  { id: "deliverables", label: "Deliverables" },
  { id: "deliverablesDetails", label: "Deliverables Details" },
  { id: "salesPreProductionRemarks", label: "Sales Pre Production Remarks" },
  { id: "salesProductionRemarks", label: "Sales Production Remarks" },
  { id: "salesPostProductionRemarks", label: "Sales Post Production Remarks" },
  { id: "mainEventDateKnown", label: "Main Event Date Known" },
  { id: "mainEventDate", label: "Main Event Date", type: "date", shootLabel: "Main Event Date / Shoot Date" },
  { id: "initialConvertedValue", label: "Initial Converted Value", type: "number" },
  { id: "crmName", label: "CRM Name" },
  { id: "createdAt", label: "Created At", type: "date" },
  { id: "updatedAt", label: "Updated At", type: "date" },
  { id: "projectManager", label: "Project Manager" },
  { id: "preProductionCoordinator", label: "Pre Production Coordinator" },
  { id: "creativeManager", label: "Creative Manager" },
  { id: "postProductionCoordinator", label: "Post Production Coordinator" },
  { id: "welcomeGift", label: "Welcome Gift" },
  { id: "welcomeGiftAssignee", label: "Welcome Gift Assigned To" },
  { id: "shootCompletedGift", label: "Shoot Completed Gift" },
  { id: "shootCompletedGiftAssignee", label: "Shoot Completed Gift Assigned To" },
  { id: "projectValidityMonths", label: "Project Validity (In Months)", type: "number" },
  { id: "storageNeeded", label: "Storage Needed" },
  { id: "crdDocumentStatus", label: "CRD Document Groom / Bride / Baby Shoot" },
  { id: "shootCount", label: "Shoot Count", type: "number" },
  { id: "shootIds", label: "Shoot IDs" },
  { id: "shootNames", label: "Shoot Names" },
  { id: "shootDates", label: "Shoot Dates" },
  { id: "shootPlaces", label: "Shoot Places" },
  { id: "shootDistricts", label: "Shoot Districts" },
  { id: "shootStates", label: "Shoot States" },
  { id: "sessionTimings", label: "Session Timing" },
  { id: "productionServiceCount", label: "Production Service Count", type: "number" },
  { id: "productionServices", label: "Production Services" },
  { id: "productionServiceDetails", label: "Production Service Details" },
  { id: "postProductionDeliverableCount", label: "Post Production Deliverable Count", type: "number" },
  { id: "postProductionDeliverables", label: "Post Production Deliverables" },
  { id: "postProductionDeliverableQuantities", label: "Post Production Deliverable Quantities" },
  { id: "actions", label: "Actions", fixed: true, sortable: false, filterable: false },
];

const salesProjectColumnIds = new Set([
  "projectStatus", "eventId", "enquiryId", "whatsappGroupName", "clientMainNumber", "vertical", "waBranch", "waOfferName", "waClientName", "waPlace", "waGou", "waHouseType", "waSocialMediaPosting", "waGeneratorCreatedAt", "waGeneratorExpiresAt", "waGeneratorUsedStatus", "sourceBranch",
  "deliverables", "deliverablesDetails", "salesPreProductionRemarks", "salesProductionRemarks", "salesPostProductionRemarks",
  "mainEventDateKnown", "mainEventDate", "initialConvertedValue", "crmName", "createdAt", "actions",
]);

const salesProjectColumns = projectManagementColumns.filter((column) => salesProjectColumnIds.has(column.id));
const productionProjectColumns = [
  { id: "projectStatus", label: "Project Status" },
  { id: "eventId", label: "Event ID" },
  { id: "whatsappGroupName", label: "WhatsApp Group Name" },
  { id: "vertical", label: "Vertical" },
  { id: "mainEventDate", label: "Event Date", type: "date" },
  { id: "productionTravelMode", label: "Travel Mode" },
  { id: "productionDrivenBy", label: "Driven By" },
  { id: "productionVehicle", label: "Vehicle" },
  { id: "productionCoordinator", label: "Assigned By" },
  { id: "productionAssignedPerson", label: "Assigned Person" },
  { id: "productionEquipment", label: "Equipment" },
  { id: "productionRemarks", label: "Remarks" },
  { id: "actions", label: "Actions", fixed: true, sortable: false, filterable: false },
];
const defaultColumnVisibility = Object.fromEntries([...projectManagementColumns, ...productionProjectColumns].map((column) => [column.id, !column.id.startsWith("wa") ]));


function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(date);
}

/**
 * What to call a project at the top of the record a double-click opens.
 *
 * Its name is the WhatsApp group name — that is what the studio calls a project, and what the
 * Start Project form puts in its own heading. `projectName` and `projectCode` were being read here
 * and are not columns `SalesProject` has, so every record was headed with the literal word
 * "Project" and one project could not be told from another.
 *
 * The Event ID sits underneath as the description rather than in the title: the name is what it is
 * called, the identifier is which one it is, and a heading that has to carry both reads as neither.
 */
function projectHeading(project) {
  return project?.whatsappGroupName?.trim() || project?.eventId || project?.enquiryId || "Project";
}

function projectForInfo(project) {
  if (!project) return null;
  const group = project.groupNameGeneratorJson && typeof project.groupNameGeneratorJson === "object" ? project.groupNameGeneratorJson : {};
  return { ...project, waBranch: group.branch || null, waOfferName: group.offerName || null, waClientName: group.clientName || null, waPlace: group.place || null, waGou: typeof group.gou === "boolean" ? (group.gou ? "Yes" : "No") : null, waHouseType: group.houseType || null, waSocialMediaPosting: group.socialMediaPosting || null, waGeneratorCreatedAt: group.generatorCreatedAt || null, waGeneratorExpiresAt: group.generatorExpiresAt || null, waGeneratorUsedStatus: group.generatorUsedStatus || null, productionTravelMode: displayValue(project, "productionTravelMode"), productionDrivenBy: displayValue(project, "productionDrivenBy"), productionVehicle: displayValue(project, "productionVehicle"), productionCoordinator: displayValue(project, "productionCoordinator"), productionAssignedPerson: displayValue(project, "productionAssignedPerson"), productionEquipment: displayValue(project, "productionEquipment"), productionRemarks: displayValue(project, "productionRemarks") };
}


/*
 * A project row opens (▸) to its shoots on Projects, one row each. A shoot row is told apart by having
 * a Shoot ID and no shoots of its own; it shows its own value in the columns that describe a shoot -
 * its ID and name, type, date and time, place, its services and deliverables - and is blank in the
 * rest.
 */
const isShootRow = (row) => Boolean(row?.shootId) && !Array.isArray(row?.shoots);

function shootDisplayValue(shoot, columnId) {
  const services = (shoot.postProductionAllocations || []).map((item) => item.serviceName).filter(Boolean);
  const deliverables = (shoot.deliverables || []).map((item) => deliverableRowLabel(item)).filter(Boolean);
  const name = `${shoot.isMainEvent ? "★ " : ""}${shoot.shoot || "Shoot"}`;
  const time = [shoot.eventStartTime, shoot.eventEndTime].filter(Boolean).join(" – ");
  const values = {
    projectStatus: shoot.shootType,
    eventId: shoot.shootId,
    whatsappGroupName: [name, shoot.shootPlace].filter(Boolean).join(" · "),
    mainEventDate: [formatDate(shoot.dateCreated), time].filter((value) => value && value !== "—").join(" · "),
    shootCount: "",
    shootIds: shoot.shootId,
    shootNames: name,
    shootDates: formatDate(shoot.dateCreated),
    shootPlaces: shoot.shootPlace,
    shootDistricts: shoot.district,
    shootStates: shoot.state,
    sessionTimings: formatSessionTiming(shoot),
    productionServiceCount: services.length,
    productionServices: services.join(", "),
    postProductionDeliverableCount: deliverables.length,
    postProductionDeliverables: deliverables.join(", "),
  };
  if (!Object.prototype.hasOwnProperty.call(values, columnId)) return "";
  const value = values[columnId];
  return value === null || value === undefined || value === "" ? "—" : value;
}

function displayValue(project, columnId) {
  if (isShootRow(project)) return shootDisplayValue(project, columnId);
  const shoots = Array.isArray(project.shoots) ? project.shoots : [];
  const services = shoots.flatMap((shoot) => (shoot.postProductionAllocations || []).map((item) => ({ ...item, shoot })));
  const postProductionDeliverables = shoots.flatMap((shoot) => (shoot.deliverables || []).map((item) => ({ ...item, shoot })));
  const join = (values) => values.filter((value) => value !== null && value !== undefined && value !== "").join(", ") || "—";
  const group = project.groupNameGeneratorJson && typeof project.groupNameGeneratorJson === "object" ? project.groupNameGeneratorJson : {};
  const waValues = { waBranch: group.branch, waOfferName: group.offerName, waClientName: group.clientName, waPlace: group.place, waGou: typeof group.gou === "boolean" ? (group.gou ? "Yes" : "No") : null, waHouseType: group.houseType, waSocialMediaPosting: group.socialMediaPosting, waGeneratorCreatedAt: group.generatorCreatedAt, waGeneratorExpiresAt: group.generatorExpiresAt, waGeneratorUsedStatus: group.generatorUsedStatus };
  const assignment = project.productionAssignment;
  const person = (value) => value ? `${value.employeeName} (${value.employeeId || "—"})` : "â€”";
  const productionValues = {
    productionTravelMode: assignment?.travelMode,
    productionDrivenBy: assignment?.drivenBy,
    productionVehicle: assignment?.vehicle ? { OWNED: "Owned", RENTAL: "Rental", OFFICE_VEHICLE: "Office Vehicle" }[assignment.vehicle] : null,
    productionCoordinator: person(assignment?.projectCoordinator),
    productionAssignedPerson: person(assignment?.assignedPerson),
    productionEquipment: assignment?.equipment ? `${assignment.equipment.equipmentName} (${assignment.equipment.equipmentCode})` : null,
    productionRemarks: assignment?.remarks,
  };
  if (Object.prototype.hasOwnProperty.call(productionValues, columnId)) return productionValues[columnId] || "â€”";
  if (Object.prototype.hasOwnProperty.call(waValues, columnId)) return ["waGeneratorCreatedAt", "waGeneratorExpiresAt"].includes(columnId) ? formatDate(waValues[columnId]) : waValues[columnId] ?? "—";
  /*
   * The vertical, as the studio says it: **DD**, not the stored `WED`.
   *
   * `WED` is Dum Dum's internal code and it belongs to exactly one place - the WhatsApp group name,
   * which somebody types into WhatsApp and has to go on reading "WED". A Vertical column is a fact
   * *about* the project, so it reads the short code the studio uses. `displayValue` feeds the cell,
   * the filter and the CSV alike, so all three say the same word.
   */
  // A project held in one of its departments says where, beside its own status: "WIP - Pre & Production · On Hold (Pre-Production)".
  if (columnId === "projectStatus") return [project.projectStatus || "—", project.holds?.length ? holdLabel(project.projectStatus, project.holds) : null, paymentsDueLabel(project.projectStatus, project.paymentsDue)].filter(Boolean).join(" · ");
  if (columnId === "vertical") return verticalCode(project.vertical) || "—";
  if (columnId === "mainEventDate" || columnId === "createdAt" || columnId === "updatedAt") return formatDate(project[columnId]);
  if (columnId === "mainEventDateKnown") return project.mainEventDateKnown ? "Yes" : "No";
  if (columnId === "deliverables") return project.deliverables === "Others" ? "Others" : project.deliverables || "—";
  if (columnId === "deliverablesDetails") return project.deliverables === "Others" ? project.deliverablesDetails?.trim() || "—" : "—";
  if (columnId === "shootCount") return shoots.length;
  if (columnId === "shootIds") return join(shoots.map((shoot) => shoot.shootId));
  if (columnId === "shootNames") return join(shoots.map((shoot) => shoot.shoot));
  if (columnId === "shootDates") return join(shoots.map((shoot) => formatDate(shoot.dateCreated)));
  if (columnId === "shootPlaces") return join(shoots.map((shoot) => shoot.shootPlace));
  if (columnId === "shootDistricts") return join(shoots.map((shoot) => shoot.district));
  if (columnId === "shootStates") return join(shoots.map((shoot) => shoot.state));
  if (columnId === "sessionTimings") return join(shoots.map(formatSessionTiming));
  if (columnId === "productionServiceCount") return services.length;
  if (columnId === "productionServices") return join(services.map((item) => `${item.shoot.shootId || "—"}: ${item.serviceName}`));
  if (columnId === "productionServiceDetails") return join(services.map((item) => item.serviceDetails ? `${item.shoot.shootId || "—"}: ${item.serviceDetails}` : null));
  if (columnId === "postProductionDeliverableCount") return postProductionDeliverables.length;
  if (columnId === "postProductionDeliverables") return join(postProductionDeliverables.map((item) => `${item.shoot.shootId || "—"}: ${deliverableRowLabel(item)}`));
  if (columnId === "postProductionDeliverableQuantities") return join(postProductionDeliverables.map((item) => `${item.shoot.shootId || "—"}: ${item.quantity}`));
  return project[columnId] ?? "—";
}

function sortValue(project, column) {
  const value = displayValue(project, column.id);
  if (value === "—") return "";
  if (column.type === "number") return Number(value) || 0;
  if (column.type === "date") {
    const group = project.groupNameGeneratorJson && typeof project.groupNameGeneratorJson === "object" ? project.groupNameGeneratorJson : {};
    const date = new Date(column.id === "waGeneratorCreatedAt" ? group.generatorCreatedAt : column.id === "waGeneratorExpiresAt" ? group.generatorExpiresAt : project[column.id]);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }
  return String(value).toLocaleLowerCase();
}

/*
 * Two permissions meet in this menu. Editing the sale details or deleting the record changes the
 * sale, which is SALES / Sales Manager's; starting the project and editing its plan are
 * PROJECT / Projects'. A project manager may plan a shoot without being able to delete the sale it
 * came from, so the two are asked for separately, and the half whose handlers a screen does not
 * pass is simply absent from the menu.
 */
/**
 * Which form a project's Edit opens for this viewer - "plan" (Start / Edit, the project's own form) for
 * whoever may plan it, else "sale" (Edit Sale Details) for whoever may change the booking, else null.
 * The project's row and each of its shoots' rows ask this one question, so the two always agree.
 */
function projectEditRoute(project, { readOnly, canEditSale, canPlan, canEditStarted, canEditProject, onEditSaleDetails, onStartProject, onEditProject }) {
  if (readOnly) return null;
  const canStartProject = project.projectStatus === "Yet to Start";
  const mayPlan = Boolean(onStartProject && onEditProject) && (canPlan ?? true) && (canStartProject || !canEditStarted || canEditStarted(project));
  if (mayPlan) return "plan";
  const mayEditRecord = Boolean(canEditSale || canPlan) && typeof canEditProject === "function" && canEditProject(project);
  return mayEditRecord && onEditSaleDetails ? "sale" : null;
}

/**
 * A shoot's row under its project: Open project, and Edit - the project's form, opened on this shoot -
 * wherever the project's own Edit is offered to this viewer (`route`).
 */
function ShootRowActions({ shoot, project, onOpenProject, onEditShoot, route }) {
  return <OptionsMenu ariaLabel={`Actions for ${shoot.shootId}`} items={[
    { label: "Open project", onSelect: () => onOpenProject(project) },
    ...(route && onEditShoot ? [{ label: "Edit", onSelect: () => onEditShoot(project, shoot, route) }] : []),
  ]} />;
}

/**
 * A project row's ⋮, as an item list - the one source for the table's ⋮ (`ProjectRowActions`) and
 * for a Board card's (`useProjectRowActions`), so the two can never offer different things. `can`
 * is the viewer's `hasPermission`.
 */
export function projectRowActionItems(project, { onView, onViewActivity, onNotice, onEditSaleDetails, onStartProject, onEditProject, onUpdateStatus, onSendBack, onDelete, onDuplicate, onAssignProduction, onJump, board, readOnly, canEditSale, canPlan, canEditStarted, canEditProject, canDeleteProject, can }) {
  const canStartProject = project.projectStatus === "Yet to Start";
  // Offered on every variant of this menu, including the view-only one: looking at the project on
  // another board is not an edit, and somebody who may only read is exactly who wants it.
  const jumpItems = boardJumpItems({ from: board, boards: project.boards, eventId: project.eventId, can, onJump });
  /*
   * Each half stands on its own handlers rather than on all four arriving together. Sales Manager
   * offers the sale's actions and nothing else - starting a project is PROJECT / Projects' - and
   * demanding the whole set left that screen with a view-only menu however the role was granted.
   */
  /*
   * `Boolean(canEditSale)` and not `canEditSale ?? true`.
   *
   * It was the latter, which made a permission default point the wrong way: a caller that simply
   * forgot the prop was handed the sale's actions. No screen was bitten by it, and that is luck
   * rather than design - a control shown to somebody the endpoint will refuse is the fault Rule 4
   * exists to stop, and a missing answer has to read as "no".
   */
  const mayEditSale = !readOnly && Boolean(onEditSaleDetails || onDelete) && Boolean(canEditSale);
  /*
   * Who may act on the project **as a record**, which is two questions rather than one.
   *
   * Both are different from `mayEditSale` above, which is only "may you sell". Making a project and
   * unmaking one are not the same act: the sale's permission books it, and it used to be the whole of
   * the guard on editing and deleting it too - so the CRM who typed a booking could rewrite it long
   * after the studio had begun working to it, and could delete it outright.
   *
   * **Changing** it belongs to anybody the project is staffed to - its Project Manager, its Pre
   * Production Coordinator, its Creative Manager, its Post Production Coordinator - because each of
   * them is working to it and each has reason to correct what it says. **Deleting** it belongs to
   * its Project Manager alone: a coordinator runs a stage of the work, and removing the project out
   * from under everybody else working to it is not a stage of anything. A branch administrator
   * passes either, and a Super Admin holds that along with everything else.
   *
   * The caller answers both for this row, the same shape `canEditStarted` takes. Either write
   * reaches the endpoints, because `PATCH`/`DELETE /projects/:id` take either: a coordinator works
   * the plan and need not hold the sale's permission at all.
   *
   * Absent rather than refused, like everything else on this menu. A missing prop reads as "no".
   */
  const answers = (may) => !readOnly && Boolean(canEditSale || canPlan) && typeof may === "function" && may(project);
  const mayEditRecord = answers(canEditProject);
  const mayDeleteRecord = answers(canDeleteProject);
  /*
   * Planning is one permission until the project starts, and a question about this project after.
   *
   * `canPlan` is `PROJECT / Projects` `READ_WRITE` - may you plan projects at all. `canEditStarted`
   * is the caller's answer for a project that is already running: its Project Manager, or somebody
   * holding `ADMIN / Branch Administration`. The plan is being worked to by then, and changing it
   * is not the same act as making it. Absent rather than refused: the entry simply is not on the
   * menu, and `PATCH` refuses it too if it is reached another way.
   */
  const mayPlan = !readOnly && Boolean(onStartProject && onEditProject) && (canPlan ?? true)
    && (canStartProject || !canEditStarted || canEditStarted(project));
  /*
   * Duplicating books a second project, so it asks for what booking one asks for - the sale's own
   * permission, which is why it hangs off `mayEditSale` rather than off a rule of its own.
   *
   * `canDuplicateProject` is the other half: only a project that converted at no quotation. A
   * project sold on one is copied by duplicating that quotation and booking from it, so that the
   * copy is priced against a quotation of its own rather than naming a document raised for somebody
   * else's enquiry. Absent rather than refused, like everything else on this menu.
   *
   * Offered only where the screen passes a handler, which today is Bookings & Converted. Project
   * Management's Projects lists the same records to plan them, not to sell a second one.
   */
  // Deliberately `mayEditSale` and not `mayManage`: duplicating books a **second** project, which is
  // a create and stays with whoever sells. It is not an act on the project in front of them.
  const mayDuplicate = mayEditSale && Boolean(onDuplicate) && canDuplicateProject(project);
  // Assign is a write like the rest, so readOnly has to reach it as well - it was tested first and
  // so slipped past the view-only branch below.
  const items = onAssignProduction && !readOnly ? [
    { label: "View Project Details", onSelect: () => onNotice("Project details are available in the Info Panel.") },
    { label: "Assign", onSelect: () => onAssignProduction(project) },
    ...jumpItems,
  ] : !mayEditSale && !mayPlan && !mayEditRecord && !mayDeleteRecord ? [
    { label: "View Project Details", onSelect: () => onNotice("Project details are available in the Info Panel.") },
    ...jumpItems,
  ] : [
    /*
     * One entry, whatever the viewer holds.
     *
     * Editing the sale and editing the plan were two of them, opening two forms that asked for
     * halves of the same project - so correcting a converted value and assigning a project manager
     * were separate errands. They are one form now, and this is the one way in. Which handler it is
     * is still decided by permission: the plan's form carries the sale's fields too, so whoever may
     * plan opens that, and whoever may only sell opens the sale's own.
     *
     * It reads "Start" until the project has been started, because that is what pressing it does -
     * the same form, but the press that saves it is the one that puts the project in progress, and
     * calling that "Edit" hides the only moment on this menu that is not reversible. Afterwards
     * there is nothing left to start, so it is "Edit".
     */
    ...(mayPlan
      ? [{ label: canStartProject ? "Start" : "Edit", onSelect: () => (canStartProject ? onStartProject : onEditProject)(project) }]
      // The sale's own form, for a viewer who may not plan. It edits the booking, so it answers to
      // the record's owner rather than to the permission that created it.
      : mayEditRecord && onEditSaleDetails ? [{ label: "Edit", onSelect: () => onEditSaleDetails(project) }] : []),
    /*
     * The booking, for an owner who may plan as well - and it has to be its own entry.
     *
     * The plan form shows the sale **read-only**, deliberately: it is not the screen that changes a
     * booking. So a Project Manager or a branch administrator, who may plan, only ever saw the plan
     * entry above and had no way to reach the sale at all. That was survivable while the booking
     * belonged to the CRM, who reached it from Sales Manager. It is not survivable now that those
     * two are the *only* people who may change a booking: without this entry the answer to "who
     * edits the sale on a started project" would be nobody.
     *
     * Named in full rather than as a second "Edit", because there are now two forms on this menu for
     * the one person who can open both, and two entries reading "Edit" is a menu that cannot be
     * aimed at. Whoever sees only one of them still sees it labelled plainly.
     *
     * It is the whole of what may be changed before a project starts: the plan form is how it is
     * started, and the details somebody may correct until then are the ones the CRM filled in.
     */
    ...(mayPlan && mayEditRecord && onEditSaleDetails
      ? [{ label: "Edit Sale Details", onSelect: () => onEditSaleDetails(project) }]
      : []),
    ...(mayDuplicate ? [{ label: "Duplicate", onSelect: () => onDuplicate(project) }] : []),
    // One project's status, as Update does over the ticked ones - passed only to whoever may plan projects.
    ...(!readOnly && onUpdateStatus ? [{ label: "Update status", onSelect: () => onUpdateStatus(project) }] : []),
    // Back to Bookings & Converted to be corrected - offered only where the page passes it (Projects,
    // to whoever may write PROJECT / Projects) and never on one already sent back.
    ...(!readOnly && onSendBack && !project.sentBackAt ? [{ label: "Send Back", onSelect: () => onSendBack(project) }] : []),
    // `mayDeleteRecord`, never `mayEditRecord`: a coordinator staffed on the project gets the Edit
    // above and no Delete here, which is the whole difference between the two rules.
    ...(mayDeleteRecord && onDelete ? [{ label: "Delete", tone: "danger", onSelect: () => onDelete(project) }] : []),
    // The same project on the other boards - offered where the viewer may open one and the project
    // is actually on it (`lib/boardJumps.mjs`).
    ...jumpItems,
  ];
  // Reading the record leads the menu, and replaces the "look in the Info Panel" note the two
  // read-only branches offered: on a touch screen this is the only way to open the record view,
  // because a double-click there is the browser's zoom gesture.
  // "View activity" opens the same record straight on its Activity tab - offered only where the
  // screen's record has one.
  return onView ? [
    { label: "View", onSelect: () => onView(project) },
    ...(onViewActivity ? [{ label: "View activity", onSelect: () => onViewActivity(project) }] : []),
    ...items.filter((item) => item.label !== "View Project Details"),
  ] : items;
}

function ProjectRowActions({ project, ...options }) {
  const { hasPermission } = usePermissions();
  return <OptionsMenu ariaLabel={`Actions for ${project.eventId || project.enquiryId}`} items={projectRowActionItems(project, { ...options, can: hasPermission })} />;
}

/**
 * `cardActions` for a Board of projects: the same items the table's ⋮ offers, from the same props the
 * page hands `ProjectDataTable`, plus the page's own `onView` / `onViewActivity` for its record panel.
 */
export function useProjectRowActions(options) {
  const { hasPermission } = usePermissions();
  const router = useRouter();
  return (project) => projectRowActionItems(project, { ...options, can: hasPermission, onJump: (href) => router.push(href) });
}

/**
 * The record a double-click on a project opens.
 *
 * Lifted out of the table below so it is not the table's any more: the Contacts directory opens a
 * project's record on its own page rather than sending the reader to Project Management for it,
 * and the only way for that to be the *same* record - the same sections, the same formatters, the
 * same Payments tab - is for there to be one of it.
 *
 * `sections` is passed rather than worked out here because the caller is what knows which record
 * this is: the production boards, the sales register and Project Management each read the same
 * project through their own list of fields.
 */
export function ProjectRecordPanel({ project, sections, projectManagement = false, showPayments = false, showStatus = false, showOverallStatus = false, showActivity = showStatus, initialTab, onClose, zIndexClassName }) {
  /*
   * Payments is asked for by name rather than following `projectManagement`: the production boards
   * pass that flag too, and their viewers hold Pre / Production / Post rather than the Projects
   * permission the payments answer to.
   */
  /*
   * Status is asked for by name too. `showStatus` is the Projects page's pair - Overall Status and the
   * Activity of what was done from Projects; `showOverallStatus` the Overall Status alone, read-only,
   * for the other screens that list a project (Bookings & Converted). Both read under the register's
   * readers. `showActivity` (on with `showStatus`) is the project's whole flow, enquiry to feedback,
   * whose server leaves out each stage the viewer's role cannot open.
   */
  const projectId = project?.id;
  const loadActivity = useCallback(() => getProjectActivity(projectId), [projectId]);
  const extraTabs = useMemo(() => (project ? [
    // The project's services and deliverables, shoot by shoot, as tables to edit or remove from -
    // whether the team added them or they were approved from the client's requests.
    ...(projectManagement ? [{ id: "lines", label: "Services & Deliverables", render: () => <ProjectLinesTab projectId={project.id} /> }] : []),
    ...(showPayments ? [{ id: "payments", label: "Payments", render: () => <ProjectPaymentsView projectId={project.id} readOnly /> }] : []),
    ...(showStatus || showOverallStatus ? [{ id: "status", label: "Overall Status", render: () => <ProjectStageView projectId={project.id} /> }] : []),
    ...(showActivity ? [
      // Everything that has happened to it, enquiry to feedback, newest first.
      { id: "activity", label: "Activity", render: () => <ProjectActivityTab load={loadActivity} /> },
    ] : []),
  ] : []), [projectManagement, showPayments, showStatus, showOverallStatus, showActivity, project, loadActivity]);

  if (!project) return null;

  return <RecordViewPanel
    title={projectHeading(project)}
    titleAddon={<ProjectHoldBadge status={project.projectStatus} holds={project.holds} paymentsDue={project.paymentsDue} />}
    description={project.eventId || undefined}
    entity={{ ...projectForInfo(project), ...(projectManagement ? { startProjectStatus: "Not started" } : {}) }}
    sections={sections}
    extraTabs={extraTabs}
    initialTab={initialTab}
    detailsLabel="Identification"
    formatters={projectInfoFormatters}
    sidebarAriaLabel="Project sections"
    // Named only where this opens on top of something - CRM's Converted History opens it from
    // inside the lead popup. Left alone it takes the record view's own layer.
    zIndexClassName={zIndexClassName}
    onClose={onClose}
  />;
}

export default function ProjectDataTable({
  openEventId = "",
  // Which of the four boards this table *is*, so the row menu offers the other three.
  board = "projects",
  // The project a "Navigate to" named, by Event ID, and the page's way of hearing it has landed.
  revealEventId = "",
  onRevealed,
  onCloseOpenedEvent, projects, loading, lastUpdated, title, fileName, emptyMessage, noMatchMessage, loadingMessage, onNotice, onEditSaleDetails, onStartProject, onEditProject, onEditShoot, onUpdateStatus, onSendBack, onDelete, onDuplicate, onAssignProduction, canEditSale, canPlan, canEditStarted, canEditProject, canDeleteProject, infoPanelTitle = "Sales Details", projectManagement = false, showShoots, showOverallStatus = false, showPayments = false, showStatus = false, showActivity = showStatus, readOnly = false, fillAvailableHeight = false, tableVariant, density, onToggleCompact,
  /*
   * Passed straight through to the shared table, which owns the Import item and its dialog.
   *
   * This component draws its own columns and its own row actions but the table underneath is the
   * shared one, so forwarding is all that is needed - and forgetting to forward is why Projects had
   * the ⋮ menu that every other table has and no Import inside it.
   */
  importConfig,
  /*
   * The tick boxes, forwarded the same way and for the same reason.
   *
   * Which rows are ticked, and what happens to them, belongs to the page: it is the page that
   * reloads after a bulk delete and the page that holds the permission. This component draws what
   * it is handed and holds nothing of its own - and is handed nothing at all by a role without
   * `ADMIN / Table Select All`, so the column is simply absent.
   */
  selection }) {
  const [selectedProject, setSelectedProject] = useState(null);
  // Double-click reads the project in full. Starting or editing one is the row menu's own entry —
  // this table used to open that edit flow straight from the double-click, which put a live form on
  // screen for a gesture people make while trying to select a row.
  const [viewingProject, setViewingProject] = useState(null);
  // The tab the record opens on: its Activity for the row menu's "View activity", else its details.
  const [viewingTab, setViewingTab] = useState(null);
  const viewActivity = useCallback((project) => { setViewingTab("activity"); setViewingProject(project); }, []);
  const viewDetails = useCallback((project) => { setViewingTab(null); setViewingProject(project); }, []);

  /*
   * A project named from outside this table - the calendar links a shoot or a main event straight
   * to the project it belongs to, and landing on the list with nothing open would be half a link.
   *
   * Matched on the Event ID rather than the row id, because that is the identifier the rest of the
   * application quotes: it is what the calendar chip shows and what a person reads off a shoot. The
   * effect waits for the rows, so a link followed before they load still opens once they arrive,
   * and it fires only when the id changes - reopening what somebody has just closed would make the
   * panel impossible to dismiss.
   */
  const openedRef = useRef("");
  useEffect(() => {
    if (!openEventId || openedRef.current === openEventId) return;
    const match = projects.find((project) => project.eventId === openEventId);
    if (!match) return;
    openedRef.current = openEventId;
    // Deferred a tick rather than set from the effect body, the way every other opening in this
    // codebase is: state set synchronously inside an effect is the cascading render React warns
    // about, and a panel opening one frame later is not something anybody can see.
    const timer = window.setTimeout(() => setViewingProject(match), 0);
    return () => window.clearTimeout(timer);
  }, [openEventId, projects]);
  /*
   * A project the page was linked to - a "Navigate to" from another board - **filters the board to
   * it**: the Event ID column takes its id, so the project is the row on screen and the filter box
   * says why. Nothing is opened: arriving answers "here it is, on this board", and a panel would
   * answer a question nobody asked.
   *
   * The event id arrives as a prop rather than being read from the address here, because the page
   * owns the tabs: a project on a tab the board is not showing is not in `projects` at all, so the
   * page comes to All first (`useLinkedProject`).
   */
  const [landedOn, setLandedOn] = useState("");
  useEffect(() => {
    if (!revealEventId || landedOn === revealEventId) return undefined;
    const timer = window.setTimeout(() => { setLandedOn(revealEventId); onRevealed?.(); }, 0);
    return () => window.clearTimeout(timer);
  }, [landedOn, onRevealed, revealEventId]);

  const [infoPanelState, setInfoPanelState] = useState("collapsed");
  const [tableStats, setTableStats] = useState({ total: projects.length });
  const tableColumns = tableVariant === "production" ? productionProjectColumns : projectManagement ? projectManagementColumns : salesProjectColumns;
  const updatedText = lastUpdated ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(lastUpdated) : "—";

  // A shoot row stands for its project wherever a project is asked for: the Info panel, the record.
  const parentOf = useCallback((row) => (isShootRow(row) ? projects.find((project) => project.id === row.projectId) || null : row), [projects]);
  const selectSharedProject = (row) => { const project = parentOf(row); if (!project) return; setSelectedProject(project); setInfoPanelState("expanded"); };
  // Shoots under each project on Projects (Project Management) and on Bookings & Converted
  // (`showShoots`), not on the production assignment view; ticks stay on the projects.
  const showsShoots = (showShoots ?? projectManagement) && tableVariant !== "production";
  // Where a "Navigate to" entry goes. `push`, not `replace`: the board you came from stays in the
  // history, so Back is the way home.
  const router = useRouter();
  const jumpTo = useCallback((href) => router.push(href), [router]);
  const sharedColumns = useMemo(() => tableColumns.map((column) => ({
    ...column, header: showsShoots && column.shootLabel ? column.shootLabel : column.label,
    accessorFn: (project) => displayValue(project, column.id),
    sortingFn: (first, second) => { const a = sortValue(first.original, column); const b = sortValue(second.original, column); return typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true }); },
    cell: column.id === "actions" ? ({ row }) => isShootRow(row.original) ? <ShootRowActions shoot={row.original} project={parentOf(row.original)} onOpenProject={setViewingProject} onEditShoot={onEditShoot} route={projectEditRoute(parentOf(row.original), { readOnly, canEditSale, canPlan, canEditStarted, canEditProject, onEditSaleDetails, onStartProject, onEditProject })} /> : <ProjectRowActions project={row.original} onView={viewDetails} onViewActivity={showActivity ? viewActivity : undefined} onNotice={onNotice} onEditSaleDetails={onEditSaleDetails} onStartProject={onStartProject} onEditProject={onEditProject} onUpdateStatus={onUpdateStatus} onSendBack={onSendBack} onDelete={onDelete} onDuplicate={onDuplicate} onAssignProduction={onAssignProduction} board={board} onJump={jumpTo} readOnly={readOnly} canEditSale={canEditSale} canPlan={canPlan} canEditStarted={canEditStarted} canEditProject={canEditProject} canDeleteProject={canDeleteProject} /> : ({ row }) => displayValue(row.original, column.id),
    exportValue: (project) => displayValue(project, column.id), width: column.id === "actions" ? 56 : 180, minWidth: column.id === "actions" ? 56 : 160,
    // Every column here is 180px wide, so a long value - a shoot named for several at once - ends
    // in "..."; this is what it says in full when it is hovered or read out.
    title: (project) => displayValue(project, column.id),
  })), [canDeleteProject, canEditProject, canEditSale, canEditStarted, canPlan, showActivity, viewActivity, viewDetails, onAssignProduction, onDelete, onDuplicate, onEditProject, onEditSaleDetails, onEditShoot, onNotice, onSendBack, onStartProject, onUpdateStatus, readOnly, tableColumns, showsShoots, parentOf, board, jumpTo]);

  const tableSelection = useMemo(() => (selection ? { ...selection, canSelectRow: (row) => !isShootRow(row) && (!selection.canSelectRow || selection.canSelectRow(row)) } : selection), [selection]);
  const infoSections = tableVariant === "production" ? productionProjectInfoSections : projectManagement ? projectManagementInfoSections : commonProjectInfoSections;


  return <DataTableShell className={fillAvailableHeight ? "h-full min-h-0" : "h-[calc(100dvh-14rem)] min-h-[21rem]"} footer={<TableFooter spread><span>Last updated: {updatedText}</span><span>Total rows: {tableStats.total}</span></TableFooter>}><div className="relative flex min-h-0 flex-1 overflow-hidden"><DataTable columns={sharedColumns} data={projects} importConfig={importConfig} density={density} onToggleCompact={onToggleCompact} loading={loading} loadingMessage={loadingMessage} emptyMessage={emptyMessage} noMatchMessage={noMatchMessage} selectedRowId={selectedProject?.id} filterPreset={landedOn ? { id: "eventId", value: landedOn } : undefined} onRowClick={selectSharedProject} onRowDoubleClick={(row) => setViewingProject(parentOf(row))} defaultColumnVisibility={defaultColumnVisibility} onVisibleRowsChange={setTableStats} ariaLabel={`${title} table`} features={{ filtering: true, sorting: true, columnVisibility: true, infiniteScroll: { pageSize: 50 }, csvExport: { enabled: true, fileName, onResult: (exported) => onNotice(exported ? `${title} CSV export downloaded.` : "No rows available to export.") }, selection: tableSelection, ...(showsShoots ? { expandable: { label: "this project's shoots", canExpand: (row) => !isShootRow(row) && row.shoots?.length > 0, getSubRows: (row) => (isShootRow(row) ? undefined : row.shoots) } } : {}) }} /><DataTableInfoPanel title={infoPanelTitle} entity={selectedProject && { ...projectForInfo(selectedProject), ...(projectManagement ? { startProjectStatus: "Not started" } : {}) }} state={infoPanelState} onToggle={() => setInfoPanelState((current) => current === "expanded" ? "collapsed" : "expanded")} sections={infoSections} formatters={projectInfoFormatters} emptyText="Select a project row to view details." /></div><ProjectRecordPanel project={viewingProject} sections={infoSections} projectManagement={projectManagement} showPayments={showPayments} showStatus={showStatus} showOverallStatus={showOverallStatus} showActivity={showActivity} initialTab={viewingTab} onClose={() => { setViewingProject(null); setViewingTab(null); onCloseOpenedEvent?.(); }} /></DataTableShell>;
}
