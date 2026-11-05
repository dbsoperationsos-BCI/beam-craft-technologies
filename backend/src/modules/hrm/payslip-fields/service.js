const prisma = require("../../../config/db");

/**
 * Settings → Payroll rules → Edit Payslip, the Personal details and PF details half: details the
 * studio adds to the payslip - a label and what is typed into it (text, a number, text and numbers
 * together, a date). Each
 * becomes a field in Edit Employee → Payslip Details, under the section it was added to, and each
 * employee's answer is kept in `employee_payslip_value` and printed on their payslip.
 *
 * Every branch's, like the payroll rules and the extra Earnings / Deductions columns, so only somebody
 * who reaches every branch through `HRM / Payroll Register` may add, rename, archive or remove one.
 * Archiving stops it being asked for or printed while keeping what was typed; removing deletes the
 * field and every employee's answer to it.
 */

const SECTIONS = ["PERSONAL", "PF"];
// Text (no digits), a number, text and numbers together, or a date.
// ALNUM: letters, numbers and spaces; ANY: any character at all, symbols included.
const INPUT_TYPES = ["TEXT", "NUMBER", "ALNUM", "ANY", "DATE", "DROPDOWN"];
// A Dropdown's choices: at least two, at most this many, each up to 60 characters.
const MAX_OPTIONS = 30;
const MAX_FIELDS = 30;
// The payslip's own details - an added field by the same name would read as one of them.
const BUILT_IN_LABELS = [
  "Emp Code", "Emp Name", "Department", "Designation", "Location", "Date Of Birth", "Date of Joining", "PAN",
  "Bank A/c No.", "Residential Status", "Cost Centre", "PF No.", "UAN", "EPS No.", "ESI No.",
];

/**
 * What every payslip carries without being added, by Edit Payslip's group. Each can be turned off or
 * deleted there (`hrm_settings.payslip_built_in_items`) - left off the payslip either way; deleted ones
 * leave the list too, until restored. They still come from the employee record and the payroll row.
 */
const BUILT_IN_ITEMS = {
  PERSONAL: ["Emp Code", "Emp Name", "Department", "Designation", "Location", "Date Of Birth", "Date of Joining", "PAN", "Bank A/c No.", "Residential Status", "Cost Centre"],
  PF: ["PF No.", "UAN", "EPS No.", "ESI No."],
  EARNING: ["Salary", "Incentive", "Referral Bonus"],
  DEDUCTION: ["LOP Deduction", "Salary Advance", "Recovery", "Policy Breach", "Other Deductions"],
};
const BUILT_IN_NAMES = Object.values(BUILT_IN_ITEMS).flat();
// What every payroll is worked out from - on Edit Payslip from the start, renamed or turned off, never
// deleted. Every other item of the payslip's own is off the list until somebody adds it there.
// Referral Bonus among them: like Recovery and Policy Breach it is a figure the payroll row brings in
// rather than one somebody types, so it prints from the start and can be turned off but not deleted.
const UNDELETABLE_ITEMS = ["Salary", "LOP Deduction", "Salary Advance", "Recovery", "Policy Breach", "Referral Bonus"];

const fail = (status, message) => Object.assign(new Error(message), { status });
const EVERY_BRANCH = "The payslip's details are every branch's, so only somebody who reaches every branch may change them.";

const toField = (row) => ({
  id: row.id,
  section: row.section,
  label: row.label,
  inputType: row.inputType,
  options: Array.isArray(row.options) ? row.options : [],
  archived: Boolean(row.archivedAt),
  shownOnPayslip: row.shownOnPayslip !== false,
  answers: row._count?.values || 0,
});

function checkLabel(label) {
  if (BUILT_IN_LABELS.some((builtIn) => builtIn.toLowerCase() === label.toLowerCase())) {
    throw fail(400, `"${label}" is already one of the payslip's own details. Choose another name.`);
  }
}
const duplicate = (label) => fail(409, `There is already a detail called "${label}" in that section.`);

/** Every field, archived ones included; `active` narrows to the ones asked for and printed. */
async function listFields({ active = false, client = prisma } = {}) {
  const rows = await client.payslipField.findMany({
    where: active ? { archivedAt: null } : {},
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    include: { _count: { select: { values: true } } },
  });
  return rows.map(toField);
}

/** A Dropdown's choices, trimmed and each once - at least two; none for any other input type. */
function optionsFor(inputType, options) {
  if (inputType !== "DROPDOWN") return null;
  const unique = [...new Set((options || []).map((option) => String(option ?? "").trim()).filter(Boolean))];
  if (unique.length < 2) throw fail(400, "Give the dropdown at least two options.");
  if (unique.length > MAX_OPTIONS) throw fail(400, `A dropdown takes up to ${MAX_OPTIONS} options.`);
  if (unique.some((option) => option.length > 60)) throw fail(400, "Keep each option to 60 characters.");
  return unique;
}

async function createField({ section, label, inputType, options }, userId, reach = null, client = prisma) {
  if (reach) throw fail(403, EVERY_BRANCH);
  checkLabel(label);
  const choices = optionsFor(inputType, options);
  const existing = await client.payslipField.findMany({ select: { sortOrder: true, archivedAt: true } });
  if (existing.filter((row) => !row.archivedAt).length >= MAX_FIELDS) throw fail(400, `The payslip takes up to ${MAX_FIELDS} added details. Archive or remove one first.`);
  try {
    const created = await client.payslipField.create({
      data: { section, label, inputType, ...(choices ? { options: choices } : {}), sortOrder: Math.max(0, ...existing.map((row) => row.sortOrder)) + 1, createdByUserId: userId || null },
    });
    return toField(created);
  } catch (error) {
    if (error?.code === "P2002") throw duplicate(label);
    throw error;
  }
}

/** Renames a field, or archives or restores it. Its section and what is typed into it never change. */
async function updateField(id, { label, archived, shownOnPayslip }, reach = null, client = prisma) {
  if (reach) throw fail(403, EVERY_BRANCH);
  const current = await client.payslipField.findUnique({ where: { id } });
  if (!current) throw fail(404, "This detail could not be found.");
  if (label !== undefined) checkLabel(label);
  const data = {};
  if (label !== undefined) data.label = label;
  if (archived !== undefined) data.archivedAt = archived ? (current.archivedAt || new Date()) : null;
  if (shownOnPayslip !== undefined) data.shownOnPayslip = Boolean(shownOnPayslip);
  try {
    return toField(await client.payslipField.update({ where: { id }, data, include: { _count: { select: { values: true } } } }));
  } catch (error) {
    if (error?.code === "P2002") throw duplicate(label);
    throw error;
  }
}

/** Removes a field and every employee's answer to it - `{ cleared }` is how many answers went. */
async function removeField(id, reach = null, client = prisma) {
  if (reach) throw fail(403, EVERY_BRANCH);
  const current = await client.payslipField.findUnique({ where: { id }, include: { _count: { select: { values: true } } } });
  if (!current) throw fail(404, "This detail could not be found.");
  await client.payslipField.delete({ where: { id } });
  return { cleared: current._count?.values || 0 };
}

/** One answer, checked against what the field takes; `""`/null clears it. */
function valueProblem(field, value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (text.length > 500) return `${field.label}: keep it to 500 characters.`;
  if (field.inputType === "NUMBER" && !/^-?\d+(\.\d+)?$/.test(text)) return `${field.label} takes a number.`;
  if (field.inputType === "TEXT" && /\d/.test(text)) return `${field.label} takes text only - choose "Text and number" for one with digits.`;
  if (field.inputType === "ALNUM" && !/^[\p{L}\p{N} ]+$/u.test(text)) return `${field.label} takes letters and numbers only - choose "Any character" for one with symbols.`;
  if (field.inputType === "DATE" && (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(new Date(`${text}T00:00:00Z`).getTime()))) return `${field.label} takes a date.`;
  if (field.inputType === "DROPDOWN" && !(Array.isArray(field.options) ? field.options : []).includes(text)) return `${field.label}: choose one of its options.`;
  return null;
}

/**
 * Writes one employee's answers - `{ [fieldId]: value }`, a value of `""`/null clearing it - inside
 * the caller's transaction. Only fields still offered are written; one that is not is refused.
 */
async function saveValues(employeeId, values, client = prisma) {
  const entries = Object.entries(values || {});
  if (!entries.length) return;
  const ids = entries.map(([id]) => Number(id));
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) throw fail(400, "That payslip detail could not be found.");
  const fields = await client.payslipField.findMany({ where: { id: { in: ids }, archivedAt: null } });
  const byId = new Map(fields.map((field) => [field.id, field]));
  for (const [rawId, value] of entries) {
    const field = byId.get(Number(rawId));
    if (!field) throw fail(400, "A payslip detail on this form is no longer offered. Reopen the employee and try again.");
    const problem = valueProblem(field, value);
    if (problem) throw fail(400, problem);
  }
  for (const [rawId, value] of entries) {
    const fieldId = Number(rawId);
    const text = String(value ?? "").trim();
    if (!text) await client.employeePayslipValue.deleteMany({ where: { employeeId, fieldId } });
    else await client.employeePayslipValue.upsert({ where: { employeeId_fieldId: { employeeId, fieldId } }, update: { value: text }, create: { employeeId, fieldId, value: text } });
  }
}

const SETTINGS_ID = "default";
const builtInState = async (client) => (await client.hrmSettings.findUnique({ where: { id: SETTINGS_ID }, select: { payslipBuiltInItems: true } }))?.payslipBuiltInItems || {};

/**
 * The original items, each `{ group, label, name, shown, deleted }` - `label` the item's own (what it is
 * stored and hidden by), `name` what the payslip prints: the label, or what Edit Payslip renamed it to.
 */
async function builtInItems({ client = prisma } = {}) {
  const state = await builtInState(client);
  return Object.entries(BUILT_IN_ITEMS).flatMap(([group, labels]) => labels.map((label) => {
    const core = UNDELETABLE_ITEMS.includes(label);
    // The undeletable ones are always there; any other is deleted - off the list and the payslip - until added.
    const deleted = core ? false : state[label]?.deleted !== false;
    return { group, label, name: state[label]?.name || label, deletable: !core, shown: !deleted && state[label]?.shown !== false, deleted };
  }));
}

/** Every name the payslip already prints, but `except` - a new name has to be none of them. */
async function namesInUse(except, client) {
  const [builtIns, fields, columns] = await Promise.all([
    builtInItems({ client }),
    client.payslipField.findMany({ where: { archivedAt: null }, select: { label: true } }),
    client.payrollComponent.findMany({ where: { archivedAt: null }, select: { name: true } }),
  ]);
  return [...builtIns.filter((item) => item.label !== except).flatMap((item) => [item.label, item.name]), ...fields.map((field) => field.label), ...columns.map((column) => column.name)]
    .map((name) => name.toLowerCase());
}

/**
 * Turns an original item on or off, deletes it, restores it (`deleted: false`, back on), or renames
 * it (`name`; its own label again puts the original back).
 */
async function setBuiltInItem(label, { shown, deleted, name }, reach = null, client = prisma) {
  if (reach) throw fail(403, EVERY_BRANCH);
  if (!BUILT_IN_NAMES.includes(label)) throw fail(404, "That item is not one of the payslip's own.");
  if (deleted === true && UNDELETABLE_ITEMS.includes(label)) throw fail(400, `${label} is what the payroll is worked out from, so it cannot be deleted. Turn it off instead.`);
  const state = { ...(await builtInState(client)) };
  const next = { ...(state[label] || {}) };
  if (name !== undefined) {
    const wanted = String(name).trim();
    if (!wanted) throw fail(400, "Name the item.");
    if (wanted.length > 60) throw fail(400, "Keep the name to 60 characters.");
    if (wanted.toLowerCase() !== label.toLowerCase() && (await namesInUse(label, client)).includes(wanted.toLowerCase())) {
      throw fail(409, `The payslip already has "${wanted}". Choose another name.`);
    }
    if (wanted === label) delete next.name; else next.name = wanted;
  }
  // Added (`deleted: false`) is stored, since an item of the payslip's own is deleted until it is.
  if (deleted !== undefined) { if (deleted) next.deleted = true; else { next.deleted = false; delete next.shown; } }
  if (shown !== undefined) { if (shown) delete next.shown; else next.shown = false; }
  if (Object.keys(next).length) state[label] = next; else delete state[label];
  await client.hrmSettings.upsert({ where: { id: SETTINGS_ID }, update: { payslipBuiltInItems: state }, create: { id: SETTINGS_ID, payslipBuiltInItems: state } });
  return (await builtInItems({ client })).find((item) => item.label === label);
}

/**
 * Every name the payslip leaves off: original items turned off or deleted, added details turned off
 * or archived, and Earnings / Deductions columns turned off - for every printout to filter by.
 */
async function hiddenPayslipItems({ client = prisma } = {}) {
  const [builtIns, fields, columns] = await Promise.all([
    builtInItems({ client }),
    client.payslipField.findMany({ where: { OR: [{ shownOnPayslip: false }, { archivedAt: { not: null } }] }, select: { label: true } }),
    client.payrollComponent.findMany({ where: { shownOnPayslip: false }, select: { name: true } }),
  ]);
  return [...builtIns.filter((item) => !item.shown).map((item) => item.label), ...fields.map((field) => field.label), ...columns.map((column) => column.name)];
}

/** `{ [original label]: new name }` for every original item renamed in Edit Payslip - for every printout. */
async function renamedPayslipItems({ client = prisma } = {}) {
  return Object.fromEntries((await builtInItems({ client })).filter((item) => item.name !== item.label).map((item) => [item.label, item.name]));
}

/**
 * What was added in Edit Payslip and is on - `{ PERSONAL: [{ label, inputType }], PF: [...],
 * EARNING: [name], DEDUCTION: [name] }` - for the sample payslip to show where each lands.
 */
async function addedPayslipItems({ client = prisma } = {}) {
  const [fields, columns] = await Promise.all([
    client.payslipField.findMany({ where: { shownOnPayslip: true, archivedAt: null }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: { section: true, label: true, inputType: true } }),
    client.payrollComponent.findMany({ where: { shownOnPayslip: true, archivedAt: null }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: { kind: true, name: true } }),
  ]);
  return {
    PERSONAL: fields.filter((field) => field.section === "PERSONAL").map(({ label, inputType }) => ({ label, inputType })),
    PF: fields.filter((field) => field.section === "PF").map(({ label, inputType }) => ({ label, inputType })),
    EARNING: columns.filter((column) => column.kind === "EARNING").map((column) => column.name),
    DEDUCTION: columns.filter((column) => column.kind === "DEDUCTION").map((column) => column.name),
  };
}

module.exports = { SECTIONS, INPUT_TYPES, MAX_FIELDS, MAX_OPTIONS, UNDELETABLE_ITEMS, BUILT_IN_ITEMS, addedPayslipItems, listFields, createField, updateField, removeField, valueProblem, saveValues, builtInItems, setBuiltInItem, hiddenPayslipItems, renamedPayslipItems };
