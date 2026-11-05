const { z } = require("zod");
// The dashboard's query is the range key every module dashboard reads - the schema lives with the
// shared range vocabulary - plus `expand`, the reader's own Expand view: cards over the enabled projects.
const { dashboardQuerySchema: rangeQuerySchema } = require("../../../services/dashboardRange");

const dashboardQuerySchema = rangeQuerySchema.extend({
  expand: z.enum(["true", "false"]).optional().transform((value) => value === "true"),
});

const expandSchema = z.object({ enabled: z.boolean() });

module.exports = { dashboardQuerySchema, expandSchema };
