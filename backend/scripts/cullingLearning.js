/**
 * The culling learning layer's operator commands (one file, one sub-command each). Nothing here is
 * scheduled by the app; run them by hand or from cron / Task Scheduler on the server.
 *
 *   npm run culling:export -- [--version dataset_2026-10-07] [--min-age-days 14]
 *   npm run culling:train -- --dataset <datasetVersion> --version 1.0.0 [--seed 7]
 *   npm run culling:register -- --dir <trained bundle dir> [--allow-synthetic]
 *   npm run culling:shadow-report -- --model culling-ranker@1.0.0
 *   npm run culling:promote -- --model culling-ranker@1.0.0 --to SHADOW|CANARY|PRODUCTION|RETIRED --by <login username> [--override "reason"] [--rollback]
 *   npm run culling:retention
 *   npm run culling:pipeline -- --version 1.1.0     (export, train, register as CANDIDATE; never promotes)
 *
 * Environment: AI_CULLING_TRAINING_DIR (datasets and trained bundles; default ~/.dbs-culling-training),
 * AI_CULLING_MODEL_DIR (registered bundles the server loads; default ~/.dbs-culling-models),
 * AI_CULLING_TRAINING_HMAC_KEY (32+ characters, required to export), AI_CULLING_EXPORT_MIN_AGE_DAYS
 * (14), AI_CULLING_TRAINING_RETENTION_DAYS (365), CULLING_ML_PYTHON (the training interpreter;
 * default backend/.venv-ml).
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env"), quiet: true });
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const args = process.argv.slice(3);
const option = (name, fallback = null) => { const at = args.indexOf(`--${name}`); return at >= 0 && args[at + 1] && !args[at + 1].startsWith("--") ? args[at + 1] : fallback; };
const flag = (name) => args.includes(`--${name}`);
const trainingDir = () => path.resolve(process.env.AI_CULLING_TRAINING_DIR || path.join(os.homedir(), ".dbs-culling-training"));
const datasetsDir = () => path.join(trainingDir(), "datasets");
const bundlesDir = () => path.join(trainingDir(), "bundles");
const today = () => new Date().toISOString().slice(0, 10);

async function withClient(work) {
  const prisma = require("../src/config/db");
  try { return await work(prisma); } finally { await prisma.$disconnect(); }
}

async function exportDataset() {
  const { createExporter } = require("../src/modules/image-selection/ai-culling/learning/exporter");
  const { trainingKey } = require("../src/modules/image-selection/ai-culling/learning/pseudonym");
  const version = option("version", `dataset_${today()}`);
  const minAgeDays = Number(option("min-age-days", process.env.AI_CULLING_EXPORT_MIN_AGE_DAYS ?? 14));
  const manifest = await withClient((client) => createExporter({ client }).exportDataset({ outDir: datasetsDir(), datasetVersion: version, minAgeDays, key: trainingKey() }));
  console.log(JSON.stringify({ dataset: path.join(datasetsDir(), version), counts: manifest.counts, labels: manifest.labels, dropped: manifest.dropped }, null, 2));
  return version;
}

function python() {
  const fallback = path.join(__dirname, "..", ".venv-ml", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const interpreter = process.env.CULLING_ML_PYTHON || fallback;
  if (!fs.existsSync(interpreter)) throw new Error(`No training interpreter at ${interpreter}. Create it: python -m venv backend/.venv-ml, then install backend/ml/culling/requirements.txt into it.`);
  return interpreter;
}

function train(dataset = option("dataset"), version = option("version")) {
  if (!dataset || !version) throw new Error("--dataset <datasetVersion> and --version <x.y.z> are required.");
  // The same names the exporter and the registry accept, so neither can point outside their folders.
  if (!/^[A-Za-z0-9_.-]{1,80}$/.test(dataset) || dataset.includes("..")) throw new Error("--dataset is a dataset version name, not a path.");
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("--version is x.y.z.");
  const out = spawnSync(python(), ["-m", "culling_ml.train", "--dataset", path.join(datasetsDir(), dataset), "--out", bundlesDir(), "--version", version, "--seed", option("seed", "7")], { cwd: path.join(__dirname, "..", "ml", "culling"), encoding: "utf8" });
  process.stdout.write(out.stdout || "");
  if (out.status !== 0) throw new Error(out.stderr || "Training failed.");
  return path.join(bundlesDir(), "culling-ranker", version);
}

async function register(dir = option("dir")) {
  const { registerBundle } = require("../src/modules/image-selection/ai-culling/learning/operations");
  const { modelDir } = require("../src/modules/image-selection/ai-culling/learning/registry");
  if (!dir) throw new Error("--dir <trained bundle dir> is required.");
  const model = await withClient((client) => registerBundle({ client, bundleDir: path.resolve(dir), modelDir: modelDir(), allowSynthetic: flag("allow-synthetic") }));
  console.log(`Registered ${model.name}@${model.version} as ${model.status}.${model.notes ? ` ${model.notes}` : ""}`);
}

async function report() {
  const { parseRef } = require("../src/modules/image-selection/ai-culling/learning/operations");
  const { shadowReport } = require("../src/modules/image-selection/ai-culling/learning/shadowReport");
  const { name, version } = parseRef(option("model"));
  await withClient(async (client) => {
    const model = await client.imageSelectionCullingModel.findFirst({ where: { name, version } });
    if (!model) throw new Error(`${name}@${version} is not registered.`);
    console.log(JSON.stringify(await shadowReport(client, model.id), null, 2));
  });
}

async function promote() {
  const { promoteModel } = require("../src/modules/image-selection/ai-culling/learning/operations");
  const { shadowReport } = require("../src/modules/image-selection/ai-culling/learning/shadowReport");
  await withClient(async (client) => {
    const { model, retired } = await promoteModel({ client, ref: option("model"), to: option("to"), by: option("by"), override: option("override"), rollback: flag("rollback"), report: (id) => shadowReport(client, id) });
    console.log(`${model.name}@${model.version} is now ${model.status}.${retired.length ? ` Retired: ${retired.join(", ")}.` : ""} The server picks it up within a minute.`);
  });
}

function retention() {
  const { pruneDatasets } = require("../src/modules/image-selection/ai-culling/learning/exporter");
  const removed = pruneDatasets(datasetsDir(), Number(process.env.AI_CULLING_TRAINING_RETENTION_DAYS ?? 365));
  console.log(removed.length ? `Removed ${removed.join(", ")}.` : "Nothing older than the retention window.");
}

async function pipeline() {
  const version = option("version");
  if (!version) throw new Error("--version <x.y.z> is required (the new model's version).");
  const dataset = await exportDataset();
  const dir = train(dataset, version);
  await register(dir);
  console.log("Registered as CANDIDATE. Read metrics.json, then promote to SHADOW by hand when it should start its shadow trial.");
}

const commands = { export: exportDataset, train, register, "shadow-report": report, promote, retention, pipeline };
const command = commands[process.argv[2]];
if (!command) {
  console.error(`Usage: node scripts/cullingLearning.js <${Object.keys(commands).join("|")}> [options]`);
  process.exit(2);
}
Promise.resolve().then(() => command()).catch((error) => { console.error(error.message); process.exitCode = 1; });
