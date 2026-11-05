const prisma = require("../../../config/db");

/**
 * The custom fields each vertical's CRM form carries, as built in Table Settings.
 *
 * The builder saves a whole form at once rather than a field at a time, so the write here is
 * a replace: whatever the vertical's field list is after a save is exactly what was on the
 * canvas. That is what makes deleting and reordering work without their own endpoints.
 *
 * Only the fields of one vertical are ever touched by a save, so two people editing Dum Dum
 * and Corp cannot overwrite each other.
 */

// The controls the builder palette offers. A type outside this set is rejected rather than
// stored, because the client renders by type and has no fallback for one it does not know.
const FIELD_TYPES = ["text", "number", "email", "website", "textarea", "checkbox", "radio", "dropdown", "date"];

// Only these carry a choice list; for anything else stored options would be dead data that
// the builder would then show on reopening.
const FIELD_TYPES_WITH_OPTIONS = ["checkbox", "radio", "dropdown"];

// Matches the cap the builder prints in its header. Enforced here too - the header is a
// label, not a control, and nothing stops a direct call.
const MAX_FIELDS_PER_VERTICAL = 40;

function slugifyKey(label) {
  return String(label || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * A choice list, normalised to `{ text, value, default }`.
 *
 * `text` is what the lead form shows, `value` is what is stored against the lead - the two
 * differ so a branch can read "Coimbatore" on screen and be filed as "Cbe". A plain string
 * is accepted and becomes both, which is what fields saved before options gained a value
 * hold, so they keep working without a data migration.
 *
 * Duplicate values are dropped: two choices storing the same thing are indistinguishable
 * once written to a lead, and they collide as keys when rendered.
 */
function parseOptions(value) {
  let raw = value;
  if (typeof raw === "string") {
    if (!raw.trim()) return [];
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];

  const seen = new Set();
  const options = [];
  for (const item of raw) {
    const isObject = item && typeof item === "object";
    const text = String((isObject ? item.text ?? item.label : item) ?? "").trim();
    if (!text) continue;
    const optionValue = String((isObject ? item.value ?? text : text) ?? "").trim() || text;
    if (seen.has(optionValue)) continue;
    seen.add(optionValue);
    options.push({ text, value: optionValue, default: Boolean(isObject && item.default) });
  }

  // Only one choice can be the default; a later one wins, matching the radio-like control
  // the builder uses to pick it.
  const lastDefault = options.map((option) => option.default).lastIndexOf(true);
  return options.map((option, index) => ({ ...option, default: index === lastDefault }));
}

function toField(row) {
  return {
    id: row.id,
    vertical: row.vertical,
    key: row.key,
    label: row.label,
    fieldType: FIELD_TYPES.includes(row.fieldType) ? row.fieldType : "text",
    placeholder: row.placeholder || "",
    // MySQL hands a BOOLEAN back as 0/1, which is truthy for "0" if passed on as-is.
    required: Boolean(row.required),
    options: parseOptions(row.options),
    sortOrder: Number(row.sortOrder || 0),
  };
}

async function listCustomFields(vertical = "") {
  const rows = vertical
    ? await prisma.salesCrmDynamicColumn.findMany({ where: { vertical }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] })
    : await prisma.salesCrmDynamicColumn.findMany({ orderBy: [{ vertical: "asc" }, { sortOrder: "asc" }, { id: "asc" }] });
  return rows.map(toField);
}

/**
 * Normalises one field off the builder canvas into a row.
 *
 * A field's key is derived from its label and is what a lead's stored answers are filed
 * under, so renaming a label would otherwise orphan every answer already given. The client
 * sends the original key back for a field it is editing; that key wins, and only a brand new
 * field gets one minted from its label.
 */
function normalizeField(field, index, usedKeys) {
  const label = String(field?.label || "").trim();
  if (!label) return { error: "Every field needs a label." };

  const fieldType = String(field?.fieldType || "text").trim();
  if (!FIELD_TYPES.includes(fieldType)) return { error: `"${fieldType}" is not a field type this form supports.` };

  let key = slugifyKey(field?.key) || slugifyKey(label);
  if (!key) return { error: `"${label}" must contain at least one letter or number.` };

  // Two fields cannot share a key, or one lead answer would serve both. A suffix keeps the
  // save rather than rejecting it, since the labels are legitimately allowed to match.
  if (usedKeys.has(key)) {
    let suffix = 2;
    while (usedKeys.has(`${key}-${suffix}`)) suffix += 1;
    key = `${key}-${suffix}`;
  }
  usedKeys.add(key);

  const options = FIELD_TYPES_WITH_OPTIONS.includes(fieldType) ? parseOptions(field?.options) : [];
  if (FIELD_TYPES_WITH_OPTIONS.includes(fieldType) && !options.length) {
    return { error: `"${label}" is a ${fieldType} field, so it needs at least one option.` };
  }

  return {
    field: {
      key,
      label: label.slice(0, 191),
      fieldType,
      placeholder: String(field?.placeholder || "").trim().slice(0, 191) || null,
      required: Boolean(field?.required),
      options: options.length ? JSON.stringify(options) : null,
      sortOrder: index,
    },
  };
}

/**
 * Replaces one vertical's fields with the list the builder saved.
 *
 * Rows are deleted and re-inserted inside a transaction: a save that fails half way would
 * otherwise leave the vertical with part of its old form and part of its new one, and the
 * builder has no way to tell the user which fields survived.
 *
 * Deleting a field does not delete the answers leads already gave it. They stay in
 * SalesCrmLead.customFields, keyed by the same key, so putting the field back restores them
 * rather than starting blank - and a field removed by mistake costs nothing.
 */
async function replaceCustomFields(vertical, fields = []) {
  if (fields.length > MAX_FIELDS_PER_VERTICAL) {
    const error = new Error(`A vertical can hold up to ${MAX_FIELDS_PER_VERTICAL} fields.`);
    error.status = 400;
    throw error;
  }

  const usedKeys = new Set();
  const normalized = [];
  for (const [index, field] of fields.entries()) {
    const result = normalizeField(field, index, usedKeys);
    if (result.error) {
      const error = new Error(result.error);
      error.status = 400;
      throw error;
    }
    normalized.push({ ...result.field, vertical });
  }

  await prisma.$transaction(async (tx) => {
    await tx.salesCrmDynamicColumn.deleteMany({ where: { vertical } });
    if (normalized.length) await tx.salesCrmDynamicColumn.createMany({ data: normalized });
  });

  return listCustomFields(vertical);
}

module.exports = {
  FIELD_TYPES,
  FIELD_TYPES_WITH_OPTIONS,
  MAX_FIELDS_PER_VERTICAL,
  listCustomFields,
  replaceCustomFields,
  slugifyKey,
};
