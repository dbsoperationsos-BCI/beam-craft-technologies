const { z } = require("zod");
const { MAX_TERMS_LENGTH } = require("./service");

// Every field here is optional at the schema level, the same reason
// `image-selection/settings/validation.js`'s fields are: the two sections of this settings record
// are edited one at a time, and neither request carries the other's field. Which of the parsed keys
// actually reach the database is decided in the controller, from which keys the request body itself
// held — see saveSettings.
const settingsSchema = z.object({
  dumDumTerms: z.string().trim().max(MAX_TERMS_LENGTH).optional(),
  quaQuaTerms: z.string().trim().max(MAX_TERMS_LENGTH).optional(),
});

module.exports = { settingsSchema };
