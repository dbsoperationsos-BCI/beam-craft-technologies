const { z } = require("zod");
const prisma = require("../../../config/db");
const { placeholdersIn } = require("../../../services/messageTemplate");

/*
 * Settings → Wishes: the ten Birthday Wishes, ten (wedding) Anniversary Wishes and ten Work
 * Anniversary Wishes, kept as message templates (`BIRTHDAY_WISH_01`..`10`,
 * `WEDDING_ANNIVERSARY_WISH_01`..`10` by migration `20261012200000_wishes`,
 * `WORK_ANNIVERSARY_WISH_01`..`10` by `20261103120000_work_anniversary_wishes`). `{employee name}` is
 * the employee's name, `{spouse name}` their spouse's, `{years}` the years since they joined ("3 years").
 */

const KINDS = { birthday: "BIRTHDAY_WISH", weddingAnniversary: "WEDDING_ANNIVERSARY_WISH", workAnniversary: "WORK_ANNIVERSARY_WISH" };
const WISH_KEY = /^(BIRTHDAY_WISH|WEDDING_ANNIVERSARY_WISH|WORK_ANNIVERSARY_WISH)_(0[1-9]|10)$/;
const WISH_LABEL = { BIRTHDAY_WISH: "Birthday Wish", WEDDING_ANNIVERSARY_WISH: "Wedding Anniversary Wish", WORK_ANNIVERSARY_WISH: "Work Anniversary Wish" };
const WISH_COUNT = 10;

const bodySchema = z.object({ body: z.string().trim().min(1, "A wish needs some wording.").max(1000, "Keep a wish to 1,000 characters.") }).strict();

const serialize = (row) => ({ key: row.key, name: row.name, body: row.body, placeholders: placeholdersIn(row.body), updatedAt: row.updatedAt });

/**
 * Every list, each in order: `{ birthday: [...], weddingAnniversary: [...], workAnniversary: [...] }` - and `delivery`, where
 * and when they are sent (the Attendance WhatsApp Report's group and time) and how the last try went.
 */
async function listWishes(req, res) {
  try {
    const rows = await prisma.messageTemplate.findMany({
      where: { OR: Object.values(KINDS).map((prefix) => ({ key: { startsWith: `${prefix}_` } })) },
      orderBy: { key: "asc" },
    });
    const wishes = rows.filter((row) => WISH_KEY.test(row.key));
    // Required here: the sender reads this file's KINDS.
    const delivery = await require("./sender").wishDeliveryStatus();
    return res.json({
      data: Object.fromEntries(Object.entries(KINDS).map(([kind, prefix]) => [kind, wishes.filter((row) => row.key.startsWith(`${prefix}_`)).map(serialize)])),
      delivery,
    });
  } catch (error) {
    console.error("Unable to load the wishes:", error.message);
    return res.status(500).json({ message: "Unable to load the wishes." });
  }
}

/** Rewords one wish - only one of the thirty. */
async function saveWish(req, res) {
  const key = String(req.params.key || "").trim();
  if (!WISH_KEY.test(key)) return res.status(404).json({ message: "That wish could not be found." });
  const parsed = bodySchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "A wish needs some wording." });
  try {
    const [prefix, number] = [key.replace(/_\d+$/, ""), Number(key.slice(-2))];
    const label = WISH_LABEL[prefix];
    const row = await prisma.messageTemplate.upsert({
      where: { key },
      update: { body: parsed.data.body, updatedByUserId: Number(req.user?.id) || null },
      create: { key, name: `${label} ${number}`, body: parsed.data.body, updatedByUserId: Number(req.user?.id) || null },
    });
    return res.json({ data: serialize(row) });
  } catch (error) {
    console.error("Unable to save the wish:", error.message);
    return res.status(500).json({ message: "Unable to save that wish." });
  }
}

/*
 * Settings → Wishes → Wishes Scheduler (`scheduler.js`): read on SETTINGS / Wishes Read, set on
 * Read / Write - the router's `requireModule` follows the method. Each answers the scheduler as it
 * now stands.
 */
const scheduler = () => require("./scheduler");
const iam = () => require("../../../services/iam.service");
const statusFor = async (req) => scheduler().schedulerStatus({ canChooseSenders: await iam().hasPermission(req.user.id, "SETTINGS", "Wishes", "READ_WRITE") });
const answered = (handler, fallback) => async (req, res) => {
  try {
    await handler(req);
    return res.json({ data: await statusFor(req) });
  } catch (error) {
    if (error?.status) return res.status(error.status).json({ message: error.message });
    console.error(`${fallback}:`, error.message);
    return res.status(500).json({ message: `${fallback}.` });
  }
};
const getScheduler = answered(async () => {}, "Unable to read the wishes scheduler");
const setSchedulerGroup = answered((req) => scheduler().setGroupName(req.body?.groupName), "Unable to save the WhatsApp group's name");
const setSchedulerSendAt = answered((req) => scheduler().setSendAt(req.body?.sendAt), "Unable to save when the wishes are sent");
const setSchedulerSender = answered((req) => scheduler().setSender(req.body || {}), "Unable to save the sender");
const listSchedulerCandidates = async (req, res) => {
  try {
    return res.json({ data: await require("../../hrm/attendance/reportGroup").senderCandidates() });
  } catch (error) {
    console.error("Unable to list the senders:", error.message);
    return res.status(500).json({ message: "Unable to list who can send the wishes." });
  }
};

module.exports = { KINDS, WISH_KEY, WISH_COUNT, listWishes, saveWish, getScheduler, setSchedulerGroup, setSchedulerSendAt, setSchedulerSender, listSchedulerCandidates };
