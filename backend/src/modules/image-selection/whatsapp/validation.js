const { z } = require("zod");

// A WhatsApp group's address and nothing else - the same shape `isGroupJid` in the session manager
// accepts. A phone number cannot pass here, so a project can only ever be linked to a group.
const groupJidSchema = z.string().trim().regex(/^[0-9]{5,25}(-[0-9]{5,25})?@g\.us$/, "A WhatsApp group address is required.");
const linkGroupSchema = z.object({ jid: groupJidSchema });

module.exports = { groupJidSchema, linkGroupSchema };
