"use client";

import { useState } from "react";
import Dialog from "@/components/ui/Dialog";
import Button from "@/components/shared/Button";
import Dropdown from "@/components/shared/Dropdown";
import TextField from "@/components/shared/TextField";
import TextAreaField from "@/components/shared/TextAreaField";
import useFormErrors from "@/components/shared/useFormErrors";
import { pricingDeliverableKey, pricingForSave, pricingFormLines, serviceDeliverables } from "@/lib/servicePricing.mjs";
import { deliverableVariantOptions } from "@/lib/deliverableBrands.mjs";
// The same rule a deliverable's answers are read by: the words as typed, or the Yes/No a boolean
// used to mean. A service's Remarks is only ever shown, never read back into an answer.
import { deliverableAnswerText } from "@/lib/deliverableAnswers.mjs";
import { definitionNameTaken } from "@/lib/projectDefinitionNames.mjs";

// Stable, so it runs once when a refusal appears rather than on every render of the form.
const revealOnMount = (node) => node?.scrollIntoView?.({ block: "nearest" });

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
   * A service to start a new one from - More → Duplicate. Everything it holds is the new form's
   * starting point except its name, which is left empty to be typed: the dialog is still adding,
   * Add still creates, and nothing is ever written back to the service it was copied from.
   */
  copyOf = null,
  booleanOptions = [],
  /*
   * The deliverables the studio configures, so the service can name the exact variants it brings
   * with it. Read from Settings → Project → Deliverables like everything else; nothing here names a
   * deliverable, a brand, a size or a length.
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
  // What the form opens holding: the service being edited, or the one being duplicated.
  const source = service || copyOf;
  const [initial] = useState(() => ({
    // A copy keeps its source's name out: the name is the one thing a duplicate must be given.
    name: service?.name || initialName || "",
    // The one price this service is quoted at, on every shoot. Empty means not priced yet.
    price: source?.price == null ? "" : String(source.price),
    /*
     * A note about the service, as typed. One saved while this was a Yes/No pair carries the word
     * it was chosen as, and one never written opens blank - which is what it decides: nothing.
     */
    remarksEnabled: deliverableAnswerText(source?.remarksEnabled),
    /*
     * Whether the service brings deliverables with it. No unless it was answered Yes, which is what
     * every service saved before this was asked reads as - and what keeps them all behaving exactly
     * as they do today.
     */
    deliverableAdded: String(source?.deliverableAdded === true),
    // The variants it brings - one list for the service, see `serviceDeliverables`.
    deliverables: serviceDeliverables(source),
    /*
     * Whether the service is given rather than charged for. No unless it was answered Yes, which is
     * what every service saved before this was asked reads as.
     */
    complimentary: String(source?.complimentary === true),
  }));
  const [form, setForm] = useState(initial);
  const fields = useFormErrors();

  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  /*
   * Editing needs a change, so Update stays disabled until there is one; a missing or taken name
   * is said under its box when the button is pressed. An Update that writes the same values back is a
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
   * Whether the service brings deliverables, and the variants it may be given.
   *
   * The options are every brand-and-variant the studio configures, in the words the Quotation
   * Generator lists them under, so a studio picks the same thing here as it would there. A variant
   * already on the list is not offered again: a service brings a variant once.
   */
  const bringsDeliverables = form.deliverableAdded === "true";
  const deliverableOptions = deliverableVariantOptions(deliverableDefinitions).filter((option) => option.variant);
  const held = new Set(form.deliverables.map(pricingDeliverableKey));
  const addableOptions = deliverableOptions.filter((option) => !held.has(pricingDeliverableKey({ deliverableId: option.definition.id, brandId: option.variant.brandId, variantId: option.variant.variantId })));
  const labelFor = (entry) => deliverableOptions.find((option) => option.id === `${entry.deliverableId}::${entry.brandId}::${entry.variantId}`)?.name || "This deliverable is no longer offered";
  const addDeliverable = (optionId) => {
    const option = deliverableOptions.find((item) => item.id === optionId);
    if (!option) return;
    set({ deliverables: [...form.deliverables, { deliverableId: option.definition.id, brandId: option.variant.brandId, variantId: option.variant.variantId }] });
  };
  const removeDeliverable = (key) => set({ deliverables: form.deliverables.filter((entry) => pricingDeliverableKey(entry) !== key) });

  /*
   * What a duplicate carries that this form no longer asks: the quantity, the timings, the shoot
   * types, the size answer and the stored pricing lines. Shoot Type, Session Timing, Duration and
   * Size left Settings, but a copy is still a copy of everything but the name. An edit sends none
   * of them, so the service keeps whatever it already holds.
   */
  const carried = !isEdit && copyOf ? {
    defaultQuantity: copyOf.defaultQuantity ?? null,
    timingModes: Array.isArray(copyOf.timingModes) && copyOf.timingModes.length ? copyOf.timingModes : [copyOf.timingMode || "NONE"],
    shootTypes: Array.isArray(copyOf.shootTypes) ? copyOf.shootTypes : [],
    timingOptionSetId: copyOf.timingOptionSetId || null,
    defaultDurationHours: copyOf.defaultDurationHours ?? null,
    defaultDurationMinutes: copyOf.defaultDurationMinutes ?? null,
    sizeOptionSetId: copyOf.sizeOptionSetId || null,
    sizeEnabled: copyOf.sizeEnabled === true,
    pricing: pricingForSave(pricingFormLines(copyOf.pricing), copyOf.sizeEnabled === true, copyOf.deliverableAdded === true),
  } : {};

  return (
    <Dialog
      title={isEdit ? "Edit Service" : "Add Service"}
      descriptionAsTip
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
          disabled={saving || (isEdit && !dirty)}
          onClick={() => fields.check({ name: named ? (nameTaken ? "A service with this name already exists." : "") : "Enter the service name." }) && onSubmit({
            ...carried,
            name: named,
            // Null is the answer, not the absence of one: it says the service is not priced yet.
            price: form.price === "" ? null : Number(form.price),
            remarksEnabled: form.remarksEnabled.trim() || null,
            deliverableAdded: bringsDeliverables,
            complimentary: form.complimentary === "true",
            // Only a service that brings deliverables keeps a list; answering No takes it out.
            deliverables: bringsDeliverables ? form.deliverables : [],
          })}
        >
          {saving ? (isEdit ? "Updating..." : "Adding...") : (isEdit ? "Update" : "Add")}
        </Button>
      </>}
    >
      {/* Announced, and scrolled to: Add and Update sit in the footer, so a refusal pressed from the
          foot of a long form would otherwise land above the fold, unseen and unheard. */}
      {error && <p ref={revealOnMount} role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Typed, with nothing offered while it is typed - see `AddServiceForm`. */}
        <TextField
          label="Service Name"
          required
          value={form.name}
          maxLength={191}
          onChange={(event) => { set({ name: event.target.value }); fields.clear("name"); }}
          placeholder="Type a service name"
          helperText="Shown on quotations and projects; each service needs its own name."
          disabled={saving}
          error={fields.errors.name || (nameTaken ? "A service with this name already exists." : "")}
          className="sm:col-span-2"
        />

        {/*
          * One price for the service, quoted on every shoot it is added to - Studio or Outdoor,
          * Half or Full Session. Shoot Type, Session Timing, Duration and Size are not asked here:
          * the per-booking pricing lines they described are no longer read, and whatever a service
          * still stores for them is left as it is.
          */}
        <TextField
          label="Price"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          value={form.price}
          onChange={(event) => set({ price: event.target.value })}
          placeholder="Not priced yet"
          helperText="Quoted on every shoot this service is added to; leave blank if unpriced."
          disabled={saving}
          className="sm:col-span-2"
        />

        {/*
          * Remarks is not a question with two answers. It is a note about the service, typed, and
          * it opens empty because it is written rather than chosen. It decides nothing: a project's
          * service line always has its own remarks box now, whatever is written here.
          */}
        <TextAreaField
          label="Remarks"
          rows={3}
          value={form.remarksEnabled}
          maxLength={2000}
          onChange={(event) => set({ remarksEnabled: event.target.value })}
          placeholder="Anything worth noting about this service"
          helperText="A note about this service; it changes nothing on a project."
          disabled={saving}
          className="sm:col-span-2"
        />

        {/* Whether the service brings deliverables with it. Yes shows the list below; No is what
            every service that has never been asked reads as. The list is kept while the answer is
            flipped and back; only what is on screen is saved. */}
        <Dropdown
          label="Deliverable Added"
          ariaLabel="Deliverable Added"
          helperText="Yes lists the deliverables this service brings to a shoot."
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
          helperText="Yes means it is given free; new quotation lines copy this."
          value={form.complimentary}
          onChange={(value) => set({ complimentary: value })}
          options={booleanOptions}
          disabled={saving}
        />

        {/*
          * What the service brings with it, whenever it is added to a shoot. Each is named the way
          * the Quotation Generator names it, and is removed one at a time.
          */}
        {bringsDeliverables && <fieldset className="text-[11px] font-semibold text-slate-600 sm:col-span-2 sm:text-xs">
          <legend>Deliverables</legend>
          <div className="mt-1.5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-4">
            {form.deliverables.length > 0 && <ul className="mb-3 space-y-1.5">
              {form.deliverables.map((entry) => <li key={pricingDeliverableKey(entry)} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5">
                <span className="min-w-0 flex-1 truncate text-xs font-normal text-slate-700">{labelFor(entry)}</span>
                <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => removeDeliverable(pricingDeliverableKey(entry))} aria-label={`Remove ${labelFor(entry)} from this service`}>Remove</Button>
              </li>)}
            </ul>}
            {/* No label of its own: the "Deliverables" legend already names it, and `ariaLabel`
                carries that to a screen reader. `searchable`, because every deliverable the studio
                configures is listed, named "Demo Album Designing - Studio Press - 16x24", so a
                dozen entries differ only in the last few words; typing "16x24" reaches one. */}
            <Dropdown
              mode="input"
              searchable
              ariaLabel="Add a deliverable to this service"
              // Only a saved deliverable with a brand and a variant can be named here - see
              // `mappableDeliverables` in the panel - so the empty state says what is missing.
              placeholder={deliverableOptions.length ? "+ Add Deliverable" : "No saved deliverable has a brand and variant yet"}
              value=""
              onChange={addDeliverable}
              options={addableOptions.map((option) => ({ label: option.name, value: option.id }))}
              sorted={false}
              helperText="Each one picked comes along whenever this service is added to a shoot."
              disabled={saving || !deliverableOptions.length}
            />
          </div>
        </fieldset>}
      </div>
    </Dialog>
  );
}
