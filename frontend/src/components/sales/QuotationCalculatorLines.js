"use client";

import { useState } from "react";
import Dropdown from "@/components/shared/Dropdown";
import CloseIcon from "@/components/ui/CloseIcon";
import { SearchablePicker } from "@/components/project-management/ProjectServiceCreationSection";
import { deliverableAnswerOn } from "@/lib/deliverableAnswers.mjs";
import { deliverableOptions, deliverableRows, serviceDisplayLabel, serviceLineLabel } from "@/lib/quotationCalculator.mjs";

/**
 * The services and deliverables on a CRM Quotation Calculator quote, and how they get there.
 *
 * Chosen with the Quotation Generator's own picker: **Choose Services** lists every booking a
 * service is priced as - one entry per Settings pricing line, named Service Name - Shoot Type -
 * Session Timing - Duration - and adds the row the moment one is picked, with that booking chosen;
 * the row keeps an Option dropdown for changing the booking where the service has more than one,
 * the way the generator's row lets its Session Timing be changed. **Choose Deliverables** lists the
 * generator's own brand-and-variant entries, worded the same way. Only what was chosen is listed, each row with its quantity,
 * its No. of Count where the deliverable is counted, and a Remove - which is also how a deliverable
 * a service brought in with it is taken off again when it is not wanted.
 *
 * No unit price is printed anywhere here, on purpose: the calculator prices every row at the
 * Settings figure behind it (`lib/quotationCalculator.mjs`) and the totals beside it say what the
 * rows come to, but the figure per service or deliverable is not the studio's to show the person
 * working the lead. The prices are still read, still stored with the quote, and unchanged.
 *
 * The rows and their quantities are the caller's state; this only draws them and asks for changes.
 */
export default function QuotationCalculatorLines({
  catalogue,
  catalogueError = "",
  serviceRows,
  deliverableQuantities,
  deliverableCounts,
  onAddService,
  onServiceLine,
  onRemoveService,
  onServiceQuantity,
  onAddDeliverable,
  onRemoveDeliverable,
  onDeliverableQuantity,
  onDeliverableCount,
}) {
  const services = catalogue?.services || [];
  const deliverables = catalogue?.deliverables || [];
  const loading = catalogue === null;
  // Every booking Settings has priced, one entry each, the whole booking in its name. A service
  // already on the quote is not offered again under any of its bookings, the way the generator's
  // picker stops offering a service the shoot holds.
  const pricedLinesOf = (service) => (service?.lines || []).filter((line) => line.price !== null);
  const chosenServices = (serviceRows || [])
    .map((row) => ({ row, service: services.find((service) => service.id === row.serviceId) || null }))
    .filter((entry) => entry.service);
  const chosenServiceIds = new Set(chosenServices.map((entry) => entry.service.id));
  const serviceOptions = services.flatMap((service) => pricedLinesOf(service).map((line) => ({ id: line.id, serviceId: service.id, name: serviceDisplayLabel(service.name, line) })));
  const chosenLineIds = new Set(serviceOptions.filter((option) => chosenServiceIds.has(option.serviceId)).map((option) => option.id));
  const deliverableRowList = deliverableRows({ deliverables, deliverableQuantities, deliverableCounts });
  const deliverableChoices = deliverableOptions(deliverables);
  const heldDeliverableKeys = new Set(deliverableRowList.map((row) => row.id));
  const heldDeliverableNames = new Set(deliverableChoices.filter((option) => heldDeliverableKeys.has(option.id)).map((option) => option.name.toLocaleLowerCase()));

  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <section className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
        <SearchablePicker
          label="Choose Services"
          placeholder="Search or browse services"
          options={serviceOptions}
          disabledIds={chosenLineIds}
          disabledNames={new Set()}
          loading={loading}
          emptyMessage="No services available"
          errorMessage={catalogueError}
          onSelect={(option) => onAddService(option.serviceId, option.id)}
          className="max-w-none"
        />
        <LinesList title="Services" loading={loading} loadingText="Loading services…" emptyText="No services selected." rows={chosenServices.map((entry) => entry.service.id)}>
          {chosenServices.map(({ row, service }) => {
            const lines = pricedLinesOf(service);
            const chosen = lines.find((line) => line.id === row.lineId) || null;
            // Service Name - Shoot Type - Session Timing - Duration, from the chosen line's own
            // words; the name alone until the option is picked, and for a flat-priced service.
            const itemLabel = chosen ? serviceDisplayLabel(service.name, chosen) : service.name;
            return (
              <LineRow
                key={service.id}
                name={itemLabel}
                detail=""
                below={lines.length > 1 && (
                  /* Which booking this line is priced as, in the pricing line's own words. Until it
                     is chosen the row is on the quote but prices nothing and brings nothing - the
                     generator's own rule for a row whose Session Timing is still open. */
                  <Dropdown
                    mode="input"
                    sorted={false}
                    ariaLabel={`Option for ${service.name}`}
                    placeholder="Select option"
                    value={row.lineId || ""}
                    options={lines.map((line) => ({ label: serviceLineLabel(line) || "Flat price", value: line.id }))}
                    onChange={(value) => onServiceLine(service.id, value)}
                    className="mt-1.5 w-full [&>span]:hidden [&_button]:mt-0"
                  />
                )}
              >
                <QuantityStepper min={1} value={row.quantity} onChange={(next) => onServiceQuantity(service.id, next)} itemLabel={itemLabel} />
                <RemoveButton label={itemLabel} onClick={() => onRemoveService(service.id)} />
              </LineRow>
            );
          })}
        </LinesList>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
        {/* One entry per brand and variant, as the generator lists them, less what the quote holds. */}
        <SearchablePicker
          label="Choose Deliverables"
          placeholder="Search or browse deliverables"
          options={deliverableChoices}
          disabledIds={heldDeliverableKeys}
          disabledNames={heldDeliverableNames}
          loading={loading}
          emptyMessage="No deliverables available"
          errorMessage={catalogueError}
          onSelect={(option) => onAddDeliverable(option.id)}
          className="max-w-none"
        />
        <LinesList title="Deliverables" loading={loading} loadingText="Loading deliverables…" emptyText="No deliverables selected." rows={deliverableRowList.map((row) => row.id)}>
          {deliverableRowList.map((row) => (
            <LineRow
              key={row.id}
              name={row.name}
              detail={row.detail}
              below={deliverableAnswerOn(row.photoCountEnabled) && (
                /* No. of Count, only where the deliverable's own Settings answer asks for it - the
                   same question the Quotation Generator's table asks, multiplying the quantity by it. */
                <CountInput value={row.count} onChange={(next) => onDeliverableCount(row.id, next)} itemLabel={row.name} />
              )}
            >
              <QuantityStepper min={1} value={row.quantity} onChange={(next) => onDeliverableQuantity(row.id, next)} itemLabel={row.name} />
              <RemoveButton label={row.name} onClick={() => onRemoveDeliverable(row.id)} />
            </LineRow>
          ))}
        </LinesList>
      </section>
    </div>
  );
}

/** The box under a picker: a heading with Qty on the right, then the rows, or what there is instead. */
function LinesList({ title, loading, loadingText, emptyText, rows, children }) {
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 sm:px-4 sm:text-sm">
        <span>{title}</span>
        {/* Over the stepper, with the Remove column's width kept clear to its right. */}
        <span className="mr-8 w-[5.5rem] text-center text-[11px] text-slate-500 sm:text-xs">Qty</span>
      </div>
      <div className="max-h-[26rem] overflow-y-auto">
        {loading && <p className="px-4 py-6 text-center text-xs text-slate-500 sm:text-sm">{loadingText}</p>}
        {!loading && rows.length === 0 && <p className="px-4 py-6 text-center text-xs text-slate-500 sm:text-sm">{emptyText}</p>}
        {children}
      </div>
    </div>
  );
}

/**
 * One chosen row, the same shape on both panels: the name, its words and any control that belongs
 * to them (`below` - a service's option, a deliverable's No. of Count) on the left, and a fixed
 * right column holding the stepper and Remove. Two columns on every width, so the controls never
 * drop under the words and every row's stepper sits under the Qty heading; on a 360px phone the
 * words truncate rather than the row wrapping.
 */
function LineRow({ name, detail, below = null, children }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-slate-100 px-3 py-2.5 text-xs text-slate-600 last:border-b-0 sm:px-4 sm:text-sm">
      <div className="min-w-0">
        <p className="truncate font-medium text-slate-700" title={name}>{name}</p>
        {detail && <p className="truncate text-[11px] text-slate-400 sm:text-xs" title={detail}>{detail}</p>}
        {below}
      </div>
      <div className="flex shrink-0 items-center gap-1">{children}</div>
    </div>
  );
}

function RemoveButton({ label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Remove ${label}`}
      title="Remove"
      className="inline-flex h-8 w-7 shrink-0 items-center justify-center rounded-md text-slate-500 transition hover:bg-red-50 hover:text-red-600"
    >
      <CloseIcon className="h-4 w-4" />
    </button>
  );
}

/** No. of Count, typed: a blank or a zero is no count, and the row is priced on its quantity alone. */
function CountInput({ value, onChange, itemLabel }) {
  return (
    <label className="mt-1.5 flex items-center gap-2 text-[11px] font-semibold text-slate-500 sm:text-xs">
      <span>No. of Count</span>
      <input
        type="text"
        inputMode="numeric"
        maxLength={6}
        aria-label={`No. of Count for ${itemLabel}`}
        value={value ? String(value) : ""}
        onChange={(event) => onChange(Number(event.target.value.replace(/[^\d]/g, "")) || 0)}
        className="min-h-8 w-20 rounded-md border border-slate-300 bg-white px-2 text-center text-xs font-normal text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 sm:text-sm"
      />
    </label>
  );
}

/**
 * A quantity, typed or stepped, held between `min` and the limit the product sets.
 *
 * The number is typed as well as stepped because some of these count in sheets: an album is quoted
 * at 35 of them, and reaching 35 meant pressing `+` thirty-five times. The two buttons stay for the
 * rows where one press is the whole answer - a frame, a session - and the box is focusable, so a
 * sheet count is one edit rather than a drum roll.
 *
 * `min` is 1 on a row that is on the quote: a line on a quotation counts at least once, which is
 * the Quotation Generator's rule, and taking it off is what Remove is for. `max` is the product's
 * ceiling, or `null` for no limit. Where there is one the answers run from `min` to that number and
 * no further - a quotation past it is not one the studio can honour, so it is refused rather than
 * sent on to be discovered later.
 */
export function QuantityStepper({ value = 0, onChange, itemLabel, max = null, min = 0 }) {
  // A ceiling of 0 or a nonsense one is no ceiling: better an uncapped box than one that can only
  // ever hold nothing.
  const ceiling = Number(max) > 0 ? Math.floor(Number(max)) : null;
  const floor = Math.max(0, Math.floor(Number(min)) || 0);
  const atCeiling = ceiling !== null && value >= ceiling;
  /*
   * What is in the box while it is being typed in, which is not the same as the value.
   *
   * Clamping on every keystroke is what makes a two-digit limit awkward to type: on the way to 35
   * the box holds "3" for a moment, and a cap applied then is fine - but the same shape applied to
   * a lower cap would fight the typist. The draft is left exactly as typed and judged once, when
   * the box is left, so what somebody meant is read whole.
   */
  const [draft, setDraft] = useState(null);
  const editing = draft !== null;

  /** Nothing outside floor..ceiling ever reaches the caller. Past the top is pulled back to the top
   *  rather than refused silently - somebody typing 40 against a 35-sheet album meant the most that
   *  album takes, and being moved to it says the limit out loud. Below the floor is the floor. */
  function settle(text) {
    setDraft(null);
    const typed = Number(String(text).replace(/[^\d]/g, ""));
    if (!Number.isFinite(typed) || typed <= floor) return onChange(floor);
    return onChange(ceiling !== null && typed > ceiling ? ceiling : typed);
  }

  return (
    <div className="inline-flex w-[5.5rem] items-center justify-between rounded-full border border-slate-200 bg-white px-1 py-0.5 text-xs font-semibold text-slate-700 focus-within:border-blue-400 sm:text-sm">
      <button
        type="button"
        aria-label={`Remove one ${itemLabel}`}
        disabled={value <= floor}
        onClick={() => onChange(Math.max(floor, value - 1))}
        className="px-1.5 text-blue-600 disabled:cursor-not-allowed disabled:text-slate-300"
      >
        −
      </button>
      <input
        type="text"
        inputMode="numeric"
        aria-label={ceiling === null ? `Quantity of ${itemLabel}` : `Quantity of ${itemLabel}, up to ${ceiling}`}
        // The limit is said in the label above rather than in `aria-valuemax`, which a textbox does
        // not carry - a spinbutton does, and this is not one.
        maxLength={6}
        value={editing ? draft : String(value).padStart(2, "0")}
        onChange={(event) => {
          const digits = event.target.value.replace(/[^\d]/g, "");
          // Held to the ceiling as it is typed as well as when it is left: a box that accepts 400
          // and silently shows 35 a moment later reads as the number having been lost.
          setDraft(ceiling !== null && Number(digits) > ceiling ? String(ceiling) : digits);
        }}
        // Select on arrival, so typing replaces the "00" rather than landing beside it.
        onFocus={(event) => { setDraft(String(value || "")); event.target.select(); }}
        onBlur={(event) => settle(event.target.value)}
        // Enter settles it where a form would otherwise be submitted by it; Escape puts it back.
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); settle(event.currentTarget.value); event.currentTarget.blur(); }
          if (event.key === "Escape") { setDraft(null); event.currentTarget.blur(); }
        }}
        className="min-w-7 max-w-10 bg-transparent text-center tabular-nums outline-none"
      />
      <button
        type="button"
        aria-label={`Add one ${itemLabel}`}
        // Stops at the ceiling rather than walking past it, and says so by going dead - the same
        // way `−` already says there is nothing below the floor.
        disabled={atCeiling}
        onClick={() => onChange(ceiling === null ? value + 1 : Math.min(ceiling, value + 1))}
        className="px-1.5 text-blue-600 disabled:cursor-not-allowed disabled:text-slate-300"
      >
        +
      </button>
    </div>
  );
}
