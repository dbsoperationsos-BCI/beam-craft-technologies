# Client Subscription Setup (Part 1: Beam Craft side) — Design

Date: 2026-11-04 · Project: Beam Craft website · Follows `2026-11-04-client-onboarding-design.md` (as since changed: invite = company details, product chosen in Edit).

## Goal

After a client submits the onboarding form and the team has spoken to them, the team sets up the client's account in Beam Craft: where they log in, how many users, their Admin login, how long it is valid, and which modules they get. Part 2 (later, in the client's own app, e.g. Velava) creates that Admin login there and enforces the rest.

## Flow

1. HRM → Client Details → a **Submitted** row → ⋮ → **Set up account**.
2. The box (two columns, like the invite box):

| Field | Rule |
| --- | --- |
| Product | Account Manager / Media Studio Operations; prefilled from Edit; required (decides the module list) |
| Subdomain | lowercase letters, digits, hyphens, 3–40 chars, unique; shown as `<subdomain>.beamcraft.tech` |
| Number Of Users | whole number ≥ 1, prefilled with the client's "Number Of Users Needed"; total logins = 1 Admin + this |
| Admin Username | 3–60 chars, letters/digits/`.`/`_`/`-`; prefilled with the subdomain |
| Valid From / Valid Until | dates; Until on or after From |
| Modules | tick boxes, at least one; list by product (below) |

3. **Save** → the server generates the Admin password (12 chars, letters + digits), stores only its bcrypt hash, marks the client set up, and returns the password **once** in a message:

> Hi {main contact name},
>
> Your Beam Craft account is ready.
> Login: https://{subdomain}.beamcraft.tech
> Username: {admin username}
> Password: {password}
> Valid until: {valid until}
>
> Please change the password after your first login and keep it to yourself.

4. Row ⋮ on a set-up client: **Edit subscription** (same box, no password shown; a **Reset password** tick generates a new one and shows the message again), plus the existing Edit and Delete.

## Modules

- Account Manager: `user-management` User Management, `accounts` Accounts, `resource-management` Resource Management.
- Media Studio Operations: `hrm` Human Resource Management, `sales-crm` Sales & CRM, `project-management` Project Management, `visual-curation` Visual Curation, `accounts` Accounts, `resource-management` Resource Management.

## Status and tabs

A client's status: Form Pending → Submitted → **Active** (set up, today ≤ Valid Until) → **Expired** (today > Valid Until). Link expired / cancelled invites keep their own tab.

Tabs: All · Form Pending · Submitted · Active · Expired · Link Expired/Cancelled.

## Data

New columns on `subscription_client`: `subdomain` (unique, nullable until set up), `users_allowed` int, `admin_username`, `admin_password_hash` (bcrypt, never returned by the API), `valid_from`, `valid_until` (dates), `modules` JSON array of keys, `activated_at`.

## API

`PUT /api/subscribe/client-onboarding/invites/:id/subscription` (SUBSCRIBE / Client Onboarding, READ_WRITE), body `{ product, subdomain, usersAllowed, adminUsername, validFrom, validUntil, modules, resetPassword? }`. Refused unless the row is submitted. First save, or `resetPassword: true`, returns `{ password, message }`; otherwise no password. List rows carry the subscription fields minus the hash.

## Out of scope (Part 2)

Creating the Admin in the client app, the client app reading its subscription from Beam Craft, enforcing modules / user limit / expiry, DNS for subdomains.

## Testing

Pure tests: subscription schema (subdomain/username format, dates order, modules belong to product, users ≥ 1), status (Active/Expired by date), password generator (length, alphabet), message text. Frontend: tabs place each status correctly.
