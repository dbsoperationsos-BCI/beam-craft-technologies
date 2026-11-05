# Local Developer Setup

This guide creates a **local-only** DBS-Operations-OS environment. It does not use the VPS database or production secrets.

## Official setup decision

- **MySQL Community Server** stores the actual local and production data.
- **MySQL Workbench Community** is the team’s visual database tool for local inspection.
- **Prisma** defines the schema in code, applies migrations, and provides the client used by backend APIs.
- Each developer uses localhost MySQL; the Hostinger VPS MySQL database is production-only.

## Required software

- Git
- Node.js 20 LTS or later and npm
- VS Code
- Codex extension, if your assigned workflow uses it
- MySQL Community Server 8 (running locally)
- MySQL Workbench Community
- A local MySQL user able to create and modify the development database

Use a feature branch. Do not use production `.env` files, production database URLs, or VPS credentials locally.

## Local environment files

The repository contains safe templates. Copy them before starting either application:

```sh
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

The default local ports are:

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:5001`

Edit `backend/.env` only for your local MySQL username, password, host, or port. Keep `DATABASE_URL` pointed to a local database named `dbs_operations_os_dev` (or another clearly local development database).

## macOS setup

From your Desktop (replace `<repo-url>` with the GitHub repository URL):

```sh
cd ~/Desktop
git clone <repo-url>
cd DBS-Operations-OS

mysql -u root -p
CREATE DATABASE IF NOT EXISTS dbs_operations_os_dev;
EXIT;

cd backend
cp .env.example .env
npm install
npm run prisma:generate
npx prisma migrate dev
npm run seed
```

Start the backend in its own terminal:

```sh
cd ~/Desktop/DBS-Operations-OS/backend
npm run dev
```

Start the frontend in a second terminal:

```sh
cd ~/Desktop/DBS-Operations-OS/frontend
cp .env.local.example .env.local
npm install
npm run dev
```

Open <http://localhost:3000/login>.

## Windows PowerShell setup

From your Desktop (replace `<repo-url>` with the GitHub repository URL):

```powershell
cd $env:USERPROFILE\Desktop
git clone <repo-url>
cd DBS-Operations-OS

mysql -u root -p
CREATE DATABASE IF NOT EXISTS dbs_operations_os_dev;
EXIT;

cd backend
copy .env.example .env
npm install
npm run prisma:generate
npx prisma migrate dev
npm run seed
```

Start the backend in its own PowerShell window:

```powershell
cd $env:USERPROFILE\Desktop\DBS-Operations-OS\backend
npm run dev
```

Start the frontend in a second PowerShell window:

```powershell
cd $env:USERPROFILE\Desktop\DBS-Operations-OS\frontend
copy .env.local.example .env.local
npm install
npm run dev
```

## Local Super Admin

After `npm run seed`, use this local development account:

- Email: `admin@dontblinkstudio.com`
- Username: `admin`
- Password: the one written at the top of `backend/prisma/seed.js` (`Admin@cxzdsa1`)

This is a seeded local-only credential, not a production credential. The seed sets the password
**only when it creates the account**: re-running it keeps the account a Super Admin and active, but
does not put a changed password back. A login that says the password is wrong on a fresh database
usually means the seed never ran — the `user` table is empty.

`npm run seed` creates no sample Employee, Sales or Project records, and the repository carries no
demo data set: every record on screen is one entered through the app.

## Quick health and database checks

Confirm the backend is reachable before trying to log in:

```sh
curl http://localhost:5001/api/health
```

Expected response:

```json
{ "ok": true, "service": "dbs-erp-backend" }
```

Open Prisma Studio to verify the local `User` table:

```sh
cd backend
npm run prisma:studio
```

Confirm there is one user with email `admin@dontblinkstudio.com`, username `admin`, role `SUPER_ADMIN`, and status `ACTIVE`. Do not paste password hashes into tickets or chat.

## MySQL Workbench Community

1. Create a local connection to `127.0.0.1:3307` with your local MySQL credentials.
2. Open the `dbs_operations_os_dev` schema after migrations and seed complete.
3. Inspect the `User` table to confirm the local Super Admin exists.
4. Use Workbench for viewing and local inspection only. Do not manually add, remove, or alter application schema columns for feature work.
5. All application schema changes must go through Prisma schema updates and Prisma migrations.

Prisma Studio (`npm run prisma:studio`) is optional; Workbench is the official visual tool. MySQL stores the data, Workbench views/administers it, Prisma schema describes it in code, Prisma Migrate applies structure changes, and Prisma Client is what the backend APIs use.

## Optional one-command local database preparation

After creating `.env` and the database, this combines client generation, migrations, and seed:

```sh
cd backend
npm run setup:local
```

## Login troubleshooting

| Symptom | Check |
|---|---|
| UI opens but login fails | The frontend is running; check backend, database, migrations, seed, and API URL first. |
| `Username or Password Incorrect` | Run `cd backend && npm run seed`, then use the exact local credential above. Confirm the `User` table contains the local Super Admin. |
| `Backend server is not reachable...` | Run `curl http://localhost:5001/api/health`; start the backend with `npm run dev`; confirm `frontend/.env.local` has `NEXT_PUBLIC_API_URL=http://localhost:5001`; restart the frontend after changing it. |
| Login service unavailable | Check the backend terminal for the development-only `Login failed:` message and confirm `DATABASE_URL` points to a running local MySQL database. |
| Prisma client or table errors | Run `npm run prisma:generate`, then `npx prisma migrate dev`, then `npm run seed`. |
| Database connection error | Verify MySQL is running, the database exists, and the local username/password/port in `backend/.env` are correct. |
| Frontend still calls the wrong port | Stop and restart `npm run dev` in `frontend`; Next.js loads `NEXT_PUBLIC_*` values when it starts. |

## What to send when stuck

Send the backend terminal screenshot, frontend browser-console screenshot, Network-tab login API response, a backend `.env` screenshot with the password hidden, the frontend `.env.local` screenshot, and a MySQL Workbench or Prisma Studio screenshot of the local `User` table. Never send actual `.env` contents, database passwords, JWT secrets, token values, or password hashes.
