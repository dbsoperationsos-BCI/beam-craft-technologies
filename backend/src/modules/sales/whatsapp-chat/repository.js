const prisma = require("../../../config/db");
const { publishThreadChange } = require("./events");
const { mediaDetails } = require("./mediaOnDemand");

/**
 * One row per WhatsApp message exchanged with a CRM lead.
 *
 * Only messages to and from a number that belongs to a lead are ever written here. A CRM's
 * WhatsApp carries their own conversations too, and those are theirs: the socket sees them and
 * this module drops them on the floor rather than storing a copy in the company's database.
 *
 * Created at runtime like the rest of the CRM's own tables (`SalesCrmLeadActivity`,
 * `SalesGoogleSheetLink`), so a server that boots against a database without it makes it rather
 * than failing every request that reads it.
 */
const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS \`SalesCrmWhatsAppMessage\` (
  \`id\` VARCHAR(191) NOT NULL,
  \`enquiryId\` VARCHAR(100) NOT NULL,
  \`userId\` INT NULL,
  \`chatJid\` VARCHAR(191) NOT NULL,
  \`waMessageId\` VARCHAR(191) NULL,
  \`direction\` VARCHAR(10) NOT NULL,
  \`body\` TEXT NULL,
  \`mediaType\` VARCHAR(30) NULL,
  \`status\` VARCHAR(20) NOT NULL DEFAULT 'sent',
  \`mediaPath\` VARCHAR(500) NULL,
  \`mediaName\` VARCHAR(255) NULL,
  \`sentAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`SalesCrmWhatsAppMessage_waMessageId_key\` (\`waMessageId\`),
  INDEX \`SalesCrmWhatsAppMessage_lead_idx\` (\`enquiryId\`, \`sentAt\`),
  INDEX \`SalesCrmWhatsAppMessage_chatJid_idx\` (\`chatJid\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

// Columns added after the table first shipped. A database that already has the table does not
// get them from CREATE TABLE IF NOT EXISTS, so they are added here rather than by a migration
// the CRM's other runtime-made tables do not use either.
const LATER_COLUMNS = [
  ["mediaPath", "ALTER TABLE \`SalesCrmWhatsAppMessage\` ADD COLUMN \`mediaPath\` VARCHAR(500) NULL"],
  ["mediaName", "ALTER TABLE \`SalesCrmWhatsAppMessage\` ADD COLUMN \`mediaName\` VARCHAR(255) NULL"],
  // What happened to a message after it was sent, which is as much a part of a conversation as
  // the message itself: the emoji someone put on it, the pin holding it to the top, and the
  // deletion that takes it back.
  ["reaction", "ALTER TABLE \`SalesCrmWhatsAppMessage\` ADD COLUMN \`reaction\` VARCHAR(16) NULL"],
  ["pinnedAt", "ALTER TABLE \`SalesCrmWhatsAppMessage\` ADD COLUMN \`pinnedAt\` DATETIME(3) NULL"],
  ["deletedAt", "ALTER TABLE \`SalesCrmWhatsAppMessage\` ADD COLUMN \`deletedAt\` DATETIME(3) NULL"],
  // Deleted for everyone, which is not the same as gone. WhatsApp leaves a marker in the thread
  // saying a message was here and was taken back, and so does this.
  ["revokedAt", "ALTER TABLE \`SalesCrmWhatsAppMessage\` ADD COLUMN \`revokedAt\` DATETIME(3) NULL"],
  ["editedAt", "ALTER TABLE \`SalesCrmWhatsAppMessage\` ADD COLUMN \`editedAt\` DATETIME(3) NULL"],
  /*
   * The message as WhatsApp sent it, for media only.
   *
   * A file on disk can go - it did, when logging out took the folder it was in - and the only way
   * to get it back is to ask WhatsApp for it again, which needs the keys that came with the
   * message. Kept for messages that carry a file and nothing else, because it is the media that
   * cannot be reconstructed; the text is already in its own column.
   */
  ["rawMessage", "ALTER TABLE \`SalesCrmWhatsAppMessage\` ADD COLUMN \`rawMessage\` LONGTEXT NULL"],
  // What a reply is replying to. WhatsApp draws the quoted message above the reply, and a reply
  // shown without it is half a sentence - "yes" against nothing.
  ["quotedBody", "ALTER TABLE \`SalesCrmWhatsAppMessage\` ADD COLUMN \`quotedBody\` TEXT NULL"],
  ["quotedAuthor", "ALTER TABLE \`SalesCrmWhatsAppMessage\` ADD COLUMN \`quotedAuthor\` VARCHAR(191) NULL"],
];

/**
 * The studio's WhatsApp switch: one row, holding whether chatting is available at all.
 *
 * Kept in the database rather than in memory because it outranks the sessions it governs - a
 * switch that forgot itself on the next deploy would quietly hand WhatsApp back to everyone,
 * which is the opposite of what turning it off was for.
 *
 * Made at runtime like the message table above, for the same reason: this module's tables are
 * not in the Prisma schema, so a server booting against a database without it makes it.
 */
const CREATE_SETTINGS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS \`SalesCrmWhatsAppSetting\` (
  \`id\` TINYINT NOT NULL DEFAULT 1,
  \`chatEnabled\` TINYINT(1) NOT NULL DEFAULT 1,
  \`hourlyChatLimit\` INT NULL,
  \`hourlyMessageLimit\` INT NULL,
  \`dailyMessageLimit\` INT NULL,
  \`updatedByUserId\` INT NULL,
  \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

/*
 * The usage limits, added after the switch shipped.
 *
 * Null per limit rather than a number, and that is the whole design: null means "nobody has set
 * this one", which sends `usage.limits()` on to the environment and then to its own defaults. A
 * column defaulted to 25 or 60 would look identical to a studio that had deliberately chosen those
 * numbers, and there would be no way left to say "use whatever the app thinks best".
 *
 * Added here rather than by a migration because this module's tables are not in the Prisma schema
 * - the same reason `LATER_COLUMNS` exists for the message table above.
 */
const LATER_SETTINGS_COLUMNS = [
  ["hourlyChatLimit", "ALTER TABLE \`SalesCrmWhatsAppSetting\` ADD COLUMN \`hourlyChatLimit\` INT NULL"],
  ["hourlyMessageLimit", "ALTER TABLE \`SalesCrmWhatsAppSetting\` ADD COLUMN \`hourlyMessageLimit\` INT NULL"],
  ["dailyMessageLimit", "ALTER TABLE \`SalesCrmWhatsAppSetting\` ADD COLUMN \`dailyMessageLimit\` INT NULL"],
];

let settingsReady = null;
async function ensureSettingsTable() {
  if (!settingsReady) {
    settingsReady = (async () => {
      await prisma.$executeRawUnsafe(CREATE_SETTINGS_TABLE_SQL);
      // Seeded on, so a studio that has never touched the switch is not locked out by the
      // feature that was meant to give them control of it.
      await prisma.$executeRawUnsafe(
        "INSERT IGNORE INTO `SalesCrmWhatsAppSetting` (`id`, `chatEnabled`) VALUES (1, 1)",
      );
      for (const [column, sql] of LATER_SETTINGS_COLUMNS) {
        try {
          await prisma.$executeRawUnsafe(sql);
        } catch (error) {
          // Already there, which is the normal case on every boot after the first.
          if (!/duplicate column/i.test(error?.message || "")) {
            console.warn(`Unable to add ${column} to the WhatsApp settings table:`, error?.message || error);
          }
        }
      }
    })().catch((error) => {
      settingsReady = null;
      throw error;
    });
  }
  return settingsReady;
}

/**
 * The limits the studio has saved, as three numbers or nulls.
 *
 * A read that fails answers nulls rather than throwing: every limit then falls back to the
 * environment and the defaults, which is the app's own conservative guess. A database hiccup must
 * not read as a studio having set its limits to nothing - and it must not take the chat panel down
 * either, since this is read on the way into every thread.
 */
async function chatLimits() {
  try {
    await ensureSettingsTable();
    const [row] = await prisma.$queryRawUnsafe(
      "SELECT `hourlyChatLimit`, `hourlyMessageLimit`, `dailyMessageLimit` FROM `SalesCrmWhatsAppSetting` WHERE `id` = 1 LIMIT 1",
    );
    if (!row) return { hourlyChats: null, hourlyMessages: null, dailyMessages: null };
    // Named as the limits are named everywhere else in the module. The columns say "Limit"
    // because they are columns; nothing above this line should have to know that.
    return {
      hourlyChats: row.hourlyChatLimit === null ? null : Number(row.hourlyChatLimit),
      hourlyMessages: row.hourlyMessageLimit === null ? null : Number(row.hourlyMessageLimit),
      dailyMessages: row.dailyMessageLimit === null ? null : Number(row.dailyMessageLimit),
    };
  } catch (error) {
    console.warn("Unable to read the WhatsApp limits, using the defaults:", error?.message || error);
    return { hourlyChats: null, hourlyMessages: null, dailyMessages: null };
  }
}

/**
 * Saves the three limits, together.
 *
 * All three every time, nulls included, so the screen's Save means what it shows: a box cleared
 * on screen is a limit handed back to the default, and a write that only sent the boxes with
 * numbers in them could never do that. Unlike the read, a failure has to say so - the
 * administrator is being told their new limit is in force.
 */
async function setChatLimits(values = {}, updatedByUserId = null) {
  await ensureSettingsTable();
  const asColumn = (value) => (Number.isInteger(value) ? value : null);
  await prisma.$executeRawUnsafe(
    "UPDATE `SalesCrmWhatsAppSetting` SET `hourlyChatLimit` = ?, `hourlyMessageLimit` = ?, `dailyMessageLimit` = ?, `updatedByUserId` = ? WHERE `id` = 1",
    asColumn(values.hourlyChats),
    asColumn(values.hourlyMessages),
    asColumn(values.dailyMessages),
    Number.isInteger(updatedByUserId) ? updatedByUserId : null,
  );
  return chatLimits();
}

/**
 * Whether chatting is switched on.
 *
 * A read that fails answers "on". This is asked on the way into every connect and every send,
 * and a database hiccup must not read as the administrator having switched WhatsApp off - the
 * switch is only ever off because somebody set it that way.
 */
async function isChatEnabled() {
  try {
    await ensureSettingsTable();
    const [row] = await prisma.$queryRawUnsafe(
      "SELECT `chatEnabled` AS `chatEnabled` FROM `SalesCrmWhatsAppSetting` WHERE `id` = 1 LIMIT 1",
    );
    if (!row) return true;
    return Number(row.chatEnabled) === 1;
  } catch (error) {
    console.warn("Unable to read the WhatsApp switch, treating chat as available:", error?.message || error);
    return true;
  }
}

// Unlike the read, a write that fails has to say so: the administrator is told WhatsApp is off
// and every CRM is about to be disconnected, so it must not report a switch that did not move.
async function setChatEnabled(enabled, updatedByUserId = null) {
  await ensureSettingsTable();
  await prisma.$executeRawUnsafe(
    "UPDATE `SalesCrmWhatsAppSetting` SET `chatEnabled` = ?, `updatedByUserId` = ? WHERE `id` = 1",
    enabled ? 1 : 0,
    Number.isInteger(updatedByUserId) ? updatedByUserId : null,
  );
  return Boolean(enabled);
}

/**
 * What each CRM has sent recently, for the usage limits.
 *
 * Counted from the stored messages rather than from a counter held in the process: the numbers
 * have to survive a restart, and a session that came back after one would otherwise start again
 * from zero - which is exactly when a CRM who has been messaging all morning looks new.
 *
 * Outgoing only. A client writing twenty times is not the studio behaving like a broadcaster,
 * and counting their messages would ask the CRM to stop for something the client did.
 */
async function usageForUsers(userIds = []) {
  const ids = userIds.map((id) => Number(id)).filter(Number.isInteger);
  const usage = new Map();
  if (!ids.length) return usage;

  await ensureTable();
  const rows = await prisma.$queryRawUnsafe(
    `SELECT \`userId\` AS \`userId\`,
            COUNT(CASE WHEN \`sentAt\` >= NOW() - INTERVAL 1 HOUR THEN 1 END) AS \`hourlyMessages\`,
            COUNT(CASE WHEN \`sentAt\` >= NOW() - INTERVAL 1 DAY THEN 1 END) AS \`dailyMessages\`,
            COUNT(DISTINCT CASE WHEN \`sentAt\` >= NOW() - INTERVAL 1 HOUR THEN \`enquiryId\` END) AS \`hourlyChats\`
       FROM \`SalesCrmWhatsAppMessage\`
      WHERE \`direction\` = 'out'
        AND \`userId\` IN (${ids.map(() => "?").join(", ")})
        AND \`sentAt\` >= NOW() - INTERVAL 1 DAY
      GROUP BY \`userId\``,
    ...ids,
  );

  for (const row of rows) {
    usage.set(String(row.userId), {
      hourlyMessages: Number(row.hourlyMessages) || 0,
      dailyMessages: Number(row.dailyMessages) || 0,
      hourlyChats: Number(row.hourlyChats) || 0,
    });
  }
  return usage;
}

/**
 * One row per CRM who has been blocked from WhatsApp individually.
 *
 * Only the exceptions are stored. Every CRM can chat unless somebody said otherwise, so an
 * absent row means allowed - which is what keeps a new employee working without anyone having
 * to remember to enable them.
 *
 * Separate from the studio switch beside it because the two answer different questions: that one
 * closes WhatsApp for everybody at once, this one stops one person while the rest carry on.
 */
const CREATE_USER_SETTINGS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS \`SalesCrmWhatsAppUserSetting\` (
  \`userId\` INT NOT NULL,
  \`chatEnabled\` TINYINT(1) NOT NULL DEFAULT 1,
  \`updatedByUserId\` INT NULL,
  \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`userId\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

let userSettingsReady = null;
async function ensureUserSettingsTable() {
  if (!userSettingsReady) {
    userSettingsReady = prisma.$executeRawUnsafe(CREATE_USER_SETTINGS_TABLE_SQL).catch((error) => {
      userSettingsReady = null;
      throw error;
    });
  }
  return userSettingsReady;
}

/**
 * The CRMs who have been blocked, as a set of ids.
 *
 * Read as a whole rather than one at a time: the settings table lists every CRM at once, and a
 * query per row is the shape that turns a page into a hundred round trips.
 */
async function blockedChatUserIds() {
  try {
    await ensureUserSettingsTable();
    const rows = await prisma.$queryRawUnsafe(
      "SELECT `userId` FROM `SalesCrmWhatsAppUserSetting` WHERE `chatEnabled` = 0",
    );
    return new Set(rows.map((row) => Number(row.userId)));
  } catch (error) {
    // Unreadable means nobody is blocked rather than everybody: a failed read must not lock the
    // whole sales team out of WhatsApp.
    console.warn("Unable to read per-CRM WhatsApp settings:", error?.message || error);
    return new Set();
  }
}

// Whether one CRM in particular may chat. Absent row means yes, which is the normal case.
async function isChatEnabledForUser(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id)) return true;
  try {
    await ensureUserSettingsTable();
    const [row] = await prisma.$queryRawUnsafe(
      "SELECT `chatEnabled` FROM `SalesCrmWhatsAppUserSetting` WHERE `userId` = ? LIMIT 1",
      id,
    );
    return !row || Number(row.chatEnabled) === 1;
  } catch (error) {
    console.warn("Unable to read this CRM's WhatsApp setting:", error?.message || error);
    return true;
  }
}

// Unlike the reads, a write that fails has to say so: an administrator is told somebody is
// blocked and their session is about to end, so it must not report a switch that did not move.
async function setUserChatEnabled(userId, enabled, updatedByUserId = null) {
  const id = Number(userId);
  if (!Number.isInteger(id)) throw new Error("Unknown user.");
  await ensureUserSettingsTable();
  await prisma.$executeRawUnsafe(
    `INSERT INTO \`SalesCrmWhatsAppUserSetting\` (\`userId\`, \`chatEnabled\`, \`updatedByUserId\`)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE \`chatEnabled\` = VALUES(\`chatEnabled\`), \`updatedByUserId\` = VALUES(\`updatedByUserId\`)`,
    id,
    enabled ? 1 : 0,
    Number.isInteger(updatedByUserId) ? updatedByUserId : null,
  );
  return Boolean(enabled);
}

let tableReady = null;
async function ensureTable() {
  if (!tableReady) {
    tableReady = (async () => {
      await prisma.$executeRawUnsafe(CREATE_TABLE_SQL);
      const rows = await prisma.$queryRawUnsafe(
        `SELECT column_name AS columnName FROM information_schema.columns
          WHERE table_schema = DATABASE() AND table_name = 'SalesCrmWhatsAppMessage'`,
      );
      const present = new Set(rows.map((row) => String(row.columnName || row.COLUMN_NAME || "")));
      for (const [column, sql] of LATER_COLUMNS) {
        if (!present.has(column)) await prisma.$executeRawUnsafe(sql);
      }
    })().catch((error) => {
      tableReady = null;
      throw error;
    });
  }
  return tableReady;
}

/**
 * The lead a message belongs to, for announcing a change to its thread.
 *
 * Every write below is given the row it wrote so the announcement reaches only the panel that is
 * looking at that conversation. Some writes are addressed by WhatsApp's own message id and never
 * knew the lead, so it is read back - one indexed lookup, and only on a write, which is rare next
 * to the reads this saves.
 */
async function enquiryIdFor({ id = "", waMessageId = "" }) {
  const column = id ? "id" : "waMessageId";
  const value = String(id || waMessageId || "").trim();
  if (!value) return "";
  const rows = await prisma.$queryRawUnsafe(
    `SELECT \`enquiryId\` FROM \`SalesCrmWhatsAppMessage\` WHERE \`${column}\` = ? LIMIT 1`,
    value,
  );
  return String(rows?.[0]?.enquiryId || "");
}

/*
 * A change to a thread, announced from the one place every change goes through.
 *
 * In the repository rather than at each caller because that is what makes it complete: a write path
 * added later announces itself by construction, and a panel that stopped waking up would otherwise
 * be a bug nobody could see - it still works, just a poll later, which is exactly the class of
 * slowness this whole change is about.
 */
function announce(enquiryId, reason) {
  publishThreadChange({ enquiryId, reason });
}

function newId() {
  return `wam-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Writes one message, ignoring a repeat of one already stored.
 *
 * WhatsApp re-delivers on reconnect, and a message the socket has already handed over must not
 * appear in the thread twice - hence the unique key on the provider's own id and the INSERT
 * IGNORE over it. Outgoing messages carry one too, so an echo of what this app just sent is
 * recognised as the same message rather than stored a second time.
 */
async function saveMessage(message) {
  await ensureTable();
  // The row count says whether this was a new message or a repeat of one already held, which is
  // what the activity log needs: the same message re-delivered is not a second conversation.
  const inserted = await prisma.$executeRawUnsafe(
    `INSERT IGNORE INTO \`SalesCrmWhatsAppMessage\`
       (\`id\`, \`enquiryId\`, \`userId\`, \`chatJid\`, \`waMessageId\`, \`direction\`, \`body\`, \`mediaType\`, \`status\`, \`sentAt\`, \`createdAt\`
        , \`mediaPath\`, \`mediaName\`, \`rawMessage\`, \`quotedBody\`, \`quotedAuthor\`)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3), ?, ?, ?, ?, ?)`,
    newId(),
    String(message.enquiryId || ""),
    message.userId ?? null,
    String(message.chatJid || ""),
    message.waMessageId || null,
    message.direction === "in" ? "in" : "out",
    message.body ?? null,
    message.mediaType || null,
    message.status || "sent",
    message.sentAt instanceof Date ? message.sentAt : new Date(message.sentAt || Date.now()),
    message.mediaPath || null,
    message.mediaName || null,
    message.rawMessage ? JSON.stringify(message.rawMessage) : null,
    message.quotedBody || null,
    message.quotedAuthor || null,
  );
  const stored = Number(inserted || 0) > 0;
  // Only a message that was actually new. A redelivery of one already held changes nothing on
  // screen, and waking every open panel to re-read an unchanged thread is the polling this
  // replaced, arriving by a different route.
  if (stored) announce(message.enquiryId, "message");
  return stored;
}

// Oldest first: a chat is read downwards, and the composer sits at the bottom of it.
/**
 * The conversation with one number, inside one lead.
 *
 * Filtered by the chat address as well as the lead. A lead can be messaged on one number and
 * then given another - the WhatsApp Number field is edited, or was wrong to begin with - and the
 * thread must show the conversation with the number it is currently addressing, not everything
 * ever exchanged under that lead. Showing the old number's messages under a new one made a
 * conversation appear to exist with somebody who had never been written to.
 *
 * Without a chat address nothing is returned. That is the case where the lead has no WhatsApp
 * Number at all, and an empty thread is the honest answer.
 */
async function listMessages(enquiryId, chatJid, limit = 200) {
  await ensureTable();
  const id = String(enquiryId || "").trim();
  const jid = String(chatJid || "").trim();
  if (!id || !jid) return [];
  const size = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const rows = await prisma.$queryRawUnsafe(
    `SELECT \`id\`, \`enquiryId\`, \`chatJid\`, \`waMessageId\`, \`direction\`, \`body\`, \`mediaType\`, \`mediaName\`, \`status\`, \`reaction\`, \`pinnedAt\`, \`revokedAt\`, \`editedAt\`, \`quotedBody\`, \`quotedAuthor\`, \`sentAt\`, \`rawMessage\`
       FROM \`SalesCrmWhatsAppMessage\`
      WHERE \`enquiryId\` = ? AND \`chatJid\` = ? AND \`deletedAt\` IS NULL
      ORDER BY \`sentAt\` ASC, \`createdAt\` ASC
      LIMIT ${size}`,
    id,
    jid,
  );
  return rows.map(withMediaDetails);
}

/**
 * A row as the panel gets it: what the file is called, how big it is and its small preview, read
 * from the message WhatsApp delivered - and that message itself dropped, because it holds the key
 * that decrypts the file and has no business leaving the server.
 */
function withMediaDetails({ rawMessage, ...row }) {
  if (!row.mediaType) return row;
  const details = mediaDetails(rawMessage, row.mediaType);
  return {
    ...row,
    mediaName: row.mediaName || details.fileName || "",
    mediaSize: details.size,
    mediaThumbnail: details.thumbnail,
    mediaMime: details.contentType,
    mediaAvailable: Boolean(rawMessage),
  };
}

/**
 * Moves a message's ticks forward, never back.
 *
 * The reports do not arrive in order - a read receipt can land before the delivery one it
 * follows - and a thread that flickered from blue ticks back to grey would be worse than one
 * tick late. The rank in the CASE is the order the ticks actually happen in.
 */
const STATUS_RANK = { sent: 1, delivered: 2, read: 3 };

async function updateMessageStatus(waMessageId, status) {
  const id = String(waMessageId || "").trim();
  const rank = STATUS_RANK[status];
  if (!id || !rank) return;
  await ensureTable();
  await prisma.$executeRawUnsafe(
    `UPDATE \`SalesCrmWhatsAppMessage\`
        SET \`status\` = ?
      WHERE \`waMessageId\` = ?
        AND CASE \`status\` WHEN 'read' THEN 3 WHEN 'delivered' THEN 2 ELSE 1 END < ?`,
    status,
    id,
    rank,
  );
  announce(await enquiryIdFor({ waMessageId: id }), "status");
}

/**
 * One message, with everything the media endpoint needs to answer for it.
 *
 * `userId` is what says whose session received the file, and the endpoint refuses to serve one
 * that is not the caller's - leaving it out of the select made that check compare against
 * `undefined` and refuse every attachment, whoever asked. `rawMessage` is the file's address and
 * key on WhatsApp, which is the only way to fetch it; `revokedAt` and `deletedAt` say the message
 * has been taken back, and its file with it.
 */
async function getMessage(id) {
  await ensureTable();
  const rows = await prisma.$queryRawUnsafe(
    "SELECT `id`, `enquiryId`, `userId`, `mediaName`, `mediaType`, `rawMessage`, `revokedAt`, `deletedAt` FROM `SalesCrmWhatsAppMessage` WHERE `id` = ? LIMIT 1",
    String(id || "").trim(),
  );
  return rows?.[0] || null;
}

// One message by WhatsApp's own id, for answering a retry request.
async function findMessageByWaId(waMessageId) {
  const id = String(waMessageId || "").trim();
  if (!id) return null;
  await ensureTable();
  const rows = await prisma.$queryRawUnsafe(
    "SELECT `id`, `enquiryId`, `body`, `direction` FROM `SalesCrmWhatsAppMessage` WHERE `waMessageId` = ? LIMIT 1",
    id,
  );
  return rows?.[0] || null;
}

/**
 * The emoji somebody put on a message.
 *
 * WhatsApp sends a reaction as a message of its own that points at another one, and removing a
 * reaction is the same thing with an empty emoji - so an empty value clears the column rather
 * than storing nothing visible.
 */
async function setReaction(waMessageId, emoji) {
  const id = String(waMessageId || "").trim();
  if (!id) return;
  await ensureTable();
  await prisma.$executeRawUnsafe(
    "UPDATE `SalesCrmWhatsAppMessage` SET `reaction` = ? WHERE `waMessageId` = ?",
    String(emoji || "").trim() || null,
    id,
  );
  announce(await enquiryIdFor({ waMessageId: id }), "reaction");
}

// Held to the top of the thread, or released.
async function setPinned(id, pinned) {
  await ensureTable();
  await prisma.$executeRawUnsafe(
    "UPDATE `SalesCrmWhatsAppMessage` SET `pinnedAt` = ? WHERE `id` = ?",
    pinned ? new Date() : null,
    String(id || "").trim(),
  );
  announce(await enquiryIdFor({ id }), "pin");
}

/**
 * Takes a message out of the thread.
 *
 * Soft, and by design: a message deleted for everyone is gone from the conversation but the CRM
 * still holds what was said to a client and when, which is the point of keeping the thread at
 * all. Nothing reads a deleted row back into the thread.
 */
async function markDeleted({ id = "", waMessageId = "" }) {
  await ensureTable();
  // Read before the write: a soft delete leaves the row, but reading the lead off it afterwards
  // would be one more query for something already in hand here.
  const enquiryId = await enquiryIdFor({ id, waMessageId });
  if (id) {
    await prisma.$executeRawUnsafe(
      "UPDATE `SalesCrmWhatsAppMessage` SET `deletedAt` = CURRENT_TIMESTAMP(3) WHERE `id` = ?",
      String(id).trim(),
    );
    announce(enquiryId, "delete");
    return;
  }
  if (waMessageId) {
    await prisma.$executeRawUnsafe(
      "UPDATE `SalesCrmWhatsAppMessage` SET `deletedAt` = CURRENT_TIMESTAMP(3) WHERE `waMessageId` = ?",
      String(waMessageId).trim(),
    );
    announce(enquiryId, "delete");
  }
}

/**
 * Taken back, rather than removed.
 *
 * A message deleted for everyone leaves a marker where it was - WhatsApp shows "You deleted this
 * message", and a thread that simply lost the bubble would read as though nothing had ever been
 * said. What was in it goes: the text and any file are cleared, because the point of deleting is
 * that it is no longer readable.
 */
async function markRevoked({ id = "", waMessageId = "" }) {
  await ensureTable();
  const column = id ? "id" : "waMessageId";
  const value = String(id || waMessageId || "").trim();
  if (!value) return;
  const enquiryId = await enquiryIdFor({ id, waMessageId });
  await prisma.$executeRawUnsafe(
    `UPDATE \`SalesCrmWhatsAppMessage\`
        SET \`revokedAt\` = CURRENT_TIMESTAMP(3), \`body\` = NULL, \`mediaPath\` = NULL, \`mediaName\` = NULL, \`rawMessage\` = NULL, \`reaction\` = NULL
      WHERE \`${column}\` = ?`,
    value,
  );
  announce(enquiryId, "revoke");
}

// An edited message keeps its place in the conversation; only what it says changes.
async function updateBody(id, body) {
  await ensureTable();
  await prisma.$executeRawUnsafe(
    "UPDATE `SalesCrmWhatsAppMessage` SET `body` = ?, `editedAt` = CURRENT_TIMESTAMP(3) WHERE `id` = ?",
    String(body || ""),
    String(id || "").trim(),
  );
  announce(await enquiryIdFor({ id }), "edit");
}

module.exports = {
  ensureTable,
  isChatEnabled,
  setChatEnabled,
  chatLimits,
  setChatLimits,
  blockedChatUserIds,
  isChatEnabledForUser,
  setUserChatEnabled,
  usageForUsers,
  saveMessage,
  listMessages,
  updateMessageStatus,
  getMessage,
  findMessageByWaId,
  setReaction,
  setPinned,
  markDeleted,
  markRevoked,
  updateBody,
};
