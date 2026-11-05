const iamService = require("../services/iam.service");

/**
 * What a guard says when the check itself could not be made.
 *
 * A failed check is a 500 - the guard could not establish anything, so nothing is let through. The
 * exception is an error that already carries its own status: a token naming an account that no
 * longer exists arrives here as a 401 from `iam.service`, and answering that with a 500 left the
 * browser holding a dead token and retrying forever instead of signing the person out.
 */
function checkFailed(res, error, fallback) {
  if (error?.status) return res.status(error.status).json({ message: error.message, code: error.code });
  console.error(fallback, error);
  return res.status(500).json({ message: fallback });
}

/**
 * Whether the caller may touch the branch this request names - **for this screen's permission**.
 *
 * `checkBranchAccess("branchId", { module: "ASSET", feature: "Asset Management" })`. The permission
 * is what decides the reach: somebody may hold leads across every branch through one role and assets
 * in Coimbatore through another, and a guard that asked "which branches does this person reach" with
 * no permission named would answer with the wider of the two on the narrower screen.
 *
 * The scope is **required**. A guard that quietly fell back to the union is the exact fault this
 * exists to remove, and it would fail open - on a write.
 */
const checkBranchAccess = (branchIdParam = "branchId", scope) => {
  if (!scope?.module || !scope?.feature) {
    throw new Error('checkBranchAccess needs the permission it guards, e.g. { module: "ASSET", feature: "Asset Management" }.');
  }
  return async (req, res, next) => {
    try {
      // Extract branchId from query, body, or params. Each is read defensively: a GET has no body
      // at all, so reaching into `req.body` threw and the request came back as a 500 - a server
      // fault for what is only a missing parameter.
      const branchId =
        parseInt(req.query?.[branchIdParam], 10) ||
        parseInt(req.body?.[branchIdParam], 10) ||
        parseInt(req.params?.[branchIdParam], 10);

      // No branch named, nothing to check. This guard answers "may you touch *that* branch"; a
      // request that names none is scoped by buildBranchFilter in the handler instead, which is how
      // every list in the app is already narrowed. Refusing here made every Asset Management call
      // fail, because the screens list assets without naming a branch at all.
      if (!branchId) return next();

      // Check if user can access this branch
      /*
       * Asked at the level the request is: a GET looks, anything else writes - the same rule
       * `requireModule` applies to the permission itself.
       *
       * It matters because permissions union across roles while branches no longer do. Somebody
       * holding a module `READ_WRITE` in Coimbatore through one role and `READ` in Erode through
       * another passes the write guard on the strength of the first, and asked for reach at `READ`
       * would be handed Erode to write into by a role that only ever let them look.
       */
      const level = req.method === "GET" || req.method === "HEAD" ? "READ" : "READ_WRITE";
      const canAccess = await iamService.canAccessBranch(req.user.id, branchId, { ...scope, level });
      
      if (!canAccess) {
        return res.status(403).json({ message: "You cannot access this branch" });
      }

      // Store branch info for later use
      req.branchId = branchId;
      next();
    } catch (error) {
      return checkFailed(res, error, "Branch access check failed");
    }
  };
};

// Check if user has specific permission
const checkPermission = (module, feature, requiredLevel = "READ") => {
  return async (req, res, next) => {
    try {
      const hasPermission = await iamService.hasPermission(
        req.user.id,
        module,
        feature,
        requiredLevel
      );

      if (!hasPermission) {
        return res.status(403).json({
          message: `You don't have ${requiredLevel} permission for ${module}:${feature}`
        });
      }

      // Store permission info for later use
      req.permission = {
        module,
        feature,
        level: requiredLevel
      };

      next();
    } catch (error) {
      return checkFailed(res, error, "Permission check failed");
    }
  };
};

// Check multiple permissions (AND logic - user needs all)
const checkPermissions = (permissions) => {
  return async (req, res, next) => {
    try {
      for (const { module, feature, level } of permissions) {
        const hasPermission = await iamService.hasPermission(
          req.user.id,
          module,
          feature,
          level
        );

        if (!hasPermission) {
          return res.status(403).json({
            message: `You don't have ${level} permission for ${module}:${feature}`
          });
        }
      }

      next();
    } catch (error) {
      return checkFailed(res, error, "Permissions check failed");
    }
  };
};

// Check any permission (OR logic - user needs at least one)
const checkAnyPermission = (permissions) => {
  return async (req, res, next) => {
    try {
      let hasAnyPermission = false;

      for (const { module, feature, level } of permissions) {
        const hasPermission = await iamService.hasPermission(
          req.user.id,
          module,
          feature,
          level
        );

        if (hasPermission) {
          hasAnyPermission = true;
          break;
        }
      }

      if (!hasAnyPermission) {
        return res.status(403).json({
          message: "You don't have required permissions"
        });
      }

      next();
    } catch (error) {
      return checkFailed(res, error, "Permission check failed");
    }
  };
};


/**
 * Guards a whole router with one line: `router.use(protect, requireModule("SALES", "CRM Leads"))`.
 *
 * The level follows the method - a GET reads, anything else writes - which is the rule every one of
 * these routers already follows in practice. Annotating 240 routes by hand would have meant 240
 * chances to miss one, and a route added later would arrive unguarded; mounted on the router, a new
 * route is covered the moment it is written.
 *
 * `readOnlyReads: false` gates reads at READ_WRITE too, for a router where even looking is
 * privileged.
 */
const requireModule = (module, feature, { readOnlyReads = true } = {}) => {
  const forRead = checkPermission(module, feature, readOnlyReads ? "READ" : "READ_WRITE");
  const forWrite = checkPermission(module, feature, "READ_WRITE");
  return (req, res, next) => (req.method === "GET" || req.method === "HEAD" ? forRead : forWrite)(req, res, next);
};

module.exports = {
  requireModule,
  checkBranchAccess,
  checkPermission,
  checkPermissions,
  checkAnyPermission
};
