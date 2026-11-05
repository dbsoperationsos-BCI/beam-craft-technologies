# Development, Git, Deployment, and Automation Safety

> **This repository has no CI or deploy pipeline.** The `ci.yml` and `deploy.yml` described below
> belong to DBS-Operations-OS and were removed from this copy; read those sections as DBS's, not this
> repository's.

## Local Development Workflow

1. Work locally first.
2. Run relevant checks, including frontend build where code changes.
3. Commit and push the reviewed work.
4. Deploy from VPS only after `main` contains the approved commit.

```bash
cd /Users/sudeepramasamy/Desktop/DBS-Operations-OS
git status
git add .
git commit -m "<message>"
git push
```

## Git Collaboration Safety

- `main` is the production-safe branch.
- Developers work in feature branches and raise pull requests **into `develop`**. Feature work is
  never pushed to `main`, and no branch but `develop` is ever merged into it.
- The one exception is the release itself: promoting `develop` to `main` is a local merge and a
  push, and that push is what deploys. See
  [Promoting `develop` to `main`](#promoting-develop-to-main). Any branch protection rule on `main`
  must leave that push possible, or nothing can be released.
- VPS deploys only `main`; never pull a feature branch into production.
- Do not commit `.env` files, credentials, tokens, SMTP passwords, database passwords, or JWT secrets.
- Codex must not edit production server files directly.

Suggested feature branch workflow:

```bash
git checkout main
git pull origin main
git checkout -b feature/<task-name>

git add .
git commit -m "<message>"
git push origin feature/<task-name>
```

## Continuous Integration and Deployment

Two GitHub Actions workflows run this. Deploying by hand is now the fallback, not the routine.

Both run on a merge, each on its own branch: `develop` is checked once a PR lands on it, and `main`
is shipped once `develop` lands on it. Promotion to `main` is done by hand rather than by PR —
see [Promoting `develop` to `main`](#promoting-develop-to-main) below — and the push at the end of
it is what starts the deploy.

```text
feature/<name> --PR--> develop --merged locally--> main ------> Hostinger VPS
                          |                         |                |
                     ci.yml runs             deploy.yml runs   (verify, backup,
                     (on the merge,          (on the push)      migrate, build,
                     reports)                                   restart, health check)
```

### `ci.yml` — what is checked

Triggered by a push to `develop` — which in this project means an approved PR was merged — or
manually from the Actions tab. It runs against `develop` as it then stands, so it sees the
integrated code rather than a branch in isolation: two changes that each pass alone and break
together are caught here, which reviewing either PR could not do.

| Job | Steps |
| --- | --- |
| `backend` | `npm ci`, `prisma generate`, `prisma validate`, `prisma migrate deploy`, `npm run seed`, `npm test` |
| `frontend` | `npm ci`, `npm run lint`, `npm test`, `npm run build` |
| `ci-passed` | Succeeds only if both jobs did — one line to read on the branch. |

**The backend job runs its own MySQL.** A `mysql:8.0` service container is created for the run and
thrown away with it. `test/iam.test.js` is not a pure unit suite — it upserts branches, creates
roles and users, and reads the seeded permission rows — so it needs a real database with the schema
applied and the seed run. That is why `migrate deploy` and `npm run seed` sit between validation and
the tests, and it doubles as proof that all 80 migrations still apply from empty.

It is never the production database, and never a shared one. Those tests write, and the VPS holds
the studio's live records; the container also means two runs cannot interfere with each other.
`DATABASE_URL` for the job points at the container and is written in the workflow, because
credentials for something that lives for eight minutes are configuration rather than secrets.

`deploy.yml`'s verify job needs no database at all — `generate` writes the client from the schema
and `validate` parses it, neither opening a connection — but it still sets a placeholder
`DATABASE_URL`, because `schema.prisma` declares `url = env("DATABASE_URL")` and `validate`
resolves that expression before it will parse the file. With no value it stops at **P1012,
"Environment variable not found"**. Locally the value comes from `backend/.env`, which is gitignored
and so is rightly absent in CI.

**This reports rather than blocks.** The merge has already happened by the time it runs, so red on
`develop` means `develop` is broken and must be fixed before it is promoted to `main` — not a
backlog item to work around. The suite is green today — backend 309/309, frontend 72/72, lint
clean — so anything red is something the merge that triggered it broke.

Because the result arrives after the merge, `ci-passed` cannot be a required status check: GitHub
can only require a check that runs on the pull request itself. **Green on `develop` is therefore the
signal to promote, and checking it is a manual step** — there is no PR into `main` to display it.
If you later want the merge into `develop` blocked as well, change the trigger to
`pull_request: branches: [develop]`, or add it alongside the push, which runs the suite twice but
gates and integrates both.

The `STRICT` switch at the top of [ci.yml](../../.github/workflows/ci.yml) is kept for the case
where `develop` inherits a genuinely unrelated failure that cannot be fixed at once, so the rest of
the report stays readable. Put it back to `"true"` immediately: this workflow is the only thing
watching `develop`. The frontend **build** ignores the switch and always fails the job.

### `deploy.yml` — what is shipped

A nightly release train: whatever sits on `main` at **23:00 IST, Monday to Saturday**, ships
together in one window, when the studio is quiet. Merging into `main` no longer deploys on its own.
`workflow_dispatch` from the Actions tab is the hotfix path and the only way to ship between
windows — including on a Sunday.

The cron is `30 17 * * 1-6`:

| Field | Value | Meaning |
| --- | --- | --- |
| minute | `30` | at :30 |
| hour | `17` | 17:00 UTC — **GitHub cron is UTC only**, so this is 23:00 IST |
| day of month | `*` | every date |
| month | `*` | every month |
| day of week | `1-6` | **Monday to Saturday**; nothing ships on a Sunday night |

Writing `0 23` for the hour would ship at 04:30 IST, not 23:00. India does not observe daylight
saving, so this holds all year.

The weekday is read in UTC like the hour, but 17:30 UTC plus 5:30 lands at 23:00 on the *same* day,
so UTC Mon–Sat is IST Mon–Sat with no day shift. Moving the window past 18:30 UTC would cross
midnight into the following IST day and shift the whole range — worth remembering if the time
changes.

Three things about scheduled runs worth knowing:

- GitHub does not promise punctuality. Under load a scheduled run is queued and can start
  appreciably late, and is occasionally dropped altogether. Treat it as a window, not an alarm.
- A `schedule` only ever runs the copy of the workflow on the **default branch** (`main`).
- GitHub **disables scheduled workflows in a repository with no activity for 60 days**, and emails
  the owner when it does — a quiet spell stops the nightly deploy until someone re-enables it.

If nothing was merged that day the run stops after the backup and the health check rather than
rebuilding and restarting for no change, so a quiet night costs nothing and still leaves a fresh
database backup. Sunday has no run at all, so no Sunday backup comes from this workflow — if the
nightly backup matters on its own, schedule `scripts/production-backup.sh` from cron on the VPS
rather than relying on the deploy to take one.

1. **version** — works out what this release is called, before anything is built, so the bundle,
   the server's record, the health check and the tag all stamp one string. It also refuses to
   run if `VERSION` and either `package.json` disagree about major.minor. See
   [Versioning](#versioning) below.
2. **verify** — installs, generates and validates the Prisma schema, and builds the frontend. This
   does not re-run the test suite; the tests ran on `develop` after each merge, and `main` only ever
   receives commits that came through there. It proves the commit is deployable, so `migrate deploy`
   cannot fail halfway against the production database. It runs before the backup and the SSH steps,
   so a commit that does not build never reaches the VPS.
3. **back up** — runs `scripts/production-backup.sh` on the VPS. `prisma migrate deploy` is
   irreversible, so this runs first or the deploy does not proceed.
4. **deploy** — `git reset --hard <the exact commit>`, then the documented sequence: `npm ci`,
   `prisma generate`, `prisma migrate deploy`, the IAM seed below, `npm run build`, `pm2 restart`
   both processes, `pm2 save`. It also writes a `RELEASE` file at the application root recording
   the version, the commit and the time, and passes the version into the frontend build as
   `NEXT_PUBLIC_APP_VERSION` — the two places the running system reports itself from.

   The step may run for **40 minutes** (`command_timeout`; the action's own default is 10, and on
   2026-10-29 two deploys in a row were killed at 10 minutes, one inside the backend's `npm ci`).
   `npm ci` runs in each of `backend` and `frontend` only when its `package-lock.json` changed since
   the last install that finished — the lock's hash is stamped into `node_modules`, which `npm ci`
   deletes, so an install cut off part way is redone. `RELEASE` is written only after the
   migrations and the build, just before the restart, and a run stops as "nothing new" only when
   **`RELEASE`** already names its commit — never when `git HEAD` does. So a deploy killed part
   way is finished by simply running the pipeline again.
5. **IAM seed** — `node -r dotenv/config prisma/seeds/iam-roles-permissions.js`. A
   `{ module, feature }` row added in a release exists only in the source until it is seeded, and
   the permission it names cannot be granted to anyone (Rule 4). This seed is built to be re-run:
   permissions, roles and scopes are upserted, and an existing role keeps the description and
   grants the studio edited it to.

   **Never `npm run seed` on production.** The full seed upserts the Super Admin with a hard-coded
   password and `status: ACTIVE`, so it would reset the live admin's password on every deploy and
   reactivate a disabled account. It also deactivates the CORP, DUM_DUM and QUA_QUA locations. It
   is a local-setup script; only the IAM seed belongs in a deploy.

   The `-r dotenv/config` matters: that script loads `src/config/db.js` directly and never calls
   dotenv itself, unlike `server.js`. The Prisma CLI reads `.env` on its own, a plain `node` does
   not — without the preload it would start with no `DATABASE_URL`.
6. **health check** — polls `http://127.0.0.1:5001/api/health` ten times at three-second intervals.
   PM2 reports "online" the moment a process starts, which is before Express is listening, so a
   backend that boots and immediately dies on a bad environment variable would otherwise look like
   a successful deploy. If it never answers, the deploy fails and the last 40 log lines are printed.

   It then checks **which** release answered, against the `RELEASE` file the deploy wrote. A PM2
   process that restarted onto the old build is indistinguishable from a healthy one otherwise.
   On a quiet night nothing is restarted, so a server with no `RELEASE` file warns instead of
   failing — the next deploy that actually ships writes one.

   Last, it reads `faceEngine` from the same response and waits, up to two minutes, for the face
   engine to finish loading its models: `ready` and `disabled` pass, `not-started` (an API whose
   face workers run in another process) passes with a warning, and `offline` **fails the deploy**
   with the reason and the `[face-engine]` log lines — the application is serving, but face
   recognition is not, and that is what this gate is for.
7. **tag** — after the health check has passed, tags the commit `v<version>` and opens a GitHub
   Release carrying that version's changelog section. It runs last on purpose: a tag existing
   means that version served a request in production, not merely that a deploy was attempted.
   It pushes a **tag and never a commit** — a commit pushed to `main` would retrigger the deploy.
   It is the only job in either workflow with `contents: write`.

`git reset --hard` discards anything edited directly on the server. That is the existing rule —
production files are never edited in place — but it is worth stating plainly.

### The face engine's Python environment

Face recognition — the AI Feature's event galleries and the client gallery's People filter — runs
in a Python sidecar ([face_engine.py](../../backend/src/modules/ai-feature/face-engine/face_engine.py))
that the backend spawns as a child of `dbs-erp-backend`; there is no PM2 process of its own. Its
packages live in **`backend/.venv-face`**, a virtual environment that is the engine's alone: apart
from Node, and apart from the call-transcript engine (faster-whisper), whose own environment is the
repository-root `.venv`. Neither is ever pip-installed package by package on the server.

[backend/scripts/face-engine-setup.sh](../../backend/scripts/face-engine-setup.sh) is the one
implementation of that environment. **The deploy does not run it.** It is run by hand on the
server once, and again whenever `backend/requirements-face.txt` changes; the environment is
git-ignored, so the deploy's `git reset --hard` leaves it in place. It used to run on every
deploy, where it upgraded pip and reinstalled every package nightly — minutes of CPU inside the
deploy step's timeout (10 minutes then), which the half-finished deploy of 2026-09-24 ran out of. The
deploy still checks the engine afterwards (the health gate above). What the script does:

```text
read AI_FACE_ENGINE_ENABLED from backend/.env  (--skip-if-disabled: not "true" → nothing to do)
→ backend/.venv-face exists and runs?           (no → python3 -m venv, newest python3 ≥ 3.9 found)
→ pip install -r backend/requirements-face.txt  (insightface itself with --no-deps: see the file)
→ python face_engine.py --check                 (imports, model files fetched from the Hub, one detection)
→ exit 0 with one JSON report, or exit 1 with what is missing and how to fix it
```

`requirements-face.txt` names every package the engine imports and every one insightface needs
at runtime, with **`opencv-python-headless`** — the OpenCV build for a server without a display.
insightface declares the desktop `opencv-python` as its dependency, which is why the script
installs it with `--no-deps` and takes the rest from the file; the production error *"Face engine
offline — ModuleNotFoundError: No module named 'cv2'"* was a server on which nothing had ever
installed any OpenCV at all, because nothing in the deploy did.

The server needs `python3` (3.9 or newer) with the `venv` module — on Ubuntu/Debian
`sudo apt install python3 python3-venv` — and outbound HTTPS to `huggingface.co` once, for the two
model files (`~/.insightface/models/buffalo_l/`, or `$INSIGHTFACE_HOME`). Without the network the
files can be copied there by hand; the check reports which are missing.

**Nothing else depends on it.** With the engine off, uninstalled or broken, `/api/health` still
answers `ok: true`, Image Selection, Album Proofing, Project Management and every other module run
as before, and only face recognition is unavailable: the AI Feature shows *Face engine offline* with
the reason, the client gallery's People tab shows nobody. Queued face jobs are not failed — the workers
park them (`FACE_ENGINE_UNAVAILABLE`, retried every minute) and re-queue anything left waiting at
boot, so they resume by themselves once the engine answers.

Two health endpoints: `GET /api/health` carries `faceEngine` (`disabled` / `ready` / `starting` /
`not-started` / `offline`) and `faceEngineReason`; `GET /api/health/face-engine` (behind
`SETTINGS / Application Monitoring`) adds the interpreter in use, whether `.venv-face` exists,
whether each model file is on disk, and how many face jobs are waiting in each module. Repair on a
server that says offline:

```bash
bash /var/www/dbs-operations-os/current/backend/scripts/face-engine-setup.sh
pm2 restart dbs-erp-backend --update-env
pm2 logs dbs-erp-backend --lines 40 --nostream | grep face-engine
```

Two deploys can never overlap, and a deploy is never cancelled midway: an interrupted run between
`migrate deploy` and `pm2 restart` would leave production inconsistent.

### Versioning

Releases are numbered `<major>.<minor>.<build>` — `1.2.41`. The first two numbers are chosen by a
person; the third is counted by git, and nobody types it.

| Part | Where it comes from | Who moves it |
| --- | --- | --- |
| major | the `VERSION` file at the repository root | you, by editing that file |
| minor | the same file | you, by editing that file |
| build | promotions to `main` since the tag `v1.0.0` | git, on its own |

`scripts/app-version.sh` is the only implementation of that rule, and the same script the deploy
runs. `--current` prints the version of `HEAD`, `--next` prints what promoting `develop` right now
would produce, and `--check` verifies `VERSION` and both `package.json` files agree.

**The build number is monotonic: it does not reset.** `1.2.41` is followed by `1.3.42`, not by
`1.3.0`. That is why it counts from the fixed tag `v1.0.0` rather than from the current minor —
the range only ever grows. **Never move or delete that tag.** Every version ever issued is a
distance from it, so re-pointing it silently renumbers the past and every version stamped on a
running server stops meaning what it said.

**`v1.0.0` does not exist yet.** The tag job creates it, and it has never run: the tag is only
pushed after a health check passes, and the health check failed every run until
2026-09-11. Until one deploy goes green, `count_builds` finds no baseline, the build is 0, and
every release — however many promotions have happened — computes to `1.0.0`. That is the
chicken-and-egg the script's own "before the baseline tag exists" branch is written for, and the
first green deploy ends it.

It counts `--first-parent` commits, which on `main` are exactly the merges of `develop` into it.
A promotion carrying twelve pull requests advances the build number by one: it counts releases,
not commits. Because the deploy is a nightly train, several promotions in one day ship together
in one window under one number — the number the *last* of them produced. If you promote twice
before a window, re-run `--next`; the first promotion's number is never issued.

What each part means here:

- **major** — the studio has to do something differently, or the release cannot be undone: a
  migration that transforms data, a change to the IAM model itself, a workflow staff are trained
  on changing shape.
- **minor** — a new module or feature, or a release adding a `{ module, feature }` row to the
  permission seed. That row is a new capability somebody can be granted, which is a minor release.
- **build** — everything else. Fixes, interface work, refactors. Decided by nobody.

`package.json` on either side is **not** the source of truth and carries no build number: it moves
every release and no commit could keep it accurate. The two files may not disagree with `VERSION`
about major.minor, though, because anyone reading them would take that for the version — the
version job checks it and fails the deploy if they drift.

#### Reading the version off a running system

| Where | Shows |
| --- | --- |
| `GET /api/health` | `version`, `commit` and `deployedAt`, read from the server's `RELEASE` file when the process booted |
| The sidebar footer | the version the loaded bundle was **built** with — a browser holding a cached bundle keeps reporting the older one, which is what makes it worth showing |
| `<app path>/RELEASE` on the VPS | what the last deploy put there |
| `git tag --sort=-creatordate` | every release that reached production |

Sort tags by date, not by name. A monotonic build number means `v1.1.42` and `v1.0.41` are
adjacent in time but not in an alphabetical listing.

#### Rolling back

`git reset --hard v1.2.40` on the VPS returns the **code** to a release known to have served
traffic. It does not return the schema: `prisma migrate deploy` is one-way. A release that
migrated needs the database restored from the backup that deploy took as well — see
[BACKUP-AND-RESTORE.md](../deployment/BACKUP-AND-RESTORE.md). This is what a major release is
warning you about.

### Promoting `develop` to `main`

Not a pull request: `develop` is merged into `main` locally and pushed, and that push is what
triggers the deploy above. There is no review step and no status check in between, so the two
checks are yours to make before you push.

```bash
# 1. develop must be green. Open the branch's latest CI run and confirm "CI passed".
#    There is no PR to display it, so nothing else will stop a broken develop from shipping.

# 2. Any new environment variable this release needs must already be on the VPS,
#    in backend/.env or frontend/.env.local. The deploy does not create them.

# 3. Close the changelog section, on develop, before merging. The version this promotion
#    will ship under is:
#        scripts/app-version.sh --next
#    Rename "## Unreleased" to "## <that version> — <today>", open a fresh Unreleased above
#    it, and move the release that was below Unreleased to docs/changelog/<its version>.md
#    with its links rewritten one level deeper (the changelog keeps only Unreleased and the
#    release being shipped). Commit. Edit VERSION in the same commit if this release is a
#    major or a minor.

git checkout main
git pull origin main            # main first, so the merge below is against the real tip
git pull origin develop         # brings develop in, creating a merge commit
git push origin main            # ← this starts the deploy
```

Then watch the run in the Actions tab. It fails loudly rather than half-deploying: `verify` stops a
commit that does not build before anything touches the VPS, the database is backed up before
`migrate deploy`, and the health check fails the run if the backend does not answer.

**Where this flow is thinner than a PR.** `git pull origin develop` makes a *new* merge commit,
which is not the commit CI ran on. If `main` had drifted and the merge needed conflicts resolved,
the resolved code has never been tested — `verify` catches a broken build or schema, but not a
failing test. When a promotion involves conflicts, run `npm test` on both sides locally before
pushing.

### One-time setup

**1. Repository secrets** — Settings > Secrets and variables > Actions > New repository secret:

| Secret | Value |
| --- | --- |
| `VPS_HOST` | The Hostinger VPS IP or hostname |
| `VPS_USER` | The SSH user that owns `/var/www/dbs-operations-os` and runs PM2 |
| `VPS_SSH_KEY` | The **private** key, whole file including the BEGIN/END lines |
| `VPS_PORT` | SSH port, usually `22` |
| `VPS_APP_PATH` | `/var/www/dbs-operations-os/current` |

Generate a key pair dedicated to deployment rather than reusing a personal one, so it can be
revoked on its own:

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/dbs_deploy
ssh-copy-id -i ~/.ssh/dbs_deploy.pub <user>@<vps-host>
cat ~/.ssh/dbs_deploy   # this is what goes into VPS_SSH_KEY
```

**2. A `production` environment** — Settings > Environments > New environment, named `production`.
**Do not add a required reviewer now that the deploy is scheduled.** An approval gate holds the run
until somebody presses the button, so the 23:00 deploy would sit waiting overnight and ship
whenever it was noticed — the opposite of a predictable window. A reviewer only makes sense if
deploys go back to being triggered by a person. Optionally add a `PRODUCTION_URL` variable so the
deploy links to the site.

Set that environment's **Deployment branches and tags** to `main` — "Selected branches and tags",
one rule, `main`. The schedule only ever runs `main`, but `workflow_dispatch` is offered on every
branch, so while this reads "No restriction" any branch in the repository can ship itself to the
VPS. With the rule in place, a dispatch from anywhere else stops at the deploy job: the environment
refuses it and the secrets never resolve.

**3. Branch protection** — Settings > Branches, for `main` and `develop`: require a pull request,
and require the `CI passed` status check. `main` must additionally reject direct pushes, otherwise
a push straight to `main` deploys without ever having been reviewed.

**4. The VPS must be able to `git pull`** — the deploy user needs read access to the repository
(a deploy key on the server, or an already-authenticated remote). Confirm with
`sudo -u <user> git -C /var/www/dbs-operations-os/current fetch origin main`.

Secrets stay in the shared VPS environment files. Nothing in these workflows prints them, and the
`NEXT_PUBLIC_*` values in the build steps are placeholders — the real ones are read on the VPS at
deploy time, because `NEXT_PUBLIC_*` values are baked into the client bundle.

## VPS Deployment

Manual fallback. `deploy.yml` above runs these same commands in the nightly window; reach for this
only when Actions is unavailable, or something has to ship before the next window and
`workflow_dispatch` is not an option.

Production path: `/var/www/dbs-operations-os/current`

```bash
cd /var/www/dbs-operations-os/current
git pull origin main

# Only on a new server, or when backend/requirements-face.txt changed: the face engine's Python
# environment - created, updated and proved. Skips itself when backend/.env does not set
# AI_FACE_ENGINE_ENABLED=true. Never pip install by hand instead.
bash backend/scripts/face-engine-setup.sh --skip-if-disabled

cd backend
npm install
npx prisma generate
npx prisma migrate deploy

node -r dotenv/config prisma/seeds/iam-roles-permissions.js

cd ../frontend
npm install
npm run build

pm2 restart dbs-erp-backend --update-env
pm2 restart dbs-erp-frontend --update-env
pm2 save
```

Logs:

```bash
pm2 logs dbs-erp-backend --lines 80
pm2 logs dbs-erp-frontend --lines 80
```

PM2 process names:

- `dbs-erp-backend`
- `dbs-erp-frontend`

Nginx and Let’s Encrypt SSL terminate the public domains. Secrets remain in shared VPS environment files and must not be printed in commands, commits, or project documentation.

### Nginx and the WhatsApp chat stream

The CRM's WhatsApp panel holds one long-lived `text/event-stream` connection open per open lead
(`GET /api/sales/whatsapp-chat/leads/:id/stream`) so a client's reply reaches the screen as it lands
rather than on the next poll. Two things about a proxy decide whether that works:

- **Buffering.** Nginx buffers a proxied response by default and will hold a stream's bytes until
  its buffer fills — which, for a few dozen bytes an hour, is for ever. The server sends
  `X-Accel-Buffering: no`, which Nginx honours per response, so **no configuration change is
  needed**. If the stream is ever proxied by something that does not honour that header, set
  `proxy_buffering off;` for that location instead.
- **Idle timeout.** `proxy_read_timeout` must be longer than the stream's heartbeat, which is 25
  seconds. Nginx's default is 60, so again nothing to change — but a config that lowers it below 25
  will cut the line every heartbeat, and the panel will spend the day reconnecting.

Neither failure breaks the chat: the panel notices the line is not there and falls back to polling,
which is how it worked before. It is simply slower, which is the thing to watch for if replies start
arriving late again after a proxy change.

**One API process.** The stream is delivered from the same process that holds the WhatsApp socket,
which is memory, not shared state — so the API cannot be run as more than one process without the
sessions themselves breaking first. If it is ever clustered, `whatsapp-chat/events.js` needs the
same treatment at the same time; there is a note in that file saying so.

## Old WhatsApp Automation Safety

- The old WhatsApp automation is a separate project from DBS-Operations-OS.
- Its old PM2 bot processes are stopped.
- Do not delete its bot folder, session folders, process configuration, or history.
- Do not touch that application or its VPS files unless an explicit request names it.
- DBS-Operations-OS W/A Group-Name Generator is an internal project-data workflow; it is not permission to alter the old WhatsApp automation.
