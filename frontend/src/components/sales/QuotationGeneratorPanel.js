"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import SchemaFormSection from "@/components/schema-form/SchemaFormSection";
import ComboBoxField from "@/components/shared/ComboBoxField";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import Dropdown from "@/components/shared/Dropdown";
import RadioGroupField from "@/components/shared/RadioGroupField";
import SharedTextField from "@/components/shared/TextField";
import TextAreaField from "@/components/shared/TextAreaField";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import AddShootDialog from "@/components/project-management/AddShootDialog";
import ProjectServiceCreationSection from "@/components/project-management/ProjectServiceCreationSection";
import { getProjectDeliverableDefinitions, getProjectServiceDefinitions } from "@/services/project-management/project-workflow.service";
import { getCrmLead } from "@/services/sales/crm-leads.service";
import { getCrmLeadEnquiryIds } from "@/services/sales/crm-lead-ids.service";
import { getQuotationSettings } from "@/services/sales/quotation-settings.service";
import { getQuotationBrandConfiguration, getQuotationBrands } from "@/services/sales/quotation-brands.service";
import { autoDeliverableNamesForServices, blockedDeliverableNamesForServices, deliverableExistsForShoot, findDeliverableDefinitionByName } from "@/components/project-management/serviceDeliverableRules";
import Button from "@/components/shared/Button";
import {
  QUOTATION_BRANDS,
  brandCodeForVertical,
  brandDeliverableDefinitions,
  brandFieldsForDeliverableRow,
  brandFieldsForServiceRow,
  brandServiceDefinitions,
  deliverableUnitPrice,
  packageRowsForShoot,
  quotationTotals,
  selectionsLostOnBrandSwitch,
  serviceUnitPrice,
  verticalForBrand,
} from "@/lib/quotationBrand.mjs";
import QuotationVerticalFields from "./QuotationVerticalFields";
import { identificationFromLead } from "./quotationEnquiryPrefill";
import { DEFAULT_VERTICAL, emptyVerticalValues, requiredFieldsFor } from "./quotationVerticalConfig";
import useLeadSuggestionLists from "@/components/sales/useLeadSuggestionLists";
import { servicePriceForShoot, servicePricingRowForLine } from "@/lib/servicePricing.mjs";
import { deliverableVariantLabel } from "@/lib/deliverableBrands.mjs";
import { deliverablePriceForRow } from "@/lib/deliverablePricing.mjs";

const sections = [["identification", "Identification"], ["service-creation", "Service Creation"]];
/*
 * What a quotation is priced with until the studio's own settings arrive.
 *
 * The rates live in Quotation -> More -> Settings and are fetched when this panel opens. These
 * stand in for that first moment, and for the case where the request fails: a generator that
 * priced everything at zero because a settings call did not answer would be worse than one
 * priced at the rates the studio has used all along.
 */
const fallbackRates = { serviceRate: 2000, deliverableRate: 1000, defaultDiscountPercent: 20, gstPercent: 18 };
/*
 * What a quotation asks that a CRM lead does not.
 *
 * The vertical rows above these cover who the client is; these four cover the job being quoted
 * for, and they keep their own columns in the quotation table, so they stay whichever vertical
 * is chosen.
 */
const quotationOnlyFields = [
  ["eventVenue", "Event Venue", "text"],
  ["followedBy", "Followed By", "text"],
  ["referredBy", "Reffered By", "text"],
  ["secondaryContactNumber", "Secondary Contact Number", "text"],
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
 */
export default function QuotationGeneratorPanel({ initialQuotation = null, initialDraft = null, versions = [], selectedVersionId = "", onSelectVersion, onClose, onGenerate }) {
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
  const [vertical, setVertical] = useState(initialPayload.vertical || verticalForBrand(initialQuotation?.quotationBrand) || DEFAULT_VERTICAL);
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
  const { notice, showError, clearNotice } = useNotice();
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
  const [services, setServices] = useState(() => Array.isArray(initialPayload.services) ? initialPayload.services : []);
  const [deliverables, setDeliverables] = useState(() => Array.isArray(initialPayload.deliverables) ? initialPayload.deliverables : []);
  const [serviceDefinitions, setServiceDefinitions] = useState([]);
  const [deliverableDefinitions, setDeliverableDefinitions] = useState([]);
  const [loadingMasterData, setLoadingMasterData] = useState(true);
  const [serviceDefinitionsError, setServiceDefinitionsError] = useState("");
  const [deliverableDefinitionsError, setDeliverableDefinitionsError] = useState("");
  const [shootDialogOpen, setShootDialogOpen] = useState(false);
  const [editingShoot, setEditingShoot] = useState(null);
  // A draft's discount is what somebody chose on the calculator, so it is kept the way a typed one
  // is - `discountTouched` below stops the studio's default from writing over it as the rates load.
  const draftDiscount = initialDraft && Number.isFinite(Number(initialDraft.discount)) ? Number(initialDraft.discount) : null;
  const [discount, setDiscount] = useState(() => initialQuotation ? Number(initialQuotation.discount || 0) : draftDiscount ?? fallbackRates.defaultDiscountPercent);
  /*
   * Editing an existing quotation keeps the rates it was built with, so reopening one cannot
   * silently reprice work already quoted for. Only a new quotation takes the studio's current
   * settings.
   */
  const [rates, setRates] = useState(() => ({ ...fallbackRates, ...(initialPayload.rates || {}) }));
  const [discountTouched, setDiscountTouched] = useState(Boolean(initialQuotation) || draftDiscount !== null);
  const serviceRowsRef = useRef(Array.isArray(initialPayload.services) ? initialPayload.services : []);
  const deliverableRowsRef = useRef(Array.isArray(initialPayload.deliverables) ? initialPayload.deliverables : []);

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
   * request leaves the fallbacks in place rather than pricing at nothing.
   */
  useEffect(() => {
    if (initialQuotation) return undefined;
    let active = true;
    async function loadRates() {
      try {
        const response = await getQuotationSettings();
        if (!active || !response?.data) return;
        setRates((current) => ({ ...current, ...response.data }));
        // Only if the discount has not been typed into yet, so loading cannot overwrite a figure
        // somebody already set for this quotation.
        if (!discountTouched) setDiscount(Number(response.data.defaultDiscountPercent ?? fallbackRates.defaultDiscountPercent));
      } catch {
        // Keep the fallbacks. The panel is still usable and the studio's long-standing rates apply.
      }
    }
    void loadRates();
    return () => { active = false; };
    // `discountTouched` is read, not depended on: refetching because somebody typed a discount
    // would be pointless, and the check inside is what protects their figure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuotation]);

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
   * For a new quotation the brand's GST rate and default discount are taken into the rates the
   * quotation will be priced with, where the brand has set them; an existing quotation keeps the
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
        setRates((current) => ({
          ...current,
          ...(Number.isFinite(Number(config.brand.gstPercent)) && config.brand.gstPercent !== null ? { gstPercent: Number(config.brand.gstPercent) } : {}),
        }));
        if (!discountTouched && config.brand.defaultDiscountPercent !== null && Number.isFinite(Number(config.brand.defaultDiscountPercent))) {
          setDiscount(Number(config.brand.defaultDiscountPercent));
        }
      })
      .catch((error) => {
        if (!active) return;
        setBrandConfig(null);
        setBrandConfigError(error?.message || "Unable to load this brand's services. The studio catalogue is offered instead.");
      });
    return () => { active = false; };
    // `discountTouched` is read, not depended on, for the reason given on the rates effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandCode, initialQuotation]);

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
      label: `${version.quotationId} · ${currency(Number(version.amount || 0))}`,
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
  const totals = quotationTotals({ services, deliverables, rates, discountPercent: discount, gstPercent: rates.gstPercent });
  const { subtotal, amount: total } = totals;

  async function saveShootRows(rows) {
    if (editingShoot) {
      setShoots((current) => current.map((shoot, index) => index === editingShoot.index ? { ...shoot, ...rows[0], id: shoot.id, shootId: shoot.shootId } : rows[0].isMainEvent ? { ...shoot, isMainEvent: false } : shoot));
      setEditingShoot(null);
      setShootDialogOpen(false);
      return;
    }
    setShoots((current) => [...current, ...rows.map((row, index) => ({ ...row, id: `quote-shoot-${Date.now()}-${index}`, shootId: `Q-SID-${String(current.length + index + 1).padStart(4, "0")}` }))]);
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
     * The service's own price for this kind of shoot, where it has one: Studio + Half Session at
     * its figure, an hourly shoot at the line priced for its length. Set in Settings → Project → Services →
     * Pricing, and more specific than the brand's default, so it wins where both exist; a package
     * that names a price still wins over both, through `extra`.
     */
    const timed = servicePriceForShoot(definition, shoot);
    return normalizeService({
      id: `quote-service-${shoot.id}-${definition.id}`,
      shootId: shoot.id,
      serviceDefinitionId: definition.id,
      serviceDefinition: definition,
      serviceName: definition.name,
      ...brandFieldsForServiceRow(definition),
      ...(timed !== null ? { unitPrice: timed } : {}),
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
      // The deliverable's own name, which is what the PDF prints and what a project raised off this
      // quotation matches by. The variant's full label is carried beside it, for the table.
      deliverableName: definition.name,
      quantity: 1,
      ...brandFieldsForDeliverableRow(definition),
      ...deliverableVariantFields(variant),
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
   * A service answered **Deliverable Added** in Settings maps deliverable variants onto each of its
   * pricing rows, and the row this line books under is the one that decides which - the Half
   * Session row's deliverables are not the Full Session row's, and the 12x18 line brings a 12x18
   * print where the 8x12 line does not. `servicePricingRowForLine` is what resolves it, and it
   * answers nothing until the line's own Session Timing and size have been chosen - which is why
   * this is re-run whenever either is.
   *
   * Every row it produces goes through `deliverableRowFor` with the variant it names, which is the
   * same call a hand-picked variant makes. So an automatic line and a manual one are the same row:
   * the same stamped price, the same ids, the same totals, the same payload, the same PDF.
   *
   * `autoFromService` is what makes it removable again. A row added this way records the service
   * and the booking that brought it, so changing that service's size, or taking the service off
   * the shoot, takes its own rows with it and leaves everything somebody added by hand alone.
   */
  function serviceMappedDeliverableRows(shoot, serviceRows) {
    const rows = [];
    for (const service of serviceRows) {
      const definition = service.serviceDefinition;
      if (definition?.deliverableAdded !== true) continue;
      /*
       * The booking *this line* was made at, not the first one the shoot could be read as. A shoot
       * offering both Half and Full answers the price with whichever the service is priced for
       * first - fine for a starting figure, wrong for what the booking brings, since the Half
       * Session row's deliverables are not the Full Session row's. So nothing follows a service in
       * until its Session Timing has been chosen.
       */
      const line = servicePricingRowForLine(definition, shoot, service);
      for (const entry of line?.deliverables || []) {
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
          // The same words a hand-picked variant is added under, the Settings note included.
          label: deliverableVariantLabel(deliverable, brand, variant, { withRemarks: true }),
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
    const next = serviceRowsRef.current.map((item) => {
      if (item.id !== row.id) return item;
      const merged = normalizeService({ ...item, ...data }, offeredServiceDefinitions);
      // A service sold by size is priced by the size picked on the line, so choosing it is what
      // prices the line - only then, and only where the pricing names that size for this shoot.
      if ("sizeOptionValueId" in data) {
        const sized = shoots.find((candidate) => candidate.id === merged.shootId) || null;
        const priced = servicePriceForShoot(merged.serviceDefinition, sized, merged);
        if (priced !== null) merged.unitPrice = priced;
      }
      return merged;
    });
    serviceRowsRef.current = next;
    setServices(next);
    /*
     * A service names the booking it is on only once its Session Timing - and its size, where it is
     * sold by size - has been chosen, so the deliverables that booking brings can only be worked
     * out now. Re-run whole: the old booking's rows go and the new one's arrive, and anything added
     * by hand is left where it is.
     */
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
    setShoots((current) => current.filter((row) => row.id !== shoot.id));
    await clearServices(servicesByShoot[shoot.id] || []);
    await clearDeliverables(deliverablesByShoot[shoot.id] || []);
  }

  function updateIdentification(field, value) {
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
    const lost = [...pending.lostServices.map((row) => row.serviceName), ...pending.lostDeliverables.map((row) => row.deliverableName)].filter(Boolean);
    if (lost.length) lines.push(`${lost.length === 1 ? "This line is" : "These lines are"} not offered by ${pending.vertical} and will be removed: ${lost.join(", ")}.`);
    lines.push("Shoots are kept, and so is anything chosen from the studio catalogue.");
    return lines.join(" ");
  }

  function submit(event) {
    event.preventDefault();
    /*
     * Name what is missing rather than refusing silently. The Identification section can be
     * scrolled well out of view by the time Generate Quotation is reached, so a message that
     * lists the fields is the only way the reader learns which ones to go back to.
     */
    /*
     * The loaded lists travel with the check, so a closed dropdown the studio has not filled in yet
     * is not demanded of anybody — see `requiredFieldsFor`. Religion is the field this is for.
     */
    const missing = [{ key: "enquiryId", label: "Enquire ID" }, ...requiredFieldsFor(vertical, suggestionLists)]
      .filter(({ key }) => !String(identification[key] || "").trim())
      .map(({ label }) => label);
    if (missing.length) {
      showError(`Fill in ${missing.join(", ")} before generating the quotation.`);
      return;
    }
    onGenerate?.({
      ...identification,
      vertical,
      // The same fact under the name the brand tables and the register's column use. The server
      // resolves it again from the vertical, so an older client sending only `vertical` is fine.
      quotationBrand: brandCode,
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
      discount,
      // The figures the snapshot keeps beside the rows: what the discount came to, the GST rate and
      // amount stated on top of the total, and the two together. The register lists `amount`.
      discountAmount: totals.discountAmount,
      gstPercent: totals.gstPercent,
      gstAmount: totals.gstAmount,
      grandTotal: totals.grandTotal,
      // Stamped onto the quotation so the client's copy states the GST that applied when it was
      // raised, and so reopening it later prices from the same numbers.
      rates,
      serviceCount: services.length,
      deliverableCount: deliverables.length,
      shoots,
      services,
      deliverables,
      packages: appliedPackages,
    });
  }

  const footer = <>
    <button type="button" onClick={onClose} className="min-h-10 rounded-md border border-slate-300 px-5 py-2 text-sm font-medium text-slate-700">Close</button>
    <button className="ml-auto min-h-10 rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700">{initialQuotation ? "Save as new version" : "Generate Quotation"}</button>
  </>;

  return <SchemaFormPanel title="Quotation Generator" description={initialQuotation ? `Editing ${initialQuotation.quotationNumber || "this quotation"} — saving raises the next version.` : "Build services and deliverables for a quotation."} sections={sections} sidebarAriaLabel="Quotation generator sections" closeAriaLabel="Close quotation generator" onClose={onClose} onSubmit={submit} footer={footer}>
    <FloatingNotice notice={notice} onClose={clearNotice} />
    <SchemaFormSection id="identification" title="Identification">
      <div className="space-y-5">
        {/* Only when there is a history to pick from. A first quotation has one version and a
            dropdown holding it alone would be a control with nothing to choose. */}
        {versions.length > 0 && <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
          <div className="grid gap-4 md:grid-cols-2">
            <Dropdown
              mode="input"
              label="Version"
              ariaLabel="Quotation version to load"
              value={selectedVersionId}
              options={versionOptions}
              onChange={(value) => onSelectVersion?.(value)}
            />
            <p className="self-end pb-2 text-xs text-slate-600">
              Saving raises <span className="font-semibold">{nextVersionLabel}</span> of {initialQuotation?.quotationNumber || "this quotation"}.
              The version loaded here is left exactly as it was sent, and its link keeps working until its own five days run out.
            </p>
          </div>
        </div>}
        {/* The brand: the same three choices the form has always opened with, under the name the
            studio uses for them. It decides which services, deliverables, packages, event types and
            terms the sections below offer; the sections themselves are the same for every brand. */}
        <RadioGroupField
          label="Quotation Brand"
          name="quotation-vertical"
          value={vertical}
          options={brandOptions}
          disabled={verticalLocked}
          onChange={(next) => void requestVertical(next)}
        />
        {/* Said once, plainly, rather than leaving a greyed-out row to explain itself: a disabled
            control with no reason given reads as broken, not as a rule. */}
        {verticalLocked && <p className="-mt-3 text-xs text-slate-500">
          The brand is set when a quotation is first raised and cannot change on a later version.
        </p>}
        {brandConfigError && <p className="-mt-3 text-xs text-amber-700">{brandConfigError}</p>}
        {/* Suggestions, not a closed list: a quotation is often raised for an enquiry the CRM
            has not been given yet, so an unlisted id can still be typed straight in. */}
        <div className="grid gap-5 md:grid-cols-3">
          <div>
            <ComboBoxField
              label="Enquire ID"
              required
              value={identification.enquiryId}
              options={enquiryIdOptions}
              placeholder="Select or type enquire id"
              onChange={(value) => updateIdentification("enquiryId", value)}
            />
            {/* Said out loud, because fields filling themselves is otherwise indistinguishable
                from the form having been left half-completed by somebody else. */}
            {prefillingEnquiry && <p className="mt-1.5 text-xs font-normal text-slate-500">Filling in the client details this enquiry already has...</p>}
          </div>
        </div>
        <QuotationVerticalFields vertical={vertical} values={identification} onChange={updateIdentification} />
        <div className="grid gap-5 md:grid-cols-3">
          {quotationOnlyFields.map(([field, label]) => (
            <SharedTextField
              key={field}
              label={label}
              value={identification[field]}
              inputMode={field === "secondaryContactNumber" ? "numeric" : undefined}
              maxLength={field === "secondaryContactNumber" ? 10 : undefined}
              onChange={(event) => updateIdentification(field, field === "secondaryContactNumber" ? phoneDigits(event.target.value) : event.target.value)}
              placeholder={`Enter ${label.toLocaleLowerCase()}`}
            />
          ))}
        </div>
      </div>
    </SchemaFormSection>
    {/*
      * Wide, so the section may use the right-hand side the 1040px column left empty: the shoots
      * and their tables keep that width on the left, and the cost summary takes the strip beside
      * them. The grid below is what sets both; nothing else about the section changes. The summary's
      * column only grows where the screen has the room - a wider column on a screen that does not
      * comes straight out of the shoots beside it.
      */}
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
            ariaLabel="Shoot to apply the package to"
            placeholder="Select shoot"
            sorted={false}
            value={packageShootId}
            options={shoots.map((shoot) => ({ label: [shoot.shoot, shoot.shootId].filter(Boolean).join(" · ") || "Shoot", value: shoot.id }))}
            onChange={setPackageShootId}
          />
          <Dropdown
            mode="input"
            label="Package"
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
        /* The same list Add Shoot is given, so editing a row and adding one offer the same shoots.
           They did not: adding went through AddShootDialog and was narrowed to the brand, while
           editing read the studio's whole vocabulary. */
        shootChoices={brandConfig?.shoots || null}
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
        servicesByShoot={servicesByShoot}
        deliverablesByShoot={deliverablesByShoot}
        onAddShoot={() => { setEditingShoot(null); setShootDialogOpen(true); }}
        onAddService={addService}
        onUpdateService={updateService}
        onDeleteService={deleteService}
        onClearServices={clearServices}
        onAddDeliverable={addDeliverable}
        onUpdateDeliverable={updateDeliverable}
        onDeleteDeliverable={deleteDeliverable}
        onClearDeliverables={clearDeliverables}
        onSaveShootEdit={async (shoot, index, nextShoot) => {
          setShoots((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...nextShoot, id: row.id, shootId: row.shootId } : nextShoot.isMainEvent ? { ...row, isMainEvent: false } : row));
        }}
        onDeleteShoot={deleteShoot}
        onRequestEditShoot={(shoot, index) => { setEditingShoot({ shoot, index }); setShootDialogOpen(true); }}
      />
      {/*
        * The one place a quotation can say something its line items cannot - what was agreed on the
        * call, what a price depends on. Full width and last, under the shoots it refers to, and
        * the client reads it, which is said here rather than left to be found out after sending.
        */}
      <div className="mt-6">
        <TextAreaField
          label="Additional Notes"
          rows={4}
          maxLength={2000}
          value={identification.additionalNotes}
          onChange={(event) => updateIdentification("additionalNotes", event.target.value)}
          placeholder="Anything else this quotation should say - an inclusion agreed on a call, a caveat about a date."
        />
        <p className="mt-1.5 text-[11px] font-normal text-slate-500 sm:text-xs">
          Shown on the client&apos;s copy, above Terms &amp; Conditions. Left blank, nothing is printed.
        </p>
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
        <label className="mt-3 flex items-center justify-between gap-4 text-sm">
          <span>Discount in %</span>
          <input type="number" min="0" max="100" value={discount} onChange={(event) => { setDiscountTouched(true); setDiscount(Math.min(100, Number(event.target.value || 0))); }} className="h-9 w-24 rounded-md border border-slate-300 bg-white px-3 text-right text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
        </label>
        <div className="mt-3 flex items-center justify-between gap-4 border-t border-blue-100 pt-3 text-xl font-semibold text-slate-800"><span>Total Cost :</span><span>{currency(total)}</span></div>
      </div>
      </div>
    </SchemaFormSection>
    {shootDialogOpen && <AddShootDialog
      initialShoot={editingShoot?.shoot}
      existingShoots={shoots}
      vertical={vertical}
      /* The shoots this brand quotes for, from the same list Settings → Field Settings →
         Quotation → Shoot Type maintains and the picture sets are built from - so a quotation
         cannot name a shoot its brand does not do. A brand with none set up falls back to the
         studio's whole vocabulary inside the dialog. */
      shootChoices={brandConfig?.shoots || null}
      onClose={() => { setShootDialogOpen(false); setEditingShoot(null); }}
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
  </SchemaFormPanel>;
}
