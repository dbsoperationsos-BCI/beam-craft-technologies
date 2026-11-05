import { apiRequest } from "@/services/api/client";

/**
 * The employee repository, a page at a time.
 *
 * `active: true` is what every picker wants - assign an asset, name a manager, choose whom a task
 * is for - and narrows the list to the people actually working here, leaving out anybody still
 * onboarding or long gone. The repository screen itself asks for everybody, because it has a tab
 * per status and a row that never arrives lands in none of them.
 */
export function getEmployees({ page = 1, pageSize = 100, active } = {}) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (active !== undefined) params.set("active", String(active));
  return apiRequest(`/api/hrm/employees?${params.toString()}`);
}

/**
 * The people a picker may name - id, Employee ID and name - for screens whose roles do not hold
 * HRM. Asset Management and Client Storage read this rather than `getEmployees`, which is the
 * repository itself and answers only to `HRM / Employee Management`. Working employees only,
 * already ordered by name.
 */
export function getEmployeeDirectory() {
  return apiRequest("/api/hrm/employees/directory");
}

export function getNextEmployeeId() {
  return apiRequest("/api/hrm/employees/next-employee-id");
}

export function createEmployee(payload) {
  return apiRequest("/api/hrm/employees", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateEmployee(id, payload) {
  return apiRequest(`/api/hrm/employees/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteEmployee(id) {
  return apiRequest(`/api/hrm/employees/${id}`, { method: "DELETE" });
}

/**
 * Brings somebody in the InActive tab back to work: the offboarding on record is removed, the
 * status returns to the one they held before it, and their login is reopened with them. Refused
 * with a 409 for somebody already working here, or still onboarding.
 */
export function reactivateEmployee(id, reason) {
  return apiRequest(`/api/hrm/employees/${id}/reactivate`, { method: "POST", body: JSON.stringify({ reason }) });
}

// Reopens a submitted onboarding under its original link and emails the candidate to edit it.
export function sendBackOnboarding(id) {
  return apiRequest(`/api/hrm/employees/${id}/send-back-onboarding`, { method: "POST" });
}

export function createLoginCredentials(id, payload) {
  return apiRequest(`/api/hrm/employees/${id}/create-login-credentials`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * The Login Credentials page as somebody left it — what was chosen, not an account.
 *
 * Answers `null` where nobody has started that page, which is the ordinary case rather than an
 * error: the page then proposes from the record as it always did.
 */
/**
 * The account an employee already has, for the Login Credentials page of Edit Employee.
 *
 * Answers `data: null` for an employee with no login, which is how the page knows to show the
 * create form instead. Behind `ADMIN / User Management` like the draft beside it.
 */
export function getLoginCredentials(id) {
  return apiRequest(`/api/hrm/employees/${id}/login-credentials`);
}

/** What that page may change: roles, cover and leave approval. Never the sign-in identity. */
export function updateLoginCredentials(id, payload) {
  return apiRequest(`/api/hrm/employees/${id}/login-credentials`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function getLoginCredentialsDraft(id) {
  return apiRequest(`/api/hrm/employees/${id}/login-credentials-draft`);
}

/** Puts the page down as it stands. An empty payload clears the draft, which is what Discard does. */
export function saveLoginCredentialsDraft(id, payload) {
  return apiRequest(`/api/hrm/employees/${id}/login-credentials-draft`, {
    method: "PUT",
    body: JSON.stringify(payload || {}),
  });
}
