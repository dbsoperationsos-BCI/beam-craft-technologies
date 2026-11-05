/**
 * The studio's side of the culling learning layer: its training consent, and a read-only view of
 * the model registry. Consent lives on the one Image Selection settings row; the training export
 * refuses without it. Models are promoted only by the promotion script, never from here.
 */
const prisma = require("../../../config/db");

const CONSENT_SELECT = { cullingTrainingConsent: true, cullingTrainingConsentAt: true, cullingTrainingConsentByUser: { select: { name: true } } };
const shape = (row) => ({ consent: Boolean(row?.cullingTrainingConsent), consentAt: row?.cullingTrainingConsentAt ?? null, consentBy: row?.cullingTrainingConsentByUser?.name ?? null });

function createCullingLearningService(client = prisma, { now = () => new Date() } = {}) {
  return {
    async consent() {
      return shape(await client.imageSelectionSettings.findUnique({ where: { id: "default" }, select: CONSENT_SELECT }));
    },
    /** Saves the answer and who gave it; the same answer again leaves the record as it was. */
    async setConsent(consent, userId = null) {
      const current = await client.imageSelectionSettings.findUnique({ where: { id: "default" }, select: CONSENT_SELECT });
      if (current && Boolean(current.cullingTrainingConsent) === consent) return shape(current);
      const data = { cullingTrainingConsent: consent, cullingTrainingConsentAt: now(), cullingTrainingConsentByUserId: userId };
      return shape(await client.imageSelectionSettings.upsert({ where: { id: "default" }, update: data, create: { id: "default", ...data }, select: CONSENT_SELECT }));
    },
    /** Registered models, newest first, with their status and headline metrics. Never the artifact path. */
    async models() {
      const rows = await client.imageSelectionCullingModel.findMany({ orderBy: { createdAt: "desc" }, take: 50, select: { id: true, name: true, version: true, status: true, datasetVersion: true, featureSetVersion: true, metrics: true, promotedAt: true, promotedByUser: { select: { name: true } }, createdAt: true } });
      return rows.map(({ metrics, promotedByUser, ...row }) => ({ ...row, promotedBy: promotedByUser?.name ?? null, headline: metrics?.headline ?? null }));
    },
  };
}

module.exports = createCullingLearningService();
module.exports.createCullingLearningService = createCullingLearningService;
