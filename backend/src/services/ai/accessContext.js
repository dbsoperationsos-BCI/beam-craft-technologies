const iamService = require("../iam.service");
const { findModule, permissionModuleFor, isGlobal, isKnownScope, moduleIds } = require("./modules");
const { verticalFor } = require("./verticals");

/**
 * Who is asking, what they may reach, and in which module - decided here and nowhere else.
 *
 * Two rules, and both are about not trusting things that look trustworthy.
 *
 * **Nothing comes from the request body.** A browser sending `{"module":"GLOBAL","isSuperAdmin":true}`
 * is sending a wish. The only thing taken from the caller is which module they would like to work
 * in, and that is then checked rather than believed.
 *
 * **Nothing comes from the JWT either, beyond the user id.** This is the part that is easy to get
 * wrong, because the token is signed and therefore feels authoritative. It carries `role`, and it is
 * signed by us, so it cannot be forged - but it was signed at login and lasts seven days. Demote a
 * Super Admin this morning and their token still says SUPER_ADMIN until next week. For a permission
 * check on a normal route that is a small staleness; for the switch that opens every module's data
 * at once it is a week-long hole. So the role is read from the database on every AI request.
 *
 * The cost is one query per request, against a model that takes seconds to answer. It is not worth
 * optimising away.
 */

/** Refusals the route turns into a status code, kept distinguishable from a bug. */
class AiAccessError extends Error {
  constructor(code, message, status = 403) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/**
 * The access context for one AI request.
 *
 * Throws `AiAccessError` when the module is unknown, when the user may not use it, or when a
 * non-Super-Admin asks for the global scope. Returns a plain object otherwise - deliberately not a
 * class, so it can be logged and asserted on without ceremony.
 */
async function buildAccessContext({ userId, requestedModule, requestedVertical } = {}) {
  const id = Number(userId);
  if (!Number.isFinite(id)) {
    throw new AiAccessError("AI_UNAUTHENTICATED", "Sign in to use the assistant.", 401);
  }

  // The database, not the token. See the note above.
  let user;
  try {
    user = await iamService.getUserWithPermissions(id);
  } catch {
    user = null;
  }
  if (!user) {
    throw new AiAccessError("AI_UNAUTHENTICATED", "That account no longer exists.", 401);
  }

  const isSuperAdmin = user.role === "SUPER_ADMIN";
  const scope = String(requestedModule || "").trim().toUpperCase();

  if (!scope) {
    throw new AiAccessError("AI_MODULE_REQUIRED", "Say which module the assistant is working in.", 400);
  }
  /*
   * An unregistered name is refused before anything else looks at it.
   *
   * Named without listing what is registered: a refusal that enumerates the modules tells someone
   * probing the API what else exists.
   */
  if (!isKnownScope(scope)) {
    throw new AiAccessError("AI_MODULE_UNKNOWN", "That module is not available to the assistant.", 404);
  }

  if (isGlobal(scope)) {
    /*
     * The one check this whole file exists for.
     *
     * `isSuperAdmin` came from the database a few lines above, so a request body claiming it, a
     * stale token carrying it, or a prompt asking for it all arrive here and are refused the same
     * way.
     */
    if (!isSuperAdmin) {
      throw new AiAccessError("AI_MODULE_FORBIDDEN", "The global assistant is for Super Admins.", 403);
    }
    return {
      userId: id,
      userName: user.name || "",
      isSuperAdmin: true,
      scope: "GLOBAL",
      // Every registered module, because that is what global means. Tool filtering in Phase 2 reads
      // this list rather than assuming "Super Admin can do anything".
      modules: moduleIds(),
      feature: null,
      branchIds: await reachableBranches(id),
    };
  }

  const registered = findModule(scope);
  /*
   * The same permission the module's own routes require.
   *
   * Not a parallel AI-specific rule: if a user may not open CRM Leads through the API, the
   * assistant must not read it for them either. `hasPermission` is the same call
   * `permissionMiddleware` makes, and it grants a Super Admin everything by itself.
   */
  const allowed = await iamService.hasPermission(id, permissionModuleFor(registered), registered.feature, "READ");
  if (!allowed) {
    throw new AiAccessError("AI_MODULE_FORBIDDEN", "You do not have access to that module.", 403);
  }

  return {
    userId: id,
    userName: user.name || "",
    isSuperAdmin,
    scope: registered.id,
    // One module, and only one. A normal user's session cannot widen past this.
    modules: [registered.id],
    feature: registered.feature,
    /*
     * Which of the studio's three businesses this session is looking at.
     *
     * The CRM is one module holding three that have nothing to do with each other - Dum Dum shoots
     * weddings, Qua Qua newborns, Corp companies - and the screen is always showing exactly one of
     * them. An assistant opened on the Qua Qua board answering about weddings is answering about
     * somebody else's work.
     *
     * A filter rather than a permission: someone with CRM access may see all three, so this narrows
     * what is read to match what is on screen. It is validated against the registry so an
     * unrecognised value narrows to nothing rather than being passed into a query.
     */
    vertical: verticalFor(requestedVertical)?.name || null,
    branchIds: await reachableBranches(id),
  };
}

/**
 * The branches this user may see, or null for someone confined to none.
 *
 * `reachableBranchIds` returns null for a Super Admin, meaning "not limited". That null is carried
 * through unchanged rather than converted to an empty list, because the two mean opposite things and
 * a data-scope filter that confuses them either shows everything or nothing.
 */
async function reachableBranches(userId) {
  try {
    /*
     * `anyRole`: every branch this account reaches, across all its roles.
     *
     * Branch reach is per-permission now, and this is deliberately not scoped to one - it describes
     * the *person* to the assistant rather than filtering a screen. Every read the assistant makes
     * on their behalf goes through `dataScope.resolve`, which asks per permission, so the narrowing
     * happens there and this stays a description.
     */
    return await iamService.reachableBranchIds(userId, { anyRole: true });
  } catch {
    // A failure to resolve scope must not read as unlimited scope.
    return [];
  }
}

module.exports = { buildAccessContext, AiAccessError };
