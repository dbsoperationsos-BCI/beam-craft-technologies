const { z } = require("zod");
const iamService = require("../../../services/iam.service");
const { listContacts, DEFAULT_LIMIT, MAX_LIMIT } = require("./service");

function sendError(res, error, fallback) {
  console.error(fallback, error.message);
  return res.status(error.status || 500).json({ message: error.status ? error.message : fallback });
}

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
});

/**
 * The contact directory.
 *
 * The router has already established that this viewer may open the screen. What they see *in* it
 * is decided here, source by source: each module's rows are included only if they hold that
 * module's own Read permission, so opening Contacts never becomes a way around the guard on the
 * module the number is kept in. A viewer who holds nothing but the CRM gets the CRM's contacts and
 * an honest count, not a 403 on the whole page.
 */
async function list(req, res) {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: "Invalid query.", errors: parsed.error.flatten() });

  try {
    const can = ({ module, feature }) => iamService.hasPermission(req.user.id, module, feature, "READ");
    const { rows, total, sources } = await listContacts({ can, limit: parsed.data.limit });
    // `capped` says the answer is the top of a longer list, so the screen can say so rather than
    // let a truncated directory read as the whole of one.
    return res.json({ data: rows, total, sources, limit: parsed.data.limit, capped: total > rows.length });
  } catch (error) {
    return sendError(res, error, "Unable to load the contacts.");
  }
}

module.exports = { list };
