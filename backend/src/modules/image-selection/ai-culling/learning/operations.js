/**
 * Registry operations (phases 8 to 10) behind the culling:register and culling:promote scripts.
 * Nothing here runs from the app: a model reaches photographers only through a named person
 * running these, and never silently.
 *
 * Status moves: CANDIDATE -> SHADOW -> CANARY -> PRODUCTION, any -> RETIRED. Into CANARY and
 * PRODUCTION only when the shadow report passes the promotion rules (or with an override reason,
 * recorded), and never for a model trained on synthetic data. One CANARY and one PRODUCTION at a
 * time: promoting retires the holder (noted "was PRODUCTION", so it can be rolled back to).
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { FEATURE_SET_VERSION } = require("./featureSet");
const { ENGINE_VERSION } = require("../constants");

const NAME = /^[a-z0-9][a-z0-9-]{0,79}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const MOVES = Object.freeze({
  CANDIDATE: ["SHADOW", "RETIRED"],
  SHADOW: ["CANARY", "RETIRED"],
  CANARY: ["PRODUCTION", "SHADOW", "RETIRED"],
  PRODUCTION: ["RETIRED"],
  RETIRED: [],
});
const GATED = new Set(["CANARY", "PRODUCTION"]);

class OperationError extends Error {}

const parseRef = (ref) => {
  const match = /^([a-z0-9-]+)@(\d+\.\d+\.\d+)$/.exec(String(ref || ""));
  if (!match) throw new OperationError("Name the model as name@version, e.g. culling-ranker@1.0.0.");
  return { name: match[1], version: match[2] };
};
const isSynthetic = (model) => /\bSYNTHETIC\b/.test(model.notes || "");
const note = (model, line) => [model.notes, line].filter(Boolean).join("\n");

/** Copies a trained bundle into the model directory and registers it as a CANDIDATE. */
async function registerBundle({ client, bundleDir, modelDir, allowSynthetic = false }) {
  const bundlePath = path.join(bundleDir, "bundle.json");
  const metricsPath = path.join(bundleDir, "metrics.json");
  if (!fs.existsSync(bundlePath) || !fs.existsSync(metricsPath)) throw new OperationError(`${bundleDir} needs bundle.json and metrics.json (the trainer's output).`);
  const bytes = fs.readFileSync(bundlePath);
  const bundle = JSON.parse(bytes.toString("utf8"));
  const metrics = JSON.parse(fs.readFileSync(metricsPath, "utf8"));
  if (!NAME.test(bundle.name || "") || !VERSION.test(bundle.version || "")) throw new OperationError("The bundle's name or version is not valid.");
  if (bundle.featureSetVersion !== FEATURE_SET_VERSION) throw new OperationError(`The bundle was trained on ${bundle.featureSetVersion}; this server computes ${FEATURE_SET_VERSION}.`);
  if (metrics.synthetic && !allowSynthetic) throw new OperationError("This bundle was trained on synthetic data. Register it only for a shadow trial, with --allow-synthetic.");
  const existing = await client.imageSelectionCullingModel.findFirst({ where: { name: bundle.name, version: bundle.version } });
  if (existing) throw new OperationError(`${bundle.name}@${bundle.version} is already registered; models are immutable. Train a new version.`);
  const relative = path.join(bundle.name, bundle.version, "bundle.json");
  const target = path.join(modelDir, relative);
  if (fs.existsSync(target)) throw new OperationError(`${target} already exists.`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
  fs.copyFileSync(metricsPath, path.join(path.dirname(target), "metrics.json"));
  return client.imageSelectionCullingModel.create({
    data: {
      name: bundle.name, version: bundle.version, datasetVersion: bundle.datasetVersion || "unknown", featureSetVersion: bundle.featureSetVersion,
      engineVersion: ENGINE_VERSION, artifactPath: relative.split(path.sep).join("/"), artifactSha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      artifactBytes: bytes.length, metrics, hyperparameters: bundle.hyperparameters || null, status: "CANDIDATE",
      notes: metrics.synthetic ? "SYNTHETIC: trained on generated data; may never pass SHADOW." : null,
    },
  });
}

/**
 * Moves a model. `report(modelId)` returns the shadow report (shadowReport.js); `override` is the
 * written reason for going ahead without a passing one; `rollback` lets a RETIRED former
 * production model return to PRODUCTION.
 */
async function promoteModel({ client, ref, to, by, override = null, rollback = false, report, now = () => new Date() }) {
  const { name, version } = parseRef(ref);
  const login = String(by || "").trim();
  if (!login) throw new OperationError("Say who approves this (--by <their login username>).");
  const approver = await client.user.findFirst({ where: { username: login }, select: { id: true, name: true, username: true } });
  if (!approver) throw new OperationError(`No user signs in as ${login}; name the approver by their login username.`);
  const model = await client.imageSelectionCullingModel.findFirst({ where: { name, version } });
  if (!model) throw new OperationError(`${ref} is not registered.`);
  const rollingBack = rollback && model.status === "RETIRED" && to === "PRODUCTION";
  if (rollingBack && !/was PRODUCTION/.test(model.notes || "")) throw new OperationError(`${ref} was never in production; it cannot be rolled back to.`);
  if (!rollingBack && !(MOVES[model.status] || []).includes(to)) throw new OperationError(`${ref} is ${model.status}; it can move to ${(MOVES[model.status] || []).join(", ") || "nothing"}.`);
  if (GATED.has(to) && isSynthetic(model)) throw new OperationError(`${ref} was trained on synthetic data and may never pass SHADOW.`);
  let gate = null;
  if (GATED.has(to) && !rollingBack) {
    gate = await report(model.id);
    if (!gate.promotable && !String(override || "").trim()) throw new OperationError(`The shadow report does not pass: ${gate.reasons.join("; ")}. Fix that, or pass --override "<reason>".`);
  }
  const stamp = now();
  const line = `${stamp.toISOString()}: ${model.status} -> ${to} by ${approver.name} (${approver.username})${override ? ` (override: ${override})` : ""}${rollingBack ? " (rollback)" : ""}`;
  return client.$transaction(async (tx) => {
    const retired = [];
    if (GATED.has(to)) {
      for (const holder of await tx.imageSelectionCullingModel.findMany({ where: { status: to, NOT: { id: model.id } } })) {
        await tx.imageSelectionCullingModel.update({ where: { id: holder.id }, data: { status: "RETIRED", notes: note(holder, `${stamp.toISOString()}: superseded by ${ref}; was ${holder.status}`) } });
        retired.push(`${holder.name}@${holder.version}`);
      }
    }
    const updated = await tx.imageSelectionCullingModel.update({ where: { id: model.id }, data: { status: to, promotedByUserId: approver.id, promotedAt: stamp, notes: note(model, line) } });
    return { model: updated, retired, gate };
  });
}

module.exports = { registerBundle, promoteModel, parseRef, OperationError, MOVES };
