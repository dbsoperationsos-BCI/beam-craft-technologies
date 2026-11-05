import { apiRequest } from "@/services/api/client";

/**
 * The CRM's lead reports, read from the calls the studio already holds.
 *
 * Every report is a `GET` with its filters in the query string. That is what makes a report a
 * link - bookmarkable, sendable, and reloading into the same numbers - and it is what lets the
 * backend grant it on Read rather than demanding write access to look at a chart.
 */

const ROOT = "/api/sales/crm-reports";

/*
 * Blank filters are left out of the URL entirely rather than sent empty.
 *
 * The server ignores them either way, but a link carrying `&employee=&vertical=&callType=` is one
 * nobody can read, and the difference matters the moment somebody pastes a report into a message
 * to ask why it says what it says.
 */
function queryString(filters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    /*
     * A filter holding several answers is **repeated**, not joined: `employee=A&employee=B` is what
     * a query string is for, and it survives a name with a comma in it, which a joined value does
     * not. The server reads either, so a link somebody typed by hand keeps working.
     */
    if (Array.isArray(value)) {
      for (const entry of value) {
        const text = String(entry ?? "").trim();
        if (text) params.append(key, text);
      }
      continue;
    }
    const text = String(value ?? "").trim();
    if (text) params.set(key, text);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

/**
 * The Sales dashboard: the CRM in one screen.
 *
 * One request rather than six, so the page cannot paint a lead total from one moment beside a call
 * total from another.
 */
export function getCrmDashboard(filters = {}) {
  return apiRequest(`${ROOT}/dashboard${queryString(filters)}`);
}

/** The employees, verticals and call kinds the filter bar offers, taken from the data itself. */
export function getReportOptions() {
  return apiRequest(`${ROOT}/options`);
}

/**
 * One report.
 *
 * `report` is one of `summary`, `employee-analysis`, `lead-analysis`, `never-attended`,
 * `not-picked-up`, `call-history`. Anything else answers 404 with the list of the ones that exist.
 */
export function getCrmReport(report, filters = {}) {
  return apiRequest(`${ROOT}/${encodeURIComponent(report)}${queryString(filters)}`);
}
