import { apiRequest } from "@/services/api/client";

const query = (params = {}) => new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== "")).toString();

// Branches are the `branches` master data - the admin screens fill their branch pickers with
// getMasterData("branches"), so there is no branch call of its own here.

// Users
export const getUsers = (params) => apiRequest(`/api/admin/users?${query(params)}`);
export const getUser = (userId) => apiRequest(`/api/admin/users/${userId}`);
export const createUser = (payload) => apiRequest("/api/admin/users", { method: "POST", body: JSON.stringify(payload) });
export const updateUser = (userId, payload) => apiRequest(`/api/admin/users/${userId}`, { method: "PATCH", body: JSON.stringify(payload) });
export const deleteUser = (userId) => apiRequest(`/api/admin/users/${userId}`, { method: "DELETE" });

// The employees an account can be joined to. Served by the admin router under its own permission
// rather than read from the Employee Repository's endpoint, so administering users does not also
// require the repository's permission. Rows already spoken for carry `linkedToUserId`.
export const getLinkableEmployees = () => apiRequest("/api/admin/linkable-employees");
// Joining a login to the person it belongs to, or clearing the link with `null`. This is what
// Attendance, Payment Requests, Tasks and the org chart read to find the person behind a login.
export const setUserEmployeeLink = (userId, linkedEmployeeId) => updateUser(userId, { linkedEmployeeId });

// The roles a user carries. A role decides what may be done and which branches it reaches, so this
// is the whole of one person's access.
export const getUserRoles = (userId) => apiRequest(`/api/admin/users/${userId}/roles`);
export const assignRoleToUser = (userId, roleId) => apiRequest(`/api/admin/users/${userId}/roles`, { method: "POST", body: JSON.stringify({ roleId }) });
export const removeRoleFromUser = (userId, roleId) => apiRequest(`/api/admin/users/${userId}/roles/${roleId}`, { method: "DELETE" });

// Roles. A role holds its permissions directly - there is no policy layer between them - and a
// group is given as many roles as it needs.
export const getRoles = () => apiRequest("/api/admin/roles");
export const getRole = (roleId) => apiRequest(`/api/admin/roles/${roleId}`);
// The whole role goes up in one call: identification, characteristics and the permission matrix
// together, because that is how the dialog collects it.
export const createRole = (payload) => apiRequest("/api/admin/roles", { method: "POST", body: JSON.stringify(payload) });
export const updateRole = (roleId, payload) => apiRequest(`/api/admin/roles/${roleId}`, { method: "PATCH", body: JSON.stringify(payload) });
export const deleteRole = (roleId) => apiRequest(`/api/admin/roles/${roleId}`, { method: "DELETE" });
// Copies the role with everything it grants, scopes included. Omit the name and the server picks
// "<name> (copy)".
export const duplicateRole = (roleId, name) => apiRequest(`/api/admin/roles/${roleId}/duplicate`, { method: "POST", body: JSON.stringify({ name }) });
// Replaces the matrix on its own. A permission left out of the list is one being withdrawn.
export const setRolePermissions = (roleId, permissions) => apiRequest(`/api/admin/roles/${roleId}/permissions`, { method: "PUT", body: JSON.stringify({ permissions }) });

// Every permission, each carrying the named scopes it can be narrowed by.
export const getPermissions = () => apiRequest("/api/admin/permissions");

// The Admin Permission set: the one matrix every role marked Branch Admin carries. Guarded by
// ADMIN / Role Management on the server, like everything else on this screen.
export const getBranchAdminPermissions = () => apiRequest("/api/admin/branch-admin-permissions");
export const saveBranchAdminPermissions = (permissions) => apiRequest("/api/admin/branch-admin-permissions", { method: "PUT", body: JSON.stringify({ permissions }) });
