import { apiRequest } from "@/services/api/client";

/** The studio's employee WhatsApp groups (Settings -> Employee -> WhatsApp Groups) and adding an employee to them. */
const base = "/api/hrm/whatsapp-groups";

/**
 * The groups typed in Settings, each with the departments it serves.
 *
 * `departmentId` narrows to one department's groups, which is what the screen's dropdown asks for.
 * A group under no department is only listed unnarrowed - it is nobody's department's group.
 */
export const getWhatsAppGroups = (departmentId) =>
  apiRequest(`${base}${departmentId ? `?departmentId=${encodeURIComponent(departmentId)}` : ""}`);

/**
 * Every department with the WhatsApp groups it claims — one row per department, as the table reads
 * them. Each row carries `groupNames` (comma separated, which is the cell) and `groups` (for Edit).
 */
export const getDepartmentWhatsAppGroups = () => apiRequest(`${base}/department-groups`);

/** Puts a group under one department, creating it if the studio has not named it yet. */
export const addGroupToDepartment = (departmentId, name) =>
  apiRequest(`${base}/departments/${departmentId}/groups`, { method: "POST", body: JSON.stringify({ name }) });

/** Takes a group out from under one department. The group itself is kept. */
export const removeGroupFromDepartment = (departmentId, groupId) =>
  apiRequest(`${base}/departments/${departmentId}/groups/${groupId}`, { method: "DELETE" });

/** The departments a group may be put under, read off the register rather than typed. */
export const getWhatsAppGroupDepartments = () => apiRequest(`${base}/departments`);

export const addWhatsAppGroup = (name, departmentIds = []) =>
  apiRequest(base, { method: "POST", body: JSON.stringify({ name, departmentIds }) });

/** Replaces which departments one group is for — what the multi-select means by saving. */
export const setWhatsAppGroupDepartments = (id, departmentIds) =>
  apiRequest(`${base}/${id}/departments`, { method: "PUT", body: JSON.stringify({ departmentIds }) });
export const removeWhatsAppGroup = (id) => apiRequest(`${base}/${id}`, { method: "DELETE" });
export const getEmployeeGroupMemberships = (employeeId) => apiRequest(`${base}/employees/${employeeId}`);
/** Queues the employee's add to each group; the answer is their rows, which say how each add went. */
export const addEmployeeToWhatsAppGroups = (employeeId, groupIds) => apiRequest(`${base}/employees/${employeeId}`, { method: "POST", body: JSON.stringify({ groupIds }) });

/**
 * Out of **every** group the app has them in, asked for by hand - for somebody marked inactive
 * without a separation, whom no exit will ever clean up. The removals queue and go about half a
 * minute apart, so the answer says that rather than looking as though nothing happened.
 */
export const removeEmployeeFromWhatsAppGroups = (employeeId) => apiRequest(`${base}/employees/${employeeId}`, { method: "DELETE" });
