const prisma = require("../../../config/db");
const { FROM_APP } = require("./referrals");
const { getSettings } = require("../../sales/client-offers/settings");

/*
 * A client's coins: earned when somebody they referred from the app books (their lead is Converted),
 * at the studio's rate on the day it is first seen booked (Client Offers -> Client app settings), and
 * kept in `client_coin_entry` - one row per referral, so a booking is never paid twice and a rate
 * changed later does not change coins already earned. Nothing is spent here: the client claims an
 * offer by WhatsApp and the studio honours it.
 */

const tenDigits = (value) => String(value || "").replace(/\D/g, "").slice(-10);

/** Records coins for the client's referrals that have booked since last asked. Never throws. */
async function creditBookedReferrals(projectId, clientMobile) {
  const mobile = tenDigits(clientMobile);
  if (!projectId || !mobile) return;
  try {
    const booked = await prisma.salesCrmLead.findMany({
      where: { referredFrom: FROM_APP, referenceContact: { contains: mobile }, deletedAt: null, status: { startsWith: "Converted" } },
      select: { enquiryId: true, name: true },
    });
    if (!booked.length) return;
    const paid = await prisma.clientCoinEntry.findMany({ where: { referralEnquiryId: { in: booked.map((lead) => lead.enquiryId) } }, select: { referralEnquiryId: true } });
    const paidIds = new Set(paid.map((entry) => entry.referralEnquiryId));
    const fresh = booked.filter((lead) => !paidIds.has(lead.enquiryId));
    if (!fresh.length) return;
    const { coinsPerBooking } = await getSettings();
    await prisma.clientCoinEntry.createMany({
      data: fresh.map((lead) => ({ projectId, referralEnquiryId: lead.enquiryId, referralName: (lead.name || "").slice(0, 120), coins: coinsPerBooking })),
      skipDuplicates: true,
    });
  } catch (error) {
    console.warn("Unable to credit a client's referral coins:", error?.message || error);
  }
}

/** The client's coins: the balance, and what each was for, newest first. */
async function coinsFor(projectId, clientMobile) {
  await creditBookedReferrals(projectId, clientMobile);
  const entries = await prisma.clientCoinEntry.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 100 });
  return {
    balance: entries.reduce((sum, entry) => sum + entry.coins, 0),
    entries: entries.map((entry) => ({ id: entry.id, coins: entry.coins, referralName: entry.referralName || "", referralId: entry.referralEnquiryId, at: entry.createdAt.toISOString() })),
  };
}

module.exports = { coinsFor, creditBookedReferrals };
