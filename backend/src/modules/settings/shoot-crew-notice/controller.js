const service = require("./service");

/*
 * Settings → Project Management → Shoot crew notice (`service.js`): read on SETTINGS / Shoot Crew
 * Notice Read, set on Read / Write - the router's `requireModule` follows the method. Each answers
 * both arms as they now stand, so the panel never has to ask again.
 *
 * There is no "who sends it" to set any more: the crew arm sends from the project's own Pre-Production
 * Coordinator and the vendor arm from its Production Manager, so the only things to change here are
 * the two switches.
 */
const iam = () => require("../../../services/iam.service");
const canWriteFor = (req) => iam().hasPermission(req.user.id, "SETTINGS", "Shoot Crew Notice", "READ_WRITE");

const answered = (handler, fallback) => async (req, res) => {
  try {
    const data = await handler(req);
    return res.json({ data: data || await service.status({ canWrite: await canWriteFor(req) }) });
  } catch (error) {
    if (error?.status) return res.status(error.status).json({ message: error.message });
    console.error(`${fallback}:`, error.message);
    return res.status(500).json({ message: `${fallback}.` });
  }
};

const getNotice = answered(async (req) => service.status({ canWrite: await canWriteFor(req) }), "Unable to read the shoot crew notice");
const setEnabled = answered((req) => service.setEnabled(req.body?.enabled), "Unable to change the shoot crew notice");
const setVendorEnabled = answered((req) => service.setVendorEnabled(req.body?.enabled), "Unable to change the vendor shoot notice");

module.exports = { getNotice, setEnabled, setVendorEnabled };
