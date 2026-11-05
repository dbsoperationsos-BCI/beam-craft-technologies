const { importTableRows, templateHeaders, IMPORT_SLICE } = require("../../../services/tableImport");
const { importColumns, rowSchema, VERTICALS } = require("./importColumns");
const prisma = require("../../../config/db");
const { importRow } = require("./import.service");

/*
 * Pre Production → Import: the studio's old pre production sheet brought in as projects and shoots
 * numbered the app's way, with their pre production filled in. One template per vertical, because
 * each vertical's pre production asks its own questions; the vertical is the route's, never the
 * file's. Columns and cell rules: `importColumns.js`. What a row writes: `import.service.js`.
 *
 * Guarded in `routes.js` by PROJECT / Pre Production (the router's) and SALES / Sales Manager write,
 * because it creates bookings.
 */

const MAX_HEADERS = 200;

function verticalOf(req) {
  const vertical = String(req.params.vertical || "").toUpperCase();
  return VERTICALS.includes(vertical) ? vertical : null;
}

async function importTemplate(req, res) {
  const vertical = verticalOf(req);
  if (!vertical) return res.status(404).json({ message: "Unknown vertical." });
  return res.json({ data: { columns: templateHeaders(importColumns(vertical)) } });
}

async function importPreProduction(req, res) {
  const vertical = verticalOf(req);
  if (!vertical) return res.status(404).json({ message: "Unknown vertical." });
  const { headers, rows } = req.body || {};
  // The browser sends a file in batches of this size; a request carrying more was not sent by it,
  // and every row is its own transaction, so the size of one request is capped here.
  if (!Array.isArray(rows) || rows.length > IMPORT_SLICE || !Array.isArray(headers) || headers.length > MAX_HEADERS) {
    return res.status(400).json({ message: `Send at most ${IMPORT_SLICE} rows and ${MAX_HEADERS} columns at a time.` });
  }
  /*
   * `replace` deletes the project already in the app for a matching client name and imports the
   * sheet's booking in its place (see `replaceProject`); `preview` works every row through in full
   * and keeps nothing, answering what an import would do - the dialog asks for one before the other.
   */
  const replace = req.body.replace === true;
  // `restore` brings back a project or shoot deleted in the app that a row names again (`restoreProject`).
  const restore = req.body.restore === true;
  const preview = req.body.preview === true;
  // `lenient` is "Import rows with errors": a cell the row's checks refuse comes in empty and the row
  // still imports, rather than the row being thrown away for it (`services/tableImport.js`).
  const lenient = req.body.lenient === true;
  try {
    const replaced = new Map();
    const restored = new Map();
    // Projects that were already in the app and are kept, given the sheet's IDs (with the reason
    // Replace did not delete one, where it was ticked).
    const linked = new Map();
    const user = replace || restore ? await prisma.user.findUnique({ where: { id: Number(req.user.id) }, select: { id: true, linkedEmployeeId: true } }) : null;
    if ((replace || restore) && !user) return res.status(403).json({ message: "Your account was not found." });
    const data = await importTableRows({
      headers,
      rows,
      startRow: Number(req.body.startRow) || 2,
      lenient,
      columns: importColumns(vertical),
      schema: rowSchema,
      create: (row, rowNumber) => importRow({
        vertical, row, userId: Number(req.user.id), preview, lenient,
        replace: replace ? { user, onReplaced: (project) => { if (!replaced.has(project.eventId)) replaced.set(project.eventId, { ...project, row: rowNumber, sheetEventId: row.sheetEventId }); } } : null,
        restore: restore ? { user, onRestored: (item) => { restored.set(`${item.kind}:${item.id}`, { ...item, row: rowNumber }); } } : null,
        onLinked: (project) => { if (!linked.has(project.eventId)) linked.set(project.eventId, { ...project, row: rowNumber }); },
      }),
    });
    return res.json({ data: { ...data, preview, replaced: [...replaced.values()], restored: [...restored.values()], linked: [...linked.values()] } });
  } catch (error) {
    if (error?.status === 400) return res.status(400).json({ message: error.message });
    console.error("Unable to import pre production:", error?.code || error?.name || "unknown");
    return res.status(500).json({ message: "Unable to import pre production." });
  }
}

module.exports = { importTemplate, importPreProduction };
