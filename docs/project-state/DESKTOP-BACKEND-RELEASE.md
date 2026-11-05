# Desktop backend release — what production needs for Virtual Curation Desktop

Audit date 2026-10-02. Production (`api-operations.dontblinkstudioz.com`) runs `main`
(`6761219b`). Every desktop route answers 404 there; `/api/auth/*`, `/api/ai-feature/*` and
`/api/image-selection/*` answer as expected. Nothing in this document has been deployed.

## 1. What the desktop calls that production does not have

| Route (all under `/api`) | Purpose | On `main`? |
| --- | --- | --- |
| `GET /desktop/capabilities` | which extras the server offers (`localAi`, `deferral`, `serverEngineReady`, model name, 512-d) | **no** |
| `GET /desktop/runtime/manifest` | engine name/version, `scriptSha256`, model version and file list | **no** |
| `GET /desktop/runtime/models/:file` | the two model files (rate-limited) | **no** |
| `GET /desktop/runtime/face-engine.py` | the engine script, served for a version bump without a new installer | **no** |
| `POST /ai-feature/events/:id/media/:mediaId/faces` | AI Curation face hand-off from the desktop | **no** |
| `POST /image-selection/projects/:id/faces/ingest` (desktop ingest) | Image Selection face hand-off | **no** |
| `POST /ai-feature/events/:id/media/upload` with `source*` fields and `deferAi` | the optimizing upload contract (preview + thumbnail + fingerprint) | field handling **no** (route exists) |
| `GET /image-selection/compression` | the studio's per-module compression presets the desktop's recipes read | **no** |

Everything else the desktop uses (auth refresh, projects, folders, galleries, register-batch,
storage roots, events, people, matches, album proofing, signature album, WhatsApp) exists on
`main` today.

## 2. The backend change set (branch `feature/desktop-virtual-curation`)

Committed on the branch (local only, not pushed): `e4ad534b` and `87c103d6` — the desktop module
skeleton (`src/modules/desktop/{routes,controller,service,flags,descriptors}.js`), the AI
Curation hand-off route, `server.js` mounting `/api/desktop`, tests
`desktop-capabilities.test.js`, `desktop-ai-feature-ingest.test.js`.

Still **uncommitted** in the working tree and required by the validated flow:

- `src/modules/desktop/runtime.js` (new) and the modified `desktop/{controller,service,routes,flags}.js` — manifest, model files, engine script.
- `src/modules/ai-feature/face-engine/{engine.js,face_engine.py}` — the script the manifest serves (sha `bfd50308…739e`) and the server's own engine.
- `src/modules/ai-feature/media/{uploadIntake.js (new),controller.js,service.js,derivatives.js}` — the upload contract; `shared/{serializers,settingsDefaults,mediaScope}.js`; `default-settings/validation.js`; `events/service.js`.
- `src/modules/ai-feature/processing/{queue,service,worker}.js` — deferral and `requeueStaleDeferred` (the server fallback).
- `src/modules/image-selection/faces/{hook,queue,repository,service,worker}.js` and the desktop ingest route.
- `src/modules/image-selection/compression/` (new) and `src/services/{imageBytes,imagePresets}.js` (new).
- `prisma/schema.prisma` and **two migrations**: `20260929120000_ai_event_media_source_fields` (adds `source_size_bytes`, `relative_path` to `ai_event_media`) and `20260930100000_visual_curation_compression_settings` (adds `compression` JSON to `image_selection_settings`). Both are additive `ALTER TABLE … ADD COLUMN … NULL`; no data rewrite, no index, replayable.
- `.env.example`, `README.md`, `package.json` (`prisma:generate` now runs `scripts/prismaGenerate.js`; `scripts/cleanupOrphanAiMedia.js`).
- Tests: `desktop-runtime`, `desktop-deferral`, `desktop-image-selection-ingest`, `ai-feature-media-upload-contract`, `ai-feature-media-upload-service`, `ai-feature-folder-delete`.

Files in the same tree that are **not** part of this change (dashboards work; can ship together
or later): `ai-feature/overview/*`, `image-selection/album-proofs/dashboard.*`,
`image-selection/dashboard/*`, `services/dashboardRange.js` and their tests.

So "verify no Prisma migration is required" is **false**: two additive migrations are required and
`deploy.yml` applies them with `prisma migrate deploy`. No seed is needed: the desktop routes use
existing permissions (AI Feature and AI Face Management already exist on `main`), and the gates
are environment switches, not permissions.

## 3. Feature flags

| Variable | Effect | Production value |
| --- | --- | --- |
| `DESKTOP_VIRTUAL_CURATION_ENABLED` | opens `/api/desktop/capabilities` and the runtime routes | **unknown — cannot be read from outside; today the routes do not exist, so the value is moot** |
| `DESKTOP_AI_ENABLED` | with the first: hand-off routes and the uploads' `deferAi` field | unknown |
| `AI_FACE_ENGINE_ENABLED` | the server's own engine; `localAi` is offered only when this is on too | unknown; `GET /api/health` on production is the place to read the engine state after deploy |

Where they live: `backend/.env` on the VPS (dotenv preload; the file is not in git). Default when
unset: all three off, which leaves production exactly the web application it is today. Both
desktop switches off = every desktop route is the same 404 an unknown path gets, and the
`deferAi` field is ignored (photos are queued to the server worker as always). Changing `.env`
alone needs `pm2 restart dbs-erp-backend --update-env`; `deploy.yml` restarts with `--update-env`
anyway, so set the values before the deploy and they take effect with it. The server also needs
the model files on disk for `AI_FACE_ENGINE_ENABLED` (see `scripts/face-engine-setup.sh`), or the
manifest answers 503 and the desktop reads "Server processing".

## 4. Pre-deploy checks (done on 2026-10-02, local)

| Check | Result |
| --- | --- |
| Backend tests, full suite | 2538 / 2550 pass; the 12 failures are the known machine-only set (Python call-transcript, setup-script executable bit, branch-reach, WhatsApp session file modes, one ESM Windows-path loader) |
| Desktop + upload-contract + deferral + ingest tests alone | 76 / 77 (the setup-script executable check is the one Windows failure) |
| Route registration | local server mounts `/api/desktop` and `/api/image-selection/compression`; with both switches off every desktop route is 404 (`desktop-capabilities.test.js`) |
| Migrations | two additive migrations, see §2; `prisma validate` is part of `deploy.yml` |
| Web unchanged | frontend `npm run lint` 0 errors (41 pre-existing warnings), `npm test` 1932 / 1932 |
| Server AI fallback | `desktop-deferral.test.js`: with switches off a deferred upload is queued as always; restart recovery (`requeueStaleDeferred`) re-takes stale deferred photos |

## 5. Deploy steps (owner; nothing here was run)

1. Commit the §2 set on `feature/desktop-virtual-curation` (two commits are cleanest: the desktop
   flow, then the dashboards), push, PR to `develop`, then promote `develop` → `main` as
   DEPLOYMENT-WORKFLOW.md describes.
2. On the VPS before the deploy, in `backend/.env`: `DESKTOP_VIRTUAL_CURATION_ENABLED=true`,
   `DESKTOP_AI_ENABLED=true`, `AI_FACE_ENGINE_ENABLED=true`; make sure `.venv-face` and the
   model files are in place (the deploy's health gate fails on an offline engine).
3. Run the Deploy workflow (`workflow_dispatch`) rather than waiting for the nightly cron.

## 6. Post-deploy verification (from any machine; no customer data involved)

```bash
B=https://api-operations.dontblinkstudioz.com
curl -s -o /dev/null -w "%{http_code}\n" $B/api/desktop/capabilities            # 401 (was 404): the route exists, auth required
curl -s -o /dev/null -w "%{http_code}\n" $B/api/desktop/runtime/manifest        # 401
curl -s $B/api/health | head -c 400                                              # faceEngine: "online"
# with a staff JWT (sign in as the test account, copy the token):
curl -s -H "Authorization: Bearer $TOKEN" $B/api/desktop/capabilities
#   {"data":{"virtualCuration":true,"localAi":true,"faceModel":"buffalo_l","embeddingDimension":512,"deferral":true,...}}
curl -s -H "Authorization: Bearer $TOKEN" $B/api/desktop/runtime/manifest
#   {"data":{"engine":{"name":"face-engine","version":"1.0.0","scriptSha256":"bfd50308cb4e4a992768b2f1bcc456f40549b8f4a2541fc83bf68a388dc3739e"},"model":{"name":"buffalo_l","version":"1","files":[...]}}}
```

`scriptSha256` must equal the digest the installer was built with (`ai-runtime.json` in the
release folder); a different value means the installed desktop reads "updating" and fetches the
script, which is designed behaviour but should be known before the second-PC test.
