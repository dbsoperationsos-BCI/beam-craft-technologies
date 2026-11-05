const missingModules = [];

const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const { appVersion } = require("./config/version");
const { releaseNotes } = require("./services/releaseNotes");
const { protect } = require("./middleware/authMiddleware");
const { checkPermission } = require("./middleware/permissionMiddleware");
const { pool: smtpPool } = require("./services/smtpPool");
const { describeSms } = require("./services/smsSender");

const authRoutes = require("./routes/authRoutes");
const hrmMasterDataRoutes = require("./modules/hrm/master-data/routes");
const hrmPaymentRequestRoutes = require("./modules/hrm/payment-requests/routes");
const hrmOrgChartRoutes = require("./modules/hrm/org-chart/routes");
const hrmAttendanceRoutes = require("./modules/hrm/attendance/routes");
const hrmReferralRoutes = require("./modules/hrm/referrals/routes");
const hrmTaskRoutes = require("./modules/hrm/tasks/routes");
const hrmInterviewRoutes = require("./modules/hrm/interview/routes");
const hrmInterviewSheetLinkRoutes = require("./modules/hrm/interview/sheetLinksRoutes");
const hrmInterviewGoogleOAuthRoutes = require("./modules/hrm/interview/googleOAuthRoutes");
const hrmInterviewInviteRoutes = require("./modules/hrm/interview/inviteRoutes");
const interviewApplicationPublicRoutes = require("./modules/hrm/interview/publicRoutes");
const { startInterviewSheetAutoSync } = require("./modules/hrm/interview/sheetAutoSync");
const notificationRoutes = require("./modules/notifications/routes");
const messageTemplateRoutes = require("./modules/settings/message-templates/routes");
const settingsHolidayRoutes = require("./modules/settings/holidays/routes");
const onboardingInvitePublicRoutes = require("./modules/hrm/onboarding-invites/publicRoutes");
const clientOnboardingRoutes = require("./modules/subscribe/client-onboarding/routes");
const clientOnboardingPublicRoutes = require("./modules/subscribe/client-onboarding/publicRoutes");
const clientSiteRoutes = require("./modules/subscribe/client-onboarding/siteRoutes");
const salesProjectRoutes = require("./modules/sales/projects/routes");
const salesQuotationPublicRoutes = require("./modules/sales/quotations-public/routes");
const salesProjectAttachmentRoutes = require("./modules/sales/project-attachments/routes");
const salesWhatsappGroupNameRoutes = require("./modules/sales/whatsapp-group-names/routes");
const salesGoogleSheetLinkRoutes = require("./modules/sales/google-sheet-links/routes");
const salesGoogleOAuthRoutes = require("./modules/sales/google-oauth/routes");
const salesCrmLeadRoutes = require("./modules/sales/crm-leads/routes");
const salesCrmReportRoutes = require("./modules/sales/crm-reports/routes");
// The contact directory. Its own module rather than a branch of the CRM: it reads a phone
// number wherever the application keeps one - HR, sales, projects, galleries, accounts, vendors.
const contactDirectoryRoutes = require("./modules/contacts/directory/routes");
// The studio calendar. Its own module for the same reason the contact directory is: a shoot and
// a meeting are both things in the diary, and neither module owns the other.
const scheduleCalendarRoutes = require("./modules/schedule/calendar/routes");
// The browser saying it is being used, which is what the usage reports are measured from.
const usageHeartbeatRoutes = require("./modules/usage/heartbeat/routes");
const usageSettingsRoutes = require("./modules/usage/settings/routes");
const salesCrmLeadPublicRoutes = require("./modules/sales/crm-leads/publicRoutes");
const salesCallyzerApiRoutes = require("./modules/sales/callyzer-api/routes");
const salesCrmAiRoutes = require("./modules/sales/crm-ai/routes");
// The central AI gateway. Every module talks to the model through this one entry point.
const aiRoutes = require("./modules/ai/routes");
const salesWhatsappChatRoutes = require("./modules/sales/whatsapp-chat/routes");
const salesCrmMeetingRoutes = require("./modules/sales/crm-meetings/routes");
const salesQuotationCalculatorRoutes = require("./modules/sales/quotation-calculator/routes");
const salesQuotationSettingsRoutes = require("./modules/sales/quotation-settings/routes");
const salesQuotationBrandRoutes = require("./modules/sales/quotation-brands/routes");
const salesCrdDocumentRoutes = require("./modules/sales/crd-documents/routes");
const clientGiftsRoutes = require("./modules/project-management/client-gifts/routes");
const salesCrdTermsSettingsRoutes = require("./modules/sales/crd-terms-settings/routes");
const salesExtraQuotationRoutes = require("./modules/sales/extra-quotations/routes");
const salesCrdDocumentPublicRoutes = require("./modules/sales/crd-documents/publicRoutes");
const { callback: googleOAuthCallback } = require("./modules/sales/google-oauth/controller");
const { migrateCrmLeadLegacyColumns } = require("./modules/sales/crm-leads/crmLeadService");
const { startCrmAutoSync } = require("./modules/sales/crm-leads/autoSync");
const { sweepExpired } = require("./services/ai/actions");
const { restoreSessions: restoreWhatsAppSessions, shutdownSessions: shutdownWhatsAppSessions } = require("./modules/sales/whatsapp-chat/sessionManager");
const imageSelectionProjectRoutes = require("./modules/image-selection/projects/routes");
const imageSelectionDeliverableRoutes = require("./modules/image-selection/deliverables/routes");
const imageSelectionPublishShareRoutes = require("./modules/image-selection/publish-share/routes");
const imageSelectionWhatsappRoutes = require("./modules/image-selection/whatsapp/routes");
const imageSelectionWhatsappSessionRoutes = require("./modules/image-selection/whatsapp/session.routes");
const imageSelectionFolderRoutes = require("./modules/image-selection/folders/routes");
// The image-selection uploads module is missing from the repository: `backend/.gitignore` used to
// carry an unanchored `uploads` rule, which excluded src/modules/image-selection/uploads/ along
// with the upload directory it was meant for, so the module was never committed. The rule is fixed,
// but the files still have to be restored by whoever holds them. Until then the rest of the API is
// not held hostage to one absent folder: the router is mounted when present and reported when not.
const imageSelectionUploadRoutes = optionalModule("./modules/image-selection/uploads/routes");

function optionalModule(request) {
  try {
    return require(request);
  } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND" || !String(error.message).includes(request)) throw error;
    missingModules.push(request);
    return null;
  }
}
const imageSelectionOriginalsRoutes = require("./modules/image-selection/originals/routes");
const { startWorker } = require("./modules/image-selection/processing/worker");
const { startWorker: startWhatsAppWorker } = require("./modules/image-selection/whatsapp/worker");
const { startTranscriptionWorker } = require("./modules/sales/call-transcripts/worker");
const imageProcessingQueue = require("./modules/image-selection/processing/queue");
const imageSelectionGalleryRoutes = require("./modules/image-selection/gallery/routes");
// The AI Feature: event galleries with face recognition, the third screen under Visual Curation and
// a module of its own - its own routers, tables, storage namespace and queue. See src/modules/ai-feature.
const aiFeatureRoutes = require("./modules/ai-feature/routes");
const aiFeatureDefaultSettingsRoutes = require("./modules/ai-feature/default-settings/routes");
const aiFeaturePublicRoutes = require("./modules/ai-feature/public/routes");
const { startWorker: startAiFeatureWorker } = require("./modules/ai-feature/processing/worker");
const aiFeatureQueue = require("./modules/ai-feature/processing/queue");
const imageSelectionAlbumProofRoutes = require("./modules/image-selection/album-proofs/routes");
const publicAlbumProofRoutes = require("./modules/image-selection/album-proofs/public.routes");
const imageSelectionPublicationRoutes = require("./modules/image-selection/publication/routes");
const imageSelectionSettingsRoutes = require("./modules/image-selection/settings/routes");
const imageSelectionDashboardRoutes = require("./modules/image-selection/dashboard/routes");
const { publicStudioBranding } = require("./modules/image-selection/settings/controller");
const imageSelectionStorageRootRoutes = require("./modules/image-selection/storage-roots/routes");
const publicImageSelectionGalleryRoutes = require("./modules/image-selection/public-gallery/routes");
// The client gallery's People filter: a plugin on the side of Image Selection with its own queue,
// worker and tables. On whenever the face engine is (AI_FACE_ENGINE_ENABLED). See src/modules/image-selection/faces.
const imageSelectionFaceRoutes = require("./modules/image-selection/faces/routes");
const { startWorker: startImageSelectionFaceWorker } = require("./modules/image-selection/faces/worker");
const imageSelectionFaceQueue = require("./modules/image-selection/faces/queue");
const assetRoutes = require("./modules/assets/assets.routes");
const assetCategoryRoutes = require("./modules/assets/categories.routes");
const vendorRoutes = require("./modules/assets/vendors.routes");
const clientStorageRoutes = require("./modules/assets/client-storage.routes");
const assetRequestRoutes = require("./modules/assets/asset-requests.routes");
const accountsCashEntryRoutes = require("./modules/accounts/cash-entries/routes");
const userRoutes = require("./modules/user/routes");
const adminRoutes = require("./modules/admin/routes");
const adminBranchRoutes = require("./modules/admin/branches/routes");
const app = express();

app.use(cors());
/*
 * The parsed body, and the exact bytes it was parsed from.
 *
 * A signed webhook is verified against the bytes as they arrived - re-serializing the parsed
 * object gives different bytes (key order, spacing, unicode escapes) and the signature will never
 * match. The Callyzer webhook is the one route that needs them, and it cannot capture them itself:
 * this parser runs first and body-parser marks the request as read, so a second parser downstream
 * steps over it and never sees the stream.
 *
 * Kept as a reference to the buffer body-parser already holds, so this costs no extra copy.
 */
app.use(express.json({
  limit: process.env.JSON_BODY_LIMIT || "50mb",
  /*
   * Only for the route that needs them. Held for every request, a 50MB CSV import would keep the
   * raw bytes alive alongside the parsed object for the life of the request - twice the memory,
   * to serve one webhook.
   */
  verify: (req, _res, buffer) => {
    if (buffer?.length && String(req.originalUrl || req.url || "").includes("/webhook/callyzer")) req.rawBody = buffer;
  },
}));
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

// Sits directly behind the body parser so it catches that parser's own oversize error, which
// would otherwise reach the client as Express's HTML page.
app.use((error, req, res, next) => {
  if (error?.type === "entity.too.large") {
    return res.status(413).json({
      message: "The uploaded files are too large. Reduce the file sizes and try again.",
    });
  }

  return next(error);
});

app.get("/", (req, res) => {
  res.json({ message: "DBS HRM API running successfully" });
});

// Also the deploy's last gate: deploy.yml polls this until it answers and then checks that
// `version` is the release it just shipped, which is what proves PM2 restarted onto the new code
// rather than reporting "online" while still serving the old process.
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "dbs-erp-backend",
    version: appVersion.version,
    commit: appVersion.commit,
    deployedAt: appVersion.deployedAt,
  });
});

/*
 * Whether this server can send mail, and through which accounts.
 *
 * "The password reset email never arrived" was unanswerable from outside the machine. Every one of
 * its causes - no `SMTP_*` configured at all, an App Password that has been revoked, a sender in
 * cooldown after being refused - lives in the environment and shows up nowhere: the reset form
 * answers "if this email exists, a reset link will be sent" whatever happens, and it must, because
 * anything else would tell a stranger which addresses have accounts. So the question has to be
 * asked here instead.
 *
 * `?verify=true` opens a connection to each account and authenticates. Off by default because it
 * talks to the provider and takes seconds; without it this is a read of what is configured and how
 * each sender is faring, which is the cheap answer to "is mail set up at all".
 *
 * Guarded, and not by `protect` alone: it names the studio's sending addresses and would tell any
 * signed-in employee which accounts the studio sends from. `ADMIN / System Settings` is the
 * permission that opens the screens this belongs beside. **No password is ever returned** - see
 * `describe()` in smtpPool.js, which is built for exactly that reason.
 */
app.get("/api/health/email", protect, checkPermission("SETTINGS", "Application Monitoring", "READ"), async (req, res) => {
  const senders = smtpPool().describe();
  // The SMS gateway is reported beside it, because a password reset can now go either way and
  // "the code never arrived" has the same two possible causes: not configured, or refused.
  const sms = describeSms();
  if (String(req.query.verify) !== "true") {
    return res.json({ configured: senders.length > 0, senders, sms, verified: null });
  }
  try {
    return res.json({ configured: senders.length > 0, senders, sms, verified: await smtpPool().verifyAll() });
  } catch (error) {
    // The message only. A thrown SMTP error can carry the credentials it tried.
    return res.status(500).json({ configured: senders.length > 0, senders, sms, verified: null, message: error.message });
  }
});

// The Release Information dialog: the version this server runs and the lead-in of every entry in
// the changelog's current section. Signed-in only - what changed is the workspace's business, not
// the internet's - and any signed-in role may read it, so `protect` alone is the guard.
app.get("/api/release", protect, (req, res) => {
  res.json({
    version: appVersion.version,
    commit: appVersion.commit,
    deployedAt: appVersion.deployedAt,
    section: releaseNotes.section,
    notes: releaseNotes.notes,
  });
});

app.get("/api/sales/google-oauth/callback", googleOAuthCallback);
app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);
// The top bar's bell, on its own prefix rather than under a module: it carries the stored task
// notices and the ones derived from every other module the reader may see, and it is gated per
// source in its own controller rather than by a module here - see the router.
app.use("/api/notifications", notificationRoutes);
// The wording of the messages the studio sends, written in Settings and read by whoever sends them.
app.use("/api/settings/message-templates", messageTemplateRoutes);
/*
 * The studio's declared holidays, written in Settings.
 *
 * The list itself is read by the attendance rules and by the studio calendar, each straight from
 * the table through its own module — this mount is only the screen that writes them, and answers
 * for ADMIN / System Settings accordingly.
 */
app.use("/api/settings/holidays", settingsHolidayRoutes);
// Ahead of the admin router, which owns the rest of /api/admin: the branch register answers for
// ADMIN / System Settings, while everything under the router below answers for User Management or
// Role Management, so it must be matched before the looser mount is reached.
app.use("/api/admin/branches", adminBranchRoutes);
app.use("/api/admin", adminRoutes);
// Ahead of the master data router, which owns the rest of /api/hrm, so a request for the payment
// requests can never be read as a master data resource of that name.
app.use("/api/hrm/payment-requests", hrmPaymentRequestRoutes);
// Ahead of the master-data router, which owns everything else under /hrm. That router lets any
// signed-in session through on GET so its reference lists can fill pickers app-wide; the chart is
// guarded on Employee Management instead, so it must be matched before the looser mount is reached.
app.use("/api/hrm/org-chart", hrmOrgChartRoutes);
// Ahead of the master-data router for the same reason as the two above: attendance is guarded on
// Employee Attendance, and the looser mount would let a signed-in session read its GETs unguarded.
app.use("/api/hrm/attendance", hrmAttendanceRoutes);
// Ahead of the master-data router for the same reason as the two above: it owns everything
// else under /hrm, and referral money is guarded by Accounts rather than by HR.
app.use("/api/hrm/referrals", hrmReferralRoutes);
// Above the master data router, which is mounted on the bare /api/hrm prefix.
app.use("/api/hrm/tasks", hrmTaskRoutes);
// The Interview module, ahead of the master data router for the same reason as the rest: it is
// guarded on HRM / Interview, and the looser mount would let a signed-in session read its GETs.
// The two integration routers sit above the module's own so their prefixes are matched first.
app.use("/api/hrm/interview/google-sheet-links", hrmInterviewSheetLinkRoutes);
app.use("/api/hrm/interview/google-oauth", hrmInterviewGoogleOAuthRoutes);
app.use("/api/hrm/interview/invites", hrmInterviewInviteRoutes);
app.use("/api/hrm/interview", hrmInterviewRoutes);
app.use("/api/hrm", hrmMasterDataRoutes);
app.use("/api/onboarding", onboardingInvitePublicRoutes);
app.use("/api/subscribe/client-onboarding", clientOnboardingRoutes);
app.use("/api/client-onboarding", clientOnboardingPublicRoutes);
// A client's own server (Velava, ...) reading its subscription: answered by site key, rate-limited, never cached.
app.use("/api/client-site", clientSiteRoutes);
// The public application form a candidate fills in from the link the Interview screen sent them:
// answered by token, rate-limited and never cached, the way the onboarding form above is.
app.use("/api/interview", interviewApplicationPublicRoutes);
app.use("/api/public/image-selection/galleries", publicImageSelectionGalleryRoutes);
app.get("/api/public/studio-branding", publicStudioBranding);
app.use("/api/public/album-proofs", publicAlbumProofRoutes);
// The AI Feature's guest link: no JWT, the link's code names the event, rate limited at the router.
app.use("/api/public/ai-feature", aiFeaturePublicRoutes);
app.use("/api/public/quotations", salesQuotationPublicRoutes);
app.use("/api/public/crd-documents", salesCrdDocumentPublicRoutes);
/*
 * Ahead of every /api/sales router, and it has to stay there.
 *
 * `salesProjectRoutes` is mounted on the bare /api/sales prefix and applies `protect` to
 * everything that enters it - route matching happens after that, so a path it does not serve is
 * still refused by it. The Callyzer webhook lives under that prefix, which meant the one endpoint
 * written to be called without a login answered 401 to Callyzer and could never deliver a call
 * log. It is unauthenticated by design and carries its own shared secret instead, checked in the
 * handler.
 */
app.use("/api/sales/crm-leads", salesCrmLeadPublicRoutes);
app.use("/api/sales", salesProjectRoutes);
app.use("/api/sales", salesProjectAttachmentRoutes);
// Ahead of the bare /api/sales router for the same reason the webhook is: that router applies its
// own guard to everything entering the prefix.
app.use("/api/sales/callyzer", salesCallyzerApiRoutes);
// Ahead of the bare /api/sales router, which guards everything entering that prefix.
app.use("/api/sales/crm-ai", salesCrmAiRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/sales/whatsapp-group-names", salesWhatsappGroupNameRoutes);
app.use("/api/sales/google-sheet-links", salesGoogleSheetLinkRoutes);
app.use("/api/sales/google-oauth", salesGoogleOAuthRoutes);
app.use("/api/sales/crm-leads", salesCrmLeadRoutes);
// The CRM's Reports page. Its own prefix rather than a branch of crm-leads, so a report is never
// mistaken for a lead id by the ":id" routes there.
app.use("/api/sales/crm-reports", salesCrmReportRoutes);
app.use("/api/contacts", contactDirectoryRoutes);
app.use("/api/schedule", scheduleCalendarRoutes);
// Mounted ahead of the heartbeat router so `/settings` is not read as a heartbeat path.
app.use("/api/usage/settings", usageSettingsRoutes);
app.use("/api/usage", usageHeartbeatRoutes);
app.use("/api/sales/whatsapp-chat", salesWhatsappChatRoutes);
app.use("/api/sales/crm-meetings", salesCrmMeetingRoutes);
app.use("/api/sales/quotation-calculator", salesQuotationCalculatorRoutes);
app.use("/api/sales/quotation-settings", salesQuotationSettingsRoutes);
app.use("/api/sales/quotation-brands", salesQuotationBrandRoutes);
app.use("/api/sales/crd-documents", salesCrdDocumentRoutes);
app.use("/api/project-management/client-gifts", clientGiftsRoutes);
app.use("/api/sales/crd-terms-settings", salesCrdTermsSettingsRoutes);
app.use("/api/sales/extra-quotations", salesExtraQuotationRoutes);
app.use("/api/assets", assetRoutes);
app.use("/api/asset-categories", assetCategoryRoutes);
app.use("/api/vendors", vendorRoutes);
app.use("/api/client-storage", clientStorageRoutes);
app.use("/api/asset-requests", assetRequestRoutes);
app.use("/api/accounts/cash-entries", accountsCashEntryRoutes);
// Ahead of the project router, which owns everything under /projects — studio-wide settings are
// not a project, so they must not fall through to a router that expects a project id.
// The AI Feature, under its own prefix so nothing here can be read as an Image Selection project.
// Defaults are mounted first: they are studio-wide, not an event's, and answer to their own permission.
app.use("/api/ai-feature/default-settings", aiFeatureDefaultSettingsRoutes);
app.use("/api/ai-feature", aiFeatureRoutes);
app.use("/api/image-selection/settings", imageSelectionSettingsRoutes);
// The dashboard is the module's summary, not a project's, so it too sits ahead of the project router.
app.use("/api/image-selection/dashboard", imageSelectionDashboardRoutes);
// The coordinator's own WhatsApp link and the match-every-project pass, under this module's guard.
app.use("/api/image-selection/whatsapp", imageSelectionWhatsappSessionRoutes);
// Named storage roots — studio-wide, not a project's — so this mount sits ahead of the project
// router for the same reason the settings one does.
app.use("/api/image-selection/storage-roots", imageSelectionStorageRootRoutes);
// Browsing the Original Storage Path happens before a project is chosen, so this mount comes ahead
// of the project router for the same reason the settings one does.
app.use("/api/image-selection/originals", imageSelectionOriginalsRoutes);
// Album Proofing lists albums across projects, so it is module-level, not project-scoped — and
// mounted ahead of the project router so "album-proofs" is never read as a project id.
app.use("/api/image-selection/album-proofs", imageSelectionAlbumProofRoutes);
app.use("/api/image-selection", imageSelectionProjectRoutes);
app.use("/api/image-selection/projects/:projectId/deliverables", imageSelectionDeliverableRoutes);
app.use("/api/image-selection/projects/:projectId/publish-share", imageSelectionPublishShareRoutes);
app.use("/api/image-selection/projects/:projectId/whatsapp", imageSelectionWhatsappRoutes);
app.use("/api/image-selection/projects/:projectId/folders", imageSelectionFolderRoutes);
if (imageSelectionUploadRoutes) app.use("/api/image-selection/projects/:projectId/uploads", imageSelectionUploadRoutes);
app.use("/api/image-selection/projects/:projectId/originals", imageSelectionOriginalsRoutes);
app.use("/api/image-selection/projects/:projectId/gallery", imageSelectionGalleryRoutes);
app.use("/api/image-selection/projects/:projectId/faces", imageSelectionFaceRoutes);
app.use("/api/image-selection/projects/:projectId/publication", imageSelectionPublicationRoutes);

// 404 fallback for any unmatched route — keeps responses JSON instead of Express's default HTML page.
// Every router must be mounted above this, or its paths fall into the 404 instead of reaching it.
app.use((req, res) => {
  res.status(404).json({ message: "Not found" });
});

// Global error handler — must be registered LAST and must have 4 args (err, req, res, next)
// Without this, any unhandled error (e.g. multer failures, thrown errors in sync middleware)
// falls through to Express's default handler, which sends an HTML page and breaks the frontend's
// JSON.parse(xhr.responseText) calls.
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ message: err.message || "Internal server error" });
});

const PORT = process.env.PORT || 5001;

/**
 * Whether a failure came out of the WhatsApp client.
 *
 * Baileys reports its own trouble - `408 Timed Out`, `unexpected error in "init queries"` - by
 * rejecting a promise inside its own code that nothing here awaits. Since Node 15 an unhandled
 * rejection ends the process, so a phone that did not answer in time was taking the CRM, the logins,
 * the password resets and the image queue down with it.
 */
function isWhatsAppFailure(error) {
  const stack = String(error?.stack || error?.message || error || "");
  return /baileys|whiskeysockets|whatsapp/i.test(stack);
}

/**
 * Keeps one module's failure inside that module.
 *
 * A rejection nobody handled is logged rather than fatal. That is a deliberate trade: the alternative
 * is a backend that any WhatsApp timeout can stop, and of the two, a logged error on a running server
 * is far the better failure. It is logged in full, so nothing is being hidden - only survived.
 *
 * An uncaught *exception* is treated less generously. Those can leave arbitrary state broken, so only
 * the ones that came out of the WhatsApp client are survived; anything else is left to end the
 * process, which is what an unknown broken state deserves.
 */
function installProcessGuards() {
  process.on("unhandledRejection", (reason) => {
    const where = isWhatsAppFailure(reason) ? "[whatsapp]" : "[unhandled]";
    console.error(`${where} Unhandled promise rejection - the server is still running:`, reason);
  });

  process.on("uncaughtException", (error) => {
    if (isWhatsAppFailure(error)) {
      console.error("[whatsapp] Uncaught error from the WhatsApp client - the server is still running:", error);
      return;
    }
    console.error("[fatal] Uncaught exception outside WhatsApp - shutting down:", error);
    process.exit(1);
  });

  /*
   * Let go of the WhatsApp sockets before the process dies.
   *
   * nodemon starts the replacement before this one has finished exiting, and two processes holding
   * one set of credentials is what WhatsApp answers with `440 replaced`. Ending them here means the
   * old process has let go before the new one asks.
   */
  for (const signal of ["SIGINT", "SIGTERM", "SIGUSR2"]) {
    process.once(signal, () => {
      // Chromium is a process of its own: left running, a restarted server leaves one behind every
      // time, and on a nodemon day that is a browser per save.
      void require("./services/quotationPdfService").closeQuotationPdfBrowser().catch(() => {});
      void shutdownWhatsAppSessions()
        .catch((error) => console.warn("[whatsapp] Unable to close sessions cleanly:", error.message))
        .finally(() => {
          // `SIGUSR2` is nodemon's restart signal: re-raise it so nodemon's own handler still runs.
          if (signal === "SIGUSR2") process.kill(process.pid, "SIGUSR2");
          else process.exit(0);
        });
    });
  }
}

async function bootstrap() {
  installProcessGuards();
  try {
    await migrateCrmLeadLegacyColumns();
  } catch (error) {
    console.error("Unable to bootstrap CRM lead columns:", error);
  }

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    for (const request of missingModules) {
      console.warn(`WARNING: ${request} is missing from the repository, so its routes are not mounted. Requests to them will 404 until the files are restored.`);
    }
    startCrmAutoSync();
    startInterviewSheetAutoSync();
    // Client Details / SUBSCRIBE: every live client's site checked every 5 minutes.
    require("./modules/subscribe/client-onboarding/siteHealth").startSiteHealthMonitor();

    /*
     * Proposals nobody acted on, tidied every ten minutes.
     *
     * Hygiene rather than correctness - an expired plan is already refused by its `expiresAt`, so
     * nothing depends on this running. What it does is drop the arguments, which are the part that
     * is business data, from proposals that were never confirmed.
     */
    const planSweep = setInterval(() => { void sweepExpired(); }, 10 * 60 * 1000);
    // Do not hold the event loop open purely for the sweeper.
    if (typeof planSweep.unref === "function") planSweep.unref();

    /*
     * Chromium, started before the first quotation is downloaded.
     *
     * The same idea as warming the model below: launching it costs about a second, and paying that
     * in the first download after a deploy puts the wait in front of somebody sending a client a
     * price. One browser serves the whole process and each render is a page against it, so this is
     * paid once at boot where nobody is watching.
     *
     * Never awaited and never fatal: a host without a usable Chromium must still serve every other
     * route, and the first download will simply try again and report properly if it cannot.
     */
    require("./services/quotationPdfService").warmQuotationPdfBrowser()
      .catch((error) => console.warn("Unable to start the PDF browser:", error.message));
    /*
     * Load Nebula's model before anyone asks a question.
     *
     * The first question after a quiet spell took over a minute, and none of that was the model
     * thinking - it was Ollama loading it. Warm here and `keep_alive` holds it, so the wait lands at
     * boot where nobody is watching. Never awaited: a studio with no Ollama must still get a working
     * CRM.
     *
     * One model now. There used to be a second for Tanglish, and holding both was what made memory
     * tight enough for one to be evicted - after which the next question in that language waited 47
     * seconds for a reload.
     */
    const { providerName } = require("./services/ai/provider");
    if (providerName() === "ollama") {
      const { config, warm, keepWarm } = require("./services/ai/ollamaClient");
      const { SYSTEM } = require("./services/ai/crmAssistant");
      const models = [config().model];
      // The same system prompt the CRM sends, so the cached prefix is the one that gets reused.
      warm(models, SYSTEM)
        .catch((error) => console.warn("Unable to warm the AI model:", error.message));
      // And keep it there: `keep_alive` holds it for an hour, and a touch every few minutes renews
      // that in the background rather than making somebody wait for a reload.
      if (process.env.OLLAMA_KEEP_WARM !== "false") keepWarm(models, SYSTEM);
    }
    // The credentials outlive the process; the socket does not. Without this a restart left every
    // CRM reading "not connected" while their phone still listed the device.
    //
    // Deliberately not awaited, and its failures are warnings: WhatsApp is one module, and a studio
    // whose phone is unreachable still needs the CRM, the logins and the password resets.
    restoreWhatsAppSessions()
      .then((count) => { if (count) console.log(`Reconnected ${count} WhatsApp session${count === 1 ? "" : "s"}.`); })
      .catch((error) => console.warn("Unable to reconnect WhatsApp sessions:", error.message));
    if (process.env.IMAGE_PROCESSING_EMBEDDED_WORKER !== "false") startWorker();
    if (process.env.WHATSAPP_EMBEDDED_WORKER !== "false") startWhatsAppWorker();
    // The AI Feature's media worker rides in this process too unless a machine runs `npm run
    // worker:ai-events` on its own and says so. The face engine is probed at boot, never awaited.
    if (process.env.AI_FEATURE_EMBEDDED_WORKER !== "false") {
      startAiFeatureWorker();
      aiFeatureQueue.recoverPending().then((count) => { if (count) console.log(`Recovered ${count} pending AI event media jobs.`); }).catch((error) => console.error("Unable to recover pending AI event media jobs:", error));
    }
    // The client gallery's face worker: starts only when the face engine is switched on (faces/config.js),
    // and rides in this process unless IMAGE_SELECTION_FACE_EMBEDDED_WORKER=false (`npm run worker:faces`).
    if (process.env.IMAGE_SELECTION_FACE_EMBEDDED_WORKER !== "false" && startImageSelectionFaceWorker()) {
      imageSelectionFaceQueue.recoverPending().then((count) => { if (count) console.log(`Recovered ${count} pending face scans.`); }).catch((error) => console.error("Unable to recover pending face scans:", error));
    }
    // Off unless asked for: it runs faster-whisper, which needs Python and the model downloaded.
    // A server without those should not be starting a worker that can only fail.
    if (process.env.CALL_TRANSCRIPTION_ENABLED === "true") {
      /*
       * Say at boot whether transcription can actually run.
       *
       * Without this a studio discovers it cannot by making a call, waiting for the upload, and
       * reading an error against a recording they cannot get back. The check is one spawn and its
       * result is in the same log everything else here writes to.
       */
      require("./modules/sales/call-transcripts/transcriber").checkTranscriptionReady();
      startTranscriptionWorker();
    }
    imageProcessingQueue.recoverPending().then((count) => { if (count) console.log(`Recovered ${count} pending image jobs.`); }).catch((error) => console.error("Unable to recover pending image jobs:", error));
  });
}

void bootstrap();
