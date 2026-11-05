const { z } = require("zod");
const service = require("./service");

/**
 * HRM -> employee WhatsApp groups. The router guards every route with `HRM / Employee Management`:
 * reading is Read, adding groups and employees is Read / Write. Groups are typed by their WhatsApp name;
 * a linked WhatsApp that is an admin of the group with that name adds employees to it.
 */

const idSchema = z.coerce.number().int().positive();
// `departmentIds` is the list the multi-select sends - omitted is a group under no department, which
// is allowed and means onboarding never adds anybody to it.
const departmentIdsSchema = z.array(z.coerce.number().int().positive()).max(50).optional();
const addGroupSchema = z.object({ name: z.string().trim().min(1).max(200), departmentIds: departmentIdsSchema }).strict();
const groupDepartmentsSchema = z.object({ departmentIds: departmentIdsSchema }).strict();
const listQuerySchema = z.object({ departmentId: z.coerce.number().int().positive().optional() }).strict();
const addEmployeeSchema = z.object({ groupIds: z.array(z.coerce.number().int().positive()).min(1).max(100) }).strict();

function fail(res, error, fallback) {
  if (error?.status) return res.status(error.status).json({ message: error.message, ...(error.code ? { code: error.code } : {}) });
  console.error(fallback, error);
  return res.status(500).json({ message: fallback });
}

async function listGroups(req, res) {
  const parsed = listQuerySchema.safeParse(req.query || {});
  if (!parsed.success) return res.status(400).json({ message: "That is not a department.", errors: parsed.error.flatten() });
  try { return res.json({ data: await service.listGroups({ departmentId: parsed.data.departmentId || null }) }); } catch (error) { return fail(res, error, "Unable to load the WhatsApp groups."); }
}

async function addGroup(req, res) {
  const parsed = addGroupSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: "Type the WhatsApp group's name." });
  try { return res.json({ data: await service.addGroup({ name: parsed.data.name, departmentIds: parsed.data.departmentIds, userId: Number(req.user.id) }) }); } catch (error) { return fail(res, error, "Unable to add that WhatsApp group."); }
}

async function removeGroup(req, res) {
  const id = idSchema.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ message: "That is not a WhatsApp group." });
  try { await service.removeGroup(id.data); return res.json({ data: { id: id.data } }); } catch (error) { return fail(res, error, "Unable to remove that WhatsApp group."); }
}

async function employeeGroups(req, res) {
  const id = idSchema.safeParse(req.params.employeeId);
  if (!id.success) return res.status(400).json({ message: "Choose an employee." });
  // `{ memberships, groups }`: where each add stands, and the groups their departments offer them.
  try { return res.json({ data: await service.employeeGroupPicker(id.data) }); } catch (error) { return fail(res, error, "Unable to load this employee's WhatsApp groups."); }
}

async function addEmployee(req, res) {
  const id = idSchema.safeParse(req.params.employeeId);
  if (!id.success) return res.status(400).json({ message: "Choose an employee." });
  const parsed = addEmployeeSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: "Choose at least one WhatsApp group." });
  try {
    return res.json({ data: await service.addEmployee({ employeeId: id.data, groupIds: parsed.data.groupIds, userId: Number(req.user.id) }) });
  } catch (error) { return fail(res, error, "Unable to add this employee to those WhatsApp groups."); }
}

/** Every department with the groups it claims — one row per department, as the table reads them. */
async function listDepartmentGroups(req, res) {
  try { return res.json({ data: await service.listDepartmentGroups() }); } catch (error) { return fail(res, error, "Unable to load the departments' WhatsApp groups."); }
}

const departmentGroupSchema = z.object({ name: z.string().trim().min(1).max(200) }).strict();

/** Puts a group under one department, creating it if the studio has not named it yet. */
async function addGroupToDepartment(req, res) {
  const departmentId = z.coerce.number().int().positive().safeParse(req.params.departmentId);
  if (!departmentId.success) return res.status(400).json({ message: "That is not a department." });
  const parsed = departmentGroupSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: "Type the WhatsApp group's name.", errors: parsed.error.flatten() });
  try {
    return res.json({ data: await service.addGroupToDepartment({ departmentId: departmentId.data, name: parsed.data.name, userId: Number(req.user.id) }) });
  } catch (error) { return fail(res, error, "Unable to add that group to the department."); }
}

/** Takes a group out from under one department. The group itself is kept. */
async function removeGroupFromDepartment(req, res) {
  const departmentId = z.coerce.number().int().positive().safeParse(req.params.departmentId);
  const groupId = z.coerce.number().int().positive().safeParse(req.params.groupId);
  if (!departmentId.success || !groupId.success) return res.status(400).json({ message: "That is not a department and a group." });
  try {
    return res.json({ data: await service.removeGroupFromDepartment({ departmentId: departmentId.data, groupId: groupId.data }) });
  } catch (error) { return fail(res, error, "Unable to take that group out of the department."); }
}

/** The departments a group may be put under, for the screen's dropdown. */
async function listDepartments(req, res) {
  try { return res.json({ data: await service.listDepartments() }); } catch (error) { return fail(res, error, "Unable to load the departments."); }
}

/** Replaces which departments one group is for. */
async function setGroupDepartments(req, res) {
  const id = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ message: "That is not a WhatsApp group." });
  const parsed = groupDepartmentsSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: "That is not a list of departments.", errors: parsed.error.flatten() });
  try { return res.json({ data: await service.setGroupDepartments(id.data, parsed.data.departmentIds) }); } catch (error) { return fail(res, error, "Unable to change that group's departments."); }
}

/**
 * **Out of every group the app has them in**, asked for by hand.
 *
 * For the people no exit will ever clean up: somebody marked inactive by a status change rather than
 * through Separations has no separation for the relieving job to find, so nothing was ever queued for
 * them and nothing ever will be. Recording an exit retroactively would close their login and move
 * their reports, which is a lot to do to fix a WhatsApp group.
 *
 * The same queue the exit uses - thirty seconds apart, never throwing - so this is the same removal,
 * asked for by a person instead of by an exit.
 */
async function removeEmployeeFromGroups(req, res) {
  const employeeId = Number(req.params.employeeId);
  if (!Number.isInteger(employeeId) || employeeId <= 0) return res.status(400).json({ message: "Choose an employee." });
  try {
    const { queued } = await service.removeEmployeeFromAllGroups(employeeId, { userId: Number(req.user?.id) || null });
    return res.json({
      data: { queued },
      message: queued
        ? `Leaving ${queued} ${queued === 1 ? "group" : "groups"}. They go one at a time, about half a minute apart, so it does not read as automation from the studio's number.`
        : "This employee is not in any group the app has a record of.",
    });
  } catch (error) {
    console.error("Unable to queue an employee's group removals:", error?.message || error);
    return res.status(500).json({ message: "Unable to take this employee out of their groups." });
  }
}

module.exports = {
  removeEmployeeFromGroups,
  listGroups, addGroup, removeGroup, listDepartments, setGroupDepartments,
  listDepartmentGroups, addGroupToDepartment, removeGroupFromDepartment,
  employeeGroups, addEmployee,
};
