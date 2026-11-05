"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useModuleAccess } from "@/components/auth/PermissionsProvider";
import ModulePageHeader from "@/components/layout/ModulePageHeader";
import Button from "@/components/shared/Button";
import TextField from "@/components/shared/TextField";
import DateField from "@/components/shared/DateField";
import Dropdown from "@/components/shared/Dropdown";
import HelpTip from "@/components/shared/HelpTip";
import SimpleTable from "@/components/data-table/SimpleTable";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import EnquiryCombobox from "@/components/sales/EnquiryCombobox";
import QuotationCalculatorLines from "@/components/sales/QuotationCalculatorLines";
import { durationForSessionTiming } from "@/components/project-management/AddShootDialog";
import { verticalCode } from "@/components/sales/whatsappGroupNameUtils";
import { getLeadQuote, getQuotationBookings, getQuotationCatalogue } from "@/services/sales/quotationCalculator.service";
import { getProjectDeliverableDefinitions, getProjectServiceDefinitions } from "@/services/project-management/project-workflow.service";
import { getCrmLead } from "@/services/sales/crm-leads.service";
import { searchSalesEnquiries } from "@/services/sales/projects.service";
import { MAX_DISCOUNT_PERCENT } from "@/lib/quotationDiscount.mjs";
import { calculatorTotals, serviceQuantitiesFromRows, serviceRowsFromQuantities, syncAutoDeliverables } from "@/lib/quotationCalculator.mjs";
import { generatorDraftFromCalculator } from "@/lib/quotationCalculatorHandoff.mjs";
import { stashQuotationGeneratorDraft } from "@/lib/quotationGeneratorDraft";


const rupeeFormat = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

// The money boxes are typed into, so what arrives is whatever the user pressed. Anything that is
// not part of a number is dropped rather than turning the total into NaN.
function formatRupees(value) {
  return `₹ ${rupeeFormat.format(Math.max(0, Math.round(value || 0)))}`;
}

// Discounts are offered in fives, the way the studio quotes them, up to the quotation's cap.
const discountOptions = Array.from({ length: MAX_DISCOUNT_PERCENT / 5 + 1 }, (_, index) => {
  const percent = index * 5;
  return { label: `${percent}`, value: String(percent) };
});

/**
 * Prices what the studio is quoting for, against the same service and deliverable master data the
 * Sales Manager module works from — there is no second copy of the catalogue kept here.
 *
 * What it charges is the base package price plus extras, plus every chosen service line and
 * deliverable at the price Settings gave it, less a discount. The rows are chosen the way the
 * Quotation Generator chooses them - Add Service, Add Deliverable, the same variant list, the same
 * auto-added deliverables - and no unit price is printed beside them; see
 * `QuotationCalculatorLines` and `lib/quotationCalculator.mjs`.
 */
export default function QuotationCalculatorPage() {
  /*
   * Which lead this is pricing, from the URL - `?lead=<enquiry id>`, which the lead popup's own
   * Quotation Calculator button navigates to. Opened from the sidebar there is none, and the
   * calculator prices without one: the saved-quote read is skipped and the handoff carries no
   * enquiry, both of which it already allowed for as a dialog.
   */
  const searchParams = useSearchParams();
  const leadFromUrl = searchParams.get("lead") || "";
  // The enquiry chosen on the page, for somebody who opened it cold and wants the price to end up
  // on a quotation - see the picker below for why it is only offered to some readers.
  const [pickedLead, setPickedLead] = useState("");
  const leadId = leadFromUrl || pickedLead;
  // Apply to Quotation opens the Quotation Generator on these choices, and raising a quotation is
  // Quotation Management's Read / Write - the same permission the generator itself is offered on.
  const { canWrite: canApply } = useModuleAccess("SALES", "Quotation Management");
  const router = useRouter();
  const [eventDate, setEventDate] = useState("");
  // null until a date has been asked about, so "no bookings" is only ever said about a day that
  // was actually looked up.
  const [bookings, setBookings] = useState(null);
  const [bookingsError, setBookingsError] = useState("");
  const [catalogue, setCatalogue] = useState(null);
  const [catalogueError, setCatalogueError] = useState("");
  // Bumped by Try again. A catalogue that failed once - the backend restarting, a dropped
  // connection - is worth asking for again without closing the dialog and losing what is typed.
  const [catalogueAttempt, setCatalogueAttempt] = useState(0);
  // One row per chosen service: the pricing line it is priced as - blank while a service priced
  // under several bookings waits for the option to be picked on its row - and its quantity. What
  // is priced, synced and saved is the quantities by line these resolve to.
  const [serviceRows, setServiceRows] = useState([]);
  const serviceQuantities = useMemo(() => serviceQuantitiesFromRows(serviceRows), [serviceRows]);
  // Keyed by the deliverable's id, or by `deliverable::brand::variant` for a chosen variant.
  const [deliverableQuantities, setDeliverableQuantities] = useState({});
  // No. of Count per deliverable row, where its definition asks for one.
  const [deliverableCounts, setDeliverableCounts] = useState({});
  // Which deliverable rows a service line brought in, so removing the line takes them with it.
  const [autoDeliverables, setAutoDeliverables] = useState({});
  const [basePackagePrice, setBasePackagePrice] = useState("");
  const [extras, setExtras] = useState("");
  const [discountPercent, setDiscountPercent] = useState("0");
  // The state of handing these choices to the Quotation Generator.
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState("");
  // What Apply to Quotation has to say before it goes: the figures the generator has no line for.
  const [handoffNotice, setHandoffNotice] = useState(null);

  /*
   * The enquiries this page may offer, and only where the reader may read them.
   *
   * `/api/sales/enquiries` answers to `SALES / Sales Manager`; this page answers to Quotation
   * Management. Somebody holding the second and not the first is not shown a picker that would come
   * back 403 - they price without an enquiry, which the calculator has always allowed, and the
   * figures still reach a quotation by opening the calculator from the lead itself.
   */
  const { canRead: canPickEnquiry } = useModuleAccess("SALES", "Sales Manager");
  const [enquiries, setEnquiries] = useState([]);
  const [enquiriesLoading, setEnquiriesLoading] = useState(false);
  const [enquirySearch, setEnquirySearch] = useState("");
  useEffect(() => {
    // Only for the cold-opened page: the button carried the lead, and a picker beside a fact is a
    // second way to answer a question already answered.
    if (leadFromUrl || !canPickEnquiry) return undefined;
    let active = true;
    // Typed at rather than on every keystroke, like every other search on this module - and the
    // waiting starts when the asking does, not while somebody is still typing.
    const timer = window.setTimeout(() => {
      setEnquiriesLoading(true);
      void searchSalesEnquiries(enquirySearch)
        .then((response) => { if (active) setEnquiries(Array.isArray(response?.data) ? response.data : []); })
        .catch(() => { if (active) setEnquiries([]); })
        .finally(() => { if (active) setEnquiriesLoading(false); });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [leadFromUrl, canPickEnquiry, enquirySearch]);


  useEffect(() => {
    let active = true;
    void getQuotationCatalogue()
      .then((response) => {
        if (!active) return;
        const data = response?.data || {};
        setCatalogue({
          services: Array.isArray(data.services) ? data.services : [],
          deliverables: Array.isArray(data.deliverables) ? data.deliverables : [],
        });
        setCatalogueError("");
      })
      .catch((error) => {
        if (!active) return;
        setCatalogue({ services: [], deliverables: [] });
        setCatalogueError(error?.message || "Unable to load the quotation catalogue.");
      });
    return () => {
      active = false;
    };
  }, [catalogueAttempt]);

  /*
   * Reopens where it was left: the quantities, base package, extras and discount the lead's last
   * applied quote was built from. A lead never quoted, or one the reader may not see, starts
   * empty - the same screen as before, with nothing to undo.
   */
  useEffect(() => {
    if (!leadId) return undefined;
    let active = true;
    void getLeadQuote(leadId)
      .then((response) => {
        if (!active) return;
        const data = response?.data || {};
        const draft = data.draft || {};
        // A draft saved before rows existed is read back from its quantities by line.
        setServiceRows(Array.isArray(draft.serviceRows) ? draft.serviceRows : serviceRowsFromQuantities(draft.serviceQuantities || {}));
        setDeliverableQuantities(draft.deliverableQuantities || {});
        setDeliverableCounts(draft.deliverableCounts || {});
        setAutoDeliverables(draft.autoDeliverables || {});
        setBasePackagePrice(draft.basePackagePrice || "");
        setExtras(draft.extras || "");
        // A lead's estimate saved under the old limit reopens at the cap, the most it can be now.
        setDiscountPercent(String(Math.min(MAX_DISCOUNT_PERCENT, Number(draft.discountPercent) || 0)));
      })
      .catch(() => { /* Nothing saved for this lead: the calculator opens empty. */ });
    return () => { active = false; };
  }, [leadId]);

  useEffect(() => {
    if (!eventDate) return undefined;
    let active = true;
    void getQuotationBookings(eventDate)
      .then((response) => {
        if (!active) return;
        setBookings(Array.isArray(response?.data) ? response.data : []);
        setBookingsError("");
      })
      .catch((error) => {
        if (!active) return;
        setBookings([]);
        setBookingsError(error?.message || "Unable to load bookings for the selected date.");
      });
    return () => {
      active = false;
    };
  }, [eventDate]);

  const services = catalogue?.services || [];
  const deliverables = catalogue?.deliverables || [];

  const { lines: linesCost, serviceCost, totalCost } = calculatorTotals({ services, deliverables, serviceQuantities, deliverableQuantities, deliverableCounts, basePackagePrice, extras, discountPercent });

  /*
   * A service added, removed, or booked under another option changes what the services bring with
   * them, so the deliverables are worked out again from the rows as they now stand - the Quotation
   * Generator's rule, applied by the same helper the totals read. Stepping a quantity changes
   * nothing about what is brought, so it does not re-sync (and cannot put back a deliverable
   * somebody has just taken off).
   */
  const applyServiceRows = (nextRows) => {
    setServiceRows(nextRows);
    const synced = syncAutoDeliverables({ services, deliverables, serviceQuantities: serviceQuantitiesFromRows(nextRows), deliverableQuantities, deliverableCounts, autoDeliverables });
    setDeliverableQuantities(synced.deliverableQuantities);
    setDeliverableCounts(synced.deliverableCounts);
    setAutoDeliverables(synced.autoDeliverables);
  };
  const addService = (serviceId, lineId = "") => {
    if (serviceRows.some((row) => row.serviceId === serviceId)) return;
    // The booking picked, or - where none was and the service is priced under one only - that one.
    const lines = (services.find((service) => service.id === serviceId)?.lines || []).filter((line) => line.price !== null);
    const chosen = lines.find((line) => line.id === lineId)?.id || (lines.length === 1 ? lines[0].id : "");
    applyServiceRows([...serviceRows, { serviceId, lineId: chosen, quantity: 1 }]);
  };
  const setServiceLine = (serviceId, lineId) => {
    applyServiceRows(serviceRows.map((row) => (row.serviceId === serviceId ? { ...row, lineId: lineId || "" } : row)));
  };
  const removeService = (serviceId) => {
    applyServiceRows(serviceRows.filter((row) => row.serviceId !== serviceId));
  };
  const setServiceQuantity = (serviceId, next) => {
    setServiceRows((current) => current.map((row) => (row.serviceId === serviceId ? { ...row, quantity: next } : row)));
  };
  const addDeliverableRow = (key) => {
    setDeliverableQuantities((current) => (current[key] > 0 ? current : { ...current, [key]: 1 }));
  };
  const removeDeliverableRow = (key) => {
    const without = (current) => { const next = { ...current }; delete next[key]; return next; };
    setDeliverableQuantities(without);
    setDeliverableCounts(without);
    setAutoDeliverables(without);
  };
  const setDeliverableQuantity = (key, next) => {
    setDeliverableQuantities((current) => ({ ...current, [key]: next }));
  };
  const setDeliverableCount = (key, next) => {
    setDeliverableCounts((current) => ({ ...current, [key]: next }));
  };

  /*
   * Apply to Quotation: these choices, handed to the Quotation Generator as its own rows.
   *
   * The generator is where a quotation is raised, so nothing is saved here - not onto the lead, not
   * as a quotation. The catalogue the generator draws rows from is read (a row carries its whole
   * definition), the lead the calculator was opened for is read for its vertical and enquiry id,
   * and `generatorDraftFromCalculator` builds the payload; it is stashed for the Quotations screen
   * to open on, and the person is sent there. A choice the generator cannot carry - a service whose
   * option is still unchosen, a variant Settings has since removed - stops the handoff and is
   * named, rather than dropped on the way.
   */
  async function buildHandoff() {
    const [serviceResult, deliverableResult, leadResult] = await Promise.all([
      getProjectServiceDefinitions(),
      getProjectDeliverableDefinitions(),
      leadId ? getCrmLead(leadId).catch(() => null) : Promise.resolve(null),
    ]);
    return generatorDraftFromCalculator({
      catalogue,
      serviceRows,
      deliverableQuantities,
      deliverableCounts,
      autoDeliverables,
      eventDate,
      basePackagePrice,
      extras,
      discountPercent,
      serviceDefinitions: Array.isArray(serviceResult?.data) ? serviceResult.data : [],
      deliverableDefinitions: Array.isArray(deliverableResult?.data) ? deliverableResult.data : [],
      lead: leadResult?.data?.lead || null,
      leadId: leadId || "",
      durationFor: durationForSessionTiming,
    });
  }

  function openGeneratorWith(draft) {
    stashQuotationGeneratorDraft(draft);
    router.push("/sales/quotation");
  }

  async function applyToQuotation() {
    setApplying(true);
    setApplyError("");
    try {
      const handoff = await buildHandoff();
      if (handoff.skipped.length) {
        setApplyError(`Not applied. ${handoff.skipped.join(" ")}`);
        return;
      }
      /*
       * The generator prices services and deliverables and has no line for a base package or for
       * extras, so those figures travel as words in Additional Notes rather than as money in the
       * total - said before leaving, so the total the generator shows is not a surprise.
       */
      if (handoff.carriedAsNote.length) {
        setHandoffNotice(handoff);
        return;
      }
      openGeneratorWith(handoff.draft);
    } catch (error) {
      setApplyError(error?.message || "Unable to open the Quotation Generator with these choices.");
    } finally {
      setApplying(false);
    }
  }

  /*
   * The page's own frame, which is the one every module page uses: the shell scrolls its inner pane,
   * never the page, so the header stays and the calculator scrolls under it.
   *
   * It was a dialog until 2026-10-08 - a portal, a backdrop, Escape and a close button - opened over
   * the lead popup. Pricing a quotation is not a question somebody answers in a moment and dismisses:
   * it is a screen they sit on, with the catalogue, the bookings for a date and a dozen rows, and on
   * a phone a dialog that tall is a page with a border drawn round it.
   */
  /** Closes the tab the calculator was opened in, or falls back to the leads screen. */
  function leave() {
    if (window.history.length <= 1) {
      window.close();
      // A browser that refused the close leaves the tab here, so it still needs somewhere to go.
      router.push("/sales/crm");
      return;
    }
    router.back();
  }

  return <section className="flex h-full min-h-0 w-full min-w-0 flex-col">
    <ModulePageHeader
      title="Quotation Calculator"
      actions={<>
        {/* Back out of the tab this was opened in. There is no history behind it, so `router.back()`
            sat here doing nothing; where the tab cannot be closed - a pasted link, or a browser
            refusing to close what it did not open by script - it goes to the leads screen rather
            than leaving a dead button. */}
        <Button type="button" variant="secondary" onClick={leave}>Back</Button>
        {/* Apply opens the Quotation Generator on these choices; the quotation is raised there, by
            Generate Quotation, and nothing is written until then. Absent without the permission to
            raise one. */}
        {canApply && (
          <Button type="button" variant="primary" disabled={applying} onClick={() => void applyToQuotation()}>
            {applying ? "Applying..." : "Apply to Quotation"}
          </Button>
        )}
      </>}
    />

    <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 px-4 py-4 sm:px-6">
      <div className="mx-auto w-full max-w-5xl space-y-4">
        {/*
          * Which lead is being priced, said at the top.
          *
          * Opened from a lead it is a fact, not a choice: the button carried it. Opened cold it is a
          * picker, so the price can still reach a quotation - **where the reader may read the list**.
          * That list is `SALES / Sales Manager`'s (`/api/sales/enquiries`), and this page answers to
          * Quotation Management, so somebody holding one and not the other would be shown a picker
          * that answers 403. They price without an enquiry instead, which the calculator allows.
          */}
        {leadFromUrl
          ? <p className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600 sm:text-sm">
            Pricing <span className="font-medium text-slate-800">{leadFromUrl}</span>.
          </p>
          : canPickEnquiry && <div className="rounded-xl border border-slate-200 bg-white p-4">
            <EnquiryCombobox
              label="Enquiry ID"
              helperText="Pick the client's enquiry so this price can go onto their quotation."
              value={pickedLead}
              enquiries={enquiries}
              loading={enquiriesLoading}
              onSearch={setEnquirySearch}
              onSelect={(entry) => setPickedLead(entry?.enquiryId || "")}
            />
          </div>}
          <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
            <DateField label="Event / Shoot Date" helperText="Lists the bookings already on this date before you price." value={eventDate} onChange={setEventDate} className="max-w-xs" />
            {bookingsError && <p role="alert" className="text-xs text-red-600 sm:text-sm">{bookingsError}</p>}
            {!bookingsError && eventDate && bookings !== null && (
              bookings.length === 0
                ? <p className="text-xs text-slate-500 sm:text-sm">No Bookings on the selected Date</p>
                : (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-600 sm:text-sm">Bookings ({bookings.length})</p>
                    {/* Scrolls inside its own box: a long list of bookings must not widen the
                        dialog or push the calculator below the fold. */}
                    <SimpleTable
                      variant="form"
                      /* Scrolls inside its own box: a long list of bookings must not widen the
                         dialog or push the calculator below the fold. */
                      classNames={{
                        wrapper: "max-w-2xl",
                        table: "min-w-[32rem] text-xs sm:text-sm",
                        head: "!bg-transparent !text-slate-600 !tracking-normal !text-xs sm:!text-sm",
                        headRow: "border-b border-slate-200",
                        th: "font-semibold",
                        row: "!border-t-0 border-b border-slate-100 text-slate-600 last:border-b-0",
                      }}
                      columns={[
                        { key: "bookingId", label: "Booking ID", render: (booking) => booking.bookingId || "—" },
                        { key: "branch", label: "Branch", render: (booking) => booking.branch || "—" },
                        { key: "vertical", label: "Vertical", render: (booking) => verticalCode(booking.vertical) || "—" },
                        { key: "details", label: "Details", render: (booking) => booking.details || "—" },
                      ]}
                      rows={bookings}
                    />
                  </div>
                )
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Base Package Price"
              helperText="Rupees added to the total; the generator gets it as a note."
              inputMode="decimal"
              value={basePackagePrice}
              onChange={(event) => setBasePackagePrice(event.target.value)}
              className="rounded-xl border border-slate-200 bg-white p-4"
            />
            <TextField
              label="Extras"
              helperText="Any extra rupees added to the total, carried over as a note."
              inputMode="decimal"
              value={extras}
              onChange={(event) => setExtras(event.target.value)}
              className="rounded-xl border border-slate-200 bg-white p-4"
            />
          </div>

          {catalogueError && (
            <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
              <p className="min-w-0 flex-1 text-xs text-red-700 sm:text-sm">{catalogueError}</p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setCatalogue(null);
                  setCatalogueError("");
                  setCatalogueAttempt((current) => current + 1);
                }}
              >
                Try again
              </Button>
            </div>
          )}

          {/* Only what has been chosen, with no unit price beside it. The totals below carry the
              figures; the per-row price is read from the catalogue and never printed here. */}
          <QuotationCalculatorLines
            catalogue={catalogue}
            catalogueError={catalogueError}
            serviceRows={serviceRows}
            deliverableQuantities={deliverableQuantities}
            deliverableCounts={deliverableCounts}
            onAddService={addService}
            onServiceLine={setServiceLine}
            onRemoveService={removeService}
            onServiceQuantity={setServiceQuantity}
            onAddDeliverable={addDeliverableRow}
            onRemoveDeliverable={removeDeliverableRow}
            onDeliverableQuantity={setDeliverableQuantity}
            onDeliverableCount={setDeliverableCount}
          />

          {/* Under the deliverables' column on a wide screen, as it always sat; full width below `lg`. */}
          <section className="rounded-xl bg-blue-50 px-4 py-3 text-slate-700 lg:ml-auto lg:w-[calc(50%-0.5rem)]">
            <div className="flex items-center justify-between gap-3 text-xs sm:text-sm">
              <span>Services &amp; Deliverables :</span>
              <span className="tabular-nums">{formatRupees(linesCost)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 text-xs sm:text-sm">
              <span>Service Cost :</span>
              <span className="tabular-nums">{formatRupees(serviceCost)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 text-xs sm:text-sm">
              <span>Discount in %<HelpTip text="Taken off the services and deliverables; the total below updates." /></span>
              <Dropdown
                mode="input"
                ariaLabel="Discount in %"
                value={discountPercent}
                onChange={setDiscountPercent}
                options={discountOptions}
                className="w-20 [&>span]:hidden [&_button]:mt-0"
              />
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 border-t border-blue-100 pt-2">
              <span className="text-sm font-medium text-slate-800 sm:text-base">Total Cost :</span>
              <span className="text-lg font-medium tabular-nums text-slate-800 sm:text-xl">{formatRupees(totalCost)}</span>
            </div>
          </section>
        {applyError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 sm:text-sm">{applyError}</p>}
      </div>
    </div>
    <ConfirmDialog
        open={Boolean(handoffNotice)}
        title="Open the Quotation Generator?"
        message={`The generator prices services and deliverables only. ${(handoffNotice?.carriedAsNote || []).join(" ")} These will be written into Additional Notes and are not added to the quotation's total.`}
        confirmLabel="Open generator"
        onCancel={() => setHandoffNotice(null)}
      onConfirm={() => { const draft = handoffNotice?.draft; setHandoffNotice(null); if (draft) openGeneratorWith(draft); }}
    />
  </section>;
}
