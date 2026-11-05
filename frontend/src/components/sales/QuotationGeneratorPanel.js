"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import SchemaFormSection from "@/components/schema-form/SchemaFormSection";
import ComboBoxField from "@/components/shared/ComboBoxField";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import useFormErrors from "@/components/shared/useFormErrors";
import Dropdown from "@/components/shared/Dropdown";
import RadioGroupField from "@/components/shared/RadioGroupField";
import MultiSelectField from "@/components/shared/MultiSelectField";
import SharedTextField from "@/components/shared/TextField";
import HelpTip from "@/components/shared/HelpTip";
import TextAreaField from "@/components/shared/TextAreaField";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ReadOnlyFieldset from "@/components/shared/ReadOnlyFieldset";
import AddShootDialog, { shootTimingsOf, shootTypesOf } from "@/components/project-management/AddShootDialog";
import ProjectServiceCreationSection from "@/components/project-management/ProjectServiceCreationSection";
import { getProjectDeliverableDefinitions, getProjectServiceDefinitions } from "@/services/project-management/project-workflow.service";
import { getCrmLead } from "@/services/sales/crm-leads.service";
import { getCrmLeadEnquiryIds } from "@/services/sales/crm-lead-ids.service";
import { getQuotationSettings } from "@/services/sales/quotation-settings.service";
import { getQuotationShareCandidates, saveQuotationShares } from "@/services/sales/projects.service";
import { getQuotationBrandConfiguration, getQuotationBrands } from "@/services/sales/quotation-brands.service";
import { autoDeliverableNamesForServices, blockedDeliverableNamesForServices, deliverableExistsForShoot, findDeliverableDefinitionByName } from "@/components/project-management/serviceDeliverableRules";
import Button from "@/components/shared/Button";
import IconButton from "@/components/shared/IconButton";
import Add from "@mui/icons-material/Add";
import Close from "@mui/icons-material/Close";
import VisibilityOutlined from "@mui/icons-material/VisibilityOutlined";
import { AUTO_SYNC_DELAY_MS, PREVIEW_MESSAGE_TYPES, acceptedPreviewMessage, newPreviewSession, previewMessage, previewWindowName, quotationPreviewPath, stashQuotationPreview } from "@/lib/quotationPreview.mjs";
import { stashEditingDraft } from "@/lib/quotationEditingDraft.mjs";
import {
  QUOTATION_BRANDS,
  brandCodeForVertical,
  brandDeliverableDefinitions,
  brandFieldsForDeliverableRow,
  brandFieldsForServiceRow,
  brandServiceDefinitions,
  deliverableUnitPrice,
  extraDiscountsOf,
  MAX_EXTRA_DISCOUNTS,
  packageRowsForShoot,
  quotationTotals,
  selectionsLostOnBrandSwitch,
  serviceUnitPrice,
  withSavedUnitPrices,
  verticalForBrand,
} from "@/lib/quotationBrand.mjs";
import QuotationVerticalFields from "./QuotationVerticalFields";
import { identificationFromLead } from "./quotationEnquiryPrefill";
import { DEFAULT_VERTICAL, emptyVerticalValues, phoneFieldsFor, requiredFieldsFor, verticalFieldRows } from "./quotationVerticalConfig";
import { markedFieldsMessage, onlyErrors } from "@/lib/formErrors.mjs";
import { isCompletePhoneNumber } from "@/lib/phoneNumber";
import useLeadSuggestionLists from "@/components/sales/useLeadSuggestionLists";
import { defaultSessionOptionId, serviceDeliverables } from "@/lib/servicePricing.mjs";
import { deliverableRowLabel, deliverableVariantLabel } from "@/lib/deliverableBrands.mjs";
import { settingsNoteOf } from "@/lib/deliverableAnswers.mjs";
import { copyShootLines, numberQuoteShoots, reorderLines } from "@/lib/quotationLineOrder.mjs";
import { deliverablePriceForRow } from "@/lib/deliverablePricing.mjs";
import { unpricedDeliverableNote, unpricedServiceNote } from "@/lib/quotationLinePricing.mjs";
import { DISCOUNT_SOURCES, MAX_DISCOUNT_PERCENT, savedDiscountOf, shownPercentage } from "@/lib/quotationDiscount.mjs";
import { shootDisplayName } from "@/lib/shootDisplay.mjs";
import { isDraftQuotation, isFinalizedQuotation, quotationVersionStatus, versionLabel } from "./quotationLinkStatus";
import StatusBadge from "@/components/shared/StatusBadge";

const sections = [["identification", "Identification"], ["service-creation", "Service Creation"]];
// A figure as a number, or null where there is none - the API sends a Decimal as a string ("1200.00").
const finite = (value) => (value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value));
// A service's one price in Settings, where it has one - quoted on every shoot.
const flatPriceOf = (definition) => finite(definition?.price);
/*
 * What a quotation asks that a CRM lead does not.
 *
 * The vertical rows above these cover who the client is; these four cover the job being quoted
 * for, and they keep their own columns in the quotation table, so they stay whichever vertical
 * is chosen.
 */
const quotationOnlyFields = [
  ["eventVenue", "Event Venue", "text", "Where the event takes place; printed on the client's copy."],
  ["followedBy", "Followed By", "text", "Who is following up this client; printed on the client's copy."],
  ["referredBy", "Reffered By", "text", "Who referred the client; printed on the client's copy."],
  ["secondaryContactNumber", "Secondary Contact Number", "text", "Another number to reach the client on, digits only, up to 10."],
];

const byId = (items) => new Map((items || []).map((item) => [item.id, item]));
const byName = (items) => new Map((items || []).map((item) => [item.name?.toLocaleLowerCase(), item]).filter(([name]) => name));
const groupRowsByShoot = (items) => (items || []).reduce((result, item) => ({ ...result, [item.shootId]: [...(result[item.shootId] || []), item] }), {});
const phoneDigits = (value) => String(value || "").replace(/\D/g, "").slice(0, 10);

function normalizeService(row, definitions = []) {
  const definition = row.serviceDefinition || byId(definitions).get(row.serviceDefinitionId) || byName(definitions).get(row.serviceName?.toLocaleLowerCase());
  return {
    ...row,
    serviceDefinitionId: row.serviceDefinitionId || definition?.id || "",
    serviceDefinition: definition || null,
    /*
     * Complimentary is two different things wearing one word, and they must not be confused.
     *
     * The master's answer is a *permission*: whether this may be given away at all. The line's is
     * the *choice* made on this quotation. So the master decides whether the question is asked -
     * `complimentaryAllowed` - and the answer always starts at No, whatever the master says. A
     * service allowed to be complimentary is not thereby complimentary; somebody has to say so,
     * on this quotation, and only for this quotation.
     *
     * The permission is read from the definition the line carries - the master as it stands for a
     * line being added, and the definition frozen onto the line for a quotation being reopened, so
     * an old quotation is judged by the permissions it was raised under. The *answer* is only ever
     * taken from the line, so a quotation saved with a Yes keeps it, and a line being edited keeps
     * whatever was chosen a moment ago.
     */
    complimentaryAllowed: definition?.complimentary === true,
    complimentary: row.complimentary === true,
    serviceName: row.serviceName || definition?.name || "",
    quantity: row.quantity ?? 1,
    quantitySessionTiming: row.quantitySessionTiming || "",
    sessionOptionId: row.sessionOptionId || "",
    sessionOption: row.sessionOption || null,
    durationHours: row.durationHours ?? "",
    durationMinutes: row.durationMinutes ?? "",
    workDays: row.workDays ?? "",
    timingMinutes: row.timingMinutes ?? "",
    sizeOptionValueId: row.sizeOptionValueId || "",
    sizeOptionValue: row.sizeOptionValue || null,
    remarks: row.remarks || "",
  };
}

function normalizeDeliverable(row, definitions = []) {
  const definition = row.deliverableDefinition || byId(definitions).get(row.deliverableDefinitionId) || byName(definitions).get(row.deliverableName?.toLocaleLowerCase());
  return {
    ...row,
    deliverableDefinitionId: row.deliverableDefinitionId || definition?.id || "",
    deliverableDefinition: definition || null,
    // The deliverable's own permission and the line's own answer - see `normalizeService`. Never
    // the service's, even where a service brought this line in.
    complimentaryAllowed: definition?.complimentary === true,
    complimentary: row.complimentary === true,
    deliverableName: row.deliverableName || definition?.name || "",
    quantity: row.quantity || 1,
    numberOfPhotos: row.numberOfPhotos ?? "",
    sizeOptionValueId: row.sizeOptionValueId || "",
    sizeOptionValue: row.sizeOptionValue || null,
    size: row.size || "",
    remarks: row.remarks || "",
  };
}

/*
 * The extra discounts a quotation opens with, as the editor's rows - read by `extraDiscountsOf`,
 * the same reading the client's copy prints from, so an older quotation's single extra discount
 * opens as the first of the list here and prints there alike.
 */
function savedExtraDiscounts(payload) {
  return extraDiscountsOf(payload).map((entry, index) => ({ id: `saved-${index}`, reason: entry.reason, amount: entry.amount > 0 ? String(entry.amount) : "" }));
}

function currency(value) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
}

/*
 * `versions` is every version already raised for this enquiry, and `selectedVersionId` is the one
 * loaded into the form. Picking another reloads the form from it — the panel is remounted around
 * the version that comes back, so every field below is initialised from that version's payload
 * rather than patched on top of the last one's.
 */
/*
 * `initialDraft` is a quotation started somewhere else - the CRM's Quotation Calculator - in the
 * payload's own shape: its shoots, services and deliverables as this panel's rows, its discount,
 * the enquiry it was for. The panel opens on it exactly as it opens on a saved payload, and then
 * treats it as a *new* quotation: nothing is locked, the brand may still change, Generate raises
 * version one. Only `initialQuotation` means editing.
 *
 * `duplicateOf` is the version a Duplicate was opened from, and it arrives beside its payload passed
 * as `initialDraft`: a duplicate is a *new* quotation, so it opens exactly as a draft does - brand
 * free, saving raises version one of a new number - and the source is never written to. What it
 * adds is that the copy keeps the source's pricing (its rates, GST and discount) rather than taking
 * today's, until the brand is changed; and the header and the button say it is a duplicate.
 *
 * `saving` is the page's save in flight, which holds the button shut so one press is one quotation.
 * `savingDraft` says that save is a Save Draft, so the spinner is on the button that was pressed.
 *
 * `onSaveDraft` is Save Draft, offered on a new quotation (blank, from the calculator, or a
 * duplicate) and on a draft - an `initialQuotation` whose status is Draft. A draft opens like an
 * edit, locked to the brand its number was drawn under, but Generate Quotation issues *it* rather
 * than raising a version over it. A generated quotation is never drafted: an edit of one raises the
 * next version straight away, as it always has.
 *
 * `onFinalize(payload)` and `onUnfinalize()` are Finalize Quotation and Unfinalize, offered on a
 * generated version being edited (a writer's only - the page leaves them out otherwise).
 * `finalizing` is the one in flight, `"finalize"` or `"unfinalize"`. Finalize sends what is on
 * screen, and the server refuses it when that is not what is saved. While any version of the
 * quotation is finalized the form only reads: nothing is raised until it is unfinalized.
 */
export default function QuotationGeneratorPanel({ editingDraftScope = null, initialQuotation = null, initialDraft = null, duplicateOf = null, saving = false, savingDraft = false, finalizing = "", versions = [], selectedVersionId = "", onSelectVersion, onClose, onGenerate, onSaveDraft, onFinalize, onUnfinalize }) {
  /*
   * The studio's own lists, read here as well as inside `QuotationVerticalFields` which draws them.
   *
   * The panel needs them for a different reason: a closed dropdown the studio has not filled in yet
   * must not be demanded before the quotation can be generated, and only the loaded list can say
   * whether there was anything to choose. The hook caches nothing, so this is a second small
   * request on open — cheaper than lifting the lists through props for one boolean.
   */
  const initialPayload = initialQuotation?.payload || initialDraft || {};
  /*
   * Set once, at the first version of a chain, and never again after. A later version raised
   * against a different vertical would be a different negotiation wearing the same quotation
   * number - the enquiry it prices, its shoots and its services all belong to the vertical chosen
   * here, so changing it mid-chain would leave those answers describing a job that no longer
   * matches what the quotation says it is for.
   */
  const verticalLocked = Boolean(initialQuotation);
  const isDraft = isDraftQuotation(initialQuotation);
  const canSaveDraft = Boolean(onSaveDraft) && (!initialQuotation || isDraft);
  /*
   * Each version is FINALIZED or UNFINALIZED, on its own. The finalized one is kept exactly as it is,
   * its link never expires, and it reads only here: it offers Unfinalize and nothing else. Every
   * unfinalized version edits - whichever is open, the newest or an older one - and saving raises
   * the next version. At most one version of a quotation is finalized: while another one is, Finalize
   * is shown disabled saying which, and the server refuses it either way. Nothing here ever
   * unfinalizes a version by itself.
   */
  const isFinalized = isFinalizedQuotation(initialQuotation);
  const otherFinalized = versions.find((version) => version.id !== initialQuotation?.id && isFinalizedQuotation(version)) || null;
  const locked = isFinalized;
  const canFinalize = Boolean(onFinalize) && Boolean(initialQuotation?.id) && !isDraft && !isFinalized;
  const canUnfinalize = Boolean(onUnfinalize) && isFinalized;
  const lockedReason = locked ? "This version is finalized. Unfinalize it before editing it or creating a new version from it." : undefined;
  const finalizeBlocked = otherFinalized ? `Another quotation version (${otherFinalized.quotationId}) is already finalized. Please unfinalize that version before finalizing this one.` : "";
  // Which confirmation is open: "finalize", "unfinalize", or none.
  const [confirmingFinalization, setConfirmingFinalization] = useState("");
  const [vertical, setVertical] = useState(initialPayload.vertical || verticalForBrand((initialQuotation || duplicateOf)?.quotationBrand) || DEFAULT_VERTICAL);
  /*
   * Who this quotation is shared with: colleagues who may then read and edit it, and every version
   * of it, although their own scope does not reach it. It belongs to the **chain**, so it is the
   * same list whichever version is open, and a duplicate starts with nobody - it is another
   * quotation for another enquiry, not this one under a new number.
   */
  // Known for a new quotation and for one opened from the register or read back by id, which is
  // every way in. A save that does not know them leaves them alone rather than clearing them.
  const sharesKnown = !initialQuotation || Array.isArray(initialQuotation.sharedWith);
  /*
   * Who it is shared with is the quotation's **own** people's to set: somebody it was shared with
   * reads the list and edits the quotation, and cannot drop the colleagues already on it or pass
   * the chain on. Shown read-only rather than hidden, so they can see who else is working on it.
   */
  const canShare = !initialQuotation || initialQuotation.canShare !== false;
  const [sharedWith, setSharedWith] = useState(() => (initialQuotation?.sharedWith || []).map((person) => String(person.employeeId)));
  const [sharing, setSharing] = useState(false);
  const [shareCandidates, setShareCandidates] = useState([]);
  useEffect(() => {
    let live = true;
    getQuotationShareCandidates()
      .then((response) => { if (live) setShareCandidates(response?.data || []); })
      // A list that will not load leaves the picker empty rather than the panel broken: the
      // quotation itself is what this form is for.
      .catch(() => { if (live) setShareCandidates([]); });
    return () => { live = false; };
  }, []);
  /*
   * Only the people a share would actually reach: the server sends the working employees whose
   * roles open Quotations and leaves the rest out. A share widens *which* quotations somebody sees
   * and cannot put them on the screen, so offering the others was offering a choice that does
   * nothing - it listed them marked "no access to Quotations" and let them be picked anyway.
   */
  const shareOptions = useMemo(() => shareCandidates.map((person) => ({
    value: String(person.id),
    label: person.employeeName,
  })), [shareCandidates]);
  // After the vertical, because Category is that vertical's own list - see the comment above.
  const suggestionLists = useLeadSuggestionLists({ vertical });
  /*
   * The brand, which is the vertical under its other name.
   *
   * `payload.vertical` ("Dum Dum") is what every quotation has always stored and what the counter
   * and the quotation name read; the brand code ("DUM_DUM") is what the brand tables and the
   * register's column are keyed by. The selector below moves the vertical, and the brand follows.
   */
  const brandCode = brandCodeForVertical(vertical) || "DUM_DUM";
  /*
   * Whether this form prices with the rates it was opened on rather than today's: always for an
   * edit, and for a duplicate while it is still under the source's brand. A duplicate moved to
   * another brand takes that brand's GST; its discount stays, as a typed one does on a new quotation.
   */
  const [openedBrandCode] = useState(brandCode);
  const keepsSourcePricing = Boolean(duplicateOf) && brandCode === openedBrandCode;
  /*
   * The three brands as the selector offers them, read once from the server so a brand switched
   * off in Settings stops being offered - and answered from the built-in list until that read
   * lands, or if it fails, so the selector is never empty.
   */
  const [brandOptions, setBrandOptions] = useState(() => QUOTATION_BRANDS.map((brand) => ({ value: brand.vertical, label: brand.label })));
  /*
   * What the chosen brand offers: its services, deliverables, packages, event types and rates.
   * Loaded when the brand changes - cached by the service, so switching back costs nothing - and
   * `null` until then or when the read fails, in which case the generator falls back to the
   * project catalogue and prices with the studio's rates, exactly as it did before brands.
   */
  const [brandConfig, setBrandConfig] = useState(null);
  const [brandConfigError, setBrandConfigError] = useState("");
  /*
   * A brand the user has picked but not yet confirmed, with what confirming would remove: the
   * client details (a groom's name means nothing on a corporate quotation) and the lines chosen
   * off the old brand's own list. The radio does not move until the warning has been answered -
   * otherwise the dial would show the new brand while the fields below still held the old one's.
   */
  const [pendingVertical, setPendingVertical] = useState(null);
  // The packages applied so far, one entry per application, recorded on the payload for the
  // snapshot. The rows they added are ordinary rows; this only says where they came from.
  const [appliedPackages, setAppliedPackages] = useState(() => Array.isArray(initialPayload.packages) ? initialPayload.packages : []);
  const [packageShootId, setPackageShootId] = useState("");
  const [packageId, setPackageId] = useState("");
  const [enquiryIdOptions, setEnquiryIdOptions] = useState([]);
  const [prefillingEnquiry, setPrefillingEnquiry] = useState(false);
  /*
   * The enquiry whose Client Details have already been read in, so they are read in once.
   *
   * Without it, every later keystroke and re-render would re-apply the lead and undo whatever
   * had been corrected by hand since - a number fixed on the quotation would spring back to the
   * one the CRM holds. Picking a *different* enquiry is a different id, so that still applies.
   */
  const prefilledEnquiryRef = useRef("");
  const { notice, showError, showUndo, clearNotice } = useNotice();
  // A refused save marks each box it is about; the toast says only how many.
  const fields = useFormErrors();
  /*
   * Sharing saves itself, and never raises a version.
   *
   * A version is the document the client receives - "this replaces what I sent you". Who at the
   * studio can open it is not part of that, so on a quotation that already exists the picker writes
   * straight through rather than waiting for Save changes, which would raise a version for it. A
   * new quotation has no chain to write to yet, so there the list rides along with the first save.
   */
  const savesShareItself = Boolean(initialQuotation?.id) && !isDraft;
  async function chooseShared(next) {
    const previous = sharedWith;
    setSharedWith(next);
    if (!savesShareItself) return;
    setSharing(true);
    try {
      await saveQuotationShares(initialQuotation.id, next.map(Number).filter(Boolean));
    } catch (error) {
      // Put back what is actually saved: a list on screen that the server refused is a lie about
      // who can see the quotation.
      setSharedWith(previous);
      showError(error.message || "Unable to save who this quotation is shared with.");
    } finally {
      setSharing(false);
    }
  }
  const [identification, setIdentification] = useState(() => ({
    // Every vertical key present, holding whatever the saved payload has for it. A key the
    // payload never had reads as "" rather than undefined, so its input stays controlled.
    ...Object.fromEntries(Object.keys(emptyVerticalValues()).map((key) => [key, initialPayload[key] || ""])),
    enquiryId: initialPayload.enquiryId || initialQuotation?.enquiryId || "",
    /*
     * A quotation raised before this screen existed has a client name and a source branch but no
     * Enquire Name or Assigned Branch, because those fields did not exist yet. Reading the old
     * keys as a fallback means reopening one of those quotations shows what was typed rather
     * than an empty form.
     */
    name: initialPayload.name || initialPayload.clientName || initialQuotation?.clientName || "",
    contactNumber: initialPayload.contactNumber || initialPayload.clientMainNumber || initialQuotation?.clientMainNumber || "",
    assignedBranch: initialPayload.assignedBranch || initialPayload.nearestBranch || initialPayload.sourceBranch || initialQuotation?.sourceBranch || "",
    eventVenue: initialPayload.eventVenue || initialQuotation?.eventVenue || "",
    followedBy: initialPayload.followedBy || initialQuotation?.followedBy || "",
    referredBy: initialPayload.referredBy || initialQuotation?.referredBy || "",
    secondaryContactNumber: initialPayload.secondaryContactNumber || initialQuotation?.secondaryContactNumber || "",
    /*
     * Read from the row as well as the payload, because a version raised before the column existed
     * has neither and one raised through an older client may have only the payload. Kept out of
     * `emptyVerticalValues()` deliberately: a note is about the job being quoted for, not about the
     * client, so switching vertical clears the client details and leaves the note alone.
     */
    additionalNotes: initialPayload.additionalNotes || initialQuotation?.additionalNotes || "",
  }));
  const [shoots, setShoots] = useState(() => Array.isArray(initialPayload.shoots) ? initialPayload.shoots : []);
  /*
   * The lines a saved quotation, a draft or a duplicate opened on, each carrying the price it was
   * charged at - a line saved before unpriced lines came to ₹0 is stamped with what it was charged
   * then (`withSavedUnitPrices`), so the quotation reads exactly as it was saved.
   */
  const [savedRows] = useState(() => ({
    services: withSavedUnitPrices(initialPayload.services, initialPayload.rates, "service"),
    deliverables: withSavedUnitPrices(initialPayload.deliverables, initialPayload.rates, "deliverable"),
  }));
  const [services, setServices] = useState(savedRows.services);
  const [deliverables, setDeliverables] = useState(savedRows.deliverables);
  const [serviceDefinitions, setServiceDefinitions] = useState([]);
  const [deliverableDefinitions, setDeliverableDefinitions] = useState([]);
  const [loadingMasterData, setLoadingMasterData] = useState(true);
  const [serviceDefinitionsError, setServiceDefinitionsError] = useState("");
  const [deliverableDefinitionsError, setDeliverableDefinitionsError] = useState("");
  const [shootDialogOpen, setShootDialogOpen] = useState(false);
  const [editingShoot, setEditingShoot] = useState(null);
  // The shoot a Duplicate copies, while its dialog is open; Save adds the copy as a new shoot.
  const [copyingShoot, setCopyingShoot] = useState(null);
  /*
   * The discount: a saved quotation's own, a draft's (what somebody chose on the calculator, or the
   * source's on a duplicate), and 0 on a new quotation - never the Default Discount in Settings,
   * which the studio asked not to pre-fill a quotation.
   *
   * The percentage and the rupees are both typed into; `discountSource` is whichever was typed last
   * and `discount` what was typed there, and the other box is worked out from it. A quotation saved
   * before rupees could be typed opens as the percentage it was saved with, read from where it
   * always was (`savedDiscountOf`).
   */
  const draftDiscount = initialDraft && Number.isFinite(Number(initialDraft.discount)) ? Number(initialDraft.discount) : null;
  // An edit reopens on the percentage exactly as it was saved in the payload; the quotation's own
  // `discount` column holds it to two places, so 12.345% came back as 12.35% and the total moved.
  // A payload from before the figure was kept there falls back to the column, as it always did.
  const [initialDiscount] = useState(() => savedDiscountOf(initialPayload, initialQuotation ? finite(initialPayload.discount) ?? Number(initialQuotation.discount || 0) : draftDiscount ?? 0));
  const [discountSource, setDiscountSource] = useState(initialDiscount.discountSource);
  const [discount, setDiscount] = useState(() => String(initialDiscount.discountValue));
  /*
   * The Performance Cost - a rupee amount added to the service cost before any discount - and the
   * extra discounts, up to three rupee amounts with a reason each, taken off after the percentage.
   * Never percentages. Both closed until their "+" is pressed, and opened already on a quotation
   * saved with them. Held in the payload beside the discount, so a version, an edit and a duplicate
   * carry them the way they carry everything else there.
   */
  const savedPerformance = Number(initialPayload.performanceCost);
  const [performanceOpen, setPerformanceOpen] = useState(() => savedPerformance > 0);
  const [performanceCost, setPerformanceCost] = useState(() => (savedPerformance > 0 ? String(savedPerformance) : ""));
  const [extraDiscounts, setExtraDiscounts] = useState(() => savedExtraDiscounts(initialPayload));
  // The Round Off Discount: one rupee figure taken off last, to bring the total to a round number.
  // Kept in the payload like the rest; a quotation saved before it existed has none, which is nothing.
  const [roundOffDiscount, setRoundOffDiscount] = useState(() => (Number(initialPayload.roundOffDiscount) > 0 ? String(Number(initialPayload.roundOffDiscount)) : ""));
  const extraDiscountIds = useRef(0);
  /*
   * Editing an existing quotation keeps the rates it was built with, so reopening one cannot
   * silently reprice work already quoted for. Only a new quotation takes the studio's current
   * settings.
   */
  /*
   * The rates a quotation is priced with: the studio's Quotation settings, fetched when the panel
   * opens, and the GST the brand or the studio configures. Nothing stands in for them - there is no
   * assumed ₹2,000, ₹1,000 or 18%. A line is priced by what Settings configures for it (see
   * `serviceUnitPrice`); a quotation already raised keeps the rates it was raised with.
   */
  const [rates, setRates] = useState(() => ({ ...(initialPayload.rates || {}) }));
  /*
   * The GST a new quotation is priced at: the brand's own rate where the brand sets one, the
   * studio's otherwise - a brand left blank means "use the studio settings". The studio rates and
   * the brand's configuration are fetched side by side, and whichever answered last used to decide,
   * so a brand's GST was overwritten whenever the studio settings arrived second. Both now write
   * their answer here and the rate is read off the two together, whatever order they arrive in.
   */
  // Seeded with the rate the panel opened on, so a brand without one never keeps another brand's.
  const studioGstRef = useRef(finite(initialPayload.rates?.gstPercent));
  const brandGstRef = useRef(null);
  const quotedGst = (current) => brandGstRef.current ?? studioGstRef.current ?? current.gstPercent;
  const serviceRowsRef = useRef(savedRows.services);
  const deliverableRowsRef = useRef(savedRows.deliverables);

  useEffect(() => {
    let active = true;
    async function loadMasterData() {
      setLoadingMasterData(true);
      setServiceDefinitionsError("");
      setDeliverableDefinitionsError("");
      const [serviceResult, deliverableResult] = await Promise.allSettled([getProjectServiceDefinitions(), getProjectDeliverableDefinitions()]);
      if (!active) return;
      if (serviceResult.status === "fulfilled") setServiceDefinitions(Array.isArray(serviceResult.value?.data) ? serviceResult.value.data : []);
      else setServiceDefinitionsError(serviceResult.reason?.message || "Unable to load services.");
      if (deliverableResult.status === "fulfilled") setDeliverableDefinitions(Array.isArray(deliverableResult.value?.data) ? deliverableResult.value.data : []);
      else setDeliverableDefinitionsError(deliverableResult.reason?.message || "Unable to load deliverables.");
      setLoadingMasterData(false);
    }
    void loadMasterData();
    return () => { active = false; };
  }, []);

  /*
   * The studio's current rates, for a new quotation only.
   *
   * An existing quotation already carries the rates it was priced with; refetching would reprice
   * it against today's settings the moment somebody opened it to correct a phone number. A failed
   * request leaves the rates empty: lines are still priced by what Settings configures for them, and
   * no GST is assumed - the server applies the brand's or the studio's when the version is saved.
   */
  useEffect(() => {
    // A duplicate carries its source's rates in the draft, and keeps them for the same reason.
    if (initialQuotation || duplicateOf) return undefined;
    let active = true;
    async function loadRates() {
      try {
        const response = await getQuotationSettings();
        if (!active || !response?.data) return;
        studioGstRef.current = finite(response.data.gstPercent);
        setRates((current) => {
          const next = { ...current, ...response.data };
          return { ...next, gstPercent: quotedGst(next) };
        });
      } catch {
        // Nothing is assumed in its place; lines are priced by their own settings.
      }
    }
    void loadRates();
    return () => { active = false; };
  }, [initialQuotation, duplicateOf]);

  useEffect(() => {
    let active = true;
    getQuotationBrands()
      .then((response) => {
        if (!active || !Array.isArray(response?.data) || !response.data.length) return;
        setBrandOptions(response.data.map((brand) => ({ value: brand.verticalName || verticalForBrand(brand.code), label: brand.name })));
      })
      .catch(() => { /* The built-in three stand. */ });
    return () => { active = false; };
  }, []);

  /*
   * The brand's own configuration, re-read whenever the brand changes.
   *
   * For a new quotation the brand's GST rate is taken into the rates the quotation will be priced
   * with, where the brand has set one (see `quotedGst`); its default discount is not applied - a new
   * quotation opens at no discount, as it always has. An existing quotation keeps the
   * rates it was raised under, for the same reason it keeps its studio rates - reopening it must
   * not reprice it. The services and deliverables offered are read off this on every render.
   */
  useEffect(() => {
    let active = true;
    getQuotationBrandConfiguration(brandCode)
      .then((response) => {
        if (!active) return;
        const config = response?.data || null;
        setBrandConfig(config);
        setBrandConfigError("");
        if (initialQuotation || !config?.brand) return;
        if (keepsSourcePricing) {
          // Back on the source's brand after trying another: its own GST, not the brand's today.
          const sourceGst = Number(initialPayload.rates?.gstPercent);
          if (Number.isFinite(sourceGst)) setRates((current) => ({ ...current, gstPercent: sourceGst }));
          return;
        }
        brandGstRef.current = finite(config.brand.gstPercent);
        setRates((current) => ({ ...current, gstPercent: quotedGst(current) }));
      })
      .catch((error) => {
        if (!active) return;
        setBrandConfig(null);
        setBrandConfigError(error?.message || "Unable to load this brand's services. The studio catalogue is offered instead.");
      });
    return () => { active = false; };
    // The source's GST is read once from the payload the panel opened on, which never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandCode, initialQuotation, keepsSourcePricing]);

  /*
   * What this brand offers the service and deliverable pickers.
   *
   * A brand with services of its own offers those - each carrying the project definition it points
   * at, so the table draws its timing and size columns as ever - and a brand that has configured
   * none offers the whole project catalogue, which is what every brand was offered before brands.
   */
  const offeredServices = useMemo(() => brandServiceDefinitions(brandConfig?.services, serviceDefinitions), [brandConfig, serviceDefinitions]);
  const offeredDeliverables = useMemo(() => brandDeliverableDefinitions(brandConfig?.deliverables, deliverableDefinitions), [brandConfig, deliverableDefinitions]);
  const offeredServiceDefinitions = offeredServices.definitions;
  const offeredDeliverableDefinitions = offeredDeliverables.definitions;
  const brandPackages = useMemo(() => (brandConfig?.packages || []).filter((pkg) => pkg?.isActive !== false && (pkg.items || []).length), [brandConfig]);

  /*
   * The CRM's enquiry IDs for the chosen vertical, offered as suggestions on the Enquire ID
   * field. Refetched when the vertical changes, because a Dum Dum quotation should not be
   * offered a Qua Qua lead's number. A failure leaves the list empty rather than raising: the
   * field still accepts a typed id, so the form is usable whether or not the CRM answers.
   */
  useEffect(() => {
    let active = true;
    async function loadEnquiryIds() {
      try {
        const response = await getCrmLeadEnquiryIds(vertical);
        if (active) setEnquiryIdOptions(Array.isArray(response?.data) ? response.data : []);
      } catch {
        if (active) setEnquiryIdOptions([]);
      }
    }
    void loadEnquiryIds();
    return () => { active = false; };
  }, [vertical]);

  /*
   * The Client Details the chosen enquiry already answers, read off its CRM lead.
   *
   * The quotation asks the same questions Add Lead does - the rows in `quotationVerticalConfig.js`
   * mirror it deliberately - so once the Enquire ID names a lead, re-typing the client's name,
   * number, branch and the rest is only a chance to type them differently from the CRM. Choosing
   * the enquiry fills them in instead, and every one stays editable: this is a head start, not a
   * lock, and a blank column on the lead is left alone rather than clearing what someone typed.
   *
   * Only for an id the vertical's own list holds. That is what makes this a choice rather than a
   * lookup on every keystroke - `ComboBoxField` cannot tell typing from picking, so an exact match
   * against the list is the signal - and it keeps a half-typed id from asking for a lead that
   * cannot exist. A request that fails leaves the form exactly as it was: the ids come from
   * `SALES / CRM Leads`, so a role without it simply types the details as before.
   */
  useEffect(() => {
    const enquiryId = String(identification.enquiryId || "").trim();
    if (!enquiryId) {
      prefilledEnquiryRef.current = "";
      return undefined;
    }
    if (enquiryId === prefilledEnquiryRef.current || !enquiryIdOptions.includes(enquiryId)) return undefined;
    let active = true;
    setPrefillingEnquiry(true);
    async function loadEnquiryDetails() {
      try {
        const response = await getCrmLead(enquiryId);
        if (!active) return;
        const applied = identificationFromLead(response?.data?.lead, vertical);
        // Marked read in whatever came back, so a lead holding nothing is not asked for again.
        prefilledEnquiryRef.current = enquiryId;
        if (Object.keys(applied).length) setIdentification((current) => ({ ...current, ...applied }));
      } catch {
        // Left unmarked, so re-picking the enquiry asks again. Nothing else is done: the details
        // are typed as they always were, and a failure here must not block raising a quotation.
      } finally {
        if (active) setPrefillingEnquiry(false);
      }
    }
    void loadEnquiryDetails();
    return () => { active = false; };
  }, [enquiryIdOptions, identification.enquiryId, vertical]);

  /*
   * Newest version first, priced, so picking one is a choice between figures rather than between
   * numbers — "Version 03 · ₹98,000" is what somebody is actually looking for when they reopen a
   * negotiation.
   */
  const versionOptions = useMemo(() => [...versions]
    .sort((first, second) => (second.version || 0) - (first.version || 0))
    .map((version) => ({
      // Each version's status travels with it - Finalized or Unfinalized.
      label: `${version.quotationId} · ${currency(Number(version.amount || 0))} · ${quotationVersionStatus(version).label}`,
      value: version.id,
    })), [versions]);
  const nextVersionLabel = useMemo(() => {
    const highest = versions.reduce((max, version) => Math.max(max, Number(version.version || 0)), 0);
    return `version ${String(highest + 1).padStart(2, "0")}`;
  }, [versions]);

  const servicesByShoot = useMemo(() => groupRowsByShoot(services), [services]);
  const deliverablesByShoot = useMemo(() => groupRowsByShoot(deliverables), [deliverables]);

  /*
   * The figures, from the rows as they stand.
   *
   * A line is priced at the `unitPrice` stamped on it when it was added - the brand's default for
   * that service at that moment - and a line without one (a row from before brands, or one off the
   * project catalogue) at the rates this quotation was raised with, as it always was. See
   * `lib/quotationBrand.mjs`, where the rule is tested.
   */
  const rupees = (value) => (value === "" ? "" : String(Math.max(0, Number(value) || 0)));
  const typedPerformance = performanceOpen ? Math.max(0, Number(performanceCost) || 0) : 0;
  const typedExtraDiscount = extraDiscounts.reduce((sum, entry) => sum + Math.max(0, Number(entry.amount) || 0), 0);
  const totals = quotationTotals({ services, deliverables, rates, discountSource, discountValue: discount, performanceCost: typedPerformance, extraDiscounts, roundOffDiscount, gstPercent: rates.gstPercent, discountCapPercent: MAX_DISCOUNT_PERCENT });
  /*
   * The lines nothing in Settings prices on their own shoot - a Studio-only service on an Outdoor
   * shoot - which count ₹0. Each is named on its line; the summary says how many, so a shoot whose
   * lines all count nothing does not read as a shoot left out of the total.
   */
  const shootsById = new Map(shoots.map((shoot) => [shoot.id, shoot]));
  // Asked of each service and deliverable as Settings holds it now, by the line's own id.
  // Held steady between renders: the lines table rebuilds its columns when these change.
  const serviceNote = useMemo(() => {
    const live = new Map([...serviceDefinitions, ...offeredServiceDefinitions].map((definition) => [definition.id, definition]));
    return (row, shoot) => unpricedServiceNote(row, shoot, live.get(row.serviceDefinitionId));
  }, [serviceDefinitions, offeredServiceDefinitions]);
  const deliverableNote = useMemo(() => {
    const live = new Map([...deliverableDefinitions, ...offeredDeliverableDefinitions].map((definition) => [definition.id, definition]));
    return (row, shoot) => unpricedDeliverableNote(row, shoot, live.get(row.deliverableDefinitionId));
  }, [deliverableDefinitions, offeredDeliverableDefinitions]);
  const unpricedLineCount = services.filter((row) => serviceNote(row, shootsById.get(row.shootId))).length
    + deliverables.filter((row) => deliverableNote(row, shootsById.get(row.shootId))).length;
  const { subtotal, amount: total } = totals;
  const discountInRupees = discountSource === DISCOUNT_SOURCES.AMOUNT;
  /*
   * The two discount boxes. The one typed into last shows what was typed, as it was typed - so it
   * can be cleared and retyped, or hold "12." on the way to "12.5" - and the other is worked out
   * from it on every render rather than stored, so neither box ever writes to the other and the
   * service cost changing moves only the worked-out one: 20% stays 20%, ₹4,000 stays ₹4,000.
   */
  const discountPercentText = discountInRupees ? String(shownPercentage(totals.discountPercent)) : discount;
  const discountAmountText = discountInRupees ? discount : String(totals.discountAmount);
  function typeDiscount(source, value) {
    const typed = value === "" || !Number.isFinite(Number(value)) || Number(value) < 0 ? "" : value;
    setDiscountSource(source);
    // A percentage is out of 100; rupees above the cost are said below, not quietly cut.
    setDiscount(source === DISCOUNT_SOURCES.PERCENTAGE && Number(typed) > 100 ? "100" : typed);
  }
  /*
   * The discount is held to `MAX_DISCOUNT_PERCENT` of the cost, typed either way: above it is said
   * here and refused on save. The totals above already apply no more than the cap, so the Summary
   * never shows a price the quotation could not be saved at.
   */
  const typedDiscount = Math.max(0, Number(discount) || 0);
  const discountError = discountInRupees
    ? (typedDiscount > totals.discountCap ? `Discount can be at most ${currency(totals.discountCap)} (${MAX_DISCOUNT_PERCENT}% of the cost).` : "")
    : (typedDiscount > MAX_DISCOUNT_PERCENT ? `Discount can be at most ${MAX_DISCOUNT_PERCENT}% (${currency(totals.discountCap)}).` : "");
  // The extra discounts are not held to the 15% - only to what the Discount leaves, so that
  // together they never take the total below nothing: said, and refused.
  const extraDiscountError = typedExtraDiscount > totals.extraDiscountLimit ? `Extra discounts can come to at most ${currency(totals.extraDiscountLimit)} together.` : "";
  // Taken off what the other discounts leave, and no further than nothing: said, and refused.
  const roundOffError = Math.max(0, Number(roundOffDiscount) || 0) > totals.roundOffLimit ? `Hidden/Round Off Discount can be at most ${currency(totals.roundOffLimit)}.` : "";
  function addExtraDiscount() {
    extraDiscountIds.current += 1;
    const id = `extra-${extraDiscountIds.current}`;
    setExtraDiscounts((current) => (current.length >= MAX_EXTRA_DISCOUNTS ? current : [...current, { id, reason: "", amount: "" }]));
  }
  function updateExtraDiscount(id, patch) {
    setExtraDiscounts((current) => current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
  }
  // Only that one goes, and it can be undone: it comes back where it was, as it was typed.
  function removeExtraDiscount(id) {
    const index = extraDiscounts.findIndex((entry) => entry.id === id);
    const removed = extraDiscounts[index];
    if (!removed) return;
    setExtraDiscounts((current) => current.filter((entry) => entry.id !== id));
    if (removed.reason.trim() || removed.amount) showUndo("Extra discount removed.", () => setExtraDiscounts((current) => (current.length >= MAX_EXTRA_DISCOUNTS ? current : [...current.slice(0, index), removed, ...current.slice(index)])));
  }
  function removePerformanceCost() {
    const removed = performanceCost;
    setPerformanceOpen(false);
    setPerformanceCost("");
    if (removed) showUndo("Performance cost removed.", () => { setPerformanceCost(removed); setPerformanceOpen(true); });
  }

  /*
   * New shoots for the quotation, each with its own key and Shoot ID: `Q-SID-` and the next number.
   * The next number is one past the highest already listed - which is the list's length plus one
   * whenever nothing has been deleted, the number every shoot has always been given - so a shoot
   * added after another was deleted, or a duplicate, can never be handed an ID the list still holds.
   */
  function withQuoteShootIds(current, rows) {
    const highest = current.reduce((max, shoot) => Math.max(max, Number(/^Q-SID-(\d+)$/.exec(String(shoot.shootId || ""))?.[1] || 0)), current.length);
    return rows.map((row, index) => ({ ...row, id: `quote-shoot-${Date.now()}-${index}`, shootId: `Q-SID-${String(highest + index + 1).padStart(4, "0")}` }));
  }

  /*
   * Duplicate on the Shoot List's ⋮ opens the shoot dialog filled from the shoot - its type, day,
   * place, district, state, sessions and length, food, stay, travel, preference, Additional Text -
   * with Shoot left for the person to choose, the way every Shoot List's Duplicate does
   * (`duplicateShootValues`). Nothing is added until Save; Cancel leaves the quotation as it was.
   */
  function duplicateShoot(shoot) {
    const source = shoots.find((row) => row.id === shoot.id);
    if (!source) return;
    setEditingShoot(null);
    setCopyingShoot(source);
    setShootDialogOpen(true);
  }

  /*
   * Save on that dialog: each row it hands over (one per shoot chosen) becomes a new shoot on this
   * quotation, with its own key and Shoot ID, listed after the others the way a shoot added by Add
   * Shoot is. The original is not touched.
   *
   * The original's service and deliverable lines come with each copy, every field as it was -
   * quantity, remarks, size, count, complimentary, price - under ids of their own
   * (`copyShootLines`), then follow whatever the form changed about the shoot (type, session,
   * length) exactly as an Edit's lines would. A copy opens as not the Main Event - one shoot carries
   * the mark, and it stays on the original - but where the form switched it on, and the person
   * confirmed the move, the copy takes the mark off every other shoot, exactly as Edit does. Undo
   * takes the copies and their lines back out.
   */
  function addDuplicatedShoots(source, rows) {
    const copies = withQuoteShootIds(shoots, rows);
    const lines = copies.map((copy) => copyShootLines({ services: serviceRowsRef.current, deliverables: deliverableRowsRef.current }, source.id, copy.id));
    const nextServices = [...serviceRowsRef.current, ...lines.flatMap((copied) => copied.services)];
    const nextDeliverables = [...deliverableRowsRef.current, ...lines.flatMap((copied) => copied.deliverables)];
    serviceRowsRef.current = nextServices;
    deliverableRowsRef.current = nextDeliverables;
    // Numbered by position, as every change to the list is: the copies are last, so they take the next.
    const copyShootIds = numberQuoteShoots([...shoots, ...copies]).slice(-copies.length).map((row) => row.shootId);
    const unmark = copies.some((copy) => copy.isMainEvent);
    setShoots((current) => numberQuoteShoots([...current.map((shoot) => unmark && shoot.isMainEvent ? { ...shoot, isMainEvent: false } : shoot), ...copies]));
    setServices(nextServices);
    setDeliverables(nextDeliverables);
    copies.forEach((copy) => repriceShootLines(source, copy));
    const copyIds = new Set(copies.map((copy) => copy.id));
    showUndo(`${shootDisplayName(source, "Shoot")} duplicated as ${copyShootIds.join(", ")}.`, () => {
      const keptServices = serviceRowsRef.current.filter((row) => !copyIds.has(row.shootId));
      const keptDeliverables = deliverableRowsRef.current.filter((row) => !copyIds.has(row.shootId));
      serviceRowsRef.current = keptServices;
      deliverableRowsRef.current = keptDeliverables;
      setShoots((current) => numberQuoteShoots(current.filter((row) => !copyIds.has(row.id))));
      setServices(keptServices);
      setDeliverables(keptDeliverables);
    });
  }

  /*
   * One shoot's lines put in the order they were dragged to. Only the array's order changes - the
   * rows are the same objects - so nothing is re-priced and the total stays exactly as it was; the
   * order is what the payload saves and the client's copy prints.
   */
  // The shoots themselves, in the order dragged to on the Shoot List: the cards below follow, and the
  // payload saves - and the client's copy prints - them in this order, numbered by where they now stand.
  function reorderShoots(ids) {
    setShoots((current) => numberQuoteShoots(reorderLines(current, ids)));
  }
  function reorderServices(_shootId, ids) {
    const next = reorderLines(serviceRowsRef.current, ids);
    serviceRowsRef.current = next;
    setServices(next);
  }
  function reorderDeliverables(_shootId, ids) {
    const next = reorderLines(deliverableRowsRef.current, ids);
    deliverableRowsRef.current = next;
    setDeliverables(next);
  }

  /*
   * A shoot edited to another Shoot Type, Session Timing or length reprices its own lines, by the
   * same reading a line added to it now would get - and nothing else on the quotation moves.
   *
   * Each shoot is priced by its own type and session, so a line keeps a price that no longer
   * describes its shoot otherwise: a shoot moved from Studio to Outdoor went on charging the Studio
   * figure. Only what the edit touches is re-read; correcting a shoot's place or date reprices
   * nothing, so a quotation is never repriced against today's Settings because somebody fixed a
   * name.
   *
   * - A service's Session Timing follows the shoot where it was still the shoot's own - the one the
   *   line started on - and stays where it was changed by hand. Its price is the service's one
   *   price, which no shoot changes, so the line keeps the price it has.
   * - A deliverable without a variant is re-read from its own pricing (a full-length video by the
   *   shoot's session); a variant is its own price and stays.
   * - A line priced by a package, and a line Settings prices nothing for, keep their price.
   *
   * The deliverables a service brings with it are then worked out again for that shoot, as for a
   * change made on the line itself.
   */
  function repriceShootLines(before, after) {
    const pricedBy = (shoot) => JSON.stringify([shootTypesOf(shoot), shootTimingsOf(shoot), shoot?.sessionDurationHours ?? "", shoot?.sessionDurationMinutes ?? ""]);
    if (!before || pricedBy(before) === pricedBy(after)) return;
    const nextServices = serviceRowsRef.current.map((row) => {
      if (row.shootId !== after.id || row.packageId) return row;
      const definition = row.serviceDefinition;
      const followed = (row.sessionOptionId || "") === (defaultSessionOptionId(definition, before) || "");
      return followed ? { ...row, sessionOptionId: defaultSessionOptionId(definition, after) || "" } : row;
    });
    serviceRowsRef.current = nextServices;
    setServices(nextServices);
    setDeliverables((current) => {
      const next = current.map((row) => {
        if (row.shootId !== after.id || row.packageId || row.deliverableVariantId) return row;
        const priced = deliverablePriceForRow(row.deliverableDefinition, row, after);
        return priced === null ? row : { ...row, unitPrice: priced };
      });
      deliverableRowsRef.current = next;
      return next;
    });
    addAutoDeliverables(after, nextServices);
  }

  async function saveShootRows(rows) {
    if (editingShoot) {
      const before = shoots[editingShoot.index];
      const after = before ? { ...before, ...rows[0], id: before.id, shootId: before.shootId } : null;
      setShoots((current) => current.map((shoot, index) => index === editingShoot.index ? { ...shoot, ...rows[0], id: shoot.id, shootId: shoot.shootId } : rows[0].isMainEvent ? { ...shoot, isMainEvent: false } : shoot));
      if (after) repriceShootLines(before, after);
      setEditingShoot(null);
      setShootDialogOpen(false);
      return;
    }
    if (copyingShoot) {
      addDuplicatedShoots(copyingShoot, rows);
      setCopyingShoot(null);
      setShootDialogOpen(false);
      return;
    }
    setShoots((current) => numberQuoteShoots([...current, ...withQuoteShootIds(current, rows)]));
    setShootDialogOpen(false);
  }

  /*
   * One row for a service, from the definition it was picked from.
   *
   * The brand's own fields ride along: which brand master it names, and the price it is added at -
   * stamped now, so the line keeps that price whatever the brand's default becomes later. A
   * definition off the project catalogue stamps neither and prices off the rates, as ever.
   */
  function serviceRowFor(shoot, definition, extra = {}) {
    /*
     * The service's one price in Settings → Project → Services, on whatever shoot it is added to -
     * Studio or Outdoor, Half or Full Session. Shoot Type, Session Timing, Duration and Size are no
     * longer asked there, and the per-booking pricing lines a service may still store are not
     * read. A package that names a price still wins, through `extra`.
     */
    const timed = flatPriceOf(definition);
    /*
     * Its Session Timing starts on the shoot's own session where the service offers that one -
     * Half Session for a half-session shoot - and blank where it does not. Only here, when the
     * row is made: a row saved with a timing is loaded as it was saved, a change the person makes
     * is theirs, and `extra` (a package, the calculator) still names its own.
     */
    const sessionOptionId = defaultSessionOptionId(definition, shoot);
    return normalizeService({
      id: `quote-service-${shoot.id}-${definition.id}`,
      shootId: shoot.id,
      serviceDefinitionId: definition.id,
      serviceDefinition: definition,
      serviceName: definition.name,
      /*
       * The note the service carries in Settings, as this line's own Remarks to start from - only
       * here, where a line is first made. From then on it is the quotation's copy: typed over,
       * cleared, saved and reopened as the line holds it, and never written back to Settings. A
       * line reopened from a saved quotation is not made here, so it keeps what it was saved with.
       */
      remarks: settingsNoteOf(definition?.remarksEnabled),
      ...brandFieldsForServiceRow(definition),
      ...(timed !== null ? { unitPrice: timed } : {}),
      ...(sessionOptionId ? { sessionOptionId } : {}),
      ...extra,
    }, offeredServiceDefinitions);
  }

  /*
   * One row for a deliverable, and - where one was chosen - for the exact variant of it.
   *
   * A variant is what carries a price, so choosing one is what prices the line: the figure the
   * studio saved against that variant in Settings → Project → Deliverables is stamped onto the row
   * here, and `deliverableUnitPrice` reads a stamped price before anything else. That is the whole
   * of the change to pricing - the quotation goes on totalling through `quotationTotals` exactly as
   * it did, quantity times unit price, and no second sum is introduced anywhere.
   *
   * Stamping is also what keeps a quotation already raised from moving: the price is a fact about
   * this line from the moment it was added, so repricing the variant in Settings tomorrow leaves
   * every version already saved reading what it was sent with.
   *
   * The three ids travel with it - deliverable, brand, variant - because a name cannot identify a
   * variant: two brands sell a 12x18, and two deliverables may be called the same thing. They ride
   * in the payload as they are; `quotationLineSchema` passes through what it does not check, so
   * nothing about the save, the versions or the PDF had to change to carry them.
   */
  function deliverableVariantFields(variant) {
    if (!variant) return {};
    return {
      deliverableOptionId: variant.optionId,
      deliverableVariantLabel: variant.label,
      deliverableBrandId: variant.brandId,
      deliverableBrandName: variant.brandName,
      deliverableVariantId: variant.variantId,
      // What the variant is, as its deliverable's type asked for it.
      size: variant.size || "",
      frameInches: variant.frameInches || "",
      videoLength: variant.videoLength || "",
    };
  }

  function deliverableRowFor(shoot, definition, extra = {}, variant = null) {
    /*
     * The deliverable's own price for this line, where its kind can already say: a full-length
     * video for the shoot's session, a teaser or a candid its one figure. An image kind is priced
     * by size and waits for the size to be picked - see `updateDeliverable`. More specific than the
     * brand's default, so it wins where both exist; a package that names a price still wins.
     */
    // The one price the deliverable dialog asks, where the deliverable has no per-kind pricing
    // (which older deliverables may still carry and which still answers for them).
    const flat = definition?.price == null || definition.price === "" || !Number.isFinite(Number(definition.price)) ? null : Number(definition.price);
    /*
     * The variant's own price wins where one was chosen, and a variant nobody has priced is quoted
     * at zero rather than falling back to the deliverable's flat figure or the brand's default -
     * the studio's call: a variant is the price, so an empty one is an answer about this variant
     * and not a reason to quote a different variant's money. A line added without a variant prices
     * exactly as it always has.
     */
    const priced = variant ? (Number.isFinite(Number(variant.price)) ? Number(variant.price) : 0) : (deliverablePriceForRow(definition, {}, shoot) ?? flat);
    return normalizeDeliverable({
      // The variant is part of the row's identity: without it two variants of one deliverable on
      // one shoot would be the same row, and the second would replace the first.
      id: `quote-deliverable-${shoot.id}-${definition.id}${variant ? `-${variant.variantId}` : ""}`,
      shootId: shoot.id,
      deliverableDefinitionId: definition.id,
      deliverableDefinition: definition,
      // The deliverable's own name, which is what a project raised off this quotation matches by.
      // The variant's full label is carried beside it, and that is what the tables and the client's
      // copy of the quotation print; this answers for them only where a row carries no label.
      deliverableName: definition.name,
      quantity: 1,
      // The deliverable's Settings note as this line's own Remarks to start from - see services.
      remarks: settingsNoteOf(definition?.remarksEnabled),
      ...brandFieldsForDeliverableRow(definition),
      ...deliverableVariantFields(variant),
      /*
       * The line's name without the Settings note: the picker shows it to choose by, but the note
       * now arrives as the line's Remarks, which the client's copy prints under the name - in both
       * it would be said twice, and the name is the one copy nobody can edit or clear.
       */
      ...(variant ? { deliverableVariantLabel: deliverableVariantLabel(definition, { name: variant.brandName }, variant) } : {}),
      ...(priced !== null ? { unitPrice: priced } : {}),
      ...extra,
    }, offeredDeliverableDefinitions);
  }

  async function addService(shoot, definition) {
    const row = serviceRowFor(shoot, definition);
    const next = [...serviceRowsRef.current, row];
    serviceRowsRef.current = next;
    setServices(next);
    addAutoDeliverables(shoot, next);
    return row;
  }

  /*
   * The variants a service's own booking brings with it, as quotation rows.
   *
   * A service answered **Deliverable Added** in Settings names one list of deliverable variants,
   * brought in whenever the service is added to a shoot, whatever its session - see
   * `serviceDeliverables`.
   *
   * Every row it produces goes through `deliverableRowFor` with the variant it names, which is the
   * same call a hand-picked variant makes. So an automatic line and a manual one are the same row:
   * the same stamped price, the same ids, the same totals, the same payload, the same PDF.
   *
   * `autoFromService` is what makes it removable again. A row added this way records the service
   * that brought it, so taking the service off the shoot takes its own rows with it and leaves
   * everything somebody added by hand alone.
   */
  function serviceMappedDeliverableRows(shoot, serviceRows) {
    const rows = [];
    for (const service of serviceRows) {
      const definition = service.serviceDefinition;
      if (definition?.deliverableAdded !== true) continue;
      for (const entry of serviceDeliverables(definition)) {
        const deliverable = offeredDeliverableDefinitions.find((item) => item.id === entry.deliverableId);
        const brand = deliverable?.brands?.find((item) => item.id === entry.brandId);
        const variant = brand?.variants?.find((item) => item.id === entry.variantId);
        // Only a deliverable this brand still offers, and only a variant it still holds: a mapping
        // whose variant has since been removed in Settings quietly brings nothing.
        if (!deliverable || !brand || !variant) continue;
        rows.push(deliverableRowFor(shoot, deliverable, {
          /*
           * Where this row came from, so the payload says so itself rather than leaving it to be
           * inferred. `autoFromService` is the one the sync reads - it is the *quotation's* service
           * row, which is what a row belongs to and what goes when that row goes - and the two
           * beside it name the master and the booking for anyone reading a saved quotation later.
           */
          autoFromService: service.id,
          autoSourceType: "SERVICE_PRICING",
          autoServiceDefinitionId: definition.id,
        }, {
          optionId: `${deliverable.id}::${brand.id}::${variant.id}`,
          // The same words a hand-picked variant is added under; the Settings note goes to Remarks.
          label: deliverableVariantLabel(deliverable, brand, variant),
          brandId: brand.id,
          brandName: brand.name || "",
          variantId: variant.id,
          size: variant.size || "",
          frameInches: variant.frameInches || "",
          videoLength: variant.videoLength || "",
          price: variant.price,
        }));
      }
    }
    return rows;
  }

  function addAutoDeliverables(shoot, nextServices) {
    setDeliverables((current) => {
      const shootServices = nextServices.filter((row) => row.shootId === shoot.id);
      const serviceNames = shootServices.map((row) => row.serviceName);
      const names = autoDeliverableNamesForServices(serviceNames);
      const blockedNames = blockedDeliverableNamesForServices(serviceNames);
      /*
       * Everything this shoot's services brought in automatically is worked out again from the
       * services as they now stand, so a service removed - or booked at another size - takes its
       * own rows with it. A row nobody's service accounts for any more is dropped; a row somebody
       * added by hand carries no `autoFromService` and is never touched.
       */
      const mapped = serviceMappedDeliverableRows(shoot, shootServices);
      const mappedIds = new Set(mapped.map((row) => row.id));
      const nextRows = current.filter((row) => {
        if (row.shootId === shoot.id && blockedNames.has(row.deliverableName)) return false;
        if (row.shootId === shoot.id && row.autoFromService) return mappedIds.has(row.id);
        return true;
      });
      // Already on the shoot - by hand or from another service - is already quoted: the existing
      // rule for a package's rows, applied here for the same reason.
      const heldIds = new Set(nextRows.map((row) => row.id));
      mapped.forEach((row) => { if (!heldIds.has(row.id)) { heldIds.add(row.id); nextRows.push(row); } });
      names.filter((name) => !blockedNames.has(name)).forEach((name) => {
        // Only a deliverable this brand offers follows a service in automatically: a brand that
        // has left "Raw - File IN" off its list has said it does not quote it.
        const definition = findDeliverableDefinitionByName(offeredDeliverableDefinitions, name);
        if (!definition || deliverableExistsForShoot(nextRows, shoot.id, definition)) return;
        nextRows.push(deliverableRowFor(shoot, definition));
      });
      deliverableRowsRef.current = nextRows;
      return nextRows;
    });
  }

  /*
   * A package, applied to one shoot: its items become that shoot's rows, at the package's
   * quantities and prices, skipping anything the shoot already holds. Recorded on the payload
   * as well, so the snapshot can say which package the client was offered - but the rows are
   * what is priced and printed, so a package edited later changes nothing here.
   */
  function applyPackage() {
    const shoot = shoots.find((row) => row.id === packageShootId);
    const pkg = brandPackages.find((row) => row.id === packageId);
    if (!shoot || !pkg) return;
    const plan = packageRowsForShoot({
      pkg,
      shoot,
      serviceDefinitions: offeredServiceDefinitions,
      deliverableDefinitions: offeredDeliverableDefinitions,
      existingServices: serviceRowsRef.current.filter((row) => row.shootId === shoot.id),
      existingDeliverables: deliverableRowsRef.current.filter((row) => row.shootId === shoot.id),
    });
    if (plan.services.length) {
      const next = [...serviceRowsRef.current, ...plan.services.map((item) => serviceRowFor(shoot, item.definition, { quantity: item.quantity, unitPrice: item.unitPrice, packageId: item.packageId, packageName: item.packageName }))];
      serviceRowsRef.current = next;
      setServices(next);
      addAutoDeliverables(shoot, next);
    }
    if (plan.deliverables.length) {
      setDeliverables((current) => {
        const held = new Set(current.map((row) => `${row.shootId}:${row.brandDeliverableId || row.deliverableDefinitionId}`));
        const added = plan.deliverables
          .map((item) => deliverableRowFor(shoot, item.definition, { quantity: item.quantity, unitPrice: item.unitPrice, packageId: item.packageId, packageName: item.packageName }))
          .filter((row) => !held.has(`${row.shootId}:${row.brandDeliverableId || row.deliverableDefinitionId}`));
        const next = [...current, ...added];
        deliverableRowsRef.current = next;
        return next;
      });
    }
    setAppliedPackages((current) => [...current, { packageId: pkg.id, packageName: pkg.name, shootId: shoot.id, shootName: shoot.shoot || "", appliedAt: new Date().toISOString() }]);
    if (!plan.services.length && !plan.deliverables.length) showError(`${shoot.shoot || "This shoot"} already holds everything in ${pkg.name}.`);
    else if (plan.skipped.length) showError(`${pkg.name} applied. ${plan.skipped.length} item${plan.skipped.length === 1 ? "" : "s"} this brand no longer offers ${plan.skipped.length === 1 ? "was" : "were"} left out.`);
  }

  /*
   * The three below work out the next list *before* setting it, rather than inside an updater.
   *
   * `setServices(fn)` does not run `fn` there and then - React runs it when it next renders - so a
   * line reading `serviceRowsRef.current` straight afterwards reads the list as it was, not as it
   * is about to be. Everything here has to hand that list to `addAutoDeliverables` immediately, to
   * work out what the services now on the shoot bring with them; from inside an updater it would
   * have been working from the shoot as it stood a moment ago, so changing a Session Timing would
   * have re-synced against the *old* timing and the booking's deliverables would have lagged one
   * change behind. `addService` above has always done it this way; these now match it.
   */
  async function updateService(row, data) {
    const next = serviceRowsRef.current.map((item) => (item.id === row.id ? normalizeService({ ...item, ...data }, offeredServiceDefinitions) : item));
    serviceRowsRef.current = next;
    setServices(next);
    // What the shoot's services bring, worked out again; anything added by hand is left alone.
    const shoot = shoots.find((candidate) => candidate.id === row.shootId);
    if (shoot) addAutoDeliverables(shoot, next);
  }

  async function deleteService(row) {
    const next = serviceRowsRef.current.filter((item) => item.id !== row.id);
    serviceRowsRef.current = next;
    setServices(next);
    // The service is off the shoot, so what it brought with it goes too - and nothing else does.
    const shoot = shoots.find((candidate) => candidate.id === row.shootId);
    if (shoot) addAutoDeliverables(shoot, next);
  }

  async function clearServices(rows) {
    const ids = new Set(rows.map((row) => row.id));
    const next = serviceRowsRef.current.filter((item) => !ids.has(item.id));
    serviceRowsRef.current = next;
    setServices(next);
    for (const shootId of new Set(rows.map((row) => row.shootId))) {
      const shoot = shoots.find((candidate) => candidate.id === shootId);
      if (shoot) addAutoDeliverables(shoot, next);
    }
  }

  async function addDeliverable(shoot, definition, variant = null) {
    const row = deliverableRowFor(shoot, definition, {}, variant);
    setDeliverables((current) => {
      const next = [...current, row];
      deliverableRowsRef.current = next;
      return next;
    });
    return row;
  }

  async function updateDeliverable(row, data) {
    setDeliverables((current) => {
      const next = current.map((item) => {
        if (item.id !== row.id) return item;
        const merged = normalizeDeliverable({ ...item, ...data }, offeredDeliverableDefinitions);
        // An image kind is priced by size, so choosing the size is what prices the line. Only
        // then, and only where the pricing names that size - the price is otherwise left alone.
        if ("sizeOptionValueId" in data) {
          const priced = deliverablePriceForRow(merged.deliverableDefinition, merged, null);
          if (priced !== null) merged.unitPrice = priced;
        }
        return merged;
      });
      deliverableRowsRef.current = next;
      return next;
    });
  }

  async function deleteDeliverable(row) {
    setDeliverables((current) => {
      const next = current.filter((item) => item.id !== row.id);
      deliverableRowsRef.current = next;
      return next;
    });
  }

  async function clearDeliverables(rows) {
    const ids = new Set(rows.map((row) => row.id));
    setDeliverables((current) => {
      const next = current.filter((item) => !ids.has(item.id));
      deliverableRowsRef.current = next;
      return next;
    });
  }

  async function deleteShoot(shoot) {
    setShoots((current) => numberQuoteShoots(current.filter((row) => row.id !== shoot.id)));
    await clearServices(servicesByShoot[shoot.id] || []);
    await clearDeliverables(deliverablesByShoot[shoot.id] || []);
  }

  function updateIdentification(field, value) {
    fields.clear(field);
    setIdentification((current) => ({ ...current, [field]: value }));
  }

  /*
   * Switching vertical empties the Client Details, so it asks first.
   *
   * The three verticals barely overlap - a groom's name means nothing on a corporate quotation -
   * and carrying answers across would save a hidden Groom Name onto a Corp record. Clearing is
   * the honest behaviour; the warning is what stops it being a surprise. Nothing is asked when
   * the section is still empty, because there is nothing to lose.
   */
  async function requestVertical(next) {
    // The field is disabled once a quotation exists, so this only guards a caller other than the
    // radio group itself - `disabled` already stops the click before it gets here.
    if (verticalLocked || next === vertical) return;
    // Enquire ID counts as an answer: the ids are listed per vertical, so a Dum Dum enquiry
    // carried onto a Qua Qua quotation would name a lead that vertical does not have.
    const answerKeys = [...Object.keys(emptyVerticalValues()), "enquiryId"];
    const hasDetails = answerKeys.some((key) => String(identification[key] || "").trim());
    /*
     * What the next brand still offers, read before the question is asked, so the warning can
     * name the lines that would go rather than discover them afterwards. A line off the shared
     * catalogue names no brand master and is kept; a line off the old brand's own list goes unless
     * the new brand lists the same master. The read is cached, so this costs a request once.
     */
    let offeredServiceIds = new Set();
    let offeredDeliverableIds = new Set();
    try {
      const response = await getQuotationBrandConfiguration(brandCodeForVertical(next) || "DUM_DUM");
      offeredServiceIds = new Set((response?.data?.services || []).filter((row) => row.isActive !== false).map((row) => row.id));
      offeredDeliverableIds = new Set((response?.data?.deliverables || []).filter((row) => row.isActive !== false).map((row) => row.id));
    } catch {
      // Unreadable: nothing of the next brand's is known, so every brand-specific line is lost.
    }
    const lostServices = selectionsLostOnBrandSwitch(serviceRowsRef.current, offeredServiceIds, "brandServiceId");
    const lostDeliverables = selectionsLostOnBrandSwitch(deliverableRowsRef.current, offeredDeliverableIds, "brandDeliverableId");
    if (!hasDetails && !lostServices.length && !lostDeliverables.length) {
      setVertical(next);
      return;
    }
    setPendingVertical({ vertical: next, hasDetails, lostServices, lostDeliverables });
  }

  async function confirmVerticalChange() {
    const pending = pendingVertical;
    if (!pending) return;
    if (pending.hasDetails) setIdentification((current) => ({ ...current, ...emptyVerticalValues(), enquiryId: "" }));
    if (pending.lostServices.length) await clearServices(pending.lostServices);
    if (pending.lostDeliverables.length) await clearDeliverables(pending.lostDeliverables);
    setAppliedPackages([]);
    setVertical(pending.vertical);
    setPendingVertical(null);
  }

  /** What the warning says: the details, the lines, or both, in one sentence each. */
  function verticalChangeMessage(pending) {
    if (!pending) return "";
    const lines = [];
    if (pending.hasDetails) lines.push(`${pending.vertical} asks for different client details, so the ones already filled in will be cleared.`);
    const lost = [...pending.lostServices.map((row) => row.serviceName), ...pending.lostDeliverables.map((row) => deliverableRowLabel(row))].filter(Boolean);
    if (lost.length) lines.push(`${lost.length === 1 ? "This line is" : "These lines are"} not offered by ${pending.vertical} and will be removed: ${lost.join(", ")}.`);
    lines.push("Shoots are kept, and so is anything chosen from the studio catalogue.");
    return lines.join(" ");
  }

  /*
   * The brand-specific discount checks, said before either save: a figure the server would refuse
   * is refused here with the reason, for a draft as much as for Generate Quotation.
   */
  function discountProblem(action) {
    if (discountError) return `${discountError} Lower it before ${action}.`;
    if (extraDiscountError) return `${extraDiscountError} Lower them, or remove one, before ${action}.`;
    if (roundOffError) return `${roundOffError} Lower it before ${action}.`;
    return "";
  }
  // The same three, keyed by the box each is drawn under.
  const discountProblems = () => ({ discount: discountError, extraDiscount: extraDiscountError, roundOff: roundOffError });

  /** Marks the boxes named in `problems` and answers true when any was; the toast says how many. */
  function refuse(problems) {
    if (fields.check(problems)) return false;
    showError(markedFieldsMessage(Object.keys(onlyErrors(problems)).length));
    return true;
  }

  /*
   * Save Draft asks for one thing only - the Assigned Branch, because the quotation number is drawn
   * from it on the first save and never changes after. Everything else can be left for later; it is
   * all checked when the draft is generated.
   */
  function saveDraft() {
    if (refuse({
      assignedBranch: String(identification.assignedBranch || "").trim() ? "" : "Choose the Assigned Branch before saving the draft - the quotation number is drawn from it.",
      ...discountProblems(),
    })) return;
    onSaveDraft?.(quotationPayload());
  }

  /*
   * Preview: the client's copy of this form as it stands, in one tab of its own, with nothing written
   * to the server - no draft, no number, no version. See `lib/quotationPreview.mjs` for the exchange.
   *
   * This generator is one preview session (`previewSession`, made on the first press). The first
   * press opens the tab. From then on the tab is kept up to date by itself: a moment after editing
   * stops (`AUTO_SYNC_DELAY_MS`) the whole form is sent to it, and the tab answers once the server has
   * drawn it - so "Preview up to date" is only ever said about what the tab actually shows. A press
   * still sends it at once and brings the tab forward; a tab that was closed opens again. Each form is
   * numbered (`previewSeq`), so the tab and this status both ignore an older one that arrives late.
   * The discount checks a save would refuse on are said first, so a preview never shows a price that
   * cannot be issued.
   *
   * The same pause auto-saves the edits to this tab's session storage (`lib/quotationEditingDraft`,
   * under `editingDraftScope`), which is what a reload of the page reopens the generator on. Nothing
   * reaches the server until Save Draft, Save as New Version or Generate is pressed.
   */
  const previewSession = useRef(null);
  const previewTab = useRef(null);
  const previewSeq = useRef(0);
  const latestPreview = useRef(null);
  // The status beside Preview while a tab is open: updating, current, failed or blocked.
  const [previewStatus, setPreviewStatus] = useState(null);
  // What the form was when last sent or saved, the timer waiting on a pause, and what it will send.
  const autoSync = useRef({ last: null, timer: null, pending: null });

  function sendToPreview(payload) {
    const tab = previewTab.current;
    if (!tab || tab.closed || !previewSession.current) return false;
    previewSeq.current += 1;
    latestPreview.current = { seq: previewSeq.current, payload };
    tab.postMessage(previewMessage(PREVIEW_MESSAGE_TYPES.UPDATE, previewSession.current, previewSeq.current, payload), window.location.origin);
    setPreviewStatus({ kind: "updating" });
    return true;
  }

  // Sends what is waiting on a pause now - the pause ended, or the generator or page is going.
  function flushAutoSync() {
    const state = autoSync.current;
    if (state.timer) window.clearTimeout(state.timer);
    state.timer = null;
    const pending = state.pending;
    state.pending = null;
    if (!pending) return;
    if (editingDraftScope) stashEditingDraft(editingDraftScope, pending.payload);
    // A tab closed by hand leaves nothing to report on; the next press opens it again.
    if (!previewTab.current || previewTab.current.closed) {
      setPreviewStatus(null);
      return;
    }
    if (pending.problem) {
      setPreviewStatus({ kind: "blocked", message: pending.problem });
      return;
    }
    sendToPreview(pending.payload);
  }
  const flushRef = useRef(flushAutoSync);
  const showErrorRef = useRef(showError);
  useEffect(() => { flushRef.current = flushAutoSync; showErrorRef.current = showError; });

  // Every render: has the form changed since it was last sent? If so, wait for a pause. The form is
  // read once here, as a save would read it, so what waits is one whole, consistent quotation.
  useEffect(() => {
    const payload = quotationPayload();
    const text = JSON.stringify(payload);
    const state = autoSync.current;
    if (state.last === null) { state.last = text; return; }
    if (text === state.last) return;
    state.last = text;
    state.pending = { payload, problem: discountProblem("previewing") };
    if (state.timer) window.clearTimeout(state.timer);
    state.timer = window.setTimeout(() => flushRef.current(), AUTO_SYNC_DELAY_MS);
  });

  useEffect(() => {
    const origin = window.location.origin;
    // What the tab says: it has loaded (send it the newest), or how a form it was sent came out.
    function answerPreviewTab(event) {
      const message = acceptedPreviewMessage(event, { session: previewSession.current, origin, source: previewTab.current });
      if (!message) return;
      if (message.type === PREVIEW_MESSAGE_TYPES.READY) {
        if (latestPreview.current) previewTab.current.postMessage(previewMessage(PREVIEW_MESSAGE_TYPES.UPDATE, previewSession.current, latestPreview.current.seq, latestPreview.current.payload), origin);
        return;
      }
      // Only the answer for the newest form decides the status; an older one is already overtaken.
      if (message.seq !== previewSeq.current) return;
      if (message.type === PREVIEW_MESSAGE_TYPES.RENDERED) setPreviewStatus({ kind: "current" });
      if (message.type === PREVIEW_MESSAGE_TYPES.FAILED) {
        const reason = message.message || "The preview could not be updated.";
        setPreviewStatus({ kind: "failed", message: reason });
        // Said as a notice too, so it reaches a phone, where the footer has no room for the status.
        showErrorRef.current(`The preview was not updated: ${reason} Press Preview to try again.`);
      }
    }
    // The generator closing - its panel, or the page - first sends what was still waiting, then
    // leaves the tab showing it, marked as no longer updating.
    function tellPreviewClosed() {
      flushRef.current();
      const tab = previewTab.current;
      if (tab && !tab.closed && previewSession.current) {
        try { tab.postMessage(previewMessage(PREVIEW_MESSAGE_TYPES.CLOSED, previewSession.current, previewSeq.current), origin); } catch { /* the tab is gone */ }
      }
    }
    window.addEventListener("message", answerPreviewTab);
    window.addEventListener("pagehide", tellPreviewClosed);
    return () => {
      window.removeEventListener("message", answerPreviewTab);
      window.removeEventListener("pagehide", tellPreviewClosed);
      tellPreviewClosed();
    };
  }, []);

  function preview() {
    if (refuse(discountProblems())) return;
    // One whole form, read at the moment of the press - the same one a save would send. Whatever was
    // waiting on a pause is this same form or older, so it is dropped rather than sent after it.
    const payload = quotationPayload();
    const state = autoSync.current;
    if (state.timer) window.clearTimeout(state.timer);
    state.timer = null;
    state.pending = null;
    state.last = JSON.stringify(payload);
    if (editingDraftScope) stashEditingDraft(editingDraftScope, payload);
    if (!previewSession.current) previewSession.current = newPreviewSession();
    const session = previewSession.current;
    const open = previewTab.current && !previewTab.current.closed ? previewTab.current : null;
    if (open) {
      sendToPreview(payload);
      open.focus();
      return;
    }
    previewSeq.current += 1;
    const seq = previewSeq.current;
    latestPreview.current = { seq, payload };
    if (!stashQuotationPreview(payload, { key: session, seq })) {
      showError("The preview could not be opened in this browser. Try again, or save the draft and open it from the list.");
      return;
    }
    const tab = window.open(quotationPreviewPath(session), previewWindowName(session));
    if (!tab) {
      showError("Your browser blocked the preview tab. Allow pop-ups for this site, then press Preview again.");
      return;
    }
    previewTab.current = tab;
    setPreviewStatus({ kind: "updating" });
  }

  // Retry after a failed update: the newest form again, as a new number.
  function retryPreview() {
    if (latestPreview.current) sendToPreview(latestPreview.current.payload);
  }
  /*
   * What stands between this form and Generate Quotation, keyed by the box each problem is drawn
   * under and worked out from the values on screen. The press is refused by it and marks every box
   * at once (`refuse`). Save Draft asks less, and does not read this - see `saveDraft`.
   *
   * Required is exactly what it was: Enquire ID and the vertical's own starred fields, with a closed
   * dropdown the studio has not filled in yet not demanded of anybody (`requiredFieldsFor` - the
   * loaded lists travel with the check; Religion is the field this is for). A number - required or
   * not - is wrong once something is typed in it but not the whole of it, and says so under itself.
   */
  const missingForGenerate = [{ key: "enquiryId", label: "Enquire ID" }, ...requiredFieldsFor(vertical, suggestionLists)]
    .filter(({ key }) => !String(identification[key] || "").trim());
  const unfinishedNumbers = phoneFieldsFor(vertical).filter(({ key }) => String(identification[key] || "").trim() && !isCompletePhoneNumber(identification[key]));
  const numberErrors = Object.fromEntries(unfinishedNumbers.map(({ key }) => [key, "Enter the whole number."]));
  // A list is chosen from, anything else is typed.
  const chosenKeys = new Set((verticalFieldRows[vertical] || []).flat().filter((field) => field.type === "select" || field.type === "branch").map((field) => field.key));
  const generateProblems = () => ({
    ...Object.fromEntries(missingForGenerate.map(({ key, label }) => [key, `${chosenKeys.has(key) ? "Choose" : "Enter"} ${label}.`])),
    ...numberErrors,
    ...discountProblems(),
  });

  function submit(event) {
    event.preventDefault();
    // Locked: nothing is raised over a finalized quotation (the server refuses it as well).
    if (locked) return;
    if (refuse(generateProblems())) return;
    onGenerate?.(quotationPayload());
  }

  /** Everything on screen, in the shape a saved quotation's payload holds - for either save. */
  function quotationPayload() {
    return {
      ...identification,
      vertical,
      // The same fact under the name the brand tables and the register's column use. The server
      // resolves it again from the vertical, so an older client sending only `vertical` is fine.
      quotationBrand: brandCode,
      // The chain's share list, as employee ids: the people on screen become the people it is
      // shared with. Left out where the form never knew them, which the server reads as "unchanged".
      // Not on a quotation that saves its shares itself: a version carries the document, not who
      // can open it.
      ...(sharesKnown && canShare && !savesShareItself ? { sharedEmployeeIds: sharedWith.map(Number).filter(Boolean) } : {}),
      /*
       * The quotation table keeps its own columns for these three, and the vertical rows are
       * where they are now typed. Mapped on the way out so a saved quotation still lists a
       * client name, a number and a branch without asking for any of them twice.
       */
      clientName: identification.name,
      clientMainNumber: identification.contactNumber,
      sourceBranch: identification.assignedBranch,
      amount: total,
      subtotal,
      /*
       * `discount` is the percentage the quotation's column has always held - the one typed, or
       * what typed rupees come to, to two places. `discountInputSource` says which box was typed,
       * so a quotation saved from rupees reopens, edits and duplicates on its `discountAmount`.
       */
      discount: discountInRupees ? shownPercentage(totals.discountPercent) : totals.discountPercent,
      discountInputSource: discountSource,
      // The figures the snapshot keeps beside the rows: what the discount came to, the GST rate and
      // amount stated on top of the total, and the two together. The register lists `amount`.
      discountAmount: totals.discountAmount,
      // The Performance Cost (0 when removed) and each extra discount with its reason - a row left
      // wholly empty is not one. `extraDiscountAmount` is their total, the figure a single extra
      // discount used to be saved as; nothing stale from a removed one is carried forward.
      performanceCost: totals.performanceCost,
      extraDiscounts: extraDiscounts.map((entry) => ({ reason: entry.reason.trim(), amount: Math.max(0, Number(entry.amount) || 0) })).filter((entry) => entry.reason || entry.amount > 0),
      extraDiscountAmount: totals.extraDiscountAmount,
      // What the Round Off Discount took off. Already out of `amount`; the client's copy lists no
      // line for it, and the public API does not send it (`clientFacingQuotation`).
      roundOffDiscount: totals.roundOffDiscount,
      // The GST it was priced at where one is configured on screen; otherwise none is sent, and
      // the server stamps the brand's or the studio's rather than taking a 0 that nobody set.
      ...(finite(rates.gstPercent) !== null ? { gstPercent: totals.gstPercent } : {}),
      gstAmount: totals.gstAmount,
      grandTotal: totals.grandTotal,
      // Stamped onto the quotation so the client's copy states the GST that applied when it was
      // raised, and so reopening it later prices from the same numbers.
      rates,
      serviceCount: services.length,
      deliverableCount: deliverables.length,
      shoots,
      // Every line saved with the price it is charged at, ₹0 for one nothing prices, so a line
      // saved from now on is never "unpriced" and nothing can be assumed for it when reopened.
      services: services.map((row) => ({ ...row, unitPrice: serviceUnitPrice(row, rates) })),
      deliverables: deliverables.map((row) => ({ ...row, unitPrice: deliverableUnitPrice(row, rates) })),
      packages: appliedPackages,
    };
  }

  /*
   * Save Draft sits beside the button it is the lesser of - secondary beside primary - so the two
   * saves read as a pair and Close stays alone on the left. Tighter padding below `sm`, so all three
   * fit on one row at 360px.
   */
  const footer = <>
    <Button type="button" onClick={onClose} disabled={saving} className="min-h-10 px-3 py-2 sm:px-5">Close</Button>
    {/* Whether the open preview shows this form yet: only while a preview tab is open, and "up to
        date" only once that tab has drawn it. From `sm` - on a phone a failure is a notice instead. */}
    {previewStatus && <p role="status" aria-live="polite" className={`hidden shrink-0 items-center gap-1.5 text-xs sm:flex ${previewStatus.kind === "failed" || previewStatus.kind === "blocked" ? "text-red-600" : previewStatus.kind === "current" ? "text-emerald-700" : "text-slate-500"}`} title={previewStatus.message}>
      {previewStatus.kind === "updating" ? "Updating preview…" : previewStatus.kind === "current" ? "Preview up to date" : previewStatus.kind === "blocked" ? "Preview waits for the discount fix" : "Preview not updated"}
      {previewStatus.kind === "failed" && <Button type="button" variant="ghost" size="sm" onClick={retryPreview} className="-my-1 px-2">Retry</Button>}
    </p>}
    {canSaveDraft && <Button type="button" onClick={saveDraft} busy={savingDraft} disabled={saving} className="min-h-10 whitespace-nowrap px-3 py-2 sm:px-5">Save Draft</Button>}
    {/* Beside Generate Quotation, which it comes before: read it, then issue it. An eye alone below
        `sm`, so all four still fit one row at 360px; the label is always its name. */}
    <Button type="button" onClick={preview} disabled={saving} aria-label="Preview" title="Preview the client's copy in a new tab" className="min-h-10 shrink-0 gap-1.5 px-2.5 py-2 sm:px-5">
      <VisibilityOutlined style={{ fontSize: 18 }} aria-hidden="true" className="sm:hidden" />
      <span className="hidden sm:inline">Preview</span>
    </Button>
    {/* Open whenever nothing is being saved: a press on an unfinished quotation marks what is
        missing under each box (`submit`). Disabled - and saying why - on the finalized version,
        which is read-only until it is unfinalized. */}
    <Button type="submit" variant="primary" busy={saving && !savingDraft} disabled={saving || locked} title={locked ? lockedReason : undefined} className="min-h-10 px-3 py-2 sm:px-5">{isDraft ? "Generate Quotation" : initialQuotation ? "Save as new version" : duplicateOf ? "Save as Duplication" : "Generate Quotation"}</Button>
    {/* Last, and green: the step after the last save. It raises no version - it settles this one.
        "Finalize" alone below `sm`, as Preview is an eye there, so all four fit one row at 360px;
        its name is always the whole of it. Disabled, saying which, while another version is. */}
    {canFinalize && <Button type="button" variant="success" aria-label="Finalize Quotation" title={finalizeBlocked || undefined} busy={finalizing === "finalize"} busyLabel="Finalizing…" disabled={saving || Boolean(finalizing) || Boolean(otherFinalized)} onClick={() => setConfirmingFinalization("finalize")} className="min-h-10 whitespace-nowrap px-3 py-2 sm:px-5">
      <span className="sm:hidden">Finalize</span>
      <span className="hidden sm:inline">Finalize Quotation</span>
    </Button>}
    {canUnfinalize && <Button type="button" variant="primary" busy={finalizing === "unfinalize"} busyLabel="Unfinalizing…" disabled={saving || Boolean(finalizing)} onClick={() => setConfirmingFinalization("unfinalize")} className="min-h-10 px-3 py-2 sm:px-5">Unfinalize</Button>}
  </>;

  // Who finalized this version and when, said on the panel itself - "Finalized" alone does not say
  // whether it was this morning or last month, or whose call it was.
  const finalization = initialQuotation?.finalization || null;
  const finalizedOn = (value) => value ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "";
  // The version's status beside the title - the same badge the version history and Create Project show.
  const versionStatus = quotationVersionStatus(initialQuotation);
  const finalizationBadge = initialQuotation?.id ? <StatusBadge tone={versionStatus.tone}>{versionStatus.label}</StatusBadge> : null;

  return <SchemaFormPanel title="Quotation Generator" titleAddon={finalizationBadge} description={isFinalized
    ? `${initialQuotation.quotationId || "This version"} was finalized${finalization.finalizedAt ? ` on ${finalizedOn(finalization.finalizedAt)}` : ""}${finalization.finalizedByName ? ` by ${finalization.finalizedByName}` : ""}. It is kept exactly as it is and its link never expires.`
    : isDraft
    ? `Draft ${initialQuotation.quotationId || ""} — Save Draft keeps your changes; Generate Quotation issues it under the same number.`
    : initialQuotation
    ? `Editing ${initialQuotation.quotationNumber || "this quotation"} — saving raises the next version.`
    : duplicateOf
      ? `Duplicating ${duplicateOf.quotationId || "a quotation"} — saving raises a new quotation, version 01. The original is not changed.`
      : "Build services and deliverables for a quotation."} sections={sections} sidebarAriaLabel="Quotation generator sections" closeAriaLabel="Close quotation generator" onClose={onClose} onSubmit={submit} footer={footer}>
    <FloatingNotice notice={notice} onClose={clearNotice} />
    <SchemaFormSection id="identification" title="Identification">
      <div className="space-y-5">
        {/* Only when there is a history to pick from. A first quotation has one version and a
            dropdown holding it alone would be a control with nothing to choose. */}
        {versions.length > 0 && !isDraft && <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
          <div className="grid gap-4 md:grid-cols-2">
            <Dropdown
              mode="input"
              label="Version"
              helperText="Loads an earlier version to start the next one from. The finalized version opens read-only."
              ariaLabel="Quotation version to load"
              value={selectedVersionId}
              options={versionOptions}
              onChange={(value) => onSelectVersion?.(value)}
            />
            {locked
              ? <p className="self-end pb-2 text-xs text-slate-600">
                This version is finalized, so it reads only. Unfinalize it to edit it; the next save is then <span className="font-semibold">{nextVersionLabel}</span>.
              </p>
              : <p className="self-end pb-2 text-xs text-slate-600">
                Saving raises <span className="font-semibold">{nextVersionLabel}</span> of {initialQuotation?.quotationNumber || "this quotation"}.
                The version loaded here is left exactly as it was sent, and its link keeps working until its own five days run out.
                {otherFinalized && ` ${otherFinalized.quotationId} is finalized; unfinalize it before finalizing another version.`}
              </p>}
          </div>
        </div>}
        {/* The document's own answers, read only while the quotation is finalized. The version
            picker above and Share with below stay usable: neither changes what was finalized. */}
        <ReadOnlyFieldset canWrite={!locked} reason={lockedReason} className="space-y-5">
        {/* The brand: the same three choices the form has always opened with, under the name the
            studio uses for them. It decides which services, deliverables, packages, event types and
            terms the sections below offer; the sections themselves are the same for every brand. */}
        <RadioGroupField
          label="Quotation Brand"
          helperText="Decides which services, deliverables, packages and terms are offered below."
          name="quotation-vertical"
          value={vertical}
          options={brandOptions}
          disabled={verticalLocked}
          onChange={(next) => void requestVertical(next)}
        />
        {/* Said once, plainly, rather than leaving a greyed-out row to explain itself: a disabled
            control with no reason given reads as broken, not as a rule. */}
        {verticalLocked && <p className="-mt-3 text-xs text-slate-500">
          {isDraft
            ? "The brand is set when the draft is first saved, because the quotation number is drawn from it."
            : "The brand is set when a quotation is first raised and cannot change on a later version."}
        </p>}
        {/* Said before the first Save Draft rather than after it: the save is what fixes the brand. */}
        {canSaveDraft && !initialQuotation && <p className="-mt-3 text-xs text-slate-500">
          Saving a draft fixes the brand, because the quotation number is drawn from it.
        </p>}
        {brandConfigError && <p className="-mt-3 text-xs text-amber-700">{brandConfigError}</p>}
        </ReadOnlyFieldset>
        {/* Who else works on this quotation. Shared is read **and** edit, and it carries the whole
            chain - every version, past and future - because that is what the register lists. */}
        {sharesKnown && <MultiSelectField
          label="Share with"
          values={sharedWith}
          onChange={chooseShared}
          options={shareOptions}
          placeholder={shareCandidates.length ? "Select employees (optional)" : "Nobody else holds Quotation Management"}
          helperText={!canShare
            ? "This quotation was shared with you. Who else it is shared with stays with the people whose own work it is."
            : savesShareItself
              // Said plainly, because the rest of this form is saved by a button that raises a
              // version: this one is not, and nobody should have to find that out by trying it.
              ? `${sharing ? "Saving…" : "Saved as you choose"} - sharing does not raise a version. They get this quotation and all its versions, to read and to edit.`
              : "They can open this quotation and all its versions, and edit it, wherever it sits outside their own work."}
          searchable
          readOnly={!canShare}
          disabled={sharing}
        />}
        <ReadOnlyFieldset canWrite={!locked} reason={lockedReason} className="space-y-5">
        {/* Suggestions, not a closed list: a quotation is often raised for an enquiry the CRM
            has not been given yet, so an unlisted id can still be typed straight in. */}
        <div className="grid gap-5 md:grid-cols-3">
          <div>
            <ComboBoxField
              label="Enquire ID"
              required
              helperText="Pick the enquiry to fill in its client details, or type a new one."
              value={identification.enquiryId}
              options={enquiryIdOptions}
              placeholder="Select or type enquire id"
              onChange={(value) => updateIdentification("enquiryId", value)}
              error={fields.errors.enquiryId}
            />
            {/* Said out loud, because fields filling themselves is otherwise indistinguishable
                from the form having been left half-completed by somebody else. */}
            {prefillingEnquiry && <p className="mt-1.5 text-xs font-normal text-slate-500">Filling in the client details this enquiry already has...</p>}
          </div>
        </div>
        <QuotationVerticalFields vertical={vertical} values={identification} onChange={updateIdentification} errors={{ ...fields.errors, ...numberErrors }} />
        <div className="grid gap-5 md:grid-cols-3">
          {quotationOnlyFields.map(([field, label, , helperText]) => (
            <SharedTextField
              key={field}
              label={label}
              helperText={helperText}
              value={identification[field]}
              inputMode={field === "secondaryContactNumber" ? "numeric" : undefined}
              maxLength={field === "secondaryContactNumber" ? 10 : undefined}
              onChange={(event) => updateIdentification(field, field === "secondaryContactNumber" ? phoneDigits(event.target.value) : event.target.value)}
              placeholder={`Enter ${label.toLocaleLowerCase()}`}
            />
          ))}
        </div>
        </ReadOnlyFieldset>
      </div>
    </SchemaFormSection>
    {/*
      * Wide, so the section may use the right-hand side the 1040px column left empty: the shoots
      * and their tables keep that width on the left, and the cost summary takes the strip beside
      * them. The grid below is what sets both; nothing else about the section changes. The summary's
      * column only grows where the screen has the room - a wider column on a screen that does not
      * comes straight out of the shoots beside it.
      */}
    <ReadOnlyFieldset canWrite={!locked} reason={lockedReason} className="contents">
    <SchemaFormSection id="service-creation" title="Service Creation" wide>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start xl:grid-cols-[minmax(0,1fr)_20rem] 2xl:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="min-w-0">
      {/*
        * A package, where the brand has any: its services and deliverables onto one shoot in one
        * move, priced as the package prices them. Custom selection is the pickers on each shoot
        * card below, exactly as before - a package is a head start on those rows, not a mode.
        * Offered only once there is a shoot to apply it to, because that is what it needs.
        */}
      {brandPackages.length > 0 && shoots.length > 0 && <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
        <p className="text-xs font-semibold text-slate-600 sm:text-sm">Package</p>
        <p className="mt-0.5 text-xs text-slate-500">Adds the package&apos;s services and deliverables to one shoot. Lines already on the shoot are left as they are, and every line can still be edited or removed.</p>
        <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
          <Dropdown
            mode="input"
            label="Shoot"
            helperText="The shoot the package's services and deliverables are added to."
            ariaLabel="Shoot to apply the package to"
            placeholder="Select shoot"
            sorted={false}
            value={packageShootId}
            options={shoots.map((shoot) => ({ label: [shootDisplayName(shoot), shoot.shootId].filter(Boolean).join(" · ") || "Shoot", value: shoot.id }))}
            onChange={setPackageShootId}
          />
          <Dropdown
            mode="input"
            label="Package"
            helperText="A ready set of services and deliverables, priced as the package."
            ariaLabel="Package"
            placeholder="Select package"
            sorted={false}
            value={packageId}
            options={brandPackages.map((pkg) => ({ label: pkg.name, value: pkg.id }))}
            onChange={setPackageId}
          />
          <Button type="button" variant="primary" className="max-md:w-full" disabled={!packageShootId || !packageId} onClick={applyPackage}>Apply package</Button>
        </div>
        {Boolean(packageId) && Boolean(brandPackages.find((pkg) => pkg.id === packageId)?.description) && <p className="mt-2 text-xs text-slate-500">{brandPackages.find((pkg) => pkg.id === packageId).description}</p>}
      </div>}
      <ProjectServiceCreationSection
        shoots={shoots}
        loading={false}
        loadingMasterData={loadingMasterData}
        serviceDefinitionsError={serviceDefinitionsError}
        deliverableDefinitionsError={deliverableDefinitionsError}
        serviceDefinitions={offeredServiceDefinitions}
        deliverableDefinitions={offeredDeliverableDefinitions}
        // Only here: a quotation line is priced, and a variant is what carries a price. The project
        // screens hold one allocation per deliverable per shoot, so variants have nowhere to go.
        deliverableVariants
        // A quotation line may be given rather than charged for; a project records work done and
        // prices nothing, so only this screen asks.
        complimentaryColumn
        sessionTimingColumn={false}
        servicesByShoot={servicesByShoot}
        deliverablesByShoot={deliverablesByShoot}
        // Nothing to add, change, remove or drag while the quotation is finalized - the section
        // draws the same rows read only for a caller that hands it no editors.
        {...(locked ? {} : {
          onAddShoot: () => { setEditingShoot(null); setShootDialogOpen(true); },
          onAddService: addService,
          onUpdateService: updateService,
          onDeleteService: deleteService,
          onClearServices: clearServices,
          onAddDeliverable: addDeliverable,
          onUpdateDeliverable: updateDeliverable,
          onDeleteDeliverable: deleteDeliverable,
          onClearDeliverables: clearDeliverables,
          onDeleteShoot: deleteShoot,
          onRequestEditShoot: (shoot, index) => { setEditingShoot({ shoot, index }); setShootDialogOpen(true); },
          onDuplicateShoot: duplicateShoot,
          onReorderShoots: reorderShoots,
          onReorderServices: reorderServices,
          onReorderDeliverables: reorderDeliverables,
        })}
        serviceLineNote={serviceNote}
        deliverableLineNote={deliverableNote}
      />
      {/*
        * The one place a quotation can say something its line items cannot - what was agreed on the
        * call, what a price depends on. Full width and last, under the shoots it refers to, and
        * the client reads it, which is said here rather than left to be found out after sending.
        */}
      <div className="mt-6">
        <TextAreaField
          label="Additional Notes"
          helperText="Anything else the client should read on this quotation, like an inclusion agreed on a call. Shown on the client's copy, above Terms & Conditions; left blank, nothing is printed."
          rows={4}
          maxLength={2000}
          value={identification.additionalNotes}
          onChange={(event) => updateIdentification("additionalNotes", event.target.value)}
          placeholder="Anything else this quotation should say - an inclusion agreed on a call, a caveat about a date."
        />
      </div>
      </div>
      {/*
        * The same summary as ever - the same figures from the same `totals`, the same discount box
        * bound to the same state - moved to the strip beside the shoots so it stays in view while
        * they are scrolled through, instead of sitting under the last of them.
        *
        * `sticky` against the panel's own scrolling `main`, the way every section heading already
        * is, so it never leaves the form: the header, the rail and the footer are outside that
        * scroller and cannot be covered, and at the end of the section it stops with the grid it
        * sits in. `top` clears the section's sticky heading (57px at `sm`) by the section's own
        * `pt-5`, so it rests where the content under the heading starts. Below `lg` the grid is one
        * column and this is ordinary content under Additional Notes, not sticky - the same
        * element, not a second copy.
        */}
      <div className="rounded-lg border border-slate-200 bg-blue-50 px-4 py-3 text-slate-700 lg:sticky lg:top-[77px]">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Quotation Summary</p>
        <div className="flex items-center justify-between gap-4 text-sm"><span>Service Cost :</span><span>{currency(subtotal)}</span></div>
        {unpricedLineCount > 0 && <p role="status" className="mt-1 text-xs font-medium text-amber-700">{unpricedLineCount === 1 ? "1 line is not priced in Settings for its shoot and is" : `${unpricedLineCount} lines are not priced in Settings for their shoots and are`} counted at ₹0.</p>}
        {/*
          * The summary's amounts sit in one column: a rupee box, then the × that takes it away (or,
          * on the discount row, the room one would take). Added to the service cost before the
          * discount - a rupee amount, never a percentage.
          */}
        {performanceOpen ? <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>Performance Cost<HelpTip text="An extra charge in rupees, added to the cost before the discount." /></span>
          <div className="flex items-center gap-2">
            <SharedTextField aria-label="Performance cost in rupees" type="number" inputMode="numeric" min="0" step="1" placeholder="₹ Amount" value={performanceCost} onChange={(event) => setPerformanceCost(rupees(event.target.value))} className="w-28" inputClassName="text-right" />
            <IconButton label="Remove performance cost" size="sm" shape="circle" onClick={removePerformanceCost}><Close style={{ fontSize: 16 }} aria-hidden="true" /></IconButton>
          </div>
        </div> : <Button type="button" variant="ghost" size="sm" className="mt-2 -ml-3" onClick={() => setPerformanceOpen(true)}>Performance Cost +</Button>}
        {/* The percentage and the rupees it comes to, either one typed and the other worked out. */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>Discount<HelpTip text="Type the percentage or the rupees; the other is worked out for you." /></span>
          <div className="flex items-center gap-2">
            <SharedTextField aria-label="Discount in %" type="number" inputMode="decimal" min="0" max={MAX_DISCOUNT_PERCENT} step="any" suffix="%" value={discountPercentText} onChange={(event) => typeDiscount(DISCOUNT_SOURCES.PERCENTAGE, event.target.value)} aria-invalid={discountError && !discountInRupees ? true : undefined} className="w-20" inputClassName={`!pl-2 text-right ${discountError && !discountInRupees ? "!border-red-400 focus:!border-red-500 focus:!ring-red-100" : ""}`} />
            <SharedTextField aria-label="Discount amount in rupees" type="number" inputMode="decimal" min="0" step="any" prefix="₹" value={discountAmountText} onChange={(event) => typeDiscount(DISCOUNT_SOURCES.AMOUNT, event.target.value)} aria-invalid={discountError && discountInRupees ? true : undefined} className="w-28" inputClassName={`text-right ${discountError && discountInRupees ? "!border-red-400 focus:!border-red-500 focus:!ring-red-100" : ""}`} />
            {/* The width of the × beside the amounts above and below, so the three amounts line up. */}
            <span aria-hidden="true" className="w-8 shrink-0" />
          </div>
        </div>
        {discountError && <p role="alert" className="mt-1.5 text-xs text-red-600">{discountError}</p>}
        {/* Rupees only - no percentage box - in the Discount row's rupee column, so the amounts line up.
            Taken off last, to bring the total to a round number, and never listed on the client's copy. */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
          {/* "Hidden" because that is what it is to the client: the one discount their copy never
              lists, folded into the price. The name says so to whoever is typing it. */}
          <span>Hidden/Round Off Discount<HelpTip text="Rupees taken off last to round the total; the client's copy never lists it." /></span>
          <div className="flex items-center gap-2">
            <SharedTextField aria-label="Hidden/Round off discount in rupees" type="number" inputMode="numeric" min="0" step="1" prefix="₹" placeholder="0" value={roundOffDiscount} onChange={(event) => setRoundOffDiscount(rupees(event.target.value))} aria-invalid={roundOffError ? true : undefined} className="w-28" inputClassName={`text-right ${roundOffError ? "!border-red-400 focus:!border-red-500 focus:!ring-red-100" : ""}`} />
            <span aria-hidden="true" className="w-8 shrink-0" />
          </div>
        </div>
        {roundOffError && <p role="alert" className="mt-1.5 text-xs text-red-600">{roundOffError}</p>}
        {/* Up to three, each a reason and a rupee amount - never a percentage - taken off after it.
            One heading, and the column names once above the rows. */}
        {extraDiscounts.length === 0 ? <Button type="button" variant="ghost" size="sm" className="mt-2 -ml-3" onClick={addExtraDiscount}>Extra Discount +</Button> : <div className="mt-3">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span>Extra Discount<HelpTip text="Up to three rupee discounts, each with the reason it is given." /></span>
            {extraDiscounts.length < MAX_EXTRA_DISCOUNTS && <IconButton label="Add extra discount" size="sm" shape="circle" onClick={addExtraDiscount}><Add style={{ fontSize: 18 }} aria-hidden="true" /></IconButton>}
          </div>
          <div aria-hidden="true" className="mt-1 grid grid-cols-[minmax(0,1fr)_7rem_2rem] gap-2 text-[11px] font-semibold text-slate-600 sm:text-xs">
            <span>Reason</span>
            <span className="text-right">Amount (₹)</span>
            <span />
          </div>
          <div className="mt-1 space-y-2">
            {extraDiscounts.map((entry) => <div key={entry.id} className="grid grid-cols-[minmax(0,1fr)_7rem_2rem] items-center gap-2">
              <SharedTextField aria-label="Extra discount reason" placeholder="Why it is given" maxLength={191} value={entry.reason} onChange={(event) => updateExtraDiscount(entry.id, { reason: event.target.value })} />
              <SharedTextField aria-label="Extra discount amount in rupees" type="number" inputMode="numeric" min="0" step="1" placeholder="0" value={entry.amount} onChange={(event) => updateExtraDiscount(entry.id, { amount: rupees(event.target.value) })} aria-invalid={extraDiscountError ? true : undefined} inputClassName={`text-right ${extraDiscountError ? "!border-red-400" : ""}`} />
              <IconButton label="Remove extra discount" size="sm" shape="circle" onClick={() => removeExtraDiscount(entry.id)}><Close style={{ fontSize: 16 }} aria-hidden="true" /></IconButton>
            </div>)}
          </div>
          {extraDiscountError && <p role="alert" className="mt-1.5 text-xs text-red-600">{extraDiscountError}</p>}
        </div>}
        <div className="mt-3 flex items-center justify-between gap-4 border-t border-blue-100 pt-3 text-xl font-semibold text-slate-800"><span>Total Cost :</span><span>{currency(total)}</span></div>
      </div>
      </div>
    </SchemaFormSection>
    </ReadOnlyFieldset>
    {shootDialogOpen && <AddShootDialog
      initialShoot={editingShoot?.shoot}
      copyOf={copyingShoot}
      existingShoots={shoots}
      vertical={vertical}
      /* The shoots this brand quotes for, from the same list Settings → Field Settings →
         Quotation → Shoot Type maintains and the picture sets are built from - so a quotation
         cannot name a shoot its brand does not do. A brand with none set up falls back to the
         studio's whole vocabulary inside the dialog. */
      shootChoices={brandConfig?.shoots || null}
      // Additional Text beside the shoot's name - "Rituals (Bride Varatham)" - saved on the shoot.
      allowCustomText
      // A shoot is often quoted before its district is known: asked here, not required.
      onClose={() => { setShootDialogOpen(false); setEditingShoot(null); setCopyingShoot(null); }}
      onSave={saveShootRows}
    />}
    <ConfirmDialog
      open={Boolean(pendingVertical)}
      title={`Switch to ${pendingVertical?.vertical || ""}?`}
      message={verticalChangeMessage(pendingVertical)}
      confirmLabel="Switch brand"
      onCancel={() => setPendingVertical(null)}
      onConfirm={() => void confirmVerticalChange()}
    />
    {/* Said before it is done, because neither is a save: one settles this version for the client,
        the other reopens the quotation. The page closes the dialog once the server has answered. */}
    <ConfirmDialog
      open={confirmingFinalization === "finalize"}
      title={`Finalize ${initialQuotation?.quotationId || "this quotation"}?`}
      message={`${versionLabel(initialQuotation)} is kept exactly as it is, and its client link stops expiring. No new version is raised, and nothing can be changed until it is unfinalized.`}
      confirmLabel="Finalize Quotation"
      busyLabel="Finalizing…"
      tone="success"
      loading={finalizing === "finalize"}
      onCancel={() => setConfirmingFinalization("")}
      onConfirm={() => void Promise.resolve(onFinalize?.(quotationPayload())).finally(() => setConfirmingFinalization(""))}
    />
    <ConfirmDialog
      open={confirmingFinalization === "unfinalize"}
      title={`Unfinalize ${initialQuotation?.quotationId || "this quotation"}?`}
      message={`${versionLabel(initialQuotation)} stays exactly as it is and is marked previously finalized. Its link is open for 5 days from now. To change the quotation, edit it and Save as new version - that raises ${versionLabel({ version: Number(initialQuotation?.version || 0) + 1 }).toLowerCase()}.`}
      confirmLabel="Unfinalize"
      busyLabel="Unfinalizing…"
      tone="primary"
      loading={finalizing === "unfinalize"}
      onCancel={() => setConfirmingFinalization("")}
      onConfirm={() => void Promise.resolve(onUnfinalize?.()).finally(() => setConfirmingFinalization(""))}
    />
  </SchemaFormPanel>;
}
