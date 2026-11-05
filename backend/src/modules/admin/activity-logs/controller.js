const { z } = require("zod");
const service = require("./service");
const exporter = require("./export");

/**
 * Administration → User Activity Logs, over HTTP.
 *
 * Who may reach this is decided by the router (`ADMIN / User Activity Logs`); which lines they see
 * is decided by the service, through the branches of the roles granting that permission. No role
 * name is checked here: a check below the guard would overrule it and could be granted to nobody.
 */

const text = z.string().trim().max(191).optional().transform((value) => value || undefined);
const isoDate = z.string().trim().optional()
  .transform((value) => value || undefined)
  .refine((value) => value === undefined || !Number.isNaN(Date.parse(value)), { message: "Not a date." })
  .transform((value) => (value === undefined ? undefined : new Date(value)));

const listQuery = z.object({
  from: isoDate,
  to: isoDate,
  username: text,
  module: text,
  action: text,
  method: z.string().trim().max(10).optional().transform((value) => (value ? value.toUpperCase() : undefined)),
  clientIp: text,
  // What the write changed, searched by word. Whitelisted here or the column's filter is accepted by
  // the screen, sent, and silently dropped - a filter that quietly does nothing is worse than none.
  changes: text,
  status: z.string().trim().max(60).optional().transform((value) => value || undefined),
  page: z.coerce.number().int().min(1).max(100000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(200).optional().default(50),
  sortBy: z.enum(service.SORTABLE).optional().default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
}).refine((query) => !query.from || !query.to || query.from <= query.to, { message: "From must be before To.", path: ["from"] });

/*
 * How far into the log a page may reach. A deep `OFFSET` makes the database walk every line before
 * it, so past ten thousand lines the reader narrows the period or the filters instead.
 */
const MAX_DEPTH = 10000;
const DEPTH_MESSAGE = "Narrow the period or filters to see older lines.";

/** The query string as the service takes it, or the validation failure. */
const parseListQuery = (query) => listQuery.safeParse(query || {});

async function listActivityLogs(req, res) {
  const parsed = parseListQuery(req.query);
  if (!parsed.success) return res.status(400).json({ message: "Check the filters.", errors: parsed.error.flatten() });
  if (parsed.data.page * parsed.data.pageSize > MAX_DEPTH) return res.status(400).json({ message: DEPTH_MESSAGE });
  try {
    return res.json(await service.list(req.user.id, parsed.data));
  } catch (error) {
    console.error("Unable to load the activity log:", error);
    return res.status(500).json({ message: "Unable to load the activity log." });
  }
}

async function activityLogOptions(req, res) {
  try {
    return res.json(await service.options(req.user.id));
  } catch (error) {
    console.error("Unable to load the activity log filters:", error);
    return res.status(500).json({ message: "Unable to load the activity log filters." });
  }
}

async function getActivityLog(req, res) {
  // A line id is a BigInt; anything that is not one is a line that does not exist.
  if (!/^\d{1,19}$/.test(String(req.params.id || ""))) return res.status(404).json({ message: "That line is not in the activity log." });
  try {
    const row = await service.detail(req.user.id, BigInt(req.params.id));
    if (!row) return res.status(404).json({ message: "That line is not in the activity log." });
    return res.json(row);
  } catch (error) {
    console.error("Unable to load the activity log line:", error);
    return res.status(500).json({ message: "Unable to load the activity log line." });
  }
}

/**
 * The whole filtered log as a file: `?format=csv|xlsx` plus the list's own filters, period and sort,
 * and the reader's `timeZone` for the Log time column. Past `EXPORT_LIMIT` lines it answers 400 and
 * asks for a narrower period, rather than a file that stops part way without saying so.
 */
async function exportActivityLogs(req, res) {
  const format = String(req.query.format || "");
  if (!exporter.FORMATS[format]) return res.status(400).json({ message: "Choose csv or xlsx." });
  const { format: _format, timeZone, page: _page, pageSize: _pageSize, ...rest } = req.query;
  const parsed = parseListQuery(rest);
  if (!parsed.success) return res.status(400).json({ message: "Check the filters.", errors: parsed.error.flatten() });
  try {
    const { page: _p, pageSize: _s, ...query } = parsed.data;
    const rows = await service.forExport(req.user.id, query, exporter.EXPORT_LIMIT);
    if (rows === null) {
      return res.status(400).json({ message: `More than ${exporter.EXPORT_LIMIT.toLocaleString("en-IN")} lines match. Narrow the period or filters to export them.` });
    }
    const file = await exporter.buildExport(rows, format, typeof timeZone === "string" ? timeZone : "");
    res.setHeader("Content-Type", file.type);
    res.setHeader("Content-Disposition", `attachment; filename="${file.fileName}"`);
    return res.send(file.body);
  } catch (error) {
    console.error("Unable to export the activity log:", error);
    return res.status(500).json({ message: "Unable to export the activity log." });
  }
}

module.exports = { listActivityLogs, activityLogOptions, getActivityLog, exportActivityLogs, parseListQuery, MAX_DEPTH };
