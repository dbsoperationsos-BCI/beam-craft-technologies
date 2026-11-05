/*
 * Why an account is - or is not - being asked to link its WhatsApp.
 *
 * The gate over the application is decided by four separate things, in two places, and only one of
 * them is visible on screen. When somebody says "it never asks me for the QR", the useful question
 * is which of the four said no, and that is not something the dialog can tell you: a gate that has
 * decided not to hold you renders nothing at all, so a missed tick and a switched-off studio and an
 * administrator's exemption all look identical from the browser.
 *
 *   node scripts/reportWhatsappGate.js            every account
 *   node scripts/reportWhatsappGate.js sabari     accounts whose username, name or email matches
 *
 * The four, and where each is set:
 *
 *   1. `whatsapp_required` on the account - Login Credentials -> WhatsApp -> **Allow WhatsApp**.
 *      Off for every account until somebody ticks it. This is the one that is usually the answer.
 *   2. Administrator - a Super Admin, or any active role carrying the Administrator tick. Never
 *      held, whatever (1) says: they do not work leads, and they are the people who have to reach
 *      Settings to put somebody else's WhatsApp right.
 *   3. The studio switch - Settings -> User Settings -> WhatsApp. Off lifts the gate for everyone
 *      at once.
 *   4. This account's own switch - the same screen, per person. Off lifts it for them.
 *
 * (1) and (2) are the server's `linkRequired`; (3) and (4) are applied by the browser in
 * `whatsappLinkNeeded`. All four have to say yes before anybody sees a QR, which is what this
 * prints. Mirrors `whatsappStanding` in src/modules/sales/whatsapp-chat/controller.js and
 * `whatsappLinkNeeded` in frontend/src/lib/whatsappGate.mjs - if either changes, change this.
 *
 * ── And the fifth, which is not a condition but is the usual answer ──
 *
 * **An account that is already linked is not asked to link.** `whatsappLinkNeeded` says no to a
 * connected session, which is the entire point of the gate - so "no QR" is the correct behaviour
 * for somebody who has already paired, and it looks exactly like all four of the above failing.
 * That is worth reporting before any of them, because it is the difference between a fault and a
 * gate doing its job. Whether an account has paired outlives the process: the credentials are on
 * disk, under WHATSAPP_SESSION_DIR, and are what `restoreSessions` brings back at boot. So it can
 * be answered here, from outside the running server, which cannot be said of the live status.
 *
 * Reads only. Nothing here writes anything, so it is safe to run against production.
 */
require("dotenv").config();
const path = require("path");
const { PrismaClient } = require("@prisma/client");
const { readCredentials } = require("../src/modules/sales/whatsapp-chat/secureAuthState");

const prisma = new PrismaClient();

/** Where the credentials live. The same default `sessionRoot` uses, so this looks where it wrote. */
const sessionDir = (userId) =>
  path.join(process.env.WHATSAPP_SESSION_DIR || path.join(process.cwd(), ".whatsapp-sessions"), `user-${userId}`);

/**
 * Whether this account has finished pairing, and to which phone.
 *
 * Read through the seal rather than off the disk - the files are encrypted - and asked the same
 * way `hasCredentials` asks it: **not** whether a credentials file exists. Baileys writes that as
 * soon as it starts talking to WhatsApp, keys and all, long before anybody scans anything, so its
 * existence means an attempt was made rather than that one succeeded. `me.id` is the phone WhatsApp
 * assigned this device, and it appears only once a scan has actually landed.
 */
async function pairing(userId) {
  try {
    const creds = await readCredentials(sessionDir(userId));
    const id = creds?.me?.id || "";
    return {
      paired: Boolean(creds?.registered || id),
      // `919344938336:11@s.whatsapp.net` -> the number, and which linked device this is.
      phone: id ? id.split("@")[0].split(":")[0] : "",
      device: id.includes(":") ? id.split("@")[0].split(":")[1] : "",
      name: creds?.me?.name || "",
    };
  } catch {
    // Nothing readable is not paired. A key that cannot open the file would report every account
    // unpaired, which is the safe direction: it points at the credentials rather than at the gate.
    return { paired: false, phone: "", device: "", name: "" };
  }
}

/**
 * The two switches, read the way the application reads them.
 *
 * Both default to *on* when they cannot be read or have no row, and deliberately: an unreadable
 * setting must not lock a whole sales team out of WhatsApp. That means a missing table here reports
 * "on", the same answer the application would give.
 */
async function switches() {
  const studio = await prisma
    .$queryRawUnsafe("SELECT `chatEnabled` FROM `SalesCrmWhatsAppSetting` WHERE `id` = 1 LIMIT 1")
    .catch(() => []);
  const blocked = await prisma
    .$queryRawUnsafe("SELECT `userId` FROM `SalesCrmWhatsAppUserSetting` WHERE `chatEnabled` = 0")
    .catch(() => []);
  return {
    chatEnabled: !studio.length || Number(studio[0].chatEnabled) === 1,
    blockedUserIds: new Set(blocked.map((row) => Number(row.userId))),
  };
}

async function main() {
  const needle = (process.argv[2] || "").trim().toLowerCase();

  const { chatEnabled, blockedUserIds } = await switches();
  const users = await prisma.user.findMany({
    select: {
      id: true, username: true, name: true, email: true, role: true, status: true,
      whatsappRequired: true, linkedEmployeeId: true,
      roles: { select: { role: { select: { name: true, isAdmin: true, isActive: true } } } },
    },
    orderBy: { username: "asc" },
  });

  const matches = needle
    ? users.filter((user) => [user.username, user.name, user.email]
        .some((value) => String(value ?? "").toLowerCase().includes(needle)))
    : users;

  console.log(`Studio WhatsApp switch: ${chatEnabled ? "ON" : "OFF - nobody is held, and nobody can chat"}`);
  console.log(`Accounts: ${users.length}${needle ? `, ${matches.length} matching "${process.argv[2]}"` : ""}\n`);

  if (!matches.length) {
    console.log(needle
      ? `No account's username, name or email contains "${process.argv[2]}" in this database.`
      : "This database holds no accounts.");
    return;
  }

  for (const user of matches) {
    // Only an active role counts. A deactivated role grants nothing else either, so it must not
    // exempt somebody from the gate.
    const adminRoles = user.roles.filter((entry) => entry.role?.isActive && entry.role?.isAdmin);
    const isAdmin = user.role === "SUPER_ADMIN" || adminRoles.length > 0;
    const linkRequired = !isAdmin && user.whatsappRequired === true;
    const userChatEnabled = !blockedUserIds.has(user.id);
    const linked = await pairing(user.id);
    const asked = linkRequired && chatEnabled && userChatEnabled && !linked.paired;

    // The first thing that said no, in the order the application applies them, because that is the
    // one to go and change. Anything after it is not the reason. Already linked comes first: it is
    // the gate working, not failing, and every other line below it is then beside the point.
    const why = linked.paired
        ? `already linked to ${linked.phone || "a phone"}${linked.device ? ` (device :${linked.device})` : ""} - there is nothing to ask for`
      : !user.whatsappRequired ? "Allow WhatsApp is not ticked on this account (Login Credentials -> WhatsApp)"
      : isAdmin ? `an administrator is never held${adminRoles.length ? ` (role: ${adminRoles.map((e) => e.role.name).join(", ")})` : " (SUPER_ADMIN)"}`
      : !chatEnabled ? "the studio WhatsApp switch is off (Settings -> User Settings -> WhatsApp)"
      : "this account's WhatsApp switch is off (Settings -> User Settings -> WhatsApp)";

    console.log(`${user.username}  (id ${user.id}, ${user.name || "no name"}, ${user.status})`);
    console.log(`  Already linked        : ${linked.paired
      ? `yes - ${linked.phone}${linked.device ? ` (device :${linked.device})` : ""}${linked.name ? `, "${linked.name}"` : ""}`
      : "no"}`);
    console.log(`  Allow WhatsApp ticked : ${user.whatsappRequired}`);
    console.log(`  Administrator         : ${isAdmin}`);
    console.log(`  Studio switch on      : ${chatEnabled}`);
    console.log(`  Account switch on     : ${userChatEnabled}`);
    console.log(`  -> asked to link      : ${asked ? "YES - this account sees the QR dialog" : `NO - ${why}`}\n`);
  }
}

main()
  .catch((error) => { console.error(error.message || error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
