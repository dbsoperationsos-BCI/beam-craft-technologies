const { z } = require("zod");
const { RANGE_KEYS, DEFAULT_RANGE } = require("./service");

// `range` is the page's one range — the period figures and the chart both follow it. A key rather
// than a pair of dates, so a URL cannot ask for a range the picker has no option for.
const dashboardQuerySchema = z.object({
  range: z.enum(RANGE_KEYS).optional().default(DEFAULT_RANGE),
});

module.exports = { dashboardQuerySchema };
