const { createDashboardService } = require("./service");
const { dashboardQuerySchema } = require("./validation");

const service = createDashboardService();

// Who may read this is the route's decision — it mounts the module's permission — so nothing here
// looks at the caller beyond what the query string asks for.
function parse(schema, value, res, message) { const result = schema.safeParse(value); if (result.success) return result.data; res.status(400).json({ message, errors: result.error.flatten() }); return null; }
function handleError(error, res, action) { if (error.status) return res.status(error.status).json({ message: error.message }); console.error(`Unable to ${action} the Image Selection dashboard:`, error); return res.status(500).json({ message: `Unable to ${action} the Image Selection dashboard.` }); }

async function dashboard(req, res) {
  const query = parse(dashboardQuerySchema, req.query, res, "Invalid dashboard request.");
  if (!query) return;
  try { return res.json({ data: await service.build(query) }); } catch (error) { return handleError(error, res, "load"); }
}

module.exports = { dashboard };
