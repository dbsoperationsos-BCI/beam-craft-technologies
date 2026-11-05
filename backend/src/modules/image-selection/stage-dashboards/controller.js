const { createStageDashboardService } = require("./service");
const { dashboardQuerySchema } = require("../../../services/dashboardRange");

const service = createStageDashboardService();

// Who may read each dashboard is its route's decision - each mounts its own stage's permission - so
// nothing here looks at the caller beyond the range the query string asks for.
function handler(build, name) {
  return async (req, res) => {
    const query = dashboardQuerySchema.safeParse(req.query);
    if (!query.success) return res.status(400).json({ message: "Invalid dashboard request.", errors: query.error.flatten() });
    try {
      return res.json({ data: await build(query.data) });
    } catch (error) {
      console.error(`Unable to load the ${name} dashboard:`, error);
      return res.status(500).json({ message: `Unable to load the ${name} dashboard.` });
    }
  };
}

module.exports = {
  culling: handler(service.culling, "AI Culling"),
  editing: handler(service.editing, "AI Editing"),
  signatureAlbum: handler(service.signatureAlbum, "Signature Album"),
};
