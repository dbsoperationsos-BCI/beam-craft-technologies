const prisma = require("../config/db");

/**
 * What was done to a project - the Activity tab of a project on Projects (area PROJECT) and on Pre
 * Production (area PRE_PRODUCTION). Production keeps its own per shoot.
 *
 * `logProjectActivity` is called by every write on those screens, beside the write: inside its
 * transaction when there is one (pass `client`), after it otherwise. A line that cannot be written is
 * reported and never fails the change it describes - the change is what the person asked for.
 */
const AREAS = ["PROJECT", "PRE_PRODUCTION"];

async function logProjectActivity({ projectId, shootId = null, area, action, detail = null, userId = null }, { client = prisma } = {}) {
  if (!projectId || !AREAS.includes(area) || !action) return null;
  try {
    return await client.projectActivity.create({
      data: { projectId, shootId: shootId || null, area, action, detail: String(detail || "").trim() || null, userId: Number(userId) || null },
    });
  } catch (error) {
    console.error(`Unable to log ${area} activity ${action}:`, error.message);
    return null;
  }
}

/** One project's activity for one screen, newest first, each line with its shoot and who did it. */
async function listProjectActivity({ projectId, area }, { client = prisma } = {}) {
  const rows = await client.projectActivity.findMany({
    where: { projectId, area },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: {
      id: true, action: true, detail: true, createdAt: true,
      user: { select: { name: true } },
      shoot: { select: { shootId: true, shoot: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    detail: row.detail,
    at: row.createdAt,
    by: row.user?.name || null,
    shoot: row.shoot ? [row.shoot.shootId, row.shoot.shoot].filter(Boolean).join(" - ") : null,
  }));
}

/** The names of the fields a save changed, from what was sent against what was stored - for a line's detail. */
function changedFields(before, after, labels) {
  return Object.entries(labels)
    .filter(([key]) => after[key] !== undefined && JSON.stringify(after[key] ?? null) !== JSON.stringify(before?.[key] ?? null))
    .map(([, label]) => label);
}

module.exports = { AREAS, logProjectActivity, listProjectActivity, changedFields };

/**
 * A route-level logger for writes whose handler another screen shares (a gift's or storage's status,
 * a WhatsApp group linked): the line is written once the handler has answered with success, so the
 * shared handler stays as it is and only this screen's route logs. `describe(req, body)` is the detail.
 */
function logAfterSuccess({ area, action, projectParam = "projectId", describe = () => null }) {
  return (req, res, next) => {
    const json = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode < 400) {
        void logProjectActivity({ projectId: req.params[projectParam], area, action, detail: describe(req, body), userId: req.user?.id });
      }
      return json(body);
    };
    next();
  };
}

module.exports.logAfterSuccess = logAfterSuccess;
