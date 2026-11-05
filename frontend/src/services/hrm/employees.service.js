import { apiRequest } from "@/services/api/client";
import { downloadPdf } from "@/services/api/downloadPdf";

/**
 * The employee repository, a page at a time.
 *
 * `active: true` is what every picker wants - assign an asset, name a manager, choose whom a task
 * is for - and narrows the list to the people actually working here, leaving out anybody still
 * onboarding or long gone. The repository screen itself asks for everybody, because it has a tab
 * per status and a row that never arrives lands in none of them.
 */
/**
 * Whether the payslip carries the PF details (Settings → Template Settings): `{ details }`,
 * `PERSONAL` or `PERSONAL_AND_PF`. For Edit Employee → Payslip Details.
 */
export function getPayslipDetailsSetting() {
  return apiRequest("/api/hrm/employees/payslip-details");
}

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
/** Active employees for a picker. `{ forAttendance: true }`: only those the Attendance module shows. */
export function getEmployeeDirectory({ forAttendance = false } = {}) {
  return apiRequest(`/api/hrm/employees/directory${forAttendance ? "?for=attendance" : ""}`);
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

/**
 * Generate → Experience or Employment Certificate (`kind`): the certificate filled from the
 * employee's record and `body` (`{ duties }` for experience, nothing for employment), as HTML for
 * the preview...
 */
export function previewEmployeeCertificate(id, kind, body = {}) {
  return apiRequest(`/api/hrm/employees/${id}/certificates/${kind}`, { method: "POST", body: JSON.stringify(body) });
}

/** ...and the same certificate as an A4 PDF, saved under its name and the employee's. */
export function downloadEmployeeCertificate(id, kind, body = {}, employeeName = "employee", label = "Certificate") {
  const name = String(employeeName).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "employee";
  const file = String(label).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "Certificate";
  return downloadPdf(`/api/hrm/employees/${id}/certificates/${kind}/pdf`, `${file}-${name}.pdf`, {
    body,
    fallback: "Unable to download the certificate.",
  });
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

/**
 * The login just created, sent to the employee on WhatsApp from the sender's own account.
 *
 * The message carries the temporary password, which is readable only at the moment it is made -
 * the server never sends one back - so the wording is the browser's and cannot be rebuilt server
 * side. The employee's number is read off their record rather than sent from here.
 */
export function sendCredentialsWhatsApp(id, message) {
  return apiRequest(`/api/hrm/employees/${encodeURIComponent(id)}/send-credentials-whatsapp`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}
