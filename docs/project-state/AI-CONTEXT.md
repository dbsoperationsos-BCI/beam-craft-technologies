# DBS-Operations-OS AI Context

## Business Context

DBS-Operations-OS is the ERP / Operations OS for Don't Blink Studio. It manages workforce operations, clients, bookings, creative planning, production, post-production, delivery, accounts, assets, vendors, notifications, reports, and automation. It is not an HRM-only product; HRM begins first because Employee Management is a dependency for future operations.

## AI Behavior

- Nebula runs locally through the configured backend model provider; it does not require an OpenAI API key in this repository.
- The lead panel is lead-first and now hands off studio-wide project or meeting counts to the calendar or CRM summary instead of repeating the same refusal line.
- Questions outside the studio's work still get a short boundary response, but in-scope questions should read like a helpful colleague rather than a form error.

## Technology Stack

- Frontend: Next.js 16, React 19, Tailwind CSS 4, planned shadcn/ui.
- Backend: Node.js 24 and Express 5.
- Database: MySQL through Prisma 6.
- Authentication: JWT and bcryptjs.
- Validation: Zod.
- Authorization: CASL policy model.
- Planned infrastructure: S3-compatible object storage, Redis/BullMQ, structured logging, and observability.

## Folder Conventions

```text
backend/                         Current Express application
  prisma/                        Prisma schema and migrations
  src/                           Backend source
frontend/                        Current Next.js application
  src/app/                       App Router source
  public/                        Static files
docs/architecture/               Frozen master architecture
docs/roadmap/                    Frozen implementation roadmap
docs/project-state/              Handover and state archive
```

The target architecture may evolve toward `apps/web`, `apps/api`, optional shared packages, documentation, and infrastructure directories. Do not restructure the repository without explicit approval and an approved decision.

## Naming Conventions

- Use singular conceptual names in prose and modules: Employee, Client, Project, Booking.
- Use plural table names: `employees`, `clients`, `projects`, `bookings`.
- Use internal IDs for joins and `publicId` values for URLs and external references.
- Use explicit foreign key names: `employeeId`, `clientId`, `projectId`, `organizationId`.
- Use module-specific table names rather than generic names.
- Use past-tense domain events: `employee.activated`, `booking.confirmed`, `delivery.sent`.

## Database Conventions

- MySQL is the transactional system of record.
- Organization scope is the current data boundary; use `organizationId` on organization-owned records.
- Each module owns its tables. Other modules reference stable IDs rather than copying master data.
- Preserve history for employment, assignments, approvals, ledgers, accounting, stock movements, and audit records.
- Soft-delete only where recovery is meaningful; never hard-delete immutable or financial facts.
- Store binary content in object storage; MySQL holds metadata, ownership, access, versions, checksums, and links.
- Use migrations for all schema changes.

## Module Ownership

| Owner | Owns |
|---|---|
| Core Platform | Organizations, users, roles, permissions, documents, audit logs, outbox events, integrations, settings |
| Organization and Employee Management | Departments, locations, designations, employment types, employees, employment/assignment history |
| HRM | Attendance, leave, approvals, later payroll |
| CRM | Leads, clients, contacts, opportunities, quotations |
| Booking | Services, bookings, calendar events, crew/location reservations |
| Projects / Pre-Production | Projects, tasks, briefs, shot lists, call sheets |
| Production | Production days, crew call times, incidents, capture batches |
| Assets | Physical assets, stock, checkouts, maintenance |
| Vendors | Vendors, rates, contracts, procurement records |
| Post-Production | Media assets, versions, edits, reviews, approvals |
| Delivery | Deliverables, delivery packages, secure links, delivery events |
| Accounts | Invoices, payments, journals, budgets, vendor bills, payroll accounting |
| Notifications | Templates, preferences, notification records, delivery attempts |
| Automation | Workflows, triggers, executions, webhooks, WhatsApp automation |
| Reports | Dashboards, reports, schedules, exports, metrics |

## Relationship Rules

- Employee is the canonical workforce record; a User account is optional and separate.
- Attendance, Leave, Payroll, Booking assignments, Projects, Production, Assets, and performance-related future modules reference `employeeId`.
- CRM owns Client; Booking, Projects, Delivery, and Accounts reference `clientId`.
- Booking can create a Project; Project creates Production Days; Production creates media inputs; Post-Production creates Delivery outputs.
- Accounts references commercial and operational records but owns financial posting.
- A module must not directly modify another module's owned records.

## Architecture Principles

- Modular monolith first.
- Shared platform services and owned business domains.
- Explicit organization scope.
- Backend-enforced authorization.
- Validated, versioned APIs.
- Event-driven side effects after committed transactions.
- Stable history and auditability over destructive updates.
- No premature microservices, warehouse, or search infrastructure.

## Current Phase and Future Roadmap

Architecture and roadmap are frozen. The project is at the transition to **Phase 2: Organization and Employee Management**. The next artifact is the Employee Management Functional Specification; do not start schema or API implementation until it is approved.

1. Platform Foundation
2. Organization and Employee Management
3. HR Operations and Approvals
4. CRM and Client Management
5. Shoot Booking and Calendar
6. Projects and Pre-Production
7. Production, Assets, and Vendors
8. Post-Production and Delivery
9. Accounts and Payroll
10. Automation, Reports, and Enterprise Hardening

## Important Terminology

| Term | Meaning |
|---|---|
| Organization | Current company data boundary for Don't Blink Studio |
| User | Application login identity |
| Employee | Workforce identity; may or may not have a User account |
| Assignment | Effective-dated employee placement into department, designation, location, and manager relationship |
| Booking | Confirmed client service commitment and schedule |
| Project | Operational work container created from a booking or internal work |
| Production Day | Planned or actual shoot-day execution record |
| Media Asset | Logical creative asset with one or more versions |
| Deliverable | Final contracted output supplied to a client |
| Outbox Event | Persisted post-transaction event for notifications, automation, and integrations |
