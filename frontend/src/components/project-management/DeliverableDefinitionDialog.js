"use client";

import { useState } from "react";
import Dialog from "@/components/ui/Dialog";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Button from "@/components/shared/Button";
import ComboBoxField from "@/components/shared/ComboBoxField";
import Dropdown from "@/components/shared/Dropdown";
import TextField from "@/components/shared/TextField";
import TextAreaField from "@/components/shared/TextAreaField";
import RadioGroupField from "@/components/shared/RadioGroupField";
import { MEDIA_TYPE_OPTIONS } from "@/lib/deliverablePricing.mjs";
import {
  brandFormRows,
  brandsForSave,
  emptyDeliverableBrand,
  emptyDeliverableVariant,
  variantsLosingValues,
} from "@/lib/deliverableBrands.mjs";
import { deliverableAnswerText } from "@/lib/deliverableAnswers.mjs";
import { definitionNameTaken } from "@/lib/projectDefinitionNames.mjs";

/**
 * One deliverable's settings, configured in a dialog rather than in the table.
 *
 * The same change the Services table went through, for the same reason: the table was the editor,
 * five dropdowns on every row, each committing on change. That is a fine way to fix one value and a
 * poor way to add a deliverable, because adding meant typing a name, finding the new row, and then
 * working across five controls that each looked like they might have saved and might not have.
 *
 * What the form asks, in the order it asks it:
 *
 *     Deliverable Name and Deliverable Type
 *     Brand (many) -> Variant (many)
 *     No. of Count, Image Selection, Remarks
 *
 * A deliverable used to hold one company, one size, one frame, one length and one price, which is
 * not how they are sold: the same album is sold by Canvera and by Pictoo, each in several sizes at
 * several prices. So it holds brands, and a brand holds the variants it sells the deliverable in -
 * a Size, a Frame Inches and a Price for an image, a Length and a Price for a video, and never one
 * type's boxes on the other's. Brands and variants are added and removed here; the rules live in
 * `@/lib/deliverableBrands.mjs` so `node --test` can hold them.
 *
 * The three questions underneath are asked of every deliverable whatever its type, and are typed
 * words rather than a Yes and a No - a studio writes what it actually does, "50 photos" or "2
 * sets". They still decide things, by the rule in `@/lib/deliverableAnswers.mjs`.
 */
export default function DeliverableDefinitionDialog({
  deliverable = null,
  /*
   * The name typed into the box above the table, carried into a new deliverable - a new one passes
   * `deliverable={null}`, so the name has nowhere else to come from.
   */
  initialName = "",
  /*
   * Yes and No, as the words the two columns hold. Not the `"true"` / `"false"` the Service
   * dialog's own dropdowns carry - a service's Remarks is still a boolean column, and these two
   * are text, so the value a choice writes has to be the word that is stored.
   */
  yesNoOptions = [],
  /*
   * Yes and No as a boolean's own `"true"` / `"false"`, for Complimentary - which really is a
   * boolean column, unlike the three answers above, which hold the word that was chosen.
   */
  booleanOptions = [],
  /*
   * The company names already typed on other deliverables, suggested as a brand is named, so a
   * studio adding Canvera to a second deliverable finds it rather than retyping it into a second
   * spelling. A list, not a rule: anything can still be typed, and nothing here names a brand.
   */
  brandSuggestions = [],
  /*
   * The names every other deliverable on the page already has, as the keys the server judges
   * them by - see `projectDefinitionNames`. A name that is one of them is refused here, with the
   * box still on screen, rather than at Save with the row already staged in the table.
   */
  takenNames = [],
  saving = false,
  error = "",
  onClose,
  onSubmit,
}) {
  const isEdit = Boolean(deliverable?.id);
  const [initial] = useState(() => ({
    name: deliverable?.name || initialName || "",
    /*
     * No. of Count and Image Selection are answered Yes or No, and hold the word they were chosen
     * as. A deliverable never answered opens on neither, which is a real state for Image Selection:
     * only Yes admits one to that module, so an unanswered deliverable stays out.
     */
    photoCount: deliverableAnswerText(deliverable?.photoCountEnabled),
    imageSelection: deliverableAnswerText(deliverable?.imageSelectionEnabled),
    /*
     * Whether the deliverable is given rather than charged for - its own answer, and nothing to do
     * with any service's. No unless it was answered Yes.
     */
    complimentary: String(deliverable?.complimentary === true),
    /*
     * Remarks is not one of that pair. It is a note about the deliverable, typed, and it decides
     * nothing - see the field below.
     */
    remarks: deliverableAnswerText(deliverable?.remarksEnabled),
    // Image or video. A deliverable saved before this was asked opens with neither and can still
    // be saved as it is - the question is offered, not demanded.
    mediaType: deliverable?.mediaType || "",
    // Every brand it is sold by with every variant, or one empty brand holding one empty variant,
    // so a new deliverable opens on a form to fill in rather than on a button to press first.
    brands: brandFormRows(deliverable?.brands),
  }));
  const [form, setForm] = useState(initial);
  // Counts the brands and variants added since the dialog opened, so each gets a key of its own.
  const [nextRowId, setNextRowId] = useState(0);
  /*
   * The change of type waiting on an answer, or null.
   *
   * Switching an image deliverable to a video stops asking for Size and Frame Inches and stops
   * saving them. A deliverable already carrying them would lose them the moment the radio moved, so
   * it is asked first and told exactly how many variants it is about to empty.
   */
  const [confirmTypeChange, setConfirmTypeChange] = useState(null);

  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  // What a variant is asked for follows what the deliverable is: an image its size and the frame
  // around it, a video its length, and the price either way.
  const isImage = form.mediaType === "IMAGE";
  const isVideo = form.mediaType === "VIDEO";
  /*
   * A variant row's columns: one per box it is actually asked for, and a narrow one for its Delete.
   * A deliverable whose type has not been answered is asked only for the price, so its row is two
   * columns rather than a video's three with an empty one in the middle. Every row is a single
   * column below `sm`, so a phone reads them one box under another.
   */
  const variantColumns = isImage ? "sm:grid-cols-[1fr_1fr_1fr_auto]" : isVideo ? "sm:grid-cols-[1fr_1fr_auto]" : "sm:grid-cols-[1fr_auto]";

  /*
   * `new-N`, never the bare count: the rows the dialog opened on are numbered from zero as well
   * (`brand-first`, `stored-brand-0`, see `brandFormRows`), and a brand added here as `brand-0`
   * beside one that opened as `brand-0` was two rows under one id - typing into either wrote into
   * both, and Delete Brand on one took both. That was every new deliverable's second brand.
   */
  const takeRowId = () => { const id = `new-${nextRowId}`; setNextRowId((current) => current + 1); return id; };

  const setBrand = (brandId, patch) => set({ brands: form.brands.map((brand) => (brand.id === brandId ? { ...brand, ...patch } : brand)) });
  const setVariant = (brandId, variantId, patch) => setBrand(brandId, {
    variants: (form.brands.find((brand) => brand.id === brandId)?.variants || []).map((variant) => (variant.id === variantId ? { ...variant, ...patch } : variant)),
  });
  const addBrand = () => set({ brands: [...form.brands, emptyDeliverableBrand(takeRowId())] });
  const removeBrand = (brandId) => set({ brands: form.brands.filter((brand) => brand.id !== brandId) });
  const addVariant = (brandId) => setBrand(brandId, { variants: [...(form.brands.find((brand) => brand.id === brandId)?.variants || []), emptyDeliverableVariant(takeRowId())] });
  const removeVariant = (brandId, variantId) => setBrand(brandId, { variants: (form.brands.find((brand) => brand.id === brandId)?.variants || []).filter((variant) => variant.id !== variantId) });

  /*
   * A change of type, asked about first where it would throw something away.
   *
   * The values themselves are kept in the form either way, so flipping to the other type and back
   * finds what was typed - it is the *save* that drops them, which is why the question says "when
   * you save" rather than claiming the data has already gone.
   */
  function chooseMediaType(value) {
    if (value === form.mediaType) return;
    const losing = variantsLosingValues(form.brands, value);
    if (losing.length) return setConfirmTypeChange({ value, count: losing.length });
    set({ mediaType: value });
  }

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
  // Another deliverable already answers to this name; the server would refuse the save.
  const nameTaken = definitionNameTaken(named, takenNames);

  return (
    <Dialog
      title={isEdit ? "Edit Deliverable" : "Add Deliverable"}
      description="These settings decide what a project is asked for when this deliverable is used."
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
          disabled={saving || !named || nameTaken || (isEdit && !dirty)}
          onClick={() => onSubmit({
            name: named,
            /*
             * The three answers as typed, and null where nothing was - unanswered, which for Image
             * Selection is a real state and keeps the deliverable out of that module.
             */
            photoCountEnabled: form.photoCount.trim() || null,
            imageSelectionEnabled: form.imageSelection.trim() || null,
            complimentary: form.complimentary === "true",
            remarksEnabled: form.remarks.trim() || null,
            /*
             * Image or Video, sent only once answered - a deliverable that has not been asked keeps
             * whatever it holds. The per-kind pricing the dialog used to build is cleared with it:
             * a deliverable is priced on its variants now.
             */
            ...(form.mediaType ? { mediaType: form.mediaType, pricing: null } : {}),
            /*
             * Every brand holding something, with every variant holding something, carrying only
             * the boxes the type asks for. The deliverable's own Company / Brand Name, Size, Frame
             * Inches, Length and Price are not sent: the server rewrites them from the first brand's
             * first variant, so the CRM Quotation Calculator goes on reading one figure per
             * deliverable exactly as it did.
             */
            brands: brandsForSave(form.brands, form.mediaType),
            /*
             * Shoot Type, Session Timing and Duration are not asked here. Whatever a deliverable
             * already holds for them is left exactly as it is - none of the three is sent, so the
             * server changes none of them - and a project's Choose Deliverables picker goes on
             * reading them as before.
             */
          })}
        >
          {saving ? (isEdit ? "Updating..." : "Adding...") : (isEdit ? "Update" : "Add")}
        </Button>
      </>}
    >
      {error && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Typed, with nothing offered while it is typed - see `AddDeliverableForm`. */}
        <TextField
          label="Deliverable Name"
          required
          value={form.name}
          maxLength={191}
          onChange={(event) => set({ name: event.target.value })}
          placeholder="Type a deliverable name"
          disabled={saving}
          error={nameTaken ? "A deliverable with this name already exists." : ""}
          className="sm:col-span-2"
        />

        <RadioGroupField
          label="Deliverable Type"
          name="deliverableMediaType"
          className="text-[11px] font-semibold text-slate-600 sm:col-span-2 sm:text-xs"
          controlClassName="px-0 py-0"
          options={MEDIA_TYPE_OPTIONS}
          value={form.mediaType}
          onChange={chooseMediaType}
          disabled={saving}
        />

        {/*
          * The companies this deliverable is sold by, each with the variants it sells it in -
          * always on screen, never folded away, and built from the same parts as the Service
          * dialog's pricing lines so the two forms read the same way.
          *
          * An image's variant is a size, the frame around it and a price; a video's is a length and
          * a price. Only the type's own boxes are drawn, so a video is never asked for a frame and
          * an image is never asked for a running time.
          */}
        <fieldset className="text-[11px] font-semibold text-slate-600 sm:col-span-2 sm:text-xs">
          <legend>Brands & Variants</legend>
          <div className="mt-1.5 space-y-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-4">
            {form.brands.map((brand, index) => (
              <div key={brand.id} className="rounded-lg border border-slate-200 bg-white px-3 py-3 sm:px-4 sm:py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <ComboBoxField
                    label="Company / Brand Name"
                    ariaLabel={`Company or brand name for brand ${index + 1}`}
                    className="min-w-0 flex-1"
                    value={brand.name}
                    onChange={(value) => setBrand(brand.id, { name: value })}
                    options={brandSuggestions}
                    placeholder="e.g. Canvera"
                    disabled={saving}
                  />
                  {/* Never on the only brand: removing it would leave the form with nothing to
                      fill in and no way back to a brand short of closing the dialog. */}
                  {form.brands.length > 1 && <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="sm:mb-0.5"
                    disabled={saving}
                    onClick={() => removeBrand(brand.id)}
                    aria-label={`Delete brand ${brand.name || index + 1}`}
                  >Delete Brand</Button>}
                </div>

                <div className="mt-3 space-y-3">
                  {brand.variants.map((variant, inner) => (
                    <div
                      key={variant.id}
                      className={`grid grid-cols-1 gap-3 sm:items-end ${variantColumns}`}
                    >
                      {isImage && <TextField
                        label="Size"
                        aria-label={`Size for variant ${inner + 1}`}
                        value={variant.size}
                        maxLength={100}
                        onChange={(event) => setVariant(brand.id, variant.id, { size: event.target.value })}
                        placeholder="e.g. 12x18"
                        disabled={saving}
                      />}
                      {isImage && <TextField
                        label="Frame Inches"
                        aria-label={`Frame inches for variant ${inner + 1}`}
                        value={variant.frameInches}
                        maxLength={60}
                        onChange={(event) => setVariant(brand.id, variant.id, { frameInches: event.target.value })}
                        placeholder="e.g. 1.5 inch"
                        disabled={saving}
                      />}
                      {isVideo && <TextField
                        label="Length"
                        aria-label={`Length for variant ${inner + 1}`}
                        value={variant.videoLength}
                        maxLength={100}
                        onChange={(event) => setVariant(brand.id, variant.id, { videoLength: event.target.value })}
                        placeholder="e.g. 3 minutes"
                        disabled={saving}
                      />}
                      <TextField
                        label="Price"
                        aria-label={`Price for variant ${inner + 1}`}
                        type="number"
                        min="0"
                        step="0.01"
                        value={variant.price}
                        onChange={(event) => setVariant(brand.id, variant.id, { price: event.target.value })}
                        placeholder="Not priced yet"
                        disabled={saving}
                      />
                      {/* Never on the only variant, for the same reason the only brand keeps its
                          row: a brand with no variant is a brand with nothing to say. */}
                      {brand.variants.length > 1 && <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="sm:mb-0.5"
                        disabled={saving}
                        onClick={() => removeVariant(brand.id, variant.id)}
                        aria-label={`Delete variant ${inner + 1} of brand ${brand.name || index + 1}`}
                      >Delete</Button>}
                    </div>
                  ))}
                </div>

                <Button type="button" variant="secondary" size="sm" className="mt-3" disabled={saving} onClick={() => addVariant(brand.id)}>+ Add Variant</Button>
              </div>
            ))}
            <Button type="button" variant="secondary" size="sm" disabled={saving} onClick={addBrand}>+ Add Another Brand</Button>
          </div>
        </fieldset>

        {/*
          * Asked of every deliverable, whatever it is, so they sit together under the rest.
          *
          * Two of them are answered Yes or No and the words are what decide: only Yes admits a
          * deliverable to Image Selection, and only Yes puts a count on a project's line. They are
          * picked rather than typed, because they are questions with two answers - and the value a
          * choice writes is the word itself, which is what the column holds.
          */}
        <Dropdown
          label="No.of.Count"
          ariaLabel="No.of.Count"
          value={form.photoCount}
          onChange={(value) => set({ photoCount: value })}
          options={yesNoOptions}
          disabled={saving}
        />

        <Dropdown
          label="Image Selection"
          ariaLabel="Image Selection"
          value={form.imageSelection}
          onChange={(value) => set({ imageSelection: value })}
          options={yesNoOptions}
          disabled={saving}
        />

        {/* Whether the deliverable is given rather than charged for. Its own answer: a service that
            brings it in does not make it complimentary, and does not stop it being so. */}
        <Dropdown
          label="Complimentary"
          ariaLabel="Complimentary"
          value={form.complimentary}
          onChange={(value) => set({ complimentary: value })}
          options={booleanOptions}
          disabled={saving}
        />

        {/*
          * Remarks is not one of that pair, and it is not a question with two answers.
          *
          * It is a note about the deliverable, typed, and it opens empty because it is written
          * rather than chosen. It decides nothing: a project's deliverable line always has its own
          * remarks box now, whatever is written here. It used to be the switch for that box, which
          * made a genuine note beginning "Not applicable" or "No frames" silently turn it off
          * across every project using the deliverable - a trap with nothing on screen to show it.
          */}
        <TextAreaField
          label="Remarks"
          rows={3}
          value={form.remarks}
          maxLength={2000}
          onChange={(event) => set({ remarks: event.target.value })}
          placeholder="Anything worth noting about this deliverable"
          disabled={saving}
          className="sm:col-span-2"
        />
      </div>

      {/* Asked before the radio moves, and only where the move would throw something away - the
          values stay in the form until the deliverable is saved, so Cancel really does leave it
          exactly as it was. */}
      {confirmTypeChange && <ConfirmDialog
        layer="confirmOverDialog"
        title={`Change this deliverable to ${confirmTypeChange.value === "VIDEO" ? "Video" : "Image"}?`}
        message={confirmTypeChange.value === "VIDEO"
          ? `A video variant has a Length and a Price, so the Size and Frame Inches on ${confirmTypeChange.count} ${confirmTypeChange.count === 1 ? "variant" : "variants"} stop being asked for and are removed when you save. Nothing is removed until then.`
          : `An image variant has a Size, Frame Inches and a Price, so the Length on ${confirmTypeChange.count} ${confirmTypeChange.count === 1 ? "variant" : "variants"} stops being asked for and is removed when you save. Nothing is removed until then.`}
        confirmLabel="Change Type"
        cancelLabel="Keep As Is"
        onCancel={() => setConfirmTypeChange(null)}
        onConfirm={() => { set({ mediaType: confirmTypeChange.value }); setConfirmTypeChange(null); }}
      />}
    </Dialog>
  );
}
