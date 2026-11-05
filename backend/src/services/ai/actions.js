const crypto = require("node:crypto");
const prisma = require("../../config/db");
const registry = require("./tools/registry");
const audit = require("./audit");

/**
 * Anything the assistant would change, held until a person says yes.
 *
 * The rule this enforces: a conversation saying "yes, do it" is not consent. A model can be talked
 * into believing it was confirmed - by a lead's remarks, by a transcript, by its own summary of the
 * previous turn - and it has no way to tell an instruction from a client's words. So confirmation
 * lives here instead: a plan is written down server-side, handed back as a token, and nothing runs
 * until that exact token comes back from the browser.
 *
 * Authorization happens twice more, and the second time is the one that matters. Permissions can
 * change between planning and confirming - a role edited, an account suspended - and the action
 * must follow the permission as it is at execution, not as it was when the plan was made.
 *
 * **Plans are a table, not a map.** In memory would mostly work - a plan lives five minutes and a
 * person is sitting there - but a restart in that window loses it, and the table gives single-use a
 * far better guarantee than deleting from a map did: claiming is one conditional UPDATE, so two
 * concurrent confirms of one token cannot both win. See `confirmAction`.
 *
 * **The token is never stored, only its hash.** The token is the consent: whoever holds it can
 * cause the change. Storing it would mean a database read, a backup or a log excerpt was enough to
 * act as somebody else.
 */

// Long enough to read the card and think; short enough that a forgotten tab cannot act later.
const PLAN_TTL_MS = Number(process.env.AI_ACTION_TTL_MS || 5 * 60 * 1000);

/*
 * A high-risk change gets less time, not more.
 *
 * The reasoning is the same as the TTL's: a token is a standing authority to change something, and
 * how long that authority should sit unattended in a browser tab is a function of what it can do.
 */
const HIGH_RISK_TTL_MS = Number(process.env.AI_ACTION_HIGH_RISK_TTL_MS || 90 * 1000);

const STATUS = { PENDING: "PENDING", CONFIRMED: "CONFIRMED", FAILED: "FAILED", CANCELLED: "CANCELLED" };

class ActionError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** The token is the consent; the table holds only something that can verify one. */
function hash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function ttlFor(risk) {
  return risk === "HIGH_RISK_WRITE" ? HIGH_RISK_TTL_MS : PLAN_TTL_MS;
}

/**
 * Writes down what is proposed, and returns the token that can run it.
 *
 * The token is random and unguessable, because it is the thing that authorises the change - a
 * sequential id would let one person confirm another's plan.
 *
 */
async function planAction({ tool, args, context, summary }) {
  const registered = registry.findTool(tool);
  if (!registered) throw new ActionError("AI_TOOL_UNKNOWN", "That action is not available.", 404);

  /*
   * Nothing may propose a destructive change.
   *
   * A confirmation card is a reasonable gate for "add a remark". It is not a reasonable gate for
   * deleting a client's record, because the card is read in a hurry by someone who has been saying
   * yes to cards all morning. If something destructive ever needs doing, it should be done on the
   * screen built for it, where the consequences are spelled out and the action is not one button
   * among several the model put there.
   */
  if (registered.risk === "DESTRUCTIVE") {
    throw new ActionError("AI_ACTION_REFUSED", "That is not something the assistant can propose.", 403);
  }

  const token = crypto.randomBytes(24).toString("base64url");
  await prisma.aiActionPlan.create({
    data: {
      tokenHash: hash(token),
      // Bound to the person and the module that planned it. Someone else's token is not theirs.
      userId: context.userId,
      module: context.scope,
      tool: registered.name,
      args: JSON.stringify(args || {}),
      risk: registered.risk,
      summary: String(summary || "").slice(0, 2000),
      status: STATUS.PENDING,
      expiresAt: new Date(Date.now() + ttlFor(registered.risk)),
    },
  });

  return {
    token,
    tool: registered.name,
    risk: registered.risk,
    summary,
    expiresInSeconds: Math.round(ttlFor(registered.risk) / 1000),
  };
}

/**
 * Runs a plan, given the token that was handed out for it.
 *
 * Single-use, and this is where the table earns its place. The claim is one conditional UPDATE:
 * only a row that is still PENDING and not yet expired can move to CONFIRMED, and MySQL will let
 * exactly one of two concurrent requests win it. Deleting from a map was single-use too, but only
 * within one process - two workers, or a restart between the read and the delete, and it was not.
 */
async function confirmAction({ token, context, requestId }) {
  const tokenHash = hash(token);

  /*
   * Claimed first, executed second.
   *
   * The claim also carries the ownership check: a token belonging to somebody else, or made in a
   * different module, matches nothing here and is refused as though it did not exist.
   */
  const claimed = await prisma.aiActionPlan.updateMany({
    where: {
      tokenHash,
      status: STATUS.PENDING,
      expiresAt: { gt: new Date() },
      userId: context.userId,
      module: context.scope,
    },
    data: { status: STATUS.CONFIRMED, confirmedAt: new Date() },
  });

  if (claimed.count !== 1) {
    /*
     * Unknown, expired, already used, or someone else's - all the same answer.
     *
     * Distinguishing them would say whether a token had ever existed, and "already used" is exactly
     * what a replay would like to learn.
     */
    throw new ActionError("AI_ACTION_EXPIRED", "That action is no longer available. Ask again.", 410);
  }

  const plan = await prisma.aiActionPlan.findUnique({ where: { tokenHash } });

  const startedAt = Date.now();
  try {
    /*
     * Authorized again, now.
     *
     * `executeTool` re-reads the permission from the database rather than trusting the context the
     * plan was made with, so a role change between planning and confirming is respected.
     */
    const result = await registry.executeTool(plan.tool, JSON.parse(plan.args || "{}"), context);
    audit.toolCall({
      requestId, userId: context.userId, module: context.scope,
      tool: plan.tool, ms: Date.now() - startedAt, allowed: true,
    });
    /*
     * The arguments are cleared once they have landed.
     *
     * They are business data - a remark's text, a client's words - and they now exist in the
     * module's own table under that table's access rules. A second copy here would outlive it and
     * be read by whoever can read plans rather than whoever can read leads.
     */
    await prisma.aiActionPlan.update({ where: { id: plan.id }, data: { args: null } }).catch(() => {});
    return { tool: plan.tool, result };
  } catch (error) {
    audit.toolCall({
      requestId, userId: context.userId, module: context.scope,
      tool: plan.tool, ms: Date.now() - startedAt, allowed: false, code: error.code || "",
    });
    /*
     * Marked failed, never returned to PENDING.
     *
     * A refused action is not a retryable one: the refusal is usually the permission answering, and
     * putting the token back would let somebody press the button until something changed.
     */
    await prisma.aiActionPlan.update({ where: { id: plan.id }, data: { status: STATUS.FAILED, args: null } }).catch(() => {});
    throw error;
  }
}

/**
 * Forgets plans that were never acted on.
 *
 * Expired PENDING rows are cancelled rather than deleted, so "this was proposed and nobody said
 * yes" stays answerable; their arguments go, because that is the part that is business data.
 */
async function sweepExpired() {
  try {
    const { count } = await prisma.aiActionPlan.updateMany({
      where: { status: STATUS.PENDING, expiresAt: { lte: new Date() } },
      data: { status: STATUS.CANCELLED, args: null },
    });
    return count;
  } catch (error) {
    console.error("[ai:actions] could not sweep expired plans", error?.message || error);
    return 0;
  }
}

module.exports = { planAction, confirmAction, sweepExpired, ActionError, PLAN_TTL_MS, HIGH_RISK_TTL_MS, STATUS };
