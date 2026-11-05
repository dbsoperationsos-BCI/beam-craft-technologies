const { z } = require("zod");
const service = require("./service");

const idSchema = z.coerce.number().int().positive();

async function getOrgChart(req, res) {
  const parsed = idSchema.safeParse(req.params.employeeId);
  if (!parsed.success) return res.status(400).json({ message: "Invalid employee id." });

  try {
    return res.json({ data: await service.chartFor(parsed.data) });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error("Org chart failed:", error);
    return res.status(500).json({ message: "Unable to load the organisation chart." });
  }
}

module.exports = { getOrgChart };
