const { callyzerPost, isConfigured } = require("./client");
const { buildReportBody } = require("./validation");

/**
 * The five Call Log reports, each with the rules its own endpoint documents.
 *
 * The differences between them are small but real: `/analysis` and `/summary` take no paging,
 * `/never-attended` takes no duration filters, and `/unique-clients` allows a page size of 10,000
 * where the others cap at 100. Encoding that here means a caller cannot send a body Callyzer will
 * refuse.
 */

function fetchSummary(input) {
  return callyzerPost("/call-log/summary", buildReportBody(input));
}

function fetchEmployeeSummary(input) {
  return callyzerPost("/call-log/employee-summary", buildReportBody(input, { paging: true }));
}

function fetchAnalysis(input) {
  return callyzerPost("/call-log/analysis", buildReportBody(input));
}

function fetchNeverAttended(input) {
  // Their table for this endpoint lists no duration filters, so they are not sent.
  return callyzerPost("/call-log/never-attended", buildReportBody(input, { paging: true, durations: false }));
}

function fetchNotPickedUpByClient(input) {
  return callyzerPost("/call-log/not-pickup-by-client", buildReportBody(input, { paging: true, durations: false }));
}

function fetchUniqueClients(input) {
  // "Value must be less than 10,000" - the one endpoint that allows more than a hundred a page.
  return callyzerPost("/call-log/unique-clients", buildReportBody(input, { paging: true, maxPageSize: 10_000, durations: false }));
}

const REPORTS = {
  summary: fetchSummary,
  "employee-summary": fetchEmployeeSummary,
  analysis: fetchAnalysis,
  "never-attended": fetchNeverAttended,
  "not-pickup-by-client": fetchNotPickedUpByClient,
  "unique-clients": fetchUniqueClients,
};

module.exports = {
  REPORTS, isConfigured,
  fetchSummary, fetchEmployeeSummary, fetchAnalysis,
  fetchNeverAttended, fetchNotPickedUpByClient, fetchUniqueClients,
};
