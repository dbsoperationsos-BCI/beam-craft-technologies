/**
 * Where a lead came into the CRM - its Source column - named once.
 *
 * Source says how the lead arrived, not what the client says about themselves: a sheet's or a CSV's
 * own "Source" cell (Instagram, a campaign name) is ignored. Each way in writes its own label:
 *
 *   MANUAL   - Add Lead and Bulk Entry, typed into the app;
 *   CSV      - Import CSV;
 *   SHEET    - the linked Google Sheet sync;
 *   CALLYZER - a call the Callyzer webhook delivered (`callBoardService`, the call merge).
 *
 * Migration `20261009130000_crm_lead_source_labels` put the leads already stored on these labels.
 */
const LEAD_SOURCES = Object.freeze({
  MANUAL: "Manual Entry",
  CSV: "CSV Import",
  SHEET: "Google Sheet Integration",
  CALLYZER: "Callyzer",
});

module.exports = { LEAD_SOURCES };
