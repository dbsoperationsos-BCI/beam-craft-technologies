"use client";

import { useState } from "react";
import Dialog from "@/components/ui/Dialog";
import Button from "@/components/shared/Button";
import ComboBoxField from "@/components/shared/ComboBoxField";
import Dropdown from "@/components/shared/Dropdown";
import TextField from "@/components/shared/TextField";
import TextAreaField from "@/components/shared/TextAreaField";
import { DURATION_MAX_LENGTH, defaultDurationFor, duplicatePricingLines, emptyPricingLine, matchServiceSize, pricedTimingModesFor, pricingDeliverableKey, pricingForSave, pricingFormLines, pricingKey, pricingLineComplete, sizeKeyOf } from "@/lib/servicePricing.mjs";
import { deliverableVariantOptions } from "@/lib/deliverableBrands.mjs";
// The same rule a deliverable's answers are read by: the words as typed, or the Yes/No a boolean
// used to mean. A service's Remarks is only ever shown, never read back into an answer.
import { deliverableAnswerText } from "@/lib/deliverableAnswers.mjs";
import { definitionNameTaken } from "@/lib/projectDefinitionNames.mjs";
import { HOURS_MINUTES, SHOOT_TYPE_OPTIONS, sessionsTicked } from "./definitionTimingFields";

/**
 * One service's settings, configured in a dialog rather than in the table.
 *
 * The table used to be the editor: seven dropdowns on every row, each committing on change. That is
 * a fine way to fix one value and a poor way to add a service, because adding meant typing a name,
 * finding the new row, and then working across seven controls that each looked like they might have
 * saved and might not have. A service is one thing with several settings, so it is configured in one
 * place and written once.
 *
 * Built from the same parts as `AddShootDialog`, which is the dialog this module already uses to add
 * a row to a list: the shared `Dialog` at `size="form"`, `layer="dialogOverPanel"` because it opens
 * over the settings panel, and the module's own fields.
 */

export default function ServiceDefinitionDialog({
  service = null,
  /*
   * The name typed into the box above the table, carried into a new service.
   *
   * Without it the dialog opened empty: a new service passes `service={null}`, so the name the
   * person had just chosen was read off an object that was not there and came back blank. They had
   * picked "360 Camera Booth", pressed Add, and been asked for the name again.
   */
  initialName = "",
  /*
   * The option set a session-timed service is booked from, chosen here rather than asked.
   *
   * The dialog used to offer a Timing Options dropdown; every service answered it with the same
   * set - the studio's Service Session Timing - so it is not asked any more. A service that ticks a
   * session and names no set gets this one, which is what keeps the session picker on a project's
   * shoot line offering Half and Full for a service added after the dropdown went.
   */
  defaultTimingOptionSetId = "",
  // The studio's service size lists, with their values, suggested as a size is typed on a line.
  sizeOptionSets = [],
  timingOptions = [],
  booleanOptions = [],
  /*
   * The deliverables the studio configures, so a pricing row can name the exact variants that
   * booking brings with it. Read from Settings → Project → Deliverables like everything else;
   * nothing here names a deliverable, a brand, a size or a length.
   */
  deliverableDefinitions = [],
  /*
   * The names every other service on the page already has, as the keys the server judges them
   * by - see `projectDefinitionNames`. A name that is one of them is refused here, with the box
   * still on screen, rather than at Save with the row already staged in the table.
   */
  takenNames = [],
  saving = false,
  error = "",
  onClose,
  onSubmit,
}) {
  const isEdit = Boolean(service?.id);
  const [initial] = useState(() => ({
    name: service?.name || initialName || "",
    price: service?.price == null ? "" : String(service.price),
    /*
     * The quantity as a number somebody types, not a mode they pick.
     *
     * Empty means the service is not counted - a drone either comes or it does not - and the
     * backend turns that into the mode the rest of the application already reads.
     */
    defaultQuantity: service?.defaultQuantity == null ? "" : String(service.defaultQuantity),
    // A list, falling back to the single mode on a service saved before this existed.
    timingModes: Array.isArray(service?.timingModes) && service.timingModes.length
      ? service.timingModes.filter((mode) => mode !== "NONE")
      : (service?.timingMode && service.timingMode !== "NONE" ? [service.timingMode] : []),
    /*
     * One shoot type, held as the one-item list the record stores.
     *
     * A service saved while this was a pair of tick boxes may hold both, or neither (which meant
     * every shoot type). Either opens with nothing selected: the radio has no way to say "both",
     * and the next edit has to say which one it is before it can be saved.
     */
    shootTypes: Array.isArray(service?.shootTypes) && service.shootTypes.length === 1 ? service.shootTypes : [],
    timingOptionSetId: service?.timingOptionSetId || "",
    defaultDurationHours: service?.defaultDurationHours == null ? "" : String(service.defaultDurationHours),
    defaultDurationMinutes: service?.defaultDurationMinutes == null ? "" : String(service.defaultDurationMinutes),
    sizeOptionSetId: service?.sizeOptionSetId || "",
    /*
     * A note about the service, as typed. One saved while this was a Yes/No pair carries the word
     * it was chosen as, and one never written opens blank - which is what it decides: nothing.
     */
    remarksEnabled: deliverableAnswerText(service?.remarksEnabled),
    /*
     * The pricing lines, each naming its own shoot type and timing with the price as typed. They
     * are the person's own list, not derived from the Shoot Type and Session Timing answered above:
     * a service may be priced for an outdoor booking whatever it is filed under. Only complete
     * lines with a figure are sent - see `pricingForSave`.
     */
    pricing: pricingFormLines(service?.pricing),
    // Whether the service is sold by size. No unless it was answered Yes.
    sizeEnabled: String(service?.sizeEnabled === true),
    /*
     * Whether the service brings deliverables with it. No unless it was answered Yes, which is what
     * every service saved before this was asked reads as - and what keeps them all behaving exactly
     * as they do today.
     */
    deliverableAdded: String(service?.deliverableAdded === true),
    /*
     * Whether the service is given rather than charged for. No unless it was answered Yes, which is
     * what every service saved before this was asked reads as.
     */
    complimentary: String(service?.complimentary === true),
  }));
  const [form, setForm] = useState(initial);
  // Counts the lines added since the dialog opened, so each gets a key of its own.
  const [nextLineId, setNextLineId] = useState(0);

  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  /*
   * The button is disabled until pressing it would do something.
   *
   * Adding needs a name; editing needs a change. An Update that writes the same values back is a
   * request nobody meant to make, and a button that looks live when it has nothing to do is the
   * thing that makes people press it twice and wonder which press counted.
   *
   * The same rule the settings panel's own Save follows, so a dialog and the panel behind it agree
   * about when there is something to save.
   */
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const named = form.name.trim();
  // Another service already answers to this name; the server would refuse the save.
  const nameTaken = definitionNameTaken(named, takenNames);
  /*
   * The shoot types and timings a service is offered for, now that the dialog no longer asks for
   * them on their own: everything the service already held, plus whatever its pricing lines name.
   * A line priced for Outdoor + Full Session makes the service bookable on an outdoor shoot by the
   * session - otherwise the price could never be reached - and nothing a service was offered for
   * before is taken away by pricing only part of it. A project's Choose Services picker and its
   * session picker read these exactly as they did.
   */
  const priced = pricingForSave(form.pricing);
  const shootTypes = [...new Set([...form.shootTypes, ...priced.map((row) => row.shootType)])];
  const timingModes = [...new Set([...form.timingModes, ...priced.map((row) => row.timingMode)])];
  /*
   * The pricing lines' own controls. The timing list follows the line's shoot type - Hours /
   * Minutes is a studio timing, so an outdoor line is not offered it - and a line already holding
   * it loses it on the way to Outdoor, exactly as the tick boxes above do.
   */
  const timingOptionsFor = (lineShootType) => timingOptions.filter((option) => pricedTimingModesFor(lineShootType).includes(option.value));
  const sized = form.sizeEnabled === "true";
  /*
   * Whether each booking is asked what it brings with it, and the variants it may be given.
   *
   * The options are every brand-and-variant the studio configures, in the words the Quotation
   * Generator lists them under, so a studio picks the same thing here as it would there. A line
   * already holding a variant does not offer it again: a booking brings a variant once.
   */
  const bringsDeliverables = form.deliverableAdded === "true";
  const deliverableOptions = deliverableVariantOptions(deliverableDefinitions).filter((option) => option.variant);
  const optionsFor = (line) => {
    const held = new Set((line.deliverables || []).map(pricingDeliverableKey));
    return deliverableOptions.filter((option) => !held.has(pricingDeliverableKey({ deliverableId: option.definition.id, brandId: option.variant.brandId, variantId: option.variant.variantId })));
  };
  const labelFor = (entry) => deliverableOptions.find((option) => option.id === `${entry.deliverableId}::${entry.brandId}::${entry.variantId}`)?.name || "This deliverable is no longer offered";
  const addDeliverableTo = (id, optionId) => {
    const option = deliverableOptions.find((item) => item.id === optionId);
    if (!option) return;
    const line = form.pricing.find((item) => item.id === id);
    setLine(id, { deliverables: [...(line?.deliverables || []), { deliverableId: option.definition.id, brandId: option.variant.brandId, variantId: option.variant.variantId }] });
  };
  const removeDeliverableFrom = (id, key) => {
    const line = form.pricing.find((item) => item.id === id);
    setLine(id, { deliverables: (line?.deliverables || []).filter((entry) => pricingDeliverableKey(entry) !== key) });
  };
  const duplicates = duplicatePricingLines(form.pricing, sized);
  /*
   * The sizes suggested as a size is typed: every entry of the studio's service size lists - LED
   * Wall Sizes, TV Sizes and any it adds under Settings → Project → Sizes. The size is whatever is
   * typed; one that matches an entry carries that entry's id as well, which is what lets a project
   * or quotation line offer it in its Size picker. Nothing here names a size.
   */
  const sizeValues = sizeOptionSets.flatMap((set) => (set.values || []).filter((value) => value.isActive !== false));
  const sizeSuggestions = [...new Set(sizeValues.map((value) => value.label).filter(Boolean))];
  const typeSize = (id, size) => setLine(id, { size, sizeOptionValueId: matchServiceSize(size, sizeValues)?.id || "" });
  const setLine = (id, patch) => set({ pricing: form.pricing.map((line) => (line.id === id ? { ...line, ...patch } : line)) });
  const addLine = () => { set({ pricing: [...form.pricing, emptyPricingLine(nextLineId)] }); setNextLineId((current) => current + 1); };
  const removeLine = (id) => set({ pricing: form.pricing.filter((line) => line.id !== id) });

  return (
    <Dialog
      title={isEdit ? "Edit Service" : "Add Service"}
      description="These settings decide what a project is asked for when this service is used."
      size="form"
      layer="dialogOverPanel"
      busy={saving}
      onClose={onClose}
      footer={<>
        <Button className="max-sm:flex-1" type="button" disabled={saving} onClick={onClose}>Cancel</Button>
        <Button
          className="max-sm:flex-1"
          type="button"
          variant="primary"
          // Two pricing lines for the same booking cannot both be right, so the save waits until
          // one of them goes.
          disabled={saving || !named || nameTaken || duplicates.length > 0 || (isEdit && !dirty)}
          onClick={() => onSubmit({
            name: named,
            // Null is the answer, not the absence of one: it says the service is not priced yet.
            price: form.price === "" ? null : Number(form.price),
            // Null is the answer here, not the absence of one: it says the service is not counted.
            defaultQuantity: form.defaultQuantity === "" ? null : Number(form.defaultQuantity),
            // "NONE" is how the backend spells an empty list; the tick boxes spell it as none ticked.
            timingModes: timingModes.length ? timingModes : ["NONE"],
            shootTypes,
            /*
             * Which option set names the sessions this service is booked in.
             *
             * Sent as null when no session is ticked, matching what the server stores: it clears the
             * set for a service that has no session to choose one for, so sending anything else here
             * would only be overwritten.
             */
            timingOptionSetId: sessionsTicked(timingModes) ? (form.timingOptionSetId || defaultTimingOptionSetId || null) : null,
            /*
             * Only a service timed in hours and minutes carries one.
             *
             * A duration typed and then unticked would otherwise stay on the record, invisible in
             * the dialog and still seeding every shoot that used the service.
             */
            ...(timingModes.includes(HOURS_MINUTES)
              ? {
                defaultDurationHours: form.defaultDurationHours === "" ? null : Number(form.defaultDurationHours),
                defaultDurationMinutes: form.defaultDurationMinutes === "" ? null : Number(form.defaultDurationMinutes),
              }
              : { defaultDurationHours: null, defaultDurationMinutes: null }),
            sizeOptionSetId: form.sizeOptionSetId || null,
            remarksEnabled: form.remarksEnabled.trim() || null,
            sizeEnabled: sized,
            deliverableAdded: bringsDeliverables,
            complimentary: form.complimentary === "true",
            // Every complete line with a figure; a line still being filled in is not a price. The
            // variants a booking brings ride on its own line, and only where the service says so.
            pricing: pricingForSave(form.pricing, sized, bringsDeliverables),
          })}
        >
          {saving ? (isEdit ? "Updating..." : "Adding...") : (isEdit ? "Update" : "Add")}
        </Button>
      </>}
    >
      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Typed, with nothing offered while it is typed - see `AddServiceForm`. */}
        <TextField
          label="Service Name"
          required
          value={form.name}
          maxLength={191}
          onChange={(event) => set({ name: event.target.value })}
          placeholder="Type a service name"
          disabled={saving}
          error={nameTaken ? "A service with this name already exists." : ""}
          className="sm:col-span-2"
        />

        {/*
          * Price, Quantity, Timing Options, Size, Shoot Type, Session Timing and Duration are not
          * asked here any more. A service's price and quantity are settled on the project that uses
          * it, the timing set is always the studio's own (see `defaultTimingOptionSetId`), no
          * service names a size set, and the shoot type, timing and length now come off the pricing
          * lines below, which say the same thing with a figure beside it. A value a service already
          * holds for any of them is carried through the save untouched.
          */}
        {/*
          * Remarks is not a question with two answers. It is a note about the service, typed, and
          * it opens empty because it is written rather than chosen. It decides nothing: a project's
          * service line always has its own remarks box now, whatever is written here. It used to be
          * the switch for that box, which made a genuine note beginning "Not applicable" or "No
          * drone on this one" silently turn it off across every project using the service.
          */}
        <TextAreaField
          label="Remarks"
          rows={3}
          value={form.remarksEnabled}
          maxLength={2000}
          onChange={(event) => set({ remarksEnabled: event.target.value })}
          placeholder="Anything worth noting about this service"
          disabled={saving}
          className="sm:col-span-2"
        />

        {/* Whether the service is sold by size. Yes puts a Size on every pricing line below, so
            the same shoot type and timing can be priced once per size; No leaves the lines as they
            are. Lines keep whatever size they hold while the answer is flipped and back. */}
        <Dropdown
          label="Size (Wall or TV etc...)"
          ariaLabel="Size (Wall or TV etc...)"
          value={form.sizeEnabled}
          onChange={(value) => set({ sizeEnabled: value })}
          options={booleanOptions}
          disabled={saving}
        />

        {/* Whether the service brings deliverables with it. Yes puts a Deliverables list on every
            pricing row below, because it is the *booking* that decides which: the 12x18 row brings
            a 12x18 print and the 8x12 row does not. No leaves the rows exactly as they were, and is
            what every service that has never been asked reads as. Lines keep whatever they hold
            while the answer is flipped and back; only what is on screen is saved. */}
        <Dropdown
          label="Deliverable Added"
          ariaLabel="Deliverable Added"
          value={form.deliverableAdded}
          onChange={(value) => set({ deliverableAdded: value })}
          options={booleanOptions}
          disabled={saving}
        />

        {/* Whether the service is given rather than charged for. A quotation copies this onto a
            line as the line is added and the line's answer is then its own - changing it here never
            moves a quotation already raised, and changing it there never writes back. */}
        <Dropdown
          label="Complimentary"
          ariaLabel="Complimentary"
          value={form.complimentary}
          onChange={(value) => set({ complimentary: value })}
          options={booleanOptions}
          disabled={saving}
        />

        {/*
          * Pricing, per shoot type and session timing - always on screen, never folded away.
          *
          * A service is not one price: a studio half session and a studio full session are sold at
          * different figures, and an hourly booking at a rate. Each line is a booking the person
          * names - its shoot type and timing from dropdowns, the duration read off them - beside its
          * price box. Lines are added and removed here and are not tied to the Shoot Type and
          * Session Timing answered above. A quotation line added for a shoot takes the line matching
          * that shoot as its unit price.
          */}
        <fieldset className="text-[11px] font-semibold text-slate-600 sm:col-span-2 sm:text-xs">
          <legend>Pricing</legend>
          <div className="mt-1.5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-4">
            <div className="space-y-4">
              {form.pricing.map((line) => {
                const hourly = line.timingMode === HOURS_MINUTES;
                const key = pricingLineComplete(line, sized) ? pricingKey(line.shootType, line.timingMode, line.hours, sized ? sizeKeyOf(line) : "") : "";
                const duplicate = Boolean(key) && duplicates.includes(key);
                return <div key={line.id} className={`grid grid-cols-1 gap-3 sm:items-end ${sized ? "sm:grid-cols-[1fr_1fr_1fr_1fr_1fr_auto]" : "sm:grid-cols-[1fr_1fr_1fr_1fr_auto]"}`}>
                  <Dropdown
                    mode="input"
                    label="Shoot Type"
                    ariaLabel="Pricing shoot type"
                    placeholder="Select shoot type"
                    value={line.shootType}
                    // A timing the new shoot type does not offer goes with the change.
                    onChange={(value) => setLine(line.id, { shootType: value, timingMode: pricedTimingModesFor(value).includes(line.timingMode) ? line.timingMode : "", ...(pricedTimingModesFor(value).includes(line.timingMode) ? {} : { hours: "", duration: "" }) })}
                    options={SHOOT_TYPE_OPTIONS}
                    sorted={false}
                    disabled={saving}
                  />
                  <Dropdown
                    mode="input"
                    label="Session Timing"
                    ariaLabel="Pricing session timing"
                    placeholder={line.shootType ? "Select timing" : "Select a shoot type first"}
                    value={line.timingMode}
                    // The hours belong to an hourly line and go with a change away from it; a
                    // session line starts on the studio's own length, ready to be typed over.
                    onChange={(value) => setLine(line.id, { timingMode: value, hours: "", duration: defaultDurationFor(value) })}
                    options={timingOptionsFor(line.shootType)}
                    sorted={false}
                    disabled={saving || !line.shootType}
                    error={duplicate ? "Already priced above" : ""}
                  />
                  {/* Typed on an hourly line - whole hours, counted up from one - because that
                      line prices a booking of exactly that length. A session line starts on the
                      studio's own length, "4-5 Hours (Half)", and takes whatever is typed over it. */}
                  {hourly
                    ? <TextField
                      label="Duration (hours)"
                      type="number"
                      min="1"
                      step="1"
                      inputMode="numeric"
                      value={line.hours}
                      onChange={(event) => setLine(line.id, { hours: event.target.value })}
                      placeholder="Hours"
                      disabled={saving}
                    />
                    : <TextField
                      label="Duration"
                      value={line.duration}
                      maxLength={DURATION_MAX_LENGTH}
                      onChange={(event) => setLine(line.id, { duration: event.target.value })}
                      placeholder={line.timingMode ? "e.g. 4-5 Hours" : "—"}
                      disabled={saving || !line.timingMode}
                    />}
                  {/* Only on a service sold by size: typed, with the studio's service size lists
                      suggested; a size that matches an entry is linked to it. */}
                  {sized && <ComboBoxField
                    label="Size"
                    ariaLabel="Pricing size"
                    placeholder="Type a size"
                    value={line.size}
                    onChange={(value) => typeSize(line.id, value)}
                    options={sizeSuggestions}
                    disabled={saving || !line.timingMode}
                    error={duplicate ? "Already priced above" : ""}
                  />}
                  <TextField
                    label="Price"
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.price}
                    onChange={(event) => setLine(line.id, { price: event.target.value })}
                    placeholder="Not priced yet"
                    disabled={saving || !pricingLineComplete(line, sized)}
                  />
                  <Button type="button" variant="ghost" size="sm" className="sm:mb-0.5" disabled={saving} onClick={() => removeLine(line.id)} aria-label="Remove this pricing line">Remove</Button>
                  {/*
                    * What this booking brings with it, under the booking it belongs to.
                    *
                    * Spanning the row rather than sitting in a column of its own: a line may bring
                    * several deliverables and each reads as a sentence, so a column would be a
                    * column of truncated text. Each is named the way the Quotation Generator names
                    * it, and is removed one at a time.
                    */}
                  {bringsDeliverables && <div className="sm:col-span-full">
                    <p className="text-[11px] font-semibold text-slate-600 sm:text-xs">Deliverables</p>
                    {(line.deliverables || []).length > 0 && <ul className="mt-1.5 space-y-1.5">
                      {(line.deliverables || []).map((entry) => <li key={pricingDeliverableKey(entry)} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5">
                        <span className="min-w-0 flex-1 truncate text-xs font-normal text-slate-700">{labelFor(entry)}</span>
                        <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => removeDeliverableFrom(line.id, pricingDeliverableKey(entry))} aria-label={`Remove ${labelFor(entry)} from this booking`}>Remove</Button>
                      </li>)}
                    </ul>}
                    <div className="mt-1.5">
                      {/* No label of its own: the "Deliverables" heading above already names it,
                          and `ariaLabel` is what carries that to a screen reader.

                          `searchable`, because this is the longest list on the form: every
                          deliverable the studio has configured, each named the way the Quotation
                          Generator names it - "Demo Album Designing - Studio Press - 16x24" - so a
                          dozen entries differ only in the last few words of a long line. Scrolling
                          to one is reading the same prefix over and over; typing "16x24" is not.
                          The box filters on anything in the label, so the brand, the size and the
                          deliverable all reach it. */}
                      <Dropdown
                        mode="input"
                        searchable
                        ariaLabel="Add a deliverable to this booking"
                        // Only a saved deliverable with a brand and a variant can be named
                        // here - see `mappableDeliverables` in the panel - so the empty state
                        // says what is missing rather than that nothing exists.
                        placeholder={deliverableOptions.length ? "+ Add Deliverable" : "No saved deliverable has a brand and variant yet"}
                        value=""
                        onChange={(value) => addDeliverableTo(line.id, value)}
                        options={optionsFor(line).map((option) => ({ label: option.name, value: option.id }))}
                        sorted={false}
                        disabled={saving || !deliverableOptions.length}
                      />
                    </div>
                  </div>}
                </div>;
              })}
            </div>
            <Button type="button" variant="secondary" size="sm" className="mt-4" disabled={saving} onClick={addLine}>Add Pricing</Button>
          </div>
        </fieldset>
      </div>
    </Dialog>
  );
}
