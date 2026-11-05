const { z } = require("zod");
const service = require("./service");

const amount = z.coerce.number().min(0).max(10_000_000);

/*
 * Every field optional, so any one figure can be changed without restating the others.
 *
 * Settings → Employee Referral asks for the amount and the number of instalments and sends both, but
 * a schema *requiring* them would make this route unusable for anything that only meant to move one.
 * `.refine` keeps an empty body from counting as a save that changed nothing but the timestamp.
 *
 * `instalmentCount` is what the form sends - how many payments, which is the question a studio has
 * an answer to - and the service turns it into the months they fall due on, so the three-month
 * interval is applied in one place rather than trusted from the browser. `instalmentMonths` is still
 * accepted for a caller that means specific offsets; sending both is refused rather than silently
 * letting one win.
 *
 * Neither is checked here. The service owns those rules and states them in words a studio can act
 * on - "Use a whole number of instalments, such as 2" beats "invalid input".
 */
const settingsSchema = z
  .object({
    referralAmount: amount.optional(),
    instalmentCount: z.union([z.string(), z.number()]).optional(),
    instalmentMonths: z.union([z.string(), z.array(z.union([z.string(), z.number()]))]).optional(),
  })
  .refine(
    (values) => values.referralAmount !== undefined || values.instalmentCount !== undefined || values.instalmentMonths !== undefined,
    { message: "Nothing to save." },
  )
  .refine((values) => values.instalmentCount === undefined || values.instalmentMonths === undefined, {
    message: "Send how many instalments, or the months they fall on - not both.",
  });

function fail(res, error, fallback) {
  if (error?.status) return res.status(error.status).json({ message: error.message });
  console.error(fallback, error);
  return res.status(500).json({ message: fallback });
}

async function getSettings(req, res) {
  try {
    return res.json({ data: await service.referralSettings() });
  } catch (error) {
    return fail(res, error, "Unable to load the referral settings.");
  }
}

async function saveSettings(req, res) {
  const parsed = settingsSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: "Enter a valid referral amount.", errors: parsed.error.flatten() });
  const values = { ...parsed.data };
  if (values.instalmentCount !== undefined) {
    const { months, error } = service.readInstalmentCount(values.instalmentCount);
    if (error) return res.status(400).json({ message: error });
    delete values.instalmentCount;
    values.instalmentMonths = months;
  } else if (values.instalmentMonths !== undefined) {
    const problem = service.validateInstalmentMonths(values.instalmentMonths);
    if (problem) return res.status(400).json({ message: problem });
  }
  try {
    return res.json({ data: await service.saveReferralSettings(values, req.user.id) });
  } catch (error) {
    return fail(res, error, "Unable to save the referral settings.");
  }
}

async function listReferrals(req, res) {
  try {
    return res.json({ data: await service.listReferrals({ status: String(req.query.status || "").trim(), userId: Number(req.user.id) }) });
  } catch (error) {
    return fail(res, error, "Unable to load referrals.");
  }
}

/*
 * Settling one instalment by hand: only ever to Paid. Paid is not reversible here - a correction is
 * an Accounts entry - and Pending or Cancelled are not things this screen sets.
 */
const payoutSchema = z.object({
  status: z.literal("Paid"),
  paidOn: z.string().trim().min(1).refine((value) => !Number.isNaN(new Date(value).getTime()), "Give the date it was paid.").nullable().optional(),
  remarks: z.string().trim().max(500).nullable().optional(),
}).strict();

async function updatePayout(req, res) {
  const id = Number.parseInt(req.params.payoutId, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "A referral instalment id is required." });
  const parsed = payoutSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Validation failed." });
  try {
    return res.json({ data: await service.updatePayout(id, parsed.data, req.user.id) });
  } catch (error) {
    return fail(res, error, "Unable to mark this referral instalment paid.");
  }
}

/** One referral deleted from the register's ⋮ - refused once anything on it has been paid. */
async function deleteReferral(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "A referral id is required." });
  try {
    await service.deleteReferral(id, req.user.id);
    return res.json({ message: "Referral deleted." });
  } catch (error) {
    return fail(res, error, "Unable to delete this referral.");
  }
}

module.exports = { getSettings, saveSettings, listReferrals, updatePayout, deleteReferral };
