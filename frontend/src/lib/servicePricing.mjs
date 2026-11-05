/**
 * A service's price per shoot type and session timing, and the price a shoot takes from it.
 *
 * Set in the Pricing section of Settings → Project → Services → Add / Edit Service - lines a
 * person adds, each naming its own shoot type and timing - stored on the service as
 * `pricing: [{ shootType, timingMode, price }]`, and read when a service is added to a quotation's
 * shoot: the row matching the shoot's type and timing is the line's unit price. An Hours / Minutes
 * row names a number of hours and is the price for that many - "Studio, 3 hours, ₹3,000" - so a
 * service may carry several, and a shoot booked hourly takes the one whose hours match its length.
 *
 * Kept free of React so `node --test` can hold the rules.
 */

/** Every timing a price can be set against - "NONE" is the absence of one. */
export const PRICED_TIMING_MODES = ["HALF_SESSION", "FULL_SESSION", "HOURS_MINUTES"];

/*
 * The codes behind the words a shoot stores. A shoot names its type and timing the way the Add
 * Shoot dialog words them ("Studio / In-House", "Half Session", "Hourly"); a service names its own
 * by code. Both spellings are accepted below so a shoot from either side reads the same.
 */
export const SHOOT_TYPE_CODE_BY_LABEL = { "Studio / In-House": "STUDIO", "Outdoor / On-Location": "OUTDOOR" };
export const TIMING_MODE_BY_LABEL = { "Half Session": "HALF_SESSION", "Full Session": "FULL_SESSION", Hourly: "HOURS_MINUTES" };

const finite = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

/**
 * What makes a line the same booking as another: shoot type and timing, and for an hourly line
 * the hours as well - two hours and three hours are two different things to price.
 */
export const pricingKey = (shootType, timingMode, hours, sizeKey = "") => (timingMode === "HOURS_MINUTES" ? `${shootType}:${timingMode}:${wholeHours(hours) ?? ""}` : `${shootType}:${timingMode}`) + (sizeKey ? `:${sizeKey}` : "");

const foldSize = (value) => String(value ?? "").trim().toLowerCase();
/** What tells one size from another on a line: the list entry it names, or its words. */
export const sizeKeyOf = (line) => line?.sizeOptionValueId || foldSize(line?.size);

/**
 * The list entry a typed size names, if it names one - matched on the label, whatever the case.
 * A size the lists do not hold is kept as typed.
 */
export function matchServiceSize(size, options = []) {
  const wanted = foldSize(size);
  if (!wanted) return null;
  return options.find((option) => foldSize(option?.label) === wanted || foldSize(option?.value) === wanted) || null;
}

/**
 * The sizes a service's pricing names, as the option value rows the API attaches
 * (`pricedSizeOptions`) - what a project or quotation line's Size picker offers. Empty where the
 * pricing names none, so the caller falls back to the one list the service is pointed at.
 */
export function pricedServiceSizeOptions(definition) {
  const rows = Array.isArray(definition?.pricing) ? definition.pricing : [];
  const ids = new Set(rows.map((row) => row?.sizeOptionValueId).filter(Boolean));
  if (!ids.size) return [];
  return (Array.isArray(definition?.pricedSizeOptions) ? definition.pricedSizeOptions : []).filter((option) => option?.isActive !== false && ids.has(option.id));
}

/**
 * What a session line says its booking runs, before anybody edits it: the studio's own session
 * lengths, in the words the Duration field has always used. Editable on the line - a studio whose
 * half session is "5-6 Hours" types that over it - and kept as typed.
 */
export const DEFAULT_DURATION_BY_TIMING = { HALF_SESSION: "4-5 Hours (Half)", FULL_SESSION: "10-12 Hours (Full)" };
export const defaultDurationFor = (timingMode) => DEFAULT_DURATION_BY_TIMING[timingMode] || "";
export const DURATION_MAX_LENGTH = 60;
const durationText = (value) => String(value ?? "").trim().slice(0, DURATION_MAX_LENGTH);

/** The hours a line names, as a whole number of at least one, or null where it names none yet. */
export function wholeHours(value) {
  const number = finite(value);
  return number !== null && Number.isInteger(number) && number >= 1 ? number : null;
}

/** Every timing a line of the given shoot type may be priced at: Hours / Minutes is a studio timing. */
export function pricedTimingModesFor(shootType) {
  return shootType === "STUDIO" ? PRICED_TIMING_MODES : PRICED_TIMING_MODES.filter((mode) => mode !== "HOURS_MINUTES");
}

/**
 * The stored rows as the form's lines, `{ id, shootType, timingMode, price }` with the price as
 * typed. A service with no pricing opens with one empty line to fill in rather than with nothing.
 */
export function pricingFormLines(pricing) {
  const lines = (Array.isArray(pricing) ? pricing : [])
    .filter((row) => row?.shootType && row?.timingMode)
    .map((row, index) => ({
      id: `stored-${index}`, shootType: row.shootType, timingMode: row.timingMode,
      hours: wholeHours(row.hours) === null ? "" : String(wholeHours(row.hours)),
      // A session row saved before durations were kept reads the studio's own length.
      duration: row.timingMode === "HOURS_MINUTES" ? "" : (durationText(row.duration) || defaultDurationFor(row.timingMode)),
      size: row.size || "",
      sizeOptionValueId: row.sizeOptionValueId || "",
      price: finite(row.price) === null ? "" : String(finite(row.price)),
      // The deliverable variants this booking brings with it - see `pricingLineDeliverables`.
      deliverables: pricingLineDeliverables(row),
    }));
  return lines.length ? lines : [emptyPricingLine("first")];
}

/**
 * The deliverable variants one pricing line carries, each named by its three ids.
 *
 * A booking is not only a price: "Studio, Full Session, 8x12, ₹700" may be sold *with* an acrylic
 * print of that size and a photo selection, and a studio that has said so should not have to add
 * them to every quotation by hand. The mapping lives on the line rather than on the service,
 * because it is the booking that decides - the 12x18 line brings a 12x18 print, not the 8x12 one.
 *
 * Ids and nothing else. A name cannot identify a variant: two brands sell a 12x18, and two
 * deliverables may be called the same thing. Anything without all three is dropped rather than
 * stored, so a half-written mapping cannot reach a quotation.
 */
export function pricingLineDeliverables(row) {
  return (Array.isArray(row?.deliverables) ? row.deliverables : [])
    .map((entry) => ({
      deliverableId: String(entry?.deliverableId || ""),
      brandId: String(entry?.brandId || ""),
      variantId: String(entry?.variantId || ""),
    }))
    .filter((entry) => entry.deliverableId && entry.brandId && entry.variantId);
}

/** The key one mapped variant is held by, so a line cannot carry the same variant twice. */
export const pricingDeliverableKey = (entry) => `${entry?.deliverableId}::${entry?.brandId}::${entry?.variantId}`;

export const emptyPricingLine = (id) => ({ id: `line-${id}`, shootType: "", timingMode: "", hours: "", duration: "", size: "", sizeOptionValueId: "", price: "", deliverables: [] });

/**
 * Whether a line names a booking in full: shoot type, timing, for an hourly line its hours, and
 * for a service sold by size its size.
 */
export const pricingLineComplete = (line, sizeEnabled = false) => Boolean(line?.shootType && line?.timingMode)
  && (line.timingMode !== "HOURS_MINUTES" || wholeHours(line.hours) !== null)
  && (!sizeEnabled || Boolean(sizeKeyOf(line)));

/** The lines that answer the same shoot type and timing twice - a save is refused while any do. */
export function duplicatePricingLines(lines = [], sizeEnabled = false) {
  const seen = new Set();
  const duplicates = new Set();
  for (const line of lines) {
    if (!pricingLineComplete(line, sizeEnabled)) continue;
    const key = pricingKey(line.shootType, line.timingMode, line.hours, sizeEnabled ? sizeKeyOf(line) : "");
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return [...duplicates];
}

/**
 * What the form sends: every complete line with a price. A line still being filled in - no shoot
 * type or timing yet, an hourly line with no hours, or no figure - is not a price and is left out,
 * and a timing the line's shoot type does not offer is dropped rather than stored.
 */
export function pricingForSave(lines = [], sizeEnabled = false, deliverablesEnabled = false) {
  const seen = new Set();
  return lines
    .filter((line) => pricingLineComplete(line, sizeEnabled) && pricedTimingModesFor(line.shootType).includes(line.timingMode))
    .map((line) => ({
      shootType: line.shootType, timingMode: line.timingMode,
      // An hourly line carries its hours; a session line carries the length it reads as.
      ...(line.timingMode === "HOURS_MINUTES" ? { hours: wholeHours(line.hours) } : { duration: durationText(line.duration) || defaultDurationFor(line.timingMode) }),
      // A service sold by size carries the size as typed, and the list entry it names where it does.
      ...(sizeEnabled ? { size: String(line.size ?? "").trim().slice(0, 100), ...(line.sizeOptionValueId ? { sizeOptionValueId: line.sizeOptionValueId } : {}) } : {}),
      price: finite(line.price),
      /*
       * Only where the service says it brings deliverables. A service answered No keeps none, so
       * turning the question off is what takes the mapping out rather than leaving it stored and
       * invisible - the same rule a deliverable's type follows for the boxes it does not ask for.
       */
      ...(deliverablesEnabled && pricingLineDeliverables(line).length ? { deliverables: pricingLineDeliverables(line) } : {}),
    }))
    .filter((row) => row.price !== null)
    .filter((row) => { const key = pricingKey(row.shootType, row.timingMode, row.hours, sizeEnabled ? sizeKeyOf(row) : ""); if (seen.has(key)) return false; seen.add(key); return true; });
}

const listOf = (list, single) => {
  const listed = Array.isArray(list) ? list.filter(Boolean) : [];
  if (listed.length) return listed;
  return single ? [single] : [];
};
const codeOf = (value, byLabel) => byLabel[value] || (Object.values(byLabel).includes(value) ? value : null);

/**
 * The unit price a shoot takes from a service's pricing, or null where the pricing does not say.
 *
 * The shoot's types and timings are read in the order it lists them, and the first row that
 * matches decides - a shoot booked over more than one place or session is priced at the first it
 * names. An hourly shoot takes the row whose hours are its length; a length that is not a whole
 * number of hours, or one no row prices, has no figure here, so the line falls back to the flat
 * price rather than to a guess.
 */
/**
 * The pricing line a shoot books this service under, or null while nothing decides it yet.
 *
 * The rule `servicePriceForShoot` has always applied, lifted out whole so the price and the line's
 * own mapped deliverables are answered by one reading rather than by two that could disagree: the
 * shoot's type, then its timing, matching the size where the service is sold by size and the hours
 * where the booking is hourly. A service sold by size answers nothing until the line has a size,
 * which is why a quotation can only know which deliverables follow once that size is chosen.
 */
export function servicePricingRowForShoot(definition, shoot, row = {}, { timingModes = null } = {}) {
  const rows = Array.isArray(definition?.pricing) ? definition.pricing : [];
  if (!rows.length || !shoot) return null;
  // A service sold by size answers only for the size the line has been given - by the list entry
  // it names, or by its words - and nothing until it has one.
  const sized = definition?.sizeEnabled === true;
  const sizeId = row?.sizeOptionValueId || "";
  const sizeText = foldSize(row?.size);
  if (sized && !sizeId && !sizeText) return null;
  const sizeMatches = (candidate) => !sized || (sizeId ? candidate?.sizeOptionValueId === sizeId : foldSize(candidate?.size) === sizeText);
  const types = listOf(shoot.shootTypes, shoot.shootType).map((value) => codeOf(value, SHOOT_TYPE_CODE_BY_LABEL)).filter(Boolean);
  // The shoot's own sessions, unless the caller has named the one it means - see
  // `servicePricingRowForLine`, which is the only caller that does.
  const timings = timingModes || listOf(shoot.sessionTimings, shoot.sessionTiming).map((value) => codeOf(value, TIMING_MODE_BY_LABEL)).filter(Boolean);
  const minutes = finite(shoot.sessionDurationMinutes) ?? 0;
  const shootHours = minutes === 0 ? wholeHours(shoot.sessionDurationHours) : null;
  for (const shootType of types) {
    for (const timingMode of timings) {
      const match = rows.find((candidate) => candidate?.shootType === shootType && candidate?.timingMode === timingMode
        && sizeMatches(candidate)
        && (timingMode !== "HOURS_MINUTES" || (shootHours !== null && wholeHours(candidate?.hours) === shootHours)));
      // A line with no figure is not the one this books under: the search goes on, exactly as it
      // did when this returned the price itself.
      if (finite(match?.price) !== null) return match;
    }
  }
  return null;
}

/** What that line costs - the whole of what this used to work out, and unchanged. */
export function servicePriceForShoot(definition, shoot, row = {}) {
  return finite(servicePricingRowForShoot(definition, shoot, row)?.price);
}

/** The sessions a service is actually priced under. */
const sessionsPriced = (definition) => [...new Set((Array.isArray(definition?.pricing) ? definition.pricing : [])
  .map((entry) => entry?.timingMode)
  .filter((mode) => mode === "HALF_SESSION" || mode === "FULL_SESSION"))];

/**
 * The session one quotation line was booked at, read off the option it names.
 *
 * A line carries `sessionOptionId` - the entry of the studio's Service Session Timing set that its
 * Session Timing cell was set to - and that entry's `code` is the timing mode. Null until the cell
 * has been answered, which is the point of it.
 */
export function lineSessionTimingMode(definition, row) {
  if (!row?.sessionOptionId) return null;
  const option = (definition?.timingOptionSet?.values || []).find((value) => value.id === row.sessionOptionId);
  return option?.code || codeOf(option?.label, TIMING_MODE_BY_LABEL) || null;
}

/**
 * The pricing line one quotation *line* books under - stricter than `servicePricingRowForShoot`,
 * and the resolver anything reading a booking's own settings must use.
 *
 * The difference is which session decides. `servicePricingRowForShoot` answers from the *shoot's*
 * sessions, and a shoot that offers both Half and Full therefore answers with the first of them the
 * service is priced for - before anybody has said which session this line is. That is the right
 * answer for a price, which is stamped the moment a service is added and is only ever a starting
 * figure the line may then be repriced from. It is the wrong answer for what a booking *brings*:
 * the Half Session row's deliverables are not the Full Session row's, and adding one set on the
 * strength of a guess means adding the wrong ones.
 *
 * So where a service is priced under more than one session - or under any session at all - the
 * line's own Session Timing decides, and nothing is answered until it has been chosen. A service
 * priced under no session (hourly, or one flat figure) has no Session Timing to choose, so it
 * resolves exactly as it always did.
 */
export function servicePricingRowForLine(definition, shoot, row = {}) {
  if (!sessionsPriced(definition).length) return servicePricingRowForShoot(definition, shoot, row);
  const chosen = lineSessionTimingMode(definition, row);
  if (!chosen) return null;
  return servicePricingRowForShoot(definition, shoot, row, { timingModes: [chosen] });
}
