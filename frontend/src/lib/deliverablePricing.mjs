/**
 * What a deliverable is, how each kind of it is priced, and the price a quotation line takes.
 *
 * A deliverable is an IMAGE or a VIDEO. Settings → Project → Deliverables → Add / Edit Deliverable
 * asks which, then prices it under a tab per kind - Frames, Album, Calendar for an image; Teaser,
 * Full Length, Candid for a video - each kind the way it is sold: an image kind per size from the
 * kind's own size list (maintained under Settings → Project → Sizes; nothing here names a size),
 * a full-length video per session, a teaser or a candid as one figure. A deliverable may be priced
 * under several kinds at once. Stored on the deliverable as `pricing`, one row per booking with
 * its kind, and read when a deliverable is on a quotation: the row matching the line's size, or
 * its shoot's session, or the one figure where a single kind is all that is priced.
 *
 * Kept free of React so `node --test` can hold the rules.
 */

export const MEDIA_TYPE_OPTIONS = [{ label: "Image", value: "IMAGE" }, { label: "Video", value: "VIDEO" }];

export const KIND_OPTIONS_BY_MEDIA = {
  IMAGE: [{ label: "Frames", value: "FRAMES" }, { label: "Album", value: "ALBUM" }, { label: "Calendar", value: "CALENDAR" }],
  VIDEO: [{ label: "Teaser", value: "TEASER" }, { label: "Full Length", value: "FULL_LENGTH" }, { label: "Candid", value: "CANDID" }],
};
const ALL_KINDS = [...KIND_OPTIONS_BY_MEDIA.IMAGE, ...KIND_OPTIONS_BY_MEDIA.VIDEO];

/** The size list each image kind is priced from, by the option set's seeded code. */
export const SIZE_SET_CODE_BY_KIND = { FRAMES: "DELIVERABLE_FRAME_SIZE", ALBUM: "DELIVERABLE_ALBUM_SIZE", CALENDAR: "DELIVERABLE_PRINT_SIZE" };

export const SESSION_OPTIONS = [{ label: "Half Session", value: "HALF_SESSION" }, { label: "Full Session", value: "FULL_SESSION" }];

const TIMING_MODE_BY_LABEL = { "Half Session": "HALF_SESSION", "Full Session": "FULL_SESSION" };

const finite = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export const kindOptionsFor = (mediaType) => KIND_OPTIONS_BY_MEDIA[mediaType] || [];
export const kindsFor = (mediaType) => kindOptionsFor(mediaType).map((option) => option.value);
export const kindLabel = (kind) => ALL_KINDS.find((option) => option.value === kind)?.label || "";

/** How a kind is priced: per SIZE, per SESSION, as a SINGLE figure - or not at all, with no kind. */
export function pricingShapeFor(kind) {
  if (SIZE_SET_CODE_BY_KIND[kind]) return "SIZE";
  if (kind === "FULL_LENGTH") return "SESSION";
  return kind ? "SINGLE" : null;
}

export const emptyDeliverablePricingLine = (id) => ({ id: `line-${id}`, size: "", sizeOptionValueId: "", timingMode: "", price: "" });

const foldSize = (value) => String(value ?? "").trim().toLowerCase();

/**
 * The list entry a typed size names, if it names one - matched on the label, whatever the case,
 * so "8x10" typed finds the 8x10 the list holds. A size the list does not hold is kept as typed.
 */
export function matchSizeOption(size, options = []) {
  const wanted = foldSize(size);
  if (!wanted) return null;
  return options.find((option) => foldSize(option?.label) === wanted || foldSize(option?.value) === wanted) || null;
}

const rowsOf = (pricing) => (Array.isArray(pricing) ? pricing.filter((row) => row && row.price != null) : []);

/**
 * The stored rows as the form's lines, one list per kind, with the price as typed. Every kind is
 * present so a tab can be opened before anything is priced under it: a kind with no rows opens
 * with one empty line to fill in, and a single-figure kind always has exactly one.
 */
export function deliverablePricingLinesByKind(pricing) {
  const lines = {};
  for (const { value: kind } of ALL_KINDS) {
    const shape = pricingShapeFor(kind);
    const own = rowsOf(pricing)
      .filter((row) => row.kind === kind)
      .map((row, index) => ({ id: `stored-${kind}-${index}`, size: row.size || "", sizeOptionValueId: row.sizeOptionValueId || "", timingMode: row.timingMode || "", price: finite(row.price) === null ? "" : String(finite(row.price)) }));
    lines[kind] = shape === "SINGLE" ? [own[0] || emptyDeliverablePricingLine(`${kind}-first`)] : (own.length ? own : [emptyDeliverablePricingLine(`${kind}-first`)]);
  }
  return lines;
}

/** Whether a line names its booking in full - its size, or its session; a single figure always does. */
export function deliverablePricingLineComplete(line, kind) {
  const shape = pricingShapeFor(kind);
  if (shape === "SIZE") return Boolean(foldSize(line?.size) || line?.sizeOptionValueId);
  if (shape === "SESSION") return Boolean(line?.timingMode);
  return shape === "SINGLE";
}

const lineKey = (line, kind) => {
  const shape = pricingShapeFor(kind);
  return `${kind}:${shape === "SIZE" ? (line.sizeOptionValueId || foldSize(line.size)) : shape === "SESSION" ? line.timingMode : "single"}`;
};

/** The bookings priced twice under one kind, as "KIND:booking" keys - a save is refused while any are. */
export function duplicateDeliverablePricingLines(linesByKind = {}, kinds = ALL_KINDS.map((option) => option.value)) {
  const duplicates = new Set();
  for (const kind of kinds) {
    if (pricingShapeFor(kind) === "SINGLE") continue;
    const seen = new Set();
    for (const line of linesByKind[kind] || []) {
      if (!deliverablePricingLineComplete(line, kind)) continue;
      const key = lineKey(line, kind);
      if (seen.has(key)) duplicates.add(key);
      seen.add(key);
    }
  }
  return [...duplicates];
}

/** How many bookings a kind has priced - what its tab counts. */
export function pricedLineCount(linesByKind = {}, kind) {
  return (linesByKind[kind] || []).filter((line) => deliverablePricingLineComplete(line, kind) && finite(line.price) !== null).length;
}

/**
 * What the form sends: every complete line with a figure under the media type's kinds, each
 * carrying its kind, each booking once. The other media type's lines are not sent - an image
 * deliverable is not sold as a video - though the form keeps them while it is open.
 */
export function deliverablePricingForSave(linesByKind = {}, mediaType) {
  const rows = [];
  for (const kind of kindsFor(mediaType)) {
    const shape = pricingShapeFor(kind);
    const seen = new Set();
    for (const line of linesByKind[kind] || []) {
      if (!deliverablePricingLineComplete(line, kind)) continue;
      const price = finite(line.price);
      if (price === null) continue;
      const key = lineKey(line, kind);
      if (seen.has(key)) continue;
      seen.add(key);
      if (shape === "SIZE") rows.push({ kind, size: String(line.size ?? "").trim().slice(0, 100), ...(line.sizeOptionValueId ? { sizeOptionValueId: line.sizeOptionValueId } : {}), price });
      else if (shape === "SESSION") rows.push({ kind, timingMode: line.timingMode, price });
      else rows.push({ kind, price });
    }
  }
  return rows;
}

/**
 * The sizes a deliverable may be given on a project or quotation line: every size its pricing
 * names, from whichever kinds' lists, as the option value rows the API attaches
 * (`pricedSizeOptions`). Empty where the pricing names none, so the caller falls back to the one
 * list the definition is pointed at.
 */
export function pricedSizeOptionsOf(definition) {
  const ids = new Set(rowsOf(definition?.pricing).map((row) => row.sizeOptionValueId).filter(Boolean));
  if (!ids.size) return [];
  return (Array.isArray(definition?.pricedSizeOptions) ? definition.pricedSizeOptions : []).filter((option) => option?.isActive !== false && ids.has(option.id));
}

const listOf = (list, single) => {
  const listed = Array.isArray(list) ? list.filter(Boolean) : [];
  if (listed.length) return listed;
  return single ? [single] : [];
};

/**
 * The unit price a quotation line takes from its deliverable's pricing, or null where the
 * pricing does not say - so the line falls back to the flat price rather than to a guess.
 *
 * The line's size decides first: a priced size is a booking whatever kind it sits under. With no
 * size, a full-length row for the shoot's session answers. With neither, a deliverable priced
 * under one single-figure kind and nothing else answers that figure; anything less certain
 * answers nothing.
 */
export function deliverablePriceForRow(definition, row, shoot) {
  const rows = rowsOf(definition?.pricing);
  if (!rows.length) return null;
  const sizeId = row?.sizeOptionValueId || "";
  if (sizeId) return finite(rows.find((candidate) => candidate.sizeOptionValueId === sizeId)?.price);
  // A line sized by its words alone - the size typed on the pricing line - matches on the words.
  const sizeText = foldSize(row?.size);
  if (sizeText) return finite(rows.find((candidate) => foldSize(candidate.size) === sizeText)?.price);
  const timings = listOf(shoot?.sessionTimings, shoot?.sessionTiming).map((value) => TIMING_MODE_BY_LABEL[value] || (Object.values(TIMING_MODE_BY_LABEL).includes(value) ? value : null)).filter(Boolean);
  for (const timingMode of timings) {
    const price = finite(rows.find((candidate) => candidate.kind === "FULL_LENGTH" && candidate.timingMode === timingMode)?.price);
    if (price !== null) return price;
  }
  const kinds = [...new Set(rows.map((candidate) => candidate.kind))];
  if (kinds.length === 1 && pricingShapeFor(kinds[0]) === "SINGLE") return finite(rows[0].price);
  return null;
}
