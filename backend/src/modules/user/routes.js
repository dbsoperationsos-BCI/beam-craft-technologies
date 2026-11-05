const express = require("express");
const bcrypt = require("bcryptjs");
const { protect } = require("../../middleware/authMiddleware");
const iamService = require("../../services/iam.service");
const { isAdministrator, isSuperAdmin } = require("../../services/administrator");
const prisma = require("../../config/db");
const { signOutEverywhere } = require("../../services/passwordSessions");
const { storeImage, discardUploads } = require("../../services/imageStorage");
const { keyFromUrl } = require("../../services/objectStorage");
const { passwordProblem } = require("../../services/passwordPolicy");
const { passwordReuseProblem, nextPasswordHistory } = require("../../services/passwordHistory");
const { CLIENT_ROLE } = require("../../services/loginCredentials");
const clientPush = require("../../services/clientPush");
const orgChartService = require("../hrm/org-chart/service");
const preferencesService = require("./preferences/service");

// The folder the employee form and the public onboarding form file this same photograph in —
// the photo is the employee's whichever screen set it, so it lives in one place.
const PROFILE_PHOTO_FOLDER = "hrm/onboarding/photo";

const router = express.Router();
router.use(protect);

/*
 * Everything here is the signed-in account acting on itself — `req.user.id` is the only record any
 * of it reads or writes — so `protect` alone guards it and no module permission is involved.
 */

/** An error carrying the status the route should answer with. */
const fail = (status, message) => Object.assign(new Error(message), { status });

/** The extension for the bytes being sent, so the saved file opens in a picture viewer. */
const EXTENSION_BY_MIME = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
};

/** A file name a browser and a file system will both accept, built from the person's own name. */
function photoFileName(name, contentType) {
  const stem = String(name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${stem || "profile"}-photo.${EXTENSION_BY_MIME[contentType] || "jpg"}`;
}

/**
 * The bytes behind a stored photo, whichever of the two shapes it is: a `data:` URI, which is what
 * a server with no object storage configured keeps, or a URL on our own bucket, which is what
 * every deployed one keeps.
 *
 * The bucket check is the point of `keyFromUrl`, not a formality. `PATCH /profile-photo` accepts an
 * `http(s)` URL and stores it as given, so the column can hold an address somebody chose - and
 * fetching that here would make this server a way to read whatever it can reach and hand the
 * answer back, internal addresses included. Only a URL this deployment wrote is followed; anything
 * else is refused, which costs a download nobody has and closes a door nobody should have.
 */
async function readProfilePhoto(photo) {
  const dataUri = /^data:([a-z0-9.+/-]+);base64,(.*)$/is.exec(photo);
  if (dataUri) return { buffer: Buffer.from(dataUri[2], "base64"), contentType: dataUri[1].toLowerCase() };

  if (!keyFromUrl(photo)) throw fail(400, "This photo is not stored on this server, so it cannot be downloaded.");

  const response = await fetch(photo);
  if (!response.ok) throw new Error(`The stored photo could not be read (${response.status}).`);
  const contentType = String(response.headers.get("content-type") || "").split(";")[0].toLowerCase();
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: EXTENSION_BY_MIME[contentType] ? contentType : "image/jpeg",
  };
}

// The formats the frontend's own validation accepts, checked again here because the browser is
// never the guard. The same shapes the employees controller holds these to.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;
const USERNAME_PATTERN = /^[a-z0-9._-]{3,50}$/i;

// Who is signed in, for the My Profile page. The display name follows the linked employee record
// where one exists — that is the name HR maintains — so `canEditName` tells the page whether the
// name belongs to this form or to the Employee Repository.
router.get("/profile", async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { name: true, email: true, username: true, role: true, linkedEmployeeId: true, profilePhotoUrl: true },
    });
    if (!user) return res.status(404).json({ message: "User not found" });
    const employee = user.linkedEmployeeId
      ? await prisma.employee.findUnique({
        where: { id: user.linkedEmployeeId },
        /*
         * The record this person filled in when they joined, read back to them in full.
         *
         * The profile used to state eleven facts. That is not a record, it is a summary - and the
         * one place somebody should be able to check what the studio holds about them, and spot
         * what needs correcting, was showing a tenth of it. These are the eight sections of the
         * onboarding form, which is where every one of these answers came from.
         *
         * Their own row and nobody else's: the id is `req.user.linkedEmployeeId`, never anything
         * the request sends. That is what makes it safe for this to be as wide as it is - salary,
         * reviews and the rest of the HR record are deliberately not here, because those are the
         * studio's notes about somebody rather than their own answers.
         */
        select: {
          employeeName: true, profilePhotoUrl: true, contactNumber: true, companyGivenNumber: true, employeeId: true,
          // Personal
          gender: true, dateOfBirth: true, emailId: true, dateOfJoining: true, workType: true,
          bloodGroup: true, currentAddress: true, permanentAddress: true, skills: true,
          languagesKnown: true,
          // Family
          fatherName: true, fatherOccupation: true, motherName: true, motherOccupation: true,
          maritalStatus: true, spouseName: true, weddingAnniversary: true,
          // Identity and bank
          aadharCardNumber: true, panCardNumber: true, aadharCardImageUrl: true, panCardImageUrl: true,
          bankName: true, bankLocation: true, accountNumber: true, ifscCode: true,
          // Emergency contact, references, nominees
          emergencyContactName: true, emergencyContactNumber: true, emergencyContactRelationship: true,
          reference1PersonName: true, reference1PersonPhone: true, reference1PersonAddress: true,
          reference2PersonName: true, reference2PersonPhone: true, reference2PersonAddress: true,
          nominee1PersonName: true, nominee1PersonPhone: true, nominee2PersonName: true,
          nominee2PersonPhone: true,
          // The three repeating lists, in the order they were entered.
          qualifications: { select: { degree: true, branch: true, college: true, passedOutYear: true }, orderBy: { id: "asc" } },
          experiences: { select: { companyName: true, companyLocation: true, role: true, years: true, attachmentName: true }, orderBy: { id: "asc" } },
          children: { select: { name: true, dateOfBirth: true }, orderBy: { id: "asc" } },
          // Employment facts HR maintains, kept for the header rather than the detail below it.
          designation: true, department: true, workBaseLocation: true, currentWorkLocation: true,
          // Their own Work History tab: each stint, read from the joining date and the rejoins.
          employmentStatus: true, dateOfRelieving: true,
          rejoins: { orderBy: { rejoinedOn: "asc" }, select: { leftOn: true, separationType: true, separationReason: true, designation: true, department: true, rejoinedOn: true } },
        },
      })
      : null;
    res.json({
      data: {
        name: employee?.employeeName || user.name,
        email: user.email,
        username: user.username,
        role: user.role,
        profilePhotoUrl: employee?.profilePhotoUrl || user.profilePhotoUrl || null,
        contactNumber: employee?.contactNumber || null,
        canEditName: !employee,
        // The linked employee row, for the org chart on the profile page. Null for the
        // standalone Super Admin, who sits on no reporting line.
        employeeId: user.linkedEmployeeId || null,
        employment: employee ? {
          employeeCode: employee.employeeId,
          designation: employee.designation,
          department: employee.department,
          dateOfJoining: employee.dateOfJoining,
          workLocation: employee.currentWorkLocation || employee.workBaseLocation,
          bloodGroup: employee.bloodGroup,
          gender: employee.gender,
          // For their Work History tab (`lib/workHistory.mjs` reads this shape).
          employmentStatus: employee.employmentStatus,
          dateOfRelieving: employee.dateOfRelieving,
          rejoins: employee.rejoins,
        } : null,
        /*
         * What this person answered when they joined, keyed exactly as the onboarding form names
         * its fields - so the page that reads this can be drawn from that form's own section list
         * rather than from a second copy of it that drifts the day a field is added.
         */
        onboarding: employee ? {
          gender: employee.gender,
          dateOfBirth: employee.dateOfBirth,
          contactNumber: employee.contactNumber,
          companyGivenNumber: employee.companyGivenNumber,
          emailId: employee.emailId,
          dateOfJoining: employee.dateOfJoining,
          workType: employee.workType,
          bloodGroup: employee.bloodGroup,
          currentAddress: employee.currentAddress,
          permanentAddress: employee.permanentAddress,
          skills: employee.skills,
          languagesKnown: employee.languagesKnown,
          qualifications: employee.qualifications,
          experiences: employee.experiences.map((row) => ({ ...row, years: row.years === null ? null : Number(row.years) })),
          fatherName: employee.fatherName,
          fatherOccupation: employee.fatherOccupation,
          motherName: employee.motherName,
          motherOccupation: employee.motherOccupation,
          maritalStatus: employee.maritalStatus,
          spouseName: employee.spouseName,
          weddingAnniversary: employee.weddingAnniversary,
          children: employee.children,
          aadharCardNumber: employee.aadharCardNumber,
          panCardNumber: employee.panCardNumber,
          aadharCardImage: employee.aadharCardImageUrl,
          panCardImage: employee.panCardImageUrl,
          bankName: employee.bankName,
          bankLocation: employee.bankLocation,
          accountNumber: employee.accountNumber,
          ifscCode: employee.ifscCode,
          emergencyContactName: employee.emergencyContactName,
          emergencyContactNumber: employee.emergencyContactNumber,
          emergencyContactRelationship: employee.emergencyContactRelationship,
          reference1PersonName: employee.reference1PersonName,
          reference1PersonPhone: employee.reference1PersonPhone,
          reference1PersonAddress: employee.reference1PersonAddress,
          reference2PersonName: employee.reference2PersonName,
          reference2PersonPhone: employee.reference2PersonPhone,
          reference2PersonAddress: employee.reference2PersonAddress,
          nominee1PersonName: employee.nominee1PersonName,
          nominee1PersonPhone: employee.nominee1PersonPhone,
          nominee2PersonName: employee.nominee2PersonName,
          nominee2PersonPhone: employee.nominee2PersonPhone,
        } : null,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/*
 * The reporting chart, self-service: any signed-in person may see where they sit and walk the
 * lines around them. The chart's nodes carry only a name, designation, department and photo -
 * the studio's shape, which its members are entitled to read - so this needs no module
 * permission, unlike the Employee Repository's own chart route, whose guard protects the screen
 * it is drawn inside. `employeeId` walks the chart; it defaults to the caller's own record.
 */
router.get("/org-chart", async (req, res) => {
  try {
    let focusId = req.query.employeeId ? Number.parseInt(req.query.employeeId, 10) : null;
    if (focusId !== null && (!Number.isInteger(focusId) || focusId <= 0)) {
      return res.status(400).json({ message: "Invalid employee id." });
    }
    if (!focusId) {
      const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { linkedEmployeeId: true } });
      focusId = user?.linkedEmployeeId || null;
    }
    /*
     * A login with no employee record (the standalone Super Admin) still gets the chart - opened
     * at the top instead of at themselves: among the people who report to nobody, the one with
     * the most reports, which is where the studio's chart begins.
     */
    if (!focusId) {
      const roots = await prisma.employee.findMany({ where: { reportsToEmployeeId: null, archivedAt: null }, select: { id: true } });
      if (!roots.length) return res.status(404).json({ message: "There are no employees on the chart yet." });
      const counts = await prisma.employee.groupBy({
        by: ["reportsToEmployeeId"],
        where: { reportsToEmployeeId: { in: roots.map((root) => root.id) }, archivedAt: null },
        _count: { _all: true },
      });
      const countById = new Map(counts.map((row) => [row.reportsToEmployeeId, row._count._all]));
      focusId = roots.reduce((best, root) => (countById.get(root.id) || 0) > (countById.get(best.id) || 0) ? root : best, roots[0]).id;
    }
    res.json({ data: await orgChartService.chartFor(focusId) });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    res.status(500).json({ message: "Unable to load the organisation chart." });
  }
});

// The details on the login itself: username and email always, the name only where no employee
// record supplies it — a linked name is HR's to change in the Employee Repository, not this form's.
router.patch("/profile", async (req, res) => {
  try {
    const body = req.body || {};
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { linkedEmployeeId: true } });
    if (!user) return res.status(404).json({ message: "User not found" });

    const data = {};
    if (body.name !== undefined && !user.linkedEmployeeId) {
      const name = String(body.name || "").trim();
      if (!name || name.length > 150) return res.status(400).json({ message: "Enter a name of up to 150 characters." });
      data.name = name;
    }
    if (body.username !== undefined) {
      const username = String(body.username || "").trim();
      if (username && !USERNAME_PATTERN.test(username)) {
        return res.status(400).json({ message: "Username must be 3-50 letters, numbers, dots, dashes, or underscores." });
      }
      data.username = username || null;
    }
    if (body.email !== undefined) {
      const email = String(body.email || "").trim();
      if (!EMAIL_PATTERN.test(email) || email.length > 191) return res.status(400).json({ message: "Enter a valid email address." });
      data.email = email;
    }
    if (Object.keys(data).length === 0) return res.status(400).json({ message: "Nothing to update." });

    /*
     * `Employee.loginUsername` mirrors this login's own username, and this is the only other place
     * (besides account creation) that ever changes it - so it is kept in one transaction with the
     * write that actually decides it, rather than a second call that could succeed on one table and
     * fail on the other. See the note on that field in schema.prisma.
     */
    await prisma.$transaction(async (transaction) => {
      await transaction.user.update({ where: { id: req.user.id }, data });
      if (data.username !== undefined && user.linkedEmployeeId) {
        await transaction.employee.update({ where: { id: user.linkedEmployeeId }, data: { loginUsername: data.username } });
      }
    });
    res.json({ data });
  } catch (error) {
    // The unique constraints on email and username, answered in words rather than as a 500.
    if (error?.code === "P2002") {
      return res.status(409).json({ message: "That email or username is already taken by another account." });
    }
    res.status(500).json({ message: error.message });
  }
});

// Sets or clears the signed-in user's own photo. It lands on the linked employee record where one
// exists — the same field HR sets from the employee form — and on the login itself otherwise, so
// the standalone Super Admin gets a photo too. A fresh pick arrives as a compressed data URI and
// is stored the way the employee form stores it; null clears.
router.patch("/profile-photo", async (req, res) => {
  try {
    const value = req.body?.profilePhotoUrl ?? null;
    const isUsable = value === null
      || (typeof value === "string" && value.length <= 12_000_000
        && (/^data:image\/[a-z0-9.+-]+;base64,/i.test(value) || /^https?:\/\//i.test(value)));
    if (!isUsable) return res.status(400).json({ message: "Upload a valid image file." });

    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { linkedEmployeeId: true } });
    if (!user) return res.status(404).json({ message: "User not found" });

    let url = null;
    const uploads = [];
    if (value) {
      const result = await storeImage(value, { folder: PROFILE_PHOTO_FOLDER });
      url = result?.url || null;
      if (result && !result.reused) uploads.push(result);
    }
    try {
      if (user.linkedEmployeeId) {
        await prisma.employee.update({ where: { id: user.linkedEmployeeId }, data: { profilePhotoUrl: url } });
      } else {
        await prisma.user.update({ where: { id: req.user.id }, data: { profilePhotoUrl: url } });
      }
    } catch (error) {
      // The upload happened before the row moved; a failed save must not leave it orphaned in R2.
      await discardUploads(uploads);
      throw error;
    }
    res.json({ data: { profilePhotoUrl: url } });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/*
 * The signed-in account's own photo, as a file to save.
 *
 * The browser cannot be relied on to do this by itself. A stored photo is an absolute URL on the
 * public bucket, and across origins the `download` attribute is ignored and a `fetch` needs a CORS
 * header the bucket does not have to send - so a link would navigate away from the app and a fetch
 * would simply be refused. Read here instead: this is the app's own API, which the frontend is
 * already allowed to call, and it answers with the bytes and the name to save them under.
 */
router.get("/profile-photo/download", async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { name: true, profilePhotoUrl: true, linkedEmployeeId: true },
    });
    if (!user) return res.status(404).json({ message: "User not found" });

    const employee = user.linkedEmployeeId
      ? await prisma.employee.findUnique({ where: { id: user.linkedEmployeeId }, select: { profilePhotoUrl: true } })
      : null;
    const photo = employee?.profilePhotoUrl || user.profilePhotoUrl || null;
    if (!photo) return res.status(404).json({ message: "There is no photo on your profile yet." });

    const { buffer, contentType } = await readProfilePhoto(photo);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", buffer.length);
    res.setHeader("Content-Disposition", `attachment; filename="${photoFileName(user.name, contentType)}"`);
    // The photo is one person's own and changes when they change it; a cached copy would be served
    // to them after they have replaced it.
    res.setHeader("Cache-Control", "private, no-store");
    res.send(buffer);
  } catch (error) {
    res.status(error.status || 502).json({ message: error.message || "Unable to read your photo." });
  }
});

// Changes the caller's own password, on the strength of knowing the current one — the JWT alone is
// not enough for this: a walked-away-from session must not be a way to lock its owner out.
/*
 * A team member's phone, for pushes of what reaches their DBS bell (the Beam Craft app, signed in as
 * staff). The same store as clients' phones; the token is only ever this login's own.
 */
const PUSH_TOKEN = /^Expo(nent)?PushToken\[[^\]]{1,200}\]$/;
router.post("/push-token", async (req, res) => {
  const token = String(req.body?.token || "").trim();
  const platform = ["android", "ios"].includes(req.body?.platform) ? req.body.platform : null;
  if (!PUSH_TOKEN.test(token)) return res.status(400).json({ message: "Not a push token." });
  try {
    await prisma.clientPushToken.upsert({ where: { token }, create: { token, platform, userId: Number(req.user.id) }, update: { platform, userId: Number(req.user.id) } });
    return res.status(204).end();
  } catch (error) {
    console.error("Unable to save the push token:", error);
    return res.status(500).json({ message: "Unable to turn on notifications." });
  }
});
router.delete("/push-token", async (req, res) => {
  try {
    await prisma.clientPushToken.deleteMany({ where: { token: String(req.body?.token || "").trim(), userId: Number(req.user.id) } });
    return res.status(204).end();
  } catch (error) {
    console.error("Unable to remove the push token:", error);
    return res.status(500).json({ message: "Unable to turn off notifications." });
  }
});

router.post("/change-password", async (req, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || "");
    const newPassword = String(req.body?.newPassword || "");

    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { password: true, passwordHistory: true, role: true } });
    if (!user) return res.status(404).json({ message: "User not found" });

    const matches = await bcrypt.compare(currentPassword, user.password);
    if (!matches) return res.status(400).json({ message: "The current password is incorrect." });

    // The same policy the reset form enforces, from the one module that decides it.
    const problem = passwordProblem(newPassword);
    if (problem) return res.status(400).json({ message: problem });
    // Not the current one, and not one the account has had before either.
    const reused = await passwordReuseProblem(newPassword, user.password, user.passwordHistory);
    if (reused) return res.status(400).json({ message: reused });

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    /*
     * They have just chosen it themselves, so there is nothing left to force on next sign-in. The
     * password being replaced joins the history, which is what lets the check above refuse it later.
     *
     * And the account is signed out of **every** device, this one included (`signOutEverywhere`):
     * a token carries no password and is good for days, so without this somebody who changed their
     * password because it had been found out went on being followed by whoever had it. The next
     * request each device makes is a 401 and the app asks for the new password.
     */
    const changedAt = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: req.user.id },
        data: { password: hashedPassword, mustChangePassword: false, passwordHistory: nextPasswordHistory(user.password, user.passwordHistory) },
      });
      await signOutEverywhere(req.user.id, tx, changedAt);
    });
    // A client (the Beam Craft app) hears of it on every phone signed in to the login, so a change
    // they did not make does not go unnoticed. After the save, and never holding the answer up.
    if (user.role === CLIENT_ROLE) {
      clientPush.notifyUser(req.user.id, { title: "Your password was changed", body: "If this was not you, please contact the studio straight away.", data: { type: "password" } });
    }
    res.json({ message: "Password changed. You have been signed out everywhere - sign in again with the new password.", signedOut: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/*
 * How this login has arranged the application for itself: column order, hidden columns, frozen
 * columns, column widths, the density it reads at, and the tab each screen was left on.
 *
 * Self-service like everything else in this file - `req.user.id` is the only account any of it
 * touches, and no key in a payload can name another - so `protect` alone guards it and no module
 * permission applies. A table layout belongs to the person who arranged it; there is no IAM
 * feature it could sensibly be gated behind, and gating it would mean a role could be refused
 * the right to remember its own screen.
 */

// Everything this login has saved, in one request at sign-in rather than one behind every table.
router.get("/preferences", async (req, res) => {
  try {
    res.json({ data: await preferencesService.listForUser(req.user.id) });
  } catch (error) {
    res.status(500).json({ message: "Unable to load your saved layout." });
  }
});

// One preference, saved. The key is in the URL and the value in the body; neither may name a user.
router.put("/preferences/:key", async (req, res) => {
  try {
    const saved = await preferencesService.saveForUser(req.user.id, req.params.key, req.body?.value);
    res.json({ data: saved });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    res.status(500).json({ message: "Unable to save that layout." });
  }
});

// Forgets one preference - "Reset column order", and anything like it added later.
router.delete("/preferences/:key", async (req, res) => {
  try {
    res.json({ data: await preferencesService.clearForUser(req.user.id, req.params.key) });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    res.status(500).json({ message: "Unable to reset that layout." });
  }
});

// Get current user's permissions - and whether they are an administrator, for the few screens that
// belong to administrators whatever a role's permission levels say (`services/administrator.js`).
router.get("/permissions", async (req, res) => {
  try {
    const [permissions, administrator, superAdmin] = await Promise.all([
      iamService.getUserPermissions(req.user.id),
      isAdministrator(req.user.id),
      isSuperAdmin(req.user.id),
    ]);
    res.json({ permissions, isAdministrator: administrator, isSuperAdmin: superAdmin });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Check single permission
router.get("/permission", async (req, res) => {
  try {
    const { module, feature, level } = req.query;
    const hasPermission = await iamService.hasPermission(
      req.user.id,
      module,
      feature,
      level
    );
    res.json({ hasPermission });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get branch filter
router.get("/branch-filter", async (req, res) => {
  try {
    /*
     * `anyRole`: every branch this person reaches, across all their roles.
     *
     * This endpoint names no screen, so there is no permission it could scope by - it answers "where
     * does this account reach at all", which is a question about the account. **Nothing may use it
     * to narrow a screen**: branch reach is per-permission now, and a screen that filtered by this
     * would take the widest role the person holds as the answer for all the others, which is the
     * fault the per-permission rule exists to remove. A screen asks its own module.
     */
    const filter = await iamService.buildBranchFilter(req.user.id, { anyRole: true });
    res.json({ filter });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Check branch access
router.get("/can-access-branch", async (req, res) => {
  try {
    const { branchId } = req.query;
    if (!branchId) {
      return res.status(400).json({ message: "Branch ID required" });
    }
    // `anyRole`, for the reason `/branch-filter` above gives: this asks about the account rather
    // than about a screen. A screen asks its own module, through its own guard.
    const canAccess = await iamService.canAccessBranch(req.user.id, parseInt(branchId), { anyRole: true });
    res.json({ canAccess });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
