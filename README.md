# DBS-Operations-OS

DBS-Operations-OS is the internal ERP and Operations OS for Don’t Blink Studioz. It manages employees, onboarding, sales projects, project-management workflows, technical access, and future operational modules. It is not only a CRM and not only an HRM product.

## Start Here

1. Read this file for a fresh clone.
2. Read [current project state](docs/project-state/PROJECT-STATE.md) before changing behavior.
3. Work in a feature branch, run local checks, open a PR to `develop`, and leave `main` promotion/VPS deployment to an authorized maintainer.

## Current Product Scope

- HRM and Employee Repository, including public onboarding invites and approval.
- Sales Manager, Create Project, and W/A Group-Name Generator.
- Project Management: Projects, Pre Production, Production, and Post Production foundations.
- Technical Dashboard foundation.
- Image Selection Dashboard and Projects route foundations.

## Finalized Technology Stack

| Area | Technology |
| --- | --- |
| Frontend | Next.js 16, React 19, JavaScript, Tailwind CSS, TanStack Table |
| UI | Custom reusable components; approved future libraries include shadcn/ui, Lucide React, React Hook Form, Zod, TanStack Query, and Recharts |
| Backend | Node.js, Express.js, REST APIs, JWT, bcrypt/bcryptjs, Prisma ORM, Zod where implemented, Nodemailer |
| Database | MySQL Community Server / MySQL 8, Prisma Migrate, Prisma Client |
| Database tools | MySQL Workbench Community; Prisma Studio is optional |
| Deployment | Hostinger VPS, Ubuntu 22.04, Nginx, PM2, Let’s Encrypt SSL, GitHub |

## Required Software for New Developers

Required: Git, VS Code, Node.js 20 LTS and npm, MySQL Community Server, MySQL Workbench Community, a terminal or PowerShell, and a modern browser (Chrome preferred).

Recommended: nvm for Node version management, Codex VS Code extension for AI-assisted work, GitHub Desktop (optional), and Postman or Thunder Client for API testing.

## Quick Start — Fresh Clone

Clone → create local environment files → create a local MySQL database → migrate → seed the local admin → run backend → run frontend → log in.

### 1. Clone Repository

```bash
git clone <repo-url>
cd DBS-Operations-OS
```

### 2. Set Up Environment Files

macOS/Linux: `cd backend && cp .env.example .env`, then `cd ../frontend && cp .env.local.example .env.local`.

Windows PowerShell: `cd backend; copy .env.example .env`, then `cd ../frontend; copy .env.local.example .env.local`.

Set `backend/.env` to **your local MySQL on port 3307 only**. Typical example: `DATABASE_URL="mysql://root:password@127.0.0.1:3307/dbs_operations_os_dev"`.

`frontend/.env.local` must contain `NEXT_PUBLIC_API_URL=http://localhost:5001`.

Never commit `.env` or `.env.local`.

### 3. Create Local MySQL Database

Run `mysql -h 127.0.0.1 -P 3307 -u root -p`, then execute `CREATE DATABASE IF NOT EXISTS dbs_operations_os_dev;`, then `EXIT;`.

Use the same database name in `DATABASE_URL`. In MySQL Workbench, create a local connection and open the same schema. Workbench is for local inspection; do not manually create application feature columns or tables. Prisma migrations own application schema changes.

### 4. Install Backend and Prepare Database

```bash
cd backend
npm install
npx prisma generate
npx prisma migrate dev
npm run seed
```

`migrate dev` applies local migrations. `seed` creates or restores the local Super Admin and is safe to run again.

### 5. Run Backend and Frontend

In one terminal: `cd backend && npm run dev`.

In a second terminal: `cd frontend && npm install && npm run dev`.

Expected URLs:

- Frontend: <http://localhost:3000>
- Backend health: <http://localhost:5001/api/health>

### 6. Local Login

Use the seeded local-only account:

- Email: `admin@dontblinkstudio.com`
- Password: `Admin@12345`
- Username, if needed: `admin`

These are development credentials only, not production credentials.

## Common Local Setup Problems

| Problem | Likely cause | Fix |
| --- | --- | --- |
| UI opens but login fails | Local DB is empty, backend targets the wrong DB, or seed was not run | Run `npx prisma migrate dev`, `npm run seed`, and check `DATABASE_URL` |
| Prisma `P1001` / cannot reach DB | MySQL is not running or port is wrong | Start MySQL and check `DATABASE_URL`; some Mac setups use `3307` |
| Frontend says backend is unreachable | Backend is not running or `NEXT_PUBLIC_API_URL` is wrong | Start backend, check `frontend/.env.local`, then restart frontend |
| Onboarding invites do not load | Backend, migration, or DB issue | Check backend terminal output, run migrations, and verify local DB |
| Add Employee reports `employeeId` validation | Stale backend/frontend build is running | Pull current main and restart both local processes |

To inspect local data, run `npm run prisma:studio` from `backend` or use MySQL Workbench. Do not share password hashes, env files, tokens, or production credentials.

## Database Rules

- MySQL stores actual data.
- MySQL Workbench is the official visual database tool.
- Prisma schema defines models; Prisma Migrate applies changes; Prisma Client is used by backend APIs.
- Do not manually change production schema in Workbench.
- Do not commit environment files or secrets.

## Git Workflow for Developers

`main` and `develop` may point to the same commit immediately after a release, but they have different responsibilities.

- `main` is the production-release branch. The VPS deploys from GitHub `main` only.
- `develop` is the integration/testing branch. Feature and bugfix PRs target `develop`.
- `feature/*`, `bugfix/*`, and `refactor/*` branches are created from current `develop`.

Standard flow:

```text
feature/bugfix branch
  -> PR to develop
  -> test develop
  -> promote develop to main
  -> deploy main to VPS
```

Before work, run `git checkout develop`, `git pull origin develop`, and `git checkout -b feature/<task-name>` or `git checkout -b bugfix/<task-name>`. Then use `git status`, `git add .`, `git commit -m "<message>"`, and `git push origin <branch-name>`. Open a pull request to `develop`.

Rules:

- Do not push directly to `main`.
- Do not use the VPS as a source of code fixes. Production code must match GitHub `main`.
- New developers must not deploy to the VPS or edit production env files.
- Do not touch the separate old WhatsApp automation.

## Production Deployment

Only an authorized maintainer deploys. From the VPS checkout:

```bash
cd /var/www/dbs-operations-os/current
git fetch origin
git checkout main
git reset --hard origin/main

cd backend
npm ci
npx prisma generate
npx prisma migrate deploy

cd ../frontend
npm ci
npm run build

pm2 restart dbs-erp-backend --update-env
pm2 restart dbs-erp-frontend --update-env
pm2 save
```

Never run `prisma migrate dev` on the VPS. Use `prisma migrate deploy` only.

If the frontend shows `Unable to reach the API service`, first verify the backend is actually listening with `curl http://127.0.0.1:5001/api/health`. If backend logs show `@prisma/client did not initialize yet`, run `npx prisma generate` from `backend`, then `npx prisma migrate deploy`, and restart `dbs-erp-backend`.

## Important Safety Notes

- Never commit or share `.env` values, production database credentials, JWT secrets, SMTP credentials, or password hashes.
- Never use destructive database commands on production.
- Do not change the stack or architecture without explicit approval.
- Keep WhatsApp automation untouched unless an explicit task names it.

## Documentation Map

- [Current Project State](docs/project-state/PROJECT-STATE.md)
- [Local Developer Setup](docs/project-state/LOCAL-DEVELOPER-SETUP.md)
- [UI Standards](docs/project-state/UI-STANDARDS.md)
- [Employee Repository Standards](docs/project-state/EMPLOYEE-REPOSITORY-STANDARDS.md)
- [Sales and Project Management Workflow](docs/project-state/SALES-AND-PROJECT-MANAGEMENT-WORKFLOW.md)
- [Deployment Workflow](docs/project-state/DEPLOYMENT-WORKFLOW.md)
- [Database Notes](docs/DATABASE.md)
- [API Notes](docs/API.md)

## AI Agent Instructions

1. Read this README first, then [PROJECT-STATE.md](docs/project-state/PROJECT-STATE.md).
2. Do not change approved stack or architecture without explicit approval.
3. Do not touch WhatsApp automation or commit secrets.
4. Work one scoped feature or bug fix at a time.
5. Run relevant lint/build/tests before reporting completion.
6. Prefer local changes, reviewed Git workflow, and maintainer-only VPS deployment.
