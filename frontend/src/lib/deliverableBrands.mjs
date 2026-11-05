/**
 * A deliverable's brands, and the variants each brand is sold in.
 *
 * A deliverable used to be one thing: one company, one size, one frame, one price. It is not - the
 * same album is sold by Canvera and by Pictoo, each in several sizes at several prices - so a
 * deliverable holds brands, and a brand holds variants:
 *
 *     Deliverable -> Type -> Brand (many) -> Variant (many)
 *
 * What a variant is asked for follows the deliverable's type, and only its type: an image's variant
 * is a Size, a Frame Inches and a Price; a video's is a Length and a Price. Neither is ever shown
 * the other's boxes, and only what the type asks for is saved - see `brandsForSave` - so a video
 * variant can never be left carrying a frame size.
 *
 * Nothing here names a brand, a size, a frame, a length or a price. They are all typed.
 *
 * Kept free of React so `node --test` can hold the rules, the way `servicePricing.mjs` is.
 */

import { deliverableAnswerText } from "./deliverableAnswers.mjs";

/**
 * The boxes a variant is asked for, by the deliverable's type. Price is asked of both.
 *
 * A type that has not been answered asks for the Price and nothing else on screen, but holds
 * whatever it is already carrying - see `askedFieldsOf`, which is what the saving and the "is this
 * row empty?" questions use. Nothing has decided yet which of the two a variant is, so a
 * deliverable saved before the type was asked must not have its size or its length thrown away by
 * a form that could not show either.
 */
export function variantFieldsFor(mediaType) {
  if (mediaType === "VIDEO") return ["videoLength", "price"];
  if (mediaType === "IMAGE") return ["size", "frameInches", "price"];
  return ["price"];
}

/** The same, but for reading and writing rather than for drawing: unanswered keeps everything. */
function askedFieldsOf(mediaType) {
  return mediaType ? variantFieldsFor(mediaType) : ["size", "frameInches", "videoLength", "price"];
}

/** The boxes the *other* type asks for - what a switch of type would stop showing and stop saving. */
export function variantFieldsNotFor(mediaType) {
  if (!mediaType) return [];
  const asked = variantFieldsFor(mediaType);
  return ["size", "frameInches", "videoLength"].filter((field) => !asked.includes(field));
}

const text = (value) => String(value ?? "").trim();

/** As wide as the column behind it - `ProjectDeliverableBrand.name` is a VarChar(191). */
export const BRAND_NAME_MAX_LENGTH = 191;

export const emptyDeliverableVariant = (id) => ({ id: `variant-${id}`, size: "", frameInches: "", videoLength: "", price: "" });
export const emptyDeliverableBrand = (id) => ({ id: `brand-${id}`, name: "", variants: [emptyDeliverableVariant(`${id}-0`)] });

/**
 * The brands the dialog opens with: every brand the deliverable holds with its variants, or one
 * empty brand holding one empty variant when it holds none - so a new deliverable opens on a form
 * to fill in rather than on a button to press first.
 *
 * Every value becomes a string, because these are the boxes' own values: a price of `1200` typed
 * back into a number box as the number would be a different value from the one the box produces,
 * and the dialog decides it has been edited by comparing the two.
 *
 * ── Every row's id is its own ────────────────────────────────────────────────────────────────
 *
 * A row's id is what the dialog edits and removes it by, so two rows sharing one are one row to
 * every control: typing a name into either wrote it into both, and Delete Brand on one took both.
 * That is exactly what happened on a new deliverable - it opened on `brand-0`, and the first press
 * of "+ Add Another Brand" made a second `brand-0`, because the dialog counts its own rows from
 * zero too. A brand without an id (one staged here but not yet saved, or a new one) is named
 * `stored-…` after its place in the list, the fallback brand is `brand-first`, and the dialog
 * names what it adds `…-new-N` - three vocabularies that cannot meet, and none of them a
 * server id.
 */
export function brandFormRows(brands, { keepServerIds = false } = {}) {
  /*
   * Editing a deliverable keeps the server's own id beside each brand and variant it opened on, as
   * `serverId`, so Save updates those rows in place rather than replacing them. A service maps its
   * bookings to a variant by id, and replacing the rows on every save gave every variant a new one
   * - so renaming a deliverable left every service mapped to it reading "no longer offered". A
   * duplicate is a new deliverable with rows of its own, and is opened without them.
   */
  const serverId = (row) => (keepServerIds && row?.id ? { serverId: row.id } : {});
  const rows = (Array.isArray(brands) ? brands : []).map((brand, index) => ({
    id: brand?.id || `stored-brand-${index}`,
    ...serverId(brand),
    name: text(brand?.name),
    variants: (Array.isArray(brand?.variants) ? brand.variants : []).map((variant, inner) => ({
      id: variant?.id || `stored-variant-${index}-${inner}`,
      ...serverId(variant),
      size: text(variant?.size),
      frameInches: text(variant?.frameInches),
      videoLength: text(variant?.videoLength),
      price: variant?.price == null ? "" : String(variant.price),
    })),
  }));
  // A brand that somehow holds no variants still gets one empty row, so it can be filled in.
  const filled = rows.map((brand) => (brand.variants.length ? brand : { ...brand, variants: [emptyDeliverableVariant(`${brand.id}-0`)] }));
  return filled.length ? filled : [emptyDeliverableBrand("first")];
}

/** Whether a variant holds anything at all, under the type asking. */
export function variantHasValue(variant, mediaType) {
  return askedFieldsOf(mediaType).some((field) => text(variant?.[field]) !== "");
}

/** Whether a brand holds anything at all - a name, or a variant with something in it. */
export function brandHasValue(brand, mediaType) {
  return text(brand?.name) !== "" || (brand?.variants || []).some((variant) => variantHasValue(variant, mediaType));
}

/**
 * The variants that would lose what they hold if the deliverable changed to `mediaType`.
 *
 * Switching an image deliverable to a video stops asking for Size and Frame Inches, and stops
 * saving them. A deliverable already carrying them would lose them silently, so the dialog asks
 * first - this is what it counts to decide whether there is anything to ask about.
 */
export function variantsLosingValues(brands, mediaType) {
  const dropped = variantFieldsNotFor(mediaType);
  const losing = [];
  for (const brand of brands || []) {
    for (const variant of brand?.variants || []) {
      const fields = dropped.filter((field) => text(variant?.[field]) !== "");
      if (fields.length) losing.push({ brand: text(brand?.name), variant, fields });
    }
  }
  return losing;
}

/**
 * What is sent: every brand holding something, with every variant holding something, carrying only
 * the boxes the type asks for. A brand still being filled in is not a brand, and a variant with
 * nothing in it is not a variant - neither is saved, and neither is an error.
 *
 * An unanswered type asks for nothing in particular, so it keeps whatever it is given: nothing has
 * decided yet which of the two a variant is, and the dialog goes on offering the Price either way.
 */
export function brandsForSave(brands, mediaType) {
  const asked = askedFieldsOf(mediaType);
  return (brands || [])
    .filter((brand) => brandHasValue(brand, mediaType))
    .map((brand) => ({
      // The row it was opened on, so the server keeps it - and its id - rather than replacing it.
      ...(brand.serverId ? { id: brand.serverId } : {}),
      // Held to the column's width here, because the combo box it is typed into has no limit of
      // its own - the server refuses a longer one, and it did so only at Save.
      name: text(brand.name).slice(0, BRAND_NAME_MAX_LENGTH),
      variants: (brand.variants || [])
        .filter((variant) => variantHasValue(variant, mediaType))
        .map((variant) => ({
          ...(variant.serverId ? { id: variant.serverId } : {}),
          size: asked.includes("size") ? text(variant.size) || null : null,
          frameInches: asked.includes("frameInches") ? text(variant.frameInches) || null : null,
          videoLength: asked.includes("videoLength") ? text(variant.videoLength) || null : null,
          price: text(variant.price) === "" ? null : Number(variant.price),
        })),
    }));
}

/**
 * How one variant reads when it has to name itself in a list: the deliverable, whose it is, and
 * what distinguishes it from the brand's other variants.
 *
 *   Album Printing - Canvera - 12x18 - 1.5 inch      an image: its size and its frame
 *   Cinematic Full Length - Partner Studio - 45 minutes    a video: how long it runs
 *
 * The deliverable's own type decides which, and nothing else - a video is never given a frame and
 * an image is never given a running time. Parts that are blank are left out rather than drawn as a
 * gap, so a brand selling one unnamed size still reads as a sentence.
 */
export function deliverableVariantLabel(definition, brand, variant, { withRemarks = false } = {}) {
  /*
   * A deliverable sold by nobody - no brand holding a variant - may still carry the one brand and
   * size it was given before brands existed, in its own `brandName` / `imageSize` / `frameInches`
   * / `videoLength`. Those are what it is, so it names itself by them rather than by its name
   * alone. Only then: a deliverable that has variants rewrites those four from its first variant on
   * every save, so reading them for a line chosen without a variant would name a variant nobody
   * chose.
   */
  if (!brand && !variant && !hasVariants(definition)) {
    brand = { name: definition?.brandName };
    variant = { size: definition?.imageSize, frameInches: definition?.frameInches, videoLength: definition?.videoLength };
  }
  const parts = [definition?.name, brand?.name];
  if (definition?.mediaType === "VIDEO") parts.push(variant?.videoLength);
  else if (definition?.mediaType === "IMAGE") parts.push(variant?.size, variant?.frameInches);
  // A type never answered, or a line read without its deliverable, is named by whatever it holds.
  else parts.push(variant?.size, variant?.frameInches, variant?.videoLength);
  /*
   * And, where the reader asked for it, the note the studio wrote about the deliverable in
   * Settings - "Sent flat, never rolled." - so a quotation line says what it is *and* what is
   * always true of it.
   *
   * This is the deliverable's own note and nothing else. The Remarks box on a quotation line is a
   * different value entirely, typed for that one quotation and stored on that one row; neither
   * ever writes to the other. Asked for rather than always appended, because the note is worth
   * reading beside a line on a quotation and is only noise in a list being picked from to map a
   * service.
   */
  if (withRemarks) parts.push(deliverableAnswerText(definition?.remarksEnabled));
  return parts.map((part) => text(part)).filter(Boolean).join(" - ");
}

/**
 * Every brand-and-variant a list of deliverables offers, one entry per variant, as the options a
 * picker takes.
 *
 * One selection is one exact variant, which is the whole point: the option carries the deliverable
 * it belongs to *and* the variant that was chosen, so what is added knows its brand, its size or
 * its length, and the price that variant was given - rather than only which deliverable it was.
 * The id is the three ids together, because a name cannot identify a variant: two brands sell a
 * 12x18, and two deliverables may be called the same thing.
 *
 * A deliverable sold by nobody - no brands, or brands with no variants yet - still appears, once,
 * under its own name and carrying no variant. It is quoted exactly as it was before any of this,
 * which is what keeps a deliverable from disappearing out of a picker the day this ships.
 *
 * Only what is offered: a variant is listed under the brand that actually holds it, so no
 * combination is invented that the studio did not configure.
 */
export function deliverableVariantOptions(definitions = [], { withRemarks = false } = {}) {
  const options = [];
  for (const definition of definitions || []) {
    if (!definition?.id) continue;
    const brands = (definition.brands || []).filter((brand) => (brand?.variants || []).length);
    if (!brands.length) {
      options.push({ id: definition.id, name: deliverableVariantLabel(definition, null, null, { withRemarks }), definition, variant: null });
      continue;
    }
    for (const brand of brands) {
      for (const variant of brand.variants) {
        options.push({
          id: `${definition.id}::${brand.id}::${variant.id}`,
          name: deliverableVariantLabel(definition, brand, variant, { withRemarks }),
          definition,
          variant: {
            brandId: brand.id,
            brandName: text(brand.name),
            variantId: variant.id,
            size: text(variant.size),
            frameInches: text(variant.frameInches),
            videoLength: text(variant.videoLength),
            price: variant.price,
          },
        });
      }
    }
  }
  return options;
}

const hasVariants = (definition) => (definition?.brands || []).some((brand) => (brand?.variants || []).length);

/**
 * The variant a saved deliverable line was added as - its brand, size, frame and length - or null
 * for a line added as the deliverable alone.
 *
 * Two shapes carry it, both a snapshot taken when the variant was picked, because a variant can be
 * resized, repriced or removed in Settings after the sale and the line still says what was sold:
 *
 *   - a quotation line names it `deliverableBrandName` beside the `deliverableVariantId` it was
 *     picked by;
 *   - a project line (`ProjectShootDeliverable`) holds `brandName`, `size`, `frameInches` and
 *     `videoLength`, which nothing writes but the variant - so any of them holding something is
 *     what says the line is a variant. A size picked from the deliverable's size list is
 *     `sizeOptionValueId` instead, and is not the variant's.
 */
export function deliverableRowVariant(row) {
  if (!row || typeof row !== "object") return null;
  const snapshot = {
    brandName: text(row.brandName ?? row.deliverableBrandName),
    size: text(row.size),
    frameInches: text(row.frameInches),
    videoLength: text(row.videoLength),
  };
  if (row.deliverableVariantId) return snapshot;
  const held = snapshot.brandName || snapshot.frameInches || snapshot.videoLength || (snapshot.size && !row.sizeOptionValueId);
  return held ? snapshot : null;
}

/**
 * What a saved deliverable line is called, wherever one is listed: the same sentence its picker
 * offered it under, built by `deliverableVariantLabel` from the line's own snapshot.
 *
 * A quotation line stamped the label when its variant was picked, and that is read as it is so a
 * quotation already sent goes on reading what it was sent with. Anything else is built here, from
 * the linked deliverable's name where the line still points at one and the name copied onto the
 * line where it does not. Blank parts are left out, so a line from before variants existed reads by
 * its name and nothing else - never "undefined", never a dangling separator.
 */
export function deliverableRowLabel(row, { withRemarks = false } = {}) {
  if (!row || typeof row !== "object") return "";
  if (text(row.deliverableVariantLabel)) return text(row.deliverableVariantLabel);
  const linked = row.deliverableDefinition || {};
  const definition = { ...linked, name: text(linked.name) || text(row.deliverableName) };
  const variant = deliverableRowVariant(row);
  if (variant) return deliverableVariantLabel(definition, { name: variant.brandName }, variant, { withRemarks });
  // A line added as the deliverable alone: named as the deliverable names itself in its picker.
  return deliverableVariantLabel(definition, null, null, { withRemarks });
}

/**
 * What makes two lines on one shoot the same line: the deliverable, and the variant it was added
 * as. Two brands of one album, or one brand's two sizes, are two lines; the same variant twice is
 * one. Case and spacing are not a difference. `backend/src/modules/sales/projects/controller.js`
 * holds the same rule for what it refuses.
 */
export function deliverableIdentityKey(deliverableDefinitionId, variant) {
  const norm = (value) => text(value).replace(/\s+/g, " ").toLocaleLowerCase();
  const parts = variant ? [variant.brandName, variant.size, variant.frameInches, variant.videoLength].map(norm) : [];
  // A variant holding nothing names nothing beyond its deliverable, so it is the deliverable alone.
  return [String(deliverableDefinitionId || ""), ...(parts.some(Boolean) ? parts : [])].join("::");
}

/**
 * The fields a project line takes from the variant it was picked as - a picker option's `variant`
 * - in the project's own column names, so the line reads by `deliverableRowLabel` before it is
 * ever saved. Empty for a deliverable picked on its own.
 */
export function projectDeliverableVariantFields(variant) {
  if (!variant) return {};
  return {
    deliverableVariantId: text(variant.variantId),
    brandName: text(variant.brandName),
    size: text(variant.size),
    frameInches: text(variant.frameInches),
    videoLength: text(variant.videoLength),
  };
}

/**
 * The `variant` a project line is created with, from any saved or pending line, or null where the
 * line was added as the deliverable alone. The server looks the id up against the deliverable's
 * brands as they stand and saves what that variant holds; the words go with it for a variant that
 * no longer exists - removed since, or replaced by a save from before ids were kept - which a
 * quotation raised before then still names.
 */
export function deliverableVariantPayload(row) {
  const variant = deliverableRowVariant(row);
  if (!variant) return null;
  return {
    variantId: text(row.deliverableVariantId) || null,
    brandName: variant.brandName || null,
    size: variant.size || null,
    frameInches: variant.frameInches || null,
    videoLength: variant.videoLength || null,
  };
}
