"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import EnquiryCombobox from "@/components/sales/EnquiryCombobox";
import SharedDropdown from "@/components/shared/Dropdown";
import useMenuDismiss from "@/components/shared/useMenuDismiss";
import ChevronIcon from "@/components/ui/ChevronIcon";
import { groupNameFieldsForEnquiry, groupNamesForEnquiry, savedGroupNameForEnquiry, savedGroupNameModeAvailable } from "@/lib/saleGroupName.mjs";
import { getSalesQuotations, getSalesSourceBranches, searchSalesEnquiries } from "@/services/sales/projects.service";
import useBranchRegistry from "@/components/shared/useBranchRegistry";

/*
 * What was sold: the enquiry, the group name, the quotation it converted at, the client's number
 * and the branch that sold it.
 *
 * Lifted out of Create Project so Projects' own Edit shows the same six answers rather than a
 * second implementation of them - the same enquiry search, the same generated-name picker, the
 * same quotation list narrowed to the enquiry, and the same phone and branch rules. The section
 * owns the lists it offers; the form itself stays with the panel, which is what lets one panel
 * hold these fields beside a project's plan and send each half to its own endpoint.
 */

export function parsePhone(value) {
  const match = String(value || "").trim().match(/^(\+\d{1,4})\s*(\d{10})$/);
  return { countryCode: match?.[1] || "+91", clientMainNumber: match?.[2] || String(value || "").replace(/\D/g, "").slice(-10) };
}

/** The sale half of a form's state, read off a project that already exists. */
export function saleFieldsFromProject(project) {
  const phone = parsePhone(project?.clientMainNumber);
  return {
    enquiryId: project?.enquiryId || "",
    /*
     * The version this project converted at, read back rather than blanked.
     *
     * It was hardcoded to "" because the server had nowhere to keep it - reopening a project
     * always showed an empty picker, whichever quotation it had been sold on. Now that
     * `sales_project` holds it, the form reopens on the version it was saved with, and the client
     * number and branch that version settled are read-only again as they were on the way in.
     */
    quotationId: project?.quotationId || "",
    /*
     * The picked version's row id, for the one caller that needs to fetch its payload.
     *
     * `quotationId` is "QUT039-02" - the reference a person quotes, and what the project stores -
     * but `GET /api/sales/quotations/:id` is keyed by the row's own cuid. This carries it from the
     * picker to whoever has to read what was quoted. Never sent anywhere: the schema strips it,
     * and it is blank on a reopened project, which is deliberate - reopening must not re-apply a
     * quotation whose shoots the project has been carrying and adjusting since.
     */
    quotationRowId: "",
    whatsappGroupNameId: project?.whatsappGroupNameId || "",
    whatsappGroupName: project?.whatsappGroupName || "",
    vertical: project?.vertical || "",
    groupType: project?.groupType || "",
    countryCode: phone.countryCode,
    clientMainNumber: phone.clientMainNumber,
    sourceBranch: project?.sourceBranch || "",
    initialConvertedValue: project?.initialConvertedValue === null || project?.initialConvertedValue === undefined ? "" : String(project.initialConvertedValue),
    // Carried rather than dropped. A lead often knows when the event is, and the conversion was
    // handing that date over only for it to be thrown away here - so every converted project
    // was saved reading "Not decided" for a date the lead already had. There is no control for
    // it on this form yet; keeping it on the form's own state is what lets the save send what
    // the lead answered.
    mainEventDateKnown: Boolean(project?.mainEventDateKnown),
    mainEventDate: project?.mainEventDate || "",
    // Carried for the same reason and in the same way as the date above: a conversion started from
    // "Converted & Followup" has to leave the lead reading that rather than a flattened
    // "Converted", and this form has no control for it because it is not a fact about the project.
    crmLeadStatus: project?.crmLeadStatus || "",
  };
}

function isPhoneValid(form) {
  return /^\+\d{1,4}$/.test(form.countryCode) && /^\d{10}$/.test(form.clientMainNumber);
}

export function missingSaleFields(form) {
  /*
   * Named as the form names them, and each one answerable on the form that asks.
   *
   * **Signed Quotation is deliberately not here.** What a project is signed for is Project
   * Management's to decide - it is answered on Projects -> Edit Project, by whoever may edit a
   * running project - and Bookings & Converted shows the figure without offering it, on Create
   * Project and on Edit Sale Details alike. Requiring it here was therefore a field that could be
   * demanded and never answered: a project booked at no quotation refused to save with "Complete
   * required fields: Signed Quotation" pointing at a box with no way into it. A booking may be
   * saved without it; the schedule below says every share works out at zero until it is set.
   */
  const required = [["enquiryId", "Enquiry ID"], ["whatsappGroupName", "WhatsApp Group Name"], ["sourceBranch", "Source Branch"]];
  const missing = required.filter(([key]) => !String(form[key] || "").trim()).map(([, label]) => label);
  if (!isPhoneValid(form)) missing.push("Client Main Number");
  return missing;
}

export function isSaleValid(form) {
  const amount = Number(form.initialConvertedValue);
  return missingSaleFields(form).length === 0 && Number.isFinite(amount) && amount >= 0;
}

/**
 * The same sale, shaped for a PATCH.
 *
 * Create collects shoots and lets the server settle the main event date from whichever one is
 * marked main; an edit touches neither, so the shoots are dropped and the date the project
 * already carries is sent back as it stands. `mainEventDateKnown` reaches this from the form as
 * a boolean, so it is read as one - taking it as the string "Yes" would answer `false` every
 * time and quietly clear a date the user never touched.
 *
 * `crmName` is deliberately not sent: the server keeps the one the project already has rather
 * than anything the browser can claim.
 */
export function salePatchPayload(form) {
  const remark = (field) => form[field]?.trim() || null;
  const known = form.mainEventDateKnown === true || form.mainEventDateKnown === "Yes";
  return {
    enquiryId: form.enquiryId,
    quotationId: form.quotationId || null,
    whatsappGroupNameId: form.whatsappGroupNameId || null,
    whatsappGroupName: String(form.whatsappGroupName || "").trim(),
    clientMainNumber: `${String(form.countryCode || "").trim()} ${form.clientMainNumber}`,
    vertical: form.vertical || null,
    sourceBranch: form.sourceBranch,
    salesPreProductionRemarks: remark("salesPreProductionRemarks"),
    salesProductionRemarks: remark("salesProductionRemarks"),
    salesPostProductionRemarks: remark("salesPostProductionRemarks"),
    initialConvertedValue: Number(form.initialConvertedValue),
    groupType: form.groupType || null,
    mainEventDateKnown: known,
    mainEventDate: known ? form.mainEventDate || null : null,
  };
}

function normalizePhoneInput(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 10);
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

/*
 * `readOnly` says the number came off the quotation the project is converting at, so it is read
 * back rather than typed. Grey rather than disabled - the value is the point, and a greyed-out
 * control reads as broken where a grey field reads as a value somebody else decided.
 */
function ClientPhoneField({ countryCode, value, onCountryCodeChange, onChange, readOnly = false }) {
  const tone = readOnly ? "bg-slate-100" : "bg-white";
  return <fieldset className="block text-[11px] font-semibold text-slate-600 sm:text-xs"><legend>Client Main Number<span aria-hidden="true" className="ml-0.5 text-rose-500">*</span></legend><div className={`mt-1.5 flex min-h-9 rounded-lg border border-slate-300 ${tone} focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100`}><input value={countryCode} readOnly={readOnly} maxLength={5} onChange={(event) => onCountryCodeChange(event.target.value.replace(/[^+\d]/g, "").replace(/(\+.*)\+/g, "$1").slice(0, 5))} inputMode="tel" aria-label="Country code" className={`w-16 shrink-0 rounded-l-lg border-r border-slate-200 bg-slate-50 px-2 text-xs font-normal outline-none sm:text-sm ${readOnly ? "cursor-default text-slate-600" : ""}`} /><input value={normalizePhoneInput(value)} readOnly={readOnly} onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="numeric" aria-label="Client main number" placeholder="12345-12345" className={`min-w-0 flex-1 rounded-r-lg px-3 text-xs font-normal outline-none sm:text-sm ${readOnly ? "cursor-default bg-slate-100 text-slate-600" : ""}`} /></div>{readOnly && <p className="mt-1.5 font-normal text-slate-500">Set from the selected quotation and cannot be changed here.</p>}</fieldset>;
}

/*
 * The group name: chosen from the ones already generated, or typed.
 *
 * The two ways used to be full-width pill buttons stacked above the control, which made this field
 * three rows tall while every other field on the form was one - so nothing in the right-hand column
 * lined up with anything in the left, and the two pills read as two separate inputs rather than as
 * a choice between modes. They are a segmented switch on the label's own row now: the field is one
 * row like its neighbours, and the mode reads as a mode.
 *
 * The typed box carries no label of its own either. "WhatsApp Group Name" is already stated above
 * it, and "Manual WhatsApp Group Name" underneath was the same field labelled twice.
 */
const CONTROL_CLASS = "mt-1.5 flex min-h-9 w-full items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 text-left text-xs font-normal text-slate-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 sm:text-sm";

/**
 * Saved or typed, as a segmented switch.
 *
 * **Saved is offered only when there is something saved to pick.** The switch already followed the
 * enquiry — landing on Manual for one with no generated name — but Saved stayed pressable beside it,
 * and pressing it swapped a usable box for a dropdown whose only content was a sentence explaining
 * that it was empty. Disabled rather than hidden: the choice is still what this control is for, and
 * a switch that loses a side is a different control each time you look at it. `title` says why,
 * since a disabled button cannot say it any other way.
 *
 * Never disabled while the mode *is* Saved — an already-saved project whose enquiry has since lost
 * its generated names would otherwise have the button it is standing on greyed out.
 */
function ModeSwitch({ mode, savedDisabled = false, savedDisabledReason = "", onUseSaved, onUseManual }) {
  const button = (id, label, onClick, disabled = false, title = "") => <button
    key={id}
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={disabled ? title : undefined}
    aria-pressed={mode === id}
    className={`rounded px-2 py-1 transition ${mode === id ? "bg-white text-blue-700 shadow-sm" : disabled ? "cursor-not-allowed text-slate-300" : "text-slate-500 hover:text-slate-700"}`}
  >{label}</button>;
  return <span className="inline-flex shrink-0 rounded-md border border-slate-200 bg-slate-50 p-0.5 text-[11px] font-medium">
    {button("saved", "Saved", onUseSaved, savedDisabled, savedDisabledReason)}
    {button("manual", "Manual", onUseManual)}
  </span>;
}

function GroupNamePicker({ mode, enquiryId, selectedId, selectedName, groupNames, isLoading, onSelect, onUseManual, onUseSaved, manualValue, onManualChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  /*
   * The names for this enquiry, then whatever the search box narrows those to — in that order, and
   * never the other way round. A name is generated for a lead, so the studio's whole pool of unused
   * names is not a list of choices: all but one of them belong to somebody else's booking. Changing
   * the enquiry re-reads this on the next render, so the list follows the enquiry with the menu
   * still open.
   */
  const namesForEnquiry = useMemo(() => groupNamesForEnquiry(groupNames, enquiryId), [groupNames, enquiryId]);
  const matchingNames = useMemo(() => namesForEnquiry.filter((groupName) => groupName.generatedName.toLowerCase().includes(search.trim().toLowerCase())), [namesForEnquiry, search]);
  /*
   * Why the list is empty, rather than one sentence covering three different situations. Nothing
   * here is a fault to be fixed: an enquiry can simply have had no name generated for it yet, and
   * the switch above the box is how one is typed instead.
   */
  const emptyMessage = !String(enquiryId || "").trim()
    ? "Choose an enquiry first — group names are saved against one."
    : namesForEnquiry.length === 0
      ? "No group name has been generated for this enquiry. Use Enter manually, or generate one from W/A Group-Name Generator."
      : "No group names match that search.";
  const close = () => { setOpen(false); setSearch(""); };
  /*
   * Clicking away closes it, and so does Escape.
   *
   * This menu is drawn by hand rather than by `Dropdown` — its rows are two lines, the name over
   * the group type, branch and enquiry it was generated for — and it was built without any of the
   * dismissal that comes with the shared control. Picking a name closed it and nothing else did,
   * so it stayed open over the rest of the form for the whole time the panel was, which reads as a
   * menu that is stuck. `useMenuDismiss` is the rule every other hand-rolled menu in the app
   * already uses; the refs are scoped to the trigger and the panel so clicking either does not
   * count as clicking away.
   */
  useMenuDismiss([triggerRef, menuRef], close, open);
  function select(groupName) { onSelect(groupName); close(); }

  return <div className="relative block text-[11px] font-semibold text-slate-600 sm:text-xs">
    <span className="flex flex-wrap items-center justify-between gap-2">
      <span>WhatsApp Group Name<span aria-hidden="true" className="ml-0.5 text-rose-500">*</span></span>
      <ModeSwitch
        mode={mode}
        // Nothing to pick, so nothing to switch to. The rule itself is in `saleGroupName.mjs`,
        // where the three different kinds of "no" it has to tell apart are set out.
        savedDisabled={!savedGroupNameModeAvailable({ groupNames, enquiryId, isLoading, mode })}
        savedDisabledReason={emptyMessage}
        onUseSaved={onUseSaved}
        onUseManual={onUseManual}
      />
    </span>

    {mode === "manual"
      ? <input
        value={manualValue}
        onChange={(event) => onManualChange(event.target.value)}
        aria-label="WhatsApp group name"
        placeholder="Enter WhatsApp group name"
        className={CONTROL_CLASS}
      />
      : <>
        <button ref={triggerRef} type="button" aria-expanded={open} aria-haspopup="listbox" onClick={() => open ? close() : setOpen(true)} className={CONTROL_CLASS}>
          <span className={selectedId ? "truncate" : "truncate text-slate-400"}>{selectedName || (String(enquiryId || "").trim() ? "Select a group name saved for this enquiry" : "Choose an enquiry first")}</span>
          <ChevronIcon size={20} className="shrink-0 text-slate-500" />
        </button>
        {open && <div ref={menuRef} className="absolute z-[90] mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          {/* Nothing to search when the enquiry has one name or none, and a search box over an
              empty list reads as though something were being hidden by it. */}
          {namesForEnquiry.length > 1 && <div className="border-b border-slate-100 p-2">
            <input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search group names" className="min-h-9 w-full rounded border border-slate-200 px-3 text-sm font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
          </div>}
          <div className="max-h-56 overflow-y-auto">
            {isLoading
              ? <p className="px-3 py-4 text-sm font-normal text-slate-500">Loading available group names...</p>
              : matchingNames.length === 0
                ? <p className="px-3 py-4 text-sm font-normal text-slate-500">{emptyMessage}</p>
                : matchingNames.map((groupName) => <button key={groupName.id} type="button" onClick={() => select(groupName)} className="block w-full border-b border-slate-100 px-3 py-2 text-left text-sm font-normal text-slate-700 hover:bg-blue-50">
                  <span className="block truncate font-medium text-slate-900">{groupName.generatedName}</span>
                  <span className="mt-1 block text-xs text-slate-500">{[groupName.groupType, groupName.branch, groupName.enquiryId].filter(Boolean).join(" · ")}</span>
                </button>)}
          </div>
        </div>}
      </>}
  </div>;
}

/*
 * `enquiryLocked` is a project that already has an enquiry: the picker is drawn as the value it
 * holds rather than as a search box. Which enquiry a booking is against is settled the moment it is
 * created - every figure on this form, the quotation it was priced from and the client it is for
 * all hang off it - so re-pointing it here would move the booking to somebody else while the rest
 * of the form stayed where it was.
 */
export default function SaleDetailsSection({ form, setForm, groupNames = [], isLoadingGroupNames = false, initialGroupNameMode = "saved", enquiryLocked = false }) {
  const [groupNameMode, setGroupNameMode] = useState(initialGroupNameMode);
  const [enquiries, setEnquiries] = useState([]);
  // What the answer said about itself: how many enquiries there are behind the page it returned.
  const [enquiryPage, setEnquiryPage] = useState({ total: 0, capped: false });
  const [isLoadingEnquiries, setIsLoadingEnquiries] = useState(false);
  /*
   * What is being looked for, kept apart from the enquiry that has been chosen.
   *
   * These used to be the same string: the picker wrote every keystroke into `form.enquiryId`, so
   * searching *was* answering and a project could be booked against an id that matched no lead.
   * The search lives here and the answer lives in the form; only picking a row moves one to the
   * other. Seeded from the form so a panel opened on an existing sale searches for that enquiry
   * first rather than for nothing.
   */
  const [enquirySearch, setEnquirySearch] = useState(() => form.enquiryId || "");
  const [quotations, setQuotations] = useState([]);
  const [isLoadingQuotations, setIsLoadingQuotations] = useState(false);
  const [sourceBranches, setSourceBranches] = useState([]);
  // Bumped when Settings → Organization → Branches saves, so Source Branch offers the register as
  // it stands rather than as it was when this form opened.
  const branchRegistryRevision = useBranchRegistry();

  const update = useCallback((field, value) => setForm((current) => ({ ...current, [field]: value })), [setForm]);

  /*
   * The quotations raised for this enquiry, and only those.
   *
   * With no enquiry the list is empty rather than every quotation in the studio: asking for one
   * without an id returns the lot, and offering a stranger's quotation as the price this project
   * converted at is how a project ends up booked against somebody else's figure. The picker says
   * to choose an enquiry first instead.
   */
  const loadQuotations = useCallback(async (enquiryId) => {
    const enquiry = String(enquiryId || "").trim();
    if (!enquiry) {
      setQuotations([]);
      setIsLoadingQuotations(false);
      return;
    }
    setIsLoadingQuotations(true);
    try {
      const response = await getSalesQuotations({ enquiryId: enquiry });
      setQuotations(Array.isArray(response?.data) ? response.data : []);
    } catch {
      setQuotations([]);
    } finally {
      setIsLoadingQuotations(false);
    }
  }, []);

  const searchEnquiries = useCallback(async (search) => {
    setIsLoadingEnquiries(true);
    try {
      const response = await searchSalesEnquiries(search.trim());
      setEnquiries(Array.isArray(response?.data) ? response.data : []);
      setEnquiryPage({ total: Number(response?.total) || 0, capped: Boolean(response?.capped) });
    } catch {
      setEnquiries([]);
      setEnquiryPage({ total: 0, capped: false });
    } finally {
      setIsLoadingEnquiries(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void searchEnquiries(enquirySearch); }, 150);
    return () => window.clearTimeout(timer);
  }, [enquirySearch, searchEnquiries]);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        const response = await getSalesSourceBranches();
        setSourceBranches((Array.isArray(response?.data) ? response.data : []).map((item) => item.name || item.value).filter(Boolean));
      } catch {
        /*
         * Emptied on the way in, where an empty picker is the honest answer to a list that could
         * not be read - but not on a refresh. By then the form is open and being filled in, and a
         * background re-read that fails is no reason to take away branches that are working; the
         * effect below would then be handed an empty list, which is exactly why it asks for one
         * that is not empty before it clears anything.
         */
        if (!branchRegistryRevision) setSourceBranches([]);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [branchRegistryRevision]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setForm((current) => current.sourceBranch && sourceBranches.length && !sourceBranches.includes(current.sourceBranch) ? { ...current, sourceBranch: "" } : current);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [setForm, sourceBranches]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadQuotations(form.enquiryId); }, 0);
    return () => window.clearTimeout(timer);
  }, [form.enquiryId, loadQuotations]);

  function applyEnquiry(enquiry) {
    const phone = parsePhone(enquiry.clientMainNumber);
    /*
     * The name the generator already prepared for this lead, picked up without anyone searching
     * for it: group names are saved against an enquiry now, so choosing the enquiry is choosing
     * its name — and choosing a different enquiry gives up the name that belonged to the last one,
     * whether or not the new one has one of its own.
     */
    // Matched through the helper the picker lists with, so the name filled in automatically is
    // always one the dropdown would also have offered.
    const savedForEnquiry = savedGroupNameForEnquiry(groupNames, enquiry.enquiryId);
    /*
     * The switch follows the enquiry: the saved list where there is one, the box where there is not.
     *
     * It used to move to "saved" for an enquiry that had a name and leave the switch wherever it
     * was for one that did not - which for a new project meant sitting on the dropdown, reading
     * "No group name has been generated for this enquiry", with the way to type one a click away
     * behind a control nobody had a reason to press. The list being empty is not a state to be
     * shown; it is the answer to which of the two this enquiry needs.
     *
     * `savedGroupNameForEnquiry` is the first of the names for this enquiry, so having one and
     * having any are the same question - the one the dropdown would be filled from.
     */
    setGroupNameMode(savedForEnquiry ? "saved" : "manual");
    setForm((current) => {
      const nextEnquiryId = enquiry.enquiryId || current.enquiryId;
      return {
        ...current,
        enquiryId: nextEnquiryId,
        // Takes the new enquiry's name, or clears the last one's — see `groupNameFieldsForEnquiry`.
        // Leaving it alone was the old behaviour, and it carried the previous enquiry's
        // `whatsappGroupNameId` with it, which is the generator row the save claims.
        ...groupNameFieldsForEnquiry({ currentEnquiryId: current.enquiryId, nextEnquiryId, savedForEnquiry }),
        /*
         * A quotation belongs to the enquiry it was raised for, so moving to another enquiry gives
         * up the one that was picked - the list below is reloaded for the new enquiry and would no
         * longer hold it. Left standing, it named a quotation from the previous enquiry while the
         * fields it had settled were being overwritten by this one underneath it, and the amount
         * stayed locked to a figure no longer taken from anywhere.
         */
        ...(nextEnquiryId === current.enquiryId ? {} : { quotationId: "", quotationRowId: "" }),
        countryCode: enquiry.clientMainNumber ? phone.countryCode : current.countryCode,
        clientMainNumber: enquiry.clientMainNumber ? phone.clientMainNumber : current.clientMainNumber,
        sourceBranch: sourceBranches.includes(enquiry.sourceBranch) ? enquiry.sourceBranch : current.sourceBranch,
        initialConvertedValue: enquiry.initialConvertedValue === null || enquiry.initialConvertedValue === undefined ? current.initialConvertedValue : String(enquiry.initialConvertedValue),
      };
    });
  }

  function selectGroupName(groupName) {
    setGroupNameMode("saved");
    setForm((current) => ({
      ...current,
      whatsappGroupNameId: groupName.id,
      whatsappGroupName: groupName.generatedName,
      groupType: groupName.groupType,
      vertical: groupName.vertical,
    }));
  }

  function useManualGroupName() {
    setGroupNameMode("manual");
    setForm((current) => ({ ...current, whatsappGroupNameId: "", whatsappGroupName: "", groupType: "", vertical: "" }));
  }

  function useSavedGroupName() {
    setGroupNameMode("saved");
    setForm((current) => ({ ...current, whatsappGroupNameId: "", whatsappGroupName: "", groupType: "", vertical: "" }));
  }

  /*
   * Every version, not just the newest one.
   *
   * `GET /api/sales/quotations` answers with chains - one row per enquiry, carrying its current
   * version, with the rest of the history on `versions`. Mapping those rows offered exactly one
   * quotation per enquiry, so an enquiry quoted for three times could only ever be converted at
   * version three. That is not how a negotiation ends: the client accepts a figure and the studio
   * often raises a further version afterwards, and until now saying so here was impossible - the
   * only version on offer was the one that had superseded the one they agreed to.
   *
   * Newest first, which is the order the server already returns versions in - the field below
   * passes `sorted={false}` to keep it, because the menu alphabetises by default and that would
   * put version 01 above the version most likely to be wanted.
   */
  const quotationVersions = useMemo(() => quotations.flatMap((chain) => (
    Array.isArray(chain.versions) && chain.versions.length ? chain.versions : [chain]
  )), [quotations]);

  /*
   * Named by the version alone: "QUT039-03". The id carries the version suffix, which is what tells
   * two versions of one chain apart in a list that holds both.
   *
   * The price used to be appended - "QUT039-03 · ₹98,000" - back when picking a version was also
   * the only way to see what it would put in the amount field beside it. That figure is Shedule
   * Payment's **Signed Quotation** now, filled the moment a version is picked and shown in full
   * there, so repeating it in the option was saying the same number twice.
   */
  const quotationValue = (quotation) => quotation.quotationId || quotation.id || quotation.quotationNumber;
  const quotationOptions = useMemo(() => quotationVersions.map((quotation) => ({
    label: quotation.quotationId || quotation.quotationNumber || quotation.label || "Quotation",
    value: quotationValue(quotation),
  })), [quotationVersions]);

  /*
   * Picking a quotation fills in what it was quoted at.
   *
   * The figure itself is no longer a field of this section: it is **Signed Quotation** in Shedule
   * Payment, beside the rows that are shares of it, and it can be corrected there. So this is where
   * the number arrives from the version that was picked, and that section is where a deal closing a
   * little above or below the quote is said out loud. What the client was sent still stands on the
   * quotation, unchanged - correcting *that* is a new version of it.
   */
  function selectQuotation(value) {
    const quotation = quotationVersions.find((row) => quotationValue(row) === value);
    const phone = parsePhone(quotation?.clientMainNumber);
    setForm((current) => ({
      ...current,
      quotationId: value,
      quotationRowId: quotation?.id || "",
      initialConvertedValue: quotation && quotation.amount !== null && quotation.amount !== undefined
        ? String(quotation.amount)
        : current.initialConvertedValue,
      /*
       * Each of these is taken only where the quotation actually answers it. A quotation raised
       * without a number or a branch leaves the field as it was and editable, so the one thing the
       * studio has to type is the one thing nobody has written down yet.
       */
      countryCode: quotation?.clientMainNumber ? phone.countryCode : current.countryCode,
      clientMainNumber: quotation?.clientMainNumber ? phone.clientMainNumber : current.clientMainNumber,
      // Only a branch this viewer's roles actually reach, the same test the enquiry prefill makes -
      // a branch that is not in the list would sit in the field naming nothing the menu can show.
      sourceBranch: quotation?.sourceBranch && sourceBranches.includes(quotation.sourceBranch)
        ? quotation.sourceBranch
        : current.sourceBranch,
    }));
  }

  /*
   * What the chosen quotation has already settled, and what is therefore not this form's to change.
   *
   * A project converts at a quotation: the figure, the number and the branch on it are what the
   * client was sent, so retyping them here would leave the project and the document it converted at
   * disagreeing, with nothing to say which is right. Correcting one of them belongs on the
   * quotation, as a new version, and the project then converts at that.
   *
   * Read off the selected version rather than remembered as a flag, so it is the same answer after
   * a reload as it is the moment the quotation is picked, and so a field the quotation never
   * answered stays open for somebody to fill in.
   */
  const selectedQuotation = quotationVersions.find((row) => quotationValue(row) === form.quotationId) || null;
  const setByQuotation = {
    clientMainNumber: Boolean(selectedQuotation?.clientMainNumber),
    sourceBranch: Boolean(selectedQuotation?.sourceBranch) && sourceBranches.includes(selectedQuotation?.sourceBranch),
  };

  /*
   * One grid, not two stacked columns.
   *
   * The fields used to live in a left `space-y-4` and a right `space-y-4`, so the two sides only
   * lined up while every field was the same height - and the group name picker never was. One
   * taller field on the left pushed everything under it out of step with the right, which is what
   * made the section read as scattered rather than as rows. As grid cells each row is a row: what
   * sits beside what is decided here, and a field growing takes its own row's height with it.
   *
   * Paired by what they answer: which enquiry and which quotation, then how the client is reached
   * and where they came from, then the group name. What the project converts at is Shedule
   * Payment's, beside the schedule it decides.
   */
  return <div className="grid gap-x-6 gap-y-5 md:grid-cols-2">
    {/* `onSearch` narrows the list; `onSelect` is the only thing that settles the enquiry. */}
    <EnquiryCombobox required readOnly={enquiryLocked} value={form.enquiryId} enquiries={enquiries} loading={isLoadingEnquiries} capped={enquiryPage.capped} total={enquiryPage.total} onSearch={setEnquirySearch} onSelect={applyEnquiry} />
    <SharedDropdown mode="input" sorted={false} label="Select Quotation" placeholder={!String(form.enquiryId || "").trim() ? "Select an Enquiry ID first" : isLoadingQuotations ? "Loading quotations..." : quotationOptions.length ? "Select quotation" : "No quotations for this enquiry"} value={form.quotationId} onChange={selectQuotation} options={quotationOptions} disabled={isLoadingQuotations || quotationOptions.length === 0} />
    <ClientPhoneField countryCode={form.countryCode} value={form.clientMainNumber} onCountryCodeChange={(value) => update("countryCode", value)} onChange={(value) => update("clientMainNumber", value)} readOnly={setByQuotation.clientMainNumber} />
    {/* `readOnly` rather than `disabled` where the quotation set it: there is no menu left to open,
        so the chevron would point at nothing, and a value somebody else decided should read as a
        value rather than as a control that refuses to work. `disabled` still covers the other
        silence - no branches to choose from at all. */}
    <div>
      <SharedDropdown mode="input" label="Source Branch" required placeholder={sourceBranches.length ? "Select Source Branch" : "No active branches available"} value={form.sourceBranch} onChange={(value) => update("sourceBranch", value)} options={sourceBranches.map((branch) => ({ label: branch, value: branch }))} disabled={sourceBranches.length === 0} readOnly={setByQuotation.sourceBranch} />
      {setByQuotation.sourceBranch && <p className="mt-1.5 text-[11px] font-normal text-slate-500">Set from the selected quotation and cannot be changed here.</p>}
    </div>
    {/*
      * What the project converts at is not asked here any more.
      *
      * It came off the chosen quotation and sat read-only in this grid, a figure to look at among
      * the fields actually being answered. It is the same number Shedule Payment schedules shares
      * of, so it is stated - and corrected - there instead, beside the rows it decides.
      * `selectQuotation` still fills `initialConvertedValue` from the quotation and the form still
      * sends it; only the box has moved.
      */}
    <GroupNamePicker mode={groupNameMode} enquiryId={form.enquiryId} selectedId={form.whatsappGroupNameId} selectedName={form.whatsappGroupName} groupNames={groupNames} isLoading={isLoadingGroupNames} onSelect={selectGroupName} onUseManual={useManualGroupName} onUseSaved={useSavedGroupName} manualValue={form.whatsappGroupName} onManualChange={(value) => update("whatsappGroupName", value)} />
  </div>;
}
