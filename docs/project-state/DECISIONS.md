# DBS-Operations-OS Architecture Decision Log

## Decision 001 — Define DBS-Operations-OS as an ERP / Operations OS

**Decision:** DBS-Operations-OS is the operational ERP for Don't Blink Studio, not an HRM-only application.

**Reason:** The long-term product must manage people, clients, bookings, creative production, delivery, finance, assets, vendors, reporting, and automation.

## Decision 002 — Start With Employee Management

**Decision:** Employee Management is the first business module.

**Reason:** Attendance, leave, payroll, shoot assignments, team allocation, performance, and login/access relationships depend on a trusted employee record.

## Decision 003 — Keep User and Employee Separate

**Decision:** `users` represents application login identity; `employees` represents workforce identity. Their association is optional one-to-one.

**Reason:** Not every employee requires system access, and future external/system users may not be employees. Employment history must not depend on account state.

## Decision 004 — Use a Modular Monolith

**Decision:** Build one deployable application with strict module boundaries before considering microservices.

**Reason:** The product is early-stage. A modular monolith reduces operational complexity while preserving a future extraction path.

## Decision 005 — Preserve the Existing Technology Stack

**Decision:** Use Next.js, React, Tailwind CSS, shadcn/ui, Express, Prisma, MySQL, JWT, Zod, and CASL.

**Reason:** The existing foundation uses this stack, and it supports the required web, API, relational-data, validation, and authorization needs without an unnecessary technology change.

## Decision 006 — Use MySQL as the Transactional System of Record

**Decision:** MySQL remains the primary transactional database accessed through Prisma.

**Reason:** The ERP model is relational and requires transactional integrity, foreign keys, migrations, and historical records.

## Decision 007 — Use Organization Scope Now; Defer Separate Tenancy

**Decision:** `organizations` is the current company boundary. A distinct tenant layer is deferred.

**Reason:** Don't Blink Studio is the initial organization. Adding both tenant and organization concepts now would duplicate scope without a validated product requirement.

## Decision 008 — Use Shared Core Platform Services

**Decision:** Authentication, authorization, documents, audit, notifications, settings, integrations, and events are shared services.

**Reason:** Recreating these concerns in each module would create inconsistent security, duplicated data, and costly maintenance.

## Decision 009 — Enforce Module Ownership

**Decision:** Each module owns its tables and rules; other modules reference stable identifiers and do not directly mutate owned records.

**Reason:** Clear ownership prevents coupling and enables future module development, testing, and service extraction.

## Decision 010 — Use Effective-Dated Employee History

**Decision:** Employment and assignment changes retain history rather than overwriting past organizational state.

**Reason:** Transfers, promotions, manager changes, exits, reporting, and future payroll require historical accuracy.

## Decision 011 — Use JWT Authentication With Backend Enforcement

**Decision:** The Express API issues and validates JWT credentials; frontend checks do not replace backend authorization.

**Reason:** The architecture separates the Next.js frontend from the Express API. Security must be enforced at the API boundary.

## Decision 012 — Use CASL for Permission Vocabulary

**Decision:** CASL is the shared authorization policy model across frontend and backend.

**Reason:** It supports consistent role, permission, and data-scope behavior with React, Node.js, and Prisma.

## Decision 013 — Store Files Outside MySQL

**Decision:** Store file and media binary content in S3-compatible object storage; keep metadata and links in MySQL.

**Reason:** Documents and creative media can be large, versioned, and access-controlled. Database blobs weaken scalability and operational manageability.

## Decision 014 — Use Outbox-Backed Events

**Decision:** Persist domain events in `outbox_events` after committed transactions and process them asynchronously.

**Reason:** Notifications, automation, integrations, and reporting side effects must not be lost or run before the business change commits.

## Decision 015 — Sequence Booking Before Projects and Production

**Decision:** CRM feeds Booking; Booking feeds Projects and Pre-Production; Projects feed Production.

**Reason:** This matches the commercial-to-operational lifecycle and prevents uncontextualized production work.

## Decision 016 — Defer Payroll Until Its Dependencies Are Stable

**Decision:** Payroll follows Employee Management, Attendance, Leave, Approvals, and Finance foundations.

**Reason:** Payroll requires accurate employment, time, leave, approval, compensation, and accounting data. Building it early would create high-risk rework.

## Decision 017 — Place Asset Reservations With the Assets Phase

**Decision:** Shoot Booking delivers crew and location scheduling first; asset reservations and conflict workflows arrive with Assets in Phase 7.

**Reason:** Asset availability depends on an asset registry, custody, status, and maintenance model.

## Decision 018 — Separate Procurement From Financial Posting

**Decision:** Vendors owns purchase requests, purchase orders, and line items; Accounts owns vendor bills and financial posting.

**Reason:** Procurement is an operational vendor commitment; accounting determines payable recognition, payment, and ledger impact.

## Decision 019 — Freeze Architecture and Roadmap Before Implementation

**Decision:** Architecture and the Phase 1–10 roadmap are frozen pending explicit approved changes.

**Reason:** Implementation must proceed against stable boundaries to prevent rework and conflicting module decisions.
