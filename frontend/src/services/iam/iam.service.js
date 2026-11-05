import { apiRequest } from "@/services/api/client";

const query = (params = {}) => new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== "")).toString();

// The permission set the signed-in user inherits from the roles of every group they belong to.
// SUPER_ADMIN comes back with every permission; a user in no group comes back with none.
export const getUserPermissions = () => apiRequest("/api/user/permissions");
export const checkPermission = (module, feature, level) => apiRequest(`/api/user/permission?${query({ module, feature, level })}`);
export const getBranchFilter = () => apiRequest("/api/user/branch-filter");
export const canAccessBranch = (branchId) => apiRequest(`/api/user/can-access-branch?${query({ branchId })}`);
