# SDD ledger — plan: docs/superpowers/plans/2026-11-04-client-onboarding.md
Setup: Ruling: no git repo (user said do not create one) — no worktree/commits; changed files listed per task — cost if wrong: none, user commits manually
Pre-flight: T3->T4 rules exports match; T4->T6/T8 endpoints match; T1 deletes placeholder pages that T6 recreates — consistent
Setup: Ruling: never run the full backend suite — DBS tests write fixture rows into bct_db (two runs left 2 users + 6 lead activities, removed with scripts/clear-test-fixtures.js + a prefix delete); only targeted pure tests — cost if wrong: less regression coverage
Task 1: Ruling: also added subscribe to backend sidebarStructure.js mirror — user-preferences-sidebar test requires it, else saving a sidebar layout is rejected — cost if wrong: none
Task 1: complete (tests: node --test test/subscribe-permission.test.js test/user-preferences-sidebar.test.js → exit 0; IAM seed granted SUBSCRIBE/Client Onboarding)
Task 2: Ruling: migration SQL made with prisma migrate diff and trimmed to the two new tables — migrate dev's shadow DB hits the collation error and the DBS copy has unrelated schema drift — cost if wrong: none
Task 2: complete (prisma validate ok; migrate deploy → All migrations have been successfully applied; client generated)
Task 3: complete (tests: node --test test/client-onboarding-rules.test.js → 7/7 pass)
Task 4: Ruling: verify returns 403 on mismatch (spec said 403; employee flow used 400) — matches spec — cost if wrong: frontend message only
Task 4: complete (tests: node --test client-onboarding-controller + rules + subscribe-permission + user-preferences-sidebar → 20/20 pass; curl 5101 /api/client-onboarding/invites/ABCDEFGH → 404 JSON)
Task 6: Ruling: no separate ClientDetailsPanel — reused DataTableInfoPanel + RecordViewPanel with clientInfoSections (gallery shows logo/favicon), as Accounts Manager does — cost if wrong: none
Task 6: Ruling: list rows for Pending invites include 'message' (backend) so Copy message works from the row menu — cost if wrong: none
Task 6: complete (tests: node --test test/subscription-clients-tabs.test.mjs → 3/3 pass; eslint clean; both routes 200)
Task 7: complete (eslint clean; dialog wired; manual check deferred to Task 8 end-to-end)
Task 8: Ruling: no route allow-list change — this copy has no proxy/middleware; pages outside app/(app) are already public — cost if wrong: link would redirect to login
Task 8: Ruling: no end-to-end submit with made-up company data — user's no-test-rows rule; first real invite (Velava/DBS) is the e2e check — cost if wrong: an untested path reaches the user
Task 8: complete (eslint clean; /client-onboarding/apply/ABCDEFGH → 200; backend nodemon reloaded .env with R2)
Final: fixed submit race (double-click deadlock → 500, cancel overwritten) — claimAndCreateClient conditional claim + P2034→409; tests 'a submit claims the invite…' and '…loses the race…' RED→GREEN, suite 23/23 backend + 3/3 frontend
Final: fixed no-R2 submit → 500 on VARCHAR(500) — assertUploadsCanBeStored → 503 with clear message; test RED→GREEN
Final: minor (deferred): verification is per invite not per visitor (same as employee flow)
Final: minor (deferred): usersNeeded has no upper bound — huge number gives 500
Final: minor (deferred): phone verify misses leading 0 / dots; 7-digit tail rule is loose (shared employee logic)
Final: minor (deferred): pasting GST/PAN with a leading space gets cut by maxLength
Final: minor (deferred): 409/410 on submit shows a toast but leaves the form open
Final: minor (deferred): backend size messages don't name Logo/Favicon
Final: minor (deferred): file type checked by extension/MIME only; uploaded SVG served publicly
Change 2026-11-04 17:30: Ruling: HRM Employee Repository row renamed Client Details → /hrm/client-details (all products, Product column, invite asks product); /employees kept, reached from the heading switch as 'Employees'; SUBSCRIBE product pages kept as filtered views — user may want them removed (their chosen option text said removed, preview showed them) — cost if wrong: two menu entries to delete
Change 2026-11-04 17:45: invite box gets optional company details (prefill JSON column, migration 20261104180000); images uploaded at invite time; client form opens prefilled, all still required; submit accepts the kept prefill image URL only — tests: rules 8/8, controller incl. resolveSubmittedImage, frontend 1601
Change 2026-11-04 17:50: user asked to remove the optional company section — reverted prefill (UI, backend, tests); column dropped by migration 20261104181000 (table had 0 rows)
Change 2026-11-04 18:00: user chose company details in the invite box, required; column company JSON (migration 20261104182000); logo/favicon stored at invite; client link = verify, review read-only, Confirm & Submit (no body); pending rows show entered company; backend restarted after generate — tests backend 26, frontend 1602
Change 2026-11-04 18:10: user: invite box = Company Details only (Product/contact/expiry removed). Invite has optional company prefill, 7-day expiry, no product/contact (columns nullable, migration 20261104183000); no verify step, no Send Invite email (no address); client form editable, prefilled, all required. Tests backend 25, frontend 1602
Change 2026-11-04 18:25: select all + bulk delete (mountBulkDelete /invites/bulk, ADMIN Table Select All + SUBSCRIBE write), row ⋮ = Edit, Delete only (View via double-click; Copy message and Cancel invite removed per user); PATCH /invites/:id edits company (submitted: all required; pending: optional); DELETE /invites/:id removes company then invite — R2 images are not deleted; tests backend 26, frontend 1602
Change 2026-11-04 18:35: SUBSCRIBE product pages show Sl. No., Company Name, Contact Number only; product is chosen in Edit (PATCH product, optional, "" clears) — tests backend 27, frontend 1602
Plan 2026-11-04-client-subscription-setup: complete — rules 6 tests, endpoint PUT /invites/:id/subscription (bcrypt hash only, password shown once), tabs All/Form Pending/Submitted/Active/Expired/Link Expired/Cancelled, SubscriptionDialog; backend 35 tests, frontend 1602
Final (subscription): fixed Edit changing product of a set-up client (modules mismatch) — assertProductEditable, test RED→GREEN, backend 36/36
Final: minor (deferred): impossible dates like 2026-02-31 accepted via API / 2026-13-01 → 500
Final: minor (deferred): module check uses 'in' (prototype keys) and keeps duplicates
Final: minor (deferred): two simultaneous first setups can hand out a password that doesn't work
Final: minor (deferred): usersAllowed no upper bound → 500 on huge numbers
Final: minor (deferred): dialog default dates a day early when opened 00:00–05:29 IST
Final: minor (deferred): no reserved subdomains (www, api, admin, mail)
Change 2026-11-04 19:10: modules are now module/screen keys from DBS and Velava sidebars (MODULES_BY_PRODUCT with screens, isProductScreen own-keys only, deduped); picker = module box ticks all screens + per-screen boxes; old whole-module saves open expanded; details panel shows Subscription incl. modules summary — backend 27, frontend 1603
Change 2026-11-04 19:40: SUBSCRIBE pages view-only; Update site flow — first setup live as v1 + subscription_version row; later edits saved as pendingChanges (password reset immediate); POST publish → next version, DELETE pending → discard; tab Update Pending (violet); product pages show Version; fixed Json null → Prisma.DbNull in updateInvite — backend 39, frontend 1604
Change 2026-11-04 19:50: site health monitoring — site_health_check table (7 days kept), checkSite/summarizeHealth/healthFor, monitor every 5 min from API process (SITE_HEALTH_MONITOR, SITE_HEALTH_INTERVAL_MS, SITE_HEALTH_URL_TEMPLATE), POST /invites/:id/health-check (READ), SUBSCRIBE pages: Health/Response/Last Checked/Uptime (24h) + Check now; plain-word failure reasons — backend 44, frontend 1606
Fix 2026-11-04 20:05: column resize not smooth — root cause: website copy of DataTable used TanStack getResizeHandler (wrong start width, header drag-to-reorder swallowed pointer, save+full redraw per pixel); DBS already fixed it with pointer-driven startResize; ported only that part (draftSizing/shownSizing/resizingId, startResize, guards, 12px handle) + DBS's resize test and two one-line test updates — frontend 1610
Change 2026-11-04 20:15: Reset password is its own row action (⋮ → Reset password on set-up clients, confirm, immediate, new password shown once in the message); tick box removed from Edit subscription; POST /invites/:id/reset-password — backend 45, frontend 1610
Final e2e review fixes 2026-11-04 20:40: termEnd crash on cleared Valid From; pending subdomains reserved (JSON path); 410 vs 409 on lost claim + client form shows expired/cancelled; Product read-only in Edit for set-up clients; info panel follows latest rows; clash + replaced-image messages; modules open for pending product — backend 48, frontend 1611. Deferred: no way to recopy/renew a pending link (user removed Copy message); Active before Valid From; no reserved subdomains
