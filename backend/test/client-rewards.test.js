const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const { coinsFor } = require("../src/modules/client/portal/rewards");
const { FROM_APP } = require("../src/modules/client/portal/referrals");
const settings = require("../src/modules/sales/client-offers/settings");

/*
 * A client's coins: a friend they referred from the app who books earns them the studio's rate, once,
 * and a referral still being talked to earns nothing. Real rows (a project and two leads, written
 * directly - never through the CRM, which would reach its Google Sheet), removed at the end.
 */
const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TRW-${STAMP}-${name}`;
const CLIENT_MOBILE = `93${STAMP}55`.slice(0, 10);
const F = {};

before(async () => {
  await prisma.salesCrmLead.create({ data: { enquiryId: tag("own"), name: tag("own") } });
  F.project = await prisma.salesProject.create({ data: {
    enquiryId: tag("own"), eventId: tag("ev"), whatsappGroupName: `WED ${STAMP}`, clientMainNumber: `+91 ${CLIENT_MOBILE}`,
    sourceBranch: "Erode TN", vertical: "WED", deliverables: "[]", initialConvertedValue: 1000, crmName: "Test", projectStatus: "Work in Progress",
  } });
  const referral = { referredFrom: FROM_APP, referenceContact: CLIENT_MOBILE, source: "Referral" };
  await prisma.salesCrmLead.create({ data: { enquiryId: tag("booked"), name: "Booked Friend", status: "Converted", ...referral } });
  await prisma.salesCrmLead.create({ data: { enquiryId: tag("talking"), name: "Talking Friend", status: "Followup", ...referral } });
});

after(async () => {
  await prisma.salesProject.deleteMany({ where: { eventId: tag("ev") } });
  await prisma.salesCrmLead.deleteMany({ where: { enquiryId: { startsWith: `TRW-${STAMP}-` } } });
  await prisma.$disconnect();
});

test("a referral that books earns the studio's coins, once; one still talking earns none", async () => {
  const { coinsPerBooking } = await settings.getSettings();
  const first = await coinsFor(F.project.id, CLIENT_MOBILE);
  assert.equal(first.balance, coinsPerBooking);
  assert.deepEqual(first.entries.map((entry) => entry.referralName), ["Booked Friend"]);

  // Asked again: the same coins, not paid twice.
  assert.equal((await coinsFor(F.project.id, CLIENT_MOBILE)).balance, coinsPerBooking);
  assert.equal(await prisma.clientCoinEntry.count({ where: { projectId: F.project.id } }), 1);

  // The friend still being talked to books: their coins are added.
  await prisma.salesCrmLead.update({ where: { enquiryId: tag("talking") }, data: { status: "Converted & Followup" } });
  assert.equal((await coinsFor(F.project.id, CLIENT_MOBILE)).balance, coinsPerBooking * 2);
});

test("another client's number earns nothing from these referrals", async () => {
  assert.equal((await coinsFor(F.project.id, "9000000001")).balance, (await coinsFor(F.project.id, CLIENT_MOBILE)).balance);
  assert.equal((await coinsFor(F.project.id, "")).entries.length, 2, "no number: nothing new credited, earned coins stay");
});

test("the settings take a WhatsApp number with its country code and whole, non-negative coins", () => {
  assert.equal(settings.settingsSchema.safeParse({ offersWhatsapp: "+91 9442648610", coinsPerBooking: 20 }).success, true);
  assert.equal(settings.settingsSchema.safeParse({ offersWhatsapp: "12345" }).success, false);
  assert.equal(settings.settingsSchema.safeParse({ coinsPerBooking: -1 }).success, false);
  assert.equal(settings.settingsSchema.safeParse({ offersWhatsapp: "" }).success, true, "empty: the branch's phone is used");
});
