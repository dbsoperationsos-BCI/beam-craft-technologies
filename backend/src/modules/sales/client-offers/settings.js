const { z } = require("zod");
const prisma = require("../../../config/db");

/*
 * The client app's settings (Sales -> Client Offers -> Client app settings), one row: the WhatsApp
 * number a client's "Ask on WhatsApp" and "Claim" go to, and the coins a client earns when somebody
 * they referred books. (What the Referrals page shows is a Referral offer, on its own tab.)
 */

const ROW = 1;

const settingsSchema = z.object({
  offersWhatsapp: z.string().trim().max(20).optional().default("")
    .refine((value) => !value || value.replace(/\D/g, "").length >= 10, "Enter the WhatsApp number with its country code, e.g. +91 9442648610."),
  coinsPerBooking: z.coerce.number().int().min(0, "Coins cannot be negative.").max(100000).optional().default(20),
});

async function readRow() {
  return prisma.clientAppSetting.findUnique({ where: { id: ROW } });
}

function serialize(row) {
  return {
    offersWhatsapp: row?.offersWhatsapp || "",
    coinsPerBooking: row?.coinsPerBooking ?? 20,
  };
}

async function getSettings() {
  return serialize(await readRow());
}

async function saveSettings(input, actorId) {
  const data = { offersWhatsapp: input.offersWhatsapp || null, coinsPerBooking: input.coinsPerBooking, updatedBy: actorId };
  return serialize(await prisma.clientAppSetting.upsert({ where: { id: ROW }, create: { id: ROW, ...data }, update: data }));
}

module.exports = { settingsSchema, getSettings, saveSettings };
