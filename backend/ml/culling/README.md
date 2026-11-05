# Culling learning: training and operations

The trainer for the AI Photo Culling **learned ranker**. Its output is a bundle (LightGBM trees as
JSON, thresholds, photographer offsets), which the server evaluates in plain JS
([learning/](../../src/modules/image-selection/ai-culling/learning/)). No Python runs inside the API.

Nothing here changes a culling run until a model has been trained on real data, registered, passed
its shadow trial, been promoted by a named person, **and** the server has been switched on. Every
switch is off by default, and a run is decided by the fixed formula exactly as before.

## One intelligence, two environments

The web and the desktop app are two places the same culling intelligence runs, not two AIs.

- **Web runs:** the signals are computed on the server, from the compressed upload.
- **Desktop local-analysis runs:** the signals are computed on the workstation and posted to the
  same signal contract (`POST /sessions/:id/signals`). Originals are still never uploaded.

Either way the ranking, the learned model, the decision code, the event log, the dataset and the
promotion gate are the server's, once. Every example carries two tags:

- `reviewPlatform`: `WEB` or `DESKTOP`, where the photographer reviewed;
- `inferenceLocation`: `SERVER` or `DESKTOP`, where the signals came from.

Both are metadata only. Neither is a feature, and neither changes a label's weight. The
evaluation slices on both. The trainer's verdict refuses a candidate that drops on either slice
(0.02 agreement, at 2000+ photos). The shadow report judges server-analyzed and desktop-analyzed
runs apart once either has 30 runs: agreement may not fall, and false rejects may not rise, on
either.

## Setup (once, on the machine that trains)

```bash
cd backend
python -m venv .venv-ml            # git-ignored
.venv-ml/Scripts/pip install -r ml/culling/requirements.txt     # Windows; bin/pip elsewhere
(cd ml/culling && ../../.venv-ml/Scripts/python -m unittest discover -s tests)   # 8 tests
```

`AI_CULLING_TRAINING_HMAC_KEY` must be set (`openssl rand -hex 32`) before any export. Rotating it
resets every photographer's personalization. See `backend/.env.example` for the other variables.

## The loop

| Step | Command | What it does |
| --- | --- | --- |
| Consent | ⋮ → Settings → AI Culling Training | The studio opts in; who did it, and when, is recorded. Without it the export refuses. |
| Export | `npm run culling:export -- [--version dataset_<date>]` | Writes the finalized runs older than 14 days as a pseudonymous, checksummed dataset (examples, burst groups, pairs, manifest) under `AI_CULLING_TRAINING_DIR`. No photo, path, name or real id. Dates are kept only to the month. |
| Train | `npm run culling:train -- --dataset <version> --version x.y.z` | Global model, burst LambdaRank model (30+ groups), photographer offsets (20+ explicit decisions), thresholds fitted so false rejects are never higher than the formula's, and the evaluation with its verdict. Deterministic for a seed. |
| Register | `npm run culling:register -- --dir <bundle>` | Copies the bundle into `AI_CULLING_MODEL_DIR`, checksums it, and records it as a CANDIDATE. A synthetic bundle is refused (or registered with `--allow-synthetic`, and then may never pass SHADOW). |
| Shadow | `npm run culling:promote -- --model culling-ranker@x.y.z --to SHADOW --by <login>` and `AI_CULLING_SHADOW_ENABLED=true` | The model scores every new run into its own table. It is never shown and never used to decide. |
| Report | `npm run culling:shadow-report -- --model culling-ranker@x.y.z` | The gate: 200+ finalized runs and 10+ photographers, agreement gain of +0.02 with a bootstrap interval above 0, no rise in false rejects, and burst top-1 +0.03 once 30+ groups exist. |
| Canary, then production | `--to CANARY`, then `--to PRODUCTION`, both `--by <login>`, and `AI_CULLING_LEARNED_RANKER=true` | Refused unless the report passes, or with a written `--override "<reason>"`. One CANARY and one PRODUCTION at a time. Canary decides `AI_CULLING_CANARY_PERCENT` of runs. |
| Roll back | `--to RETIRED`, or `--to PRODUCTION --rollback` on the previous model | Takes effect within a minute. Runs already decided keep their decisions. |
| Retention | `npm run culling:retention` | Deletes datasets older than `AI_CULLING_TRAINING_RETENTION_DAYS` (365). |

`npm run culling:pipeline -- --version x.y.z` runs export, train and register in one go. It never
promotes. A suggested schedule on the server: the pipeline monthly, retention weekly. Promotion is
always by hand.

## What has been proven, and what has not

- The pipeline, parity and the gates have been proven on **synthetic** data
  (`python -m culling_ml.synth`). On synthetic data the trainer beats the formula. That says the
  code works, not that a real model will.
- No real model exists yet. The gates above are what will say whether one is good enough, and they
  cannot pass until enough finalized culls exist with consent on.
