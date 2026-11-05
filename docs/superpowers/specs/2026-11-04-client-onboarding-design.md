# Client Onboarding (Subscribe) — Design

Date: 2026-11-04 · Project: Beam Craft website (`/Users/mac/Desktop/Beam-Craft-Website`, a copy of DBS-Operations-OS) · DBS itself is not touched.

## Goal

Beam Craft sells two products. A company that wants one is onboarded the same way an employee is today: the team sends an invite link, the company fills a form, and the company then appears in that product's list.

| Product (sidebar, under SUBSCRIBE) | First client (arrives through a real invite, never seeded) |
| --- | --- |
| Media Studio Operations | Don't Blink Studioz |
| Account Manager | Velava Agencies |

Out of scope here (a later spec): the Beam Craft side after submission — number of users A+n, main account username/password, validity time, module selection.

## 1. Pages

- `SUBSCRIBE → Media Studio Operations` → `/subscribe/media-studio-operations`
- `SUBSCRIBE → Account Manager` → `/subscribe/account-manager`

Both render one component, `SubscriptionClientsPage({ product })`, built like Employee Repository (`EmployeeVerificationPage`): `ModulePageHeader` with tabs and a **Create Onboarding Invite** button, `DataTable` with column filters, footer with last updated / total rows.

- Rows: one per invite (and its company once submitted), for this product only.
- Tabs: **All · Form Pending · Submitted · Expired/Cancelled**.
  - Form Pending: invite not submitted and not expired/cancelled.
  - Submitted: company form received.
  - Expired/Cancelled: expiry passed before submission, or the team cancelled it.
- Columns: Company Name, Main Contact, Main Contact Phone, Contact Email, Number of Users, GST Number, Status, Invited On, Submitted On.
- Clicking a submitted row opens a side panel with every field, the logo and the favicon.
- Row actions: Copy message / Send Invite again (pending), Cancel invite (pending).

The Accounts Manager copy currently on `/subscribe/account-manager`, its permission entry, and the `title` prop added to `AccountsManagerPage` are removed.

## 2. Create Onboarding Invite

Dialog modelled on `OnboardingInviteDialog`. Fields, all required:

- Contact Person Name
- Contact Email
- Contact Phone (+91 country picker, as today)
- Expiry Date (default: 7 days from today)

The product is fixed by the page the dialog was opened from. On create, the **Onboarding Invite Created** box shows the message with the link, **Copy message**, and **Send Invite** (email, through the existing SMTP service — without SMTP configured, Send Invite reports the failure and Copy message still works).

Message text:

> Hi {name},
>
> Welcome to Beam Craft. Please complete your company's onboarding details for {product} here:
> {link}
>
> The link is open until {expiry}. You will be asked for your email or phone number to open it — use the one you gave us.
>
> Please keep this link to yourself.

Link: `{FRONTEND_URL}/client-onboarding/apply/{shortCode}`.

## 3. Client form (public)

Route `/client-onboarding/apply/[token]`, laid out like `/onboarding/apply/[token]`: Beam Craft logo, heading **Client Onboarding**, subtitle "Complete your company's onboarding details for {product}.", the invite summary (name, masked email/phone, expiry), then the form after the visitor confirms their email or phone.

All fields mandatory:

| Section | Field | Rule |
| --- | --- | --- |
| Company | Company Name | text, ≤150 |
| | Address | multi-line, ≤500 |
| | GST Number | 15 chars, GSTIN format |
| | PAN Number | 10 chars, `AAAAA9999A` |
| | Logo | PNG only, ≤5 MB |
| | Favicon | PNG or SVG, ≤1 MB (the existing `storeFavicon` service takes PNG/SVG, not ICO) |
| | Number of Users Needed | whole number ≥1 |
| Main contact | Name, Phone (+91), Designation | text / phone / text |
| Secondary contact | Name, Phone (+91), Designation | text / phone / text |

GST and PAN are upper-cased before checking. On submit: the company row is created, the invite is marked Submitted, and the page shows a thank-you state. A used, expired or cancelled link shows the matching message, as the employee form does.

## 4. Data

New Prisma migration, two tables:

`client_onboarding_invite` — id, product (`MEDIA_STUDIO_OPERATIONS` | `ACCOUNT_MANAGER`), contact_name, contact_email, contact_phone, token_hash (unique), token, short_code (unique), status (`Created` · `Verified` · `Submitted` · `Cancelled`), expires_at, verified_at, submitted_at, cancelled_at, client_id, created_by, created_at, updated_at. Expired is derived from `expires_at`, not stored.

`subscription_client` — id, product, company_name, address, gst_number, pan_number, logo_url, favicon_url, users_needed, main_contact_name, main_contact_phone, main_contact_designation, secondary_contact_name, secondary_contact_phone, secondary_contact_designation, contact_email, invite_id (unique), created_at, updated_at.

No seed rows.

## 5. Backend

New module `backend/src/modules/subscribe/client-onboarding/`, following `hrm/onboarding-invites`:

- Team routes, mounted at `/api/subscribe/client-onboarding`, behind auth + `SUBSCRIBE / Client Onboarding`: list (by product), create invite, send invite email, cancel invite, get one client.
- Public routes, mounted at `/api/client-onboarding`, rate-limited and not cached like `/api/onboarding`: get invite by token, verify (email or phone), submit (multipart: fields + logo + favicon).
- Reuses `shortCode`, token hashing, `phonesMatch`, `emailService` (a new client-invite template), `imageStorage.storeFavicon` (stores the file as uploaded, so the PNG logo keeps its transparency instead of being converted to WebP) with folders `beamcraft/client-onboarding/logo` and `beamcraft/client-onboarding/favicon`.
- zod validation on every body.

## 6. Permission

New `{ module: "SUBSCRIBE", feature: "Client Onboarding" }` added to the IAM seed (`prisma/seeds/iam-roles-permissions.js`) so Super Admin gets it and other roles can be granted it. Both `/subscribe/...` routes map to it in `modulePermissions.js`; `SUBSCRIBE` gets a label in `MODULE_LABELS`.

## 7. Environment

The website's `backend/.env` takes the DBS local R2 values (`R2_*`), copied without printing. Beam Craft files live under the `beamcraft/` folder in that bucket. A Beam Craft bucket can replace it later by changing only `.env`.

## 8. Testing

- Backend `node --test`: create → verify → submit happy path; wrong email/phone refused; expired and cancelled links refused; second submit refused; GST/PAN validation; product filter on list.
- Frontend: eslint on changed files; manual run on localhost — create invite, open link, fill form with real details, see the company under Submitted.
