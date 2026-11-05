const service = require("./service");
const settings = require("./settings");

/*
 * Sales -> Client Offers: what the team reads and writes. The client's side reads the live ones
 * through the client portal (`getClientOffers`).
 */

const idOf = (req) => Number.parseInt(req.params.id, 10);
const invalid = (res, error) => res.status(400).json({ message: error.issues?.[0]?.message || "Please check the offer.", errors: error.flatten?.() });

async function list(_req, res) {
  try {
    return res.json({ data: await service.listOffers() });
  } catch (error) {
    console.error("Unable to list client offers:", error);
    return res.status(500).json({ message: "Unable to load offers." });
  }
}

async function create(req, res) {
  const parsed = service.offerSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  try {
    return res.status(201).json({ data: await service.createOffer(parsed.data, Number(req.user.id) || null), message: "Offer added." });
  } catch (error) {
    console.error("Unable to add a client offer:", error);
    return res.status(error.status || 500).json({ message: error.status ? error.message : "Unable to add the offer." });
  }
}

async function update(req, res) {
  const parsed = service.offerSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  try {
    const saved = await service.updateOffer(idOf(req), parsed.data, Number(req.user.id) || null);
    if (!saved) return res.status(404).json({ message: "Offer not found." });
    return res.json({ data: saved, message: "Offer saved." });
  } catch (error) {
    console.error("Unable to save a client offer:", error);
    return res.status(error.status || 500).json({ message: error.status ? error.message : "Unable to save the offer." });
  }
}

async function remove(req, res) {
  try {
    if (!(await service.removeOffer(idOf(req), Number(req.user.id) || null))) return res.status(404).json({ message: "Offer not found." });
    return res.json({ message: "Offer removed." });
  } catch (error) {
    console.error("Unable to remove a client offer:", error);
    return res.status(500).json({ message: "Unable to remove the offer." });
  }
}

/** The client app's settings: the offers' WhatsApp number, and the coins a booked referral earns. */
async function readSettings(_req, res) {
  try {
    return res.json({ data: await settings.getSettings() });
  } catch (error) {
    console.error("Unable to read the client app settings:", error);
    return res.status(500).json({ message: "Unable to load the settings." });
  }
}

async function writeSettings(req, res) {
  const parsed = settings.settingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues?.[0]?.message || "Please check the settings." });
  try {
    return res.json({ data: await settings.saveSettings(parsed.data, Number(req.user.id) || null), message: "Settings saved." });
  } catch (error) {
    console.error("Unable to save the client app settings:", error);
    return res.status(error.status || 500).json({ message: error.status ? error.message : "Unable to save the settings." });
  }
}

module.exports = { list, create, update, remove, readSettings, writeSettings };
