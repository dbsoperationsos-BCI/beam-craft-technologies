const { z } = require("zod");
const prisma = require("../../../config/db");

/**
 * The rates the Quotation Generator prices with.
 *
 * One row, keyed "default". Read on opening the generator and written from Quotation → ⋮ →
 * Settings. A quotation stamps whatever these were into its own payload as it is generated, so
 * changing them here prices the next quotation and never rewrites one already sent.
 */

const SETTINGS_ID = "default";

const percent = z.coerce.number().finite().min(0).max(100);
const rate = z.coerce.number().finite().min(0).max(99_999_999);
const pricing = z.record(z.string(), rate);

const settingsSchema = z.object({
  serviceRate: rate.optional(),
  deliverableRate: rate.optional(),
  defaultDiscountPercent: percent.optional(),
  gstPercent: percent.optional(),
  servicePricing: pricing.optional(),
  deliverablePricing: pricing.optional(),
});

/** Decimal columns arrive as Prisma Decimals; the client wants plain numbers. */
function serialize(row) {
  return {
    serviceRate: Number(row?.serviceRate ?? 2000),
    deliverableRate: Number(row?.deliverableRate ?? 1000),
    defaultDiscountPercent: Number(row?.defaultDiscountPercent ?? 20),
    gstPercent: Number(row?.gstPercent ?? 18),
    servicePricing: row?.servicePricing || {},
    deliverablePricing: row?.deliverablePricing || {},
  };
}

async function getQuotationSettings(req, res) {
  try {
    const row = await prisma.salesQuotationSettings.findUnique({ where: { id: SETTINGS_ID } });
    // No row yet on a database seeded before this table existed: answer with the defaults rather
    // than a 404, so the generator opens and prices normally.
    return res.json({ data: serialize(row) });
  } catch (error) {
    console.error("Unable to load quotation settings:", error);
    return res.status(500).json({ message: "Unable to load quotation settings." });
  }
}

async function saveQuotationSettings(req, res) {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Enter a valid rate for each field.", errors: parsed.error.flatten() });
  }
  try {
    const data = { ...parsed.data, updatedByUserId: req.user?.id ?? null };
    const row = await prisma.salesQuotationSettings.upsert({
      where: { id: SETTINGS_ID },
      update: data,
      create: { id: SETTINGS_ID, ...data },
    });
    return res.json({ message: "Quotation settings saved.", data: serialize(row) });
  } catch (error) {
    console.error("Unable to save quotation settings:", error);
    return res.status(500).json({ message: "Unable to save quotation settings." });
  }
}

module.exports = { getQuotationSettings, saveQuotationSettings };
