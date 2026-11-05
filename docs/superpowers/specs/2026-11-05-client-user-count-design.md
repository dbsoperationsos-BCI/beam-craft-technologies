# Client user count - design

**Date:** 2026-11-05 · **Projects:** Beam-Craft-Website (backend + frontend), Velava Agencies (backend)

## Why

BeamCraft sells a client site with a set number of users (Set Up Account → "Number Of Users", e.g. 5).
The client's Admin creates users on their own site. Velava already refuses a user that would pass the limit,
but BeamCraft cannot see how many users a client actually has. BeamCraft needs the number, per client,
to monitor use against the plan.

## What BeamCraft shows

- **Tables** - Client Details and each product page under SUBSCRIBE get a **Users** column (`3 of 5`) and,
  beside it, a **User Limit** status with the table's coloured dot: `Within limit` (green), `At limit` (red - at or
  over the limit, e.g. `5 of 5`), `Not reported yet` (grey) before the site has ever sent a count. (The table's
  dots are keyed by a fixed label, so the red shows on this status rather than on the number itself.)
- **Details panel** - Subscription section gets **Users In Use**: `3 of 5`, and **Users Reported** with when
  the site last sent the count.

Only the count. No user names, phones or activity history.

## What is counted

Active users the client's Admin created (`users.is_active = true` in Velava). The Admin login itself is not
counted - the same rule Velava's `userLimitReached` applies when it refuses the next user.

## How the count reaches BeamCraft

The client's server pushes it; BeamCraft never calls into the client for it.

1. Velava's `sync()` (every minute, and before a sign-in when the copy is stale) already reads
   `GET /api/client-site/subscription`. After a successful read it counts its active users and sends
   `POST /api/client-site/usage` with body `{ "activeUsers": <n> }`, the same `Authorization: Bearer <site key>`
   and `X-Site: <subdomain>` headers.
2. BeamCraft checks the site key exactly as the subscription read does (`siteKeyMatches`, one
   `401 This site is not recognised.` for unknown subdomain / no key / wrong key), refuses a site whose account
   is not set up (`404`), validates `activeUsers` as a whole number 0-100000 (`400` otherwise), and stores it.
3. A failed send is logged in Velava and tried again on the next sync; it never affects sign-in or the site.

The route sits on the existing `client-site` router, so it shares its rate limit (300 per 15 min per address)
and `Cache-Control: no-store`.

## Data

`SubscriptionClient` gets two nullable columns (one Prisma migration):

- `activeUsers Int? @map("active_users")` - the last count the site sent.
- `usersReportedAt DateTime? @map("users_reported_at")` - when it sent it.

Both are written only by the site's usage call, never by the Set Up Account / Edit subscription forms.

## Changes

**Beam-Craft-Website backend**
- `prisma/schema.prisma` + migration: the two columns.
- `siteApi.js`: `reportSiteUsage(req, res, db)` - auth as `getSiteSubscription`, validate, update.
- `siteRoutes.js`: `router.post("/usage", ...)` with `express.json()`.
- Nothing in the serializer: `serializeInvite` already passes every client column except the two hashes.

**Beam-Craft-Website frontend** (`subscriptionProducts.mjs`)
- `clientRow` adds `usersInUseLabel` (`3 of 5` / `3` when no limit / `""` before a report), `userLimitStatus`
  (`Within limit` / `At limit` / `Not reported yet`) and `usersReportedLabel`.
- `Users` and `User Limit` columns in `clientTableFields` and `productTableFields`; the two new labels in `clientStatusStyles`.
- `Users In Use` and `Users Reported` rows in the Subscription section of `clientInfoSections`.

**Velava backend** (`src/subscription.js`)
- `reportUsage()` after a successful `fetchRemote()` in `sync()`: `prisma.user.count({ where: { isActive: true } })`,
  POST it; errors logged, not thrown. Nothing happens when BeamCraft is not configured.

## Tests

- Backend: usage call - right key stores the count and time; unknown subdomain / no key / wrong key → 401 with
  one message; not set up → 404; `-1`, `2.5`, `"3"`, missing → 400; nothing else on the client changes.
- Frontend: `clientRow` labels - `3 of 5`, `5 of 5` at limit, more than allowed at limit, never reported.
- Velava: `reportUsage` sends the active count with the site headers, and swallows a failed send.

## Out of scope

User list, phone numbers, activity history, alerts/emails when a client reaches its limit.
