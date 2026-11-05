const { importTableRows, templateHeaders, IMPORT_SLICE } = require("../../../services/tableImport");
const { importColumns, rowSchema, VERTICALS } = require("./importColumns");
const { importRow } = require("./import.service");
const { callerOf } = require("./access");

/*
 * Production → Import: the production side of the studio's old sheet, linked to the shoots Pre
 * Production → Import made by the sheet's Shoot ID. One template per vertical; the vertical is the
 * route's, never the file's. Columns and cell rules: `importColumns.js`. What a row writes:
 * `import.service.js`. Guarded in `routes.js` by the router's PROJECT / Production - write for the
 * POST. It creates no booking and no shoot, so nothing beyond that is asked.
 */

const MAX_HEADERS = 200;

function verticalOf(req) {
  const vertical = String(req.params.vertical || "").toUpperCase();
  return VERTICALS.includes(vertical) ? vertical : null;
}

async function importTemplate(req, res) {
  if (!verticalOf(req)) return res.status(404).json({ message: "Unknown vertical." });
  return res.json({ data: { columns: templateHeaders(importColumns()) } });
}

async function importProduction(req, res) {
  const vertical = verticalOf(req);
  if (!vertical) return res.status(404).json({ message: "Unknown vertical." });
  const { headers, rows } = req.body || {};
  // The browser sends a file in batches of this size; every row is its own transaction.
  if (!Array.isArray(rows) || rows.length > IMPORT_SLICE || !Array.isArray(headers) || headers.length > MAX_HEADERS) {
    return res.status(400).json({ message: `Send at most ${IMPORT_SLICE} rows and ${MAX_HEADERS} columns at a time.` });
  }
  try {
    const caller = await callerOf(req.user.id);
    const data = await importTableRows({
      headers,
      rows,
      startRow: Number(req.body.startRow) || 2,
      columns: importColumns(),
      schema: rowSchema,
      create: (row) => importRow({ vertical, row, caller }),
    });
    return res.json({ data });
  } catch (error) {
    if (error?.status === 400) return res.status(400).json({ message: error.message });
    console.error("Unable to import production:", error?.code || error?.name || "unknown");
    return res.status(500).json({ message: "Unable to import production." });
  }
}

module.exports = { importTemplate, importProduction };
