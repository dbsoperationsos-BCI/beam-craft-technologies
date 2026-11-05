# WhatsApp Activity Log and Resend — architecture report and design

Date: 2026-10-17. Status: implemented in the same branch as this spec.

## 1. Audit findings

### Transports

| Transport | Where the send happens | Returns | Fails by | Configured by |
| --- | --- | --- | --- | --- |
| Baileys (a WhatsApp-Web session per staff login, QR-paired) | `backend/src/modules/sales/whatsapp-chat/sessionManager.js` — `sendMessageToLead`, `sendMessageToPerson`, `sendMessageToGroup`, `sendMediaToLead`, `actOnMessage` (reply/forward), all ending at `socket.sendMessage` | `{ waMessageId, chatJid }` | thrown Error with `.status` and sometimes `.code` (`WHATSAPP_NOT_CONNECTED`, `NOT_ON_WHATSAPP`, `NOT_A_GROUP`) | studio switch + per-user switch in `whatsapp-chat/repository.js`; `WHATSAPP_*` limits are advisory only |
| Meta Cloud API (template messages) | `backend/src/modules/image-selection/whatsapp/providers.js` → `createMetaProvider().sendTemplateMessage` | `{ providerMessageId, status: "SENT" }` | thrown `appError` with `code` `META_*` / `INVALID_*` | `WHATSAPP_PROVIDER=meta|mock`, `META_WHATSAPP_*` env |

No WATI integration exists. The AI Feature module sends nothing over WhatsApp and has no provider configuration of its own. There is no inbound WhatsApp webhook today (Callyzer is the only webhook). Baileys delivery and read receipts already arrive through the `messages.update` handler in `sessionManager.js` and are written only to the CRM chat table.

### Send paths (every one of them)

Manual, from a staff button, over Baileys:

| Trigger | Caller | Recipient |
| --- | --- | --- |
| CRM lead message / attachment / reply / forward | `sales/whatsapp-chat/controller.js` `send`, `sendMedia`, `act` | lead's WhatsApp number |
| Client login credentials | `sales/projects/controller.js` `sendClientLoginWhatsApp` | `salesProject.clientMainNumber` |
| CRD document link | `sales/crd-documents/groupSend.js` `sendToProjectGroup` | project's WhatsApp group |
| Onboarding invite | `hrm/onboarding-invites/controller.js` `sendInviteWhatsApp` | candidate phone |
| Interview application invite | `hrm/interview/invites.js` `sendInviteWhatsApp` | candidate phone |
| Interview candidate message | `hrm/interview/controller.js` `sendCandidateWhatsApp` | candidate's WhatsApp number |
| Employee login credentials | `hrm/employees/controller.js` `sendCredentialsWhatsApp` | employee contact number |
| Image Selection gallery invite to group | `image-selection/whatsapp/group.service.js` `sendInvite` | project's WhatsApp group |
| Signature Album share to group | `image-selection/signature-album/signatureAlbum.share.service.js` `sendToGroup` | project's WhatsApp group |

Manual, over Meta: Image Selection `POST .../whatsapp/send` → `whatsapp/service.js` `queue` → BullMQ `image-selection-whatsapp` (3 attempts, exponential backoff) → `process` → provider. The frontend no longer calls this route, but the backend path is live.

Automatic, over Baileys:

| Trigger | Caller | Dedup today |
| --- | --- | --- |
| Production step messages (started from studio, reached shoot place, shoot completed) | `project-management/production/messages.js` `sendStepMessage`, claimed in the step's transaction by `claimSending` | unique `(productionId, step)` row; manual retry by the Production Manager |
| Attendance daily report | `hrm/attendance/reportGroup.js` `runOnce` → `deliverToGroup` | claim on `hrmSettings`, retried every 5 min in a 135 min window |
| Birthday and anniversary wishes | `settings/wishes/sender.js` → `deliverToGroup` | `EmployeeWish` unique row per person, kind and day |

### Existing partial logs

`ImageSelectionWhatsAppNotification` (Meta and group invites), `ProjectProductionMessage` (production, with safe `reason`), `EmployeeWish`, and the raw-SQL `SalesCrmWhatsAppMessage` (lead chat, with sent/delivered/read status). HRM invites, credentials, client login, CRD link and signature album are not logged anywhere.

### Consent and eligibility

Both chat switches are checked by every path except Meta `/send` and CRM `act`. Baileys refuses numbers not on WhatsApp (`confirmOnWhatsApp`). Phone numbers are always read from the record, never from the request. There is no guest opt-in or verified-phone concept in this codebase; "consent" here means the two switches, an active login for the sender, and a number still on the record.

## 2. Design

### Principle

One shared service, `backend/src/services/whatsappActivity.js`, wraps every send: `track(context, sendFn)`. The caller supplies what only it knows (mode, trigger, recipient, links, body) and the service writes one `whatsapp_activity` row per logical message and one `whatsapp_activity_attempt` row per try. Sends are never blocked by the log: if the log cannot be written the send still goes and the failure is logged to the console.

Automatic events pass a `logicalKey`; a second call with the same key while the activity is already SENT/DELIVERED/READ is answered from the row and nothing is sent again. A call for a FAILED activity adds an attempt to the same row.

### Schema

`whatsapp_activity`: id, logical_key (unique), mode (MANUAL/AUTOMATIC), provider (baileys/meta/mock), source_module, trigger, event_ref (a dedup string, never parsed), initiated_by_user_id → user, sender_user_id → user, sales_project_id → sales_project, crm_lead_id → sales_crm_lead, employee_id → employee, image_selection_project_id → image_selection_project, production_id → project_production, image_selection_notification_id → image_selection_whatsapp_notification (the two rows a resend syncs back to, as keys rather than ids read out of `event_ref`), recipient_kind (PERSON/GROUP/LEAD), recipient_masked, recipient_name (an audit snapshot, not a name copy), recipient_address (raw, nullable - null when nothing could be addressed - never returned by the API), template_key → message_template, body_preview (links replaced by "[link]"), body (full, only kept when resendable and non-empty), resendable, status (QUEUED/PROCESSING/SENT/DELIVERED/READ/FAILED), failure_code, failure_reason (safe wording), attempt_count, provider_message_id, created_at, attempted_at, sent_at, delivered_at, read_at, updated_at. Indexes on created_at, (status, created_at), (mode, created_at), (source_module, created_at), (trigger, created_at), provider_message_id and every foreign key; none on the `contains`-searched text columns, which an index cannot serve.

`whatsapp_activity_attempt`: id, activity_id → whatsapp_activity (cascade), attempt_no, kind (INITIAL/RETRY/RESEND), requested_by_user_id → user, sender_user_id → user, status (PROCESSING/SENT/FAILED), provider_message_id, error_code, error_message (raw, DB only), error_safe (whether error_message may be shown), ambiguous (the send may have gone), started_at, finished_at.

### Status lifecycle

QUEUED → PROCESSING → SENT → DELIVERED → READ, or → FAILED. Baileys: `messages.update` receipts (`sessionManager.js`) also call `onDeliveryStatus(waMessageId, status)`; the update is monotonic (a rank compare in the WHERE), so duplicates and out-of-order receipts are no-ops. Meta: a webhook `GET/POST /api/public/whatsapp/meta/webhook` is mounted only when `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN` and `META_WHATSAPP_APP_SECRET` are set; POST verifies `X-Hub-Signature-256` over the raw body, is rate-limited, and feeds `statuses[]` through the same monotonic update. Meta "failed" statuses mark the activity FAILED with the provider's error code.

### Resend

`POST /api/settings/whatsapp-activity/:id/resend`, behind `SETTINGS / WhatsApp Activity Log` READ_WRITE and a 10/min per-user limiter. Eligible when status is FAILED, `resendable`, `attempt_count < 6`, and the last attempt finished at least 30 s ago. Claimed with a conditional `updateMany` (FAILED → PROCESSING) so two clicks or two tabs cannot both send; the loser gets 409. The send is rebuilt from the row: group → `sendMessageToGroup` from the original sender's session; person → `sendWhatsAppToPerson` (both switches re-checked, number re-confirmed on WhatsApp); lead → `sendMessageToLead` (files into the thread as a new message); Meta → the notification row is re-queued. After a successful resend of a production message or an Image Selection group invite, that module's own status row is marked SENT too, so the two screens agree. Credentials (passwords) and media attachments are recorded with a redacted preview and `resendable = false`: the UI says to send them again from their own screen. Attendance reports and wishes are `resendable = false` because their schedulers retry them. Neither provider offers a "what happened to message X" query, so ambiguous failures are flagged on the attempt and the dialog warns before resending one.

### API

`/api/settings/whatsapp-activity` (protect + `requireModule("SETTINGS", "WhatsApp Activity Log")`): `GET /` (offset/limit list with filters: search, mode, status, module, trigger, recipient, from, to), `GET /summary`, `GET /options` (trigger and module lists), `GET /:id` (detail with attempts), `POST /:id/resend`.

### Frontend

Settings → User Settings → **WhatsApp Activity Log** (`frontend/src/components/settings/WhatsAppActivityLogPanel.js`), gated on `SETTINGS / WhatsApp Activity Log` READ. Summary tiles (total, sent, delivered, pending, failed), a filter row (search, mode, status, module, trigger, date range), a `DataTable` message history with server paging on scroll, and a detail `Dialog` with the attempts and a Resend button (write only). Service: `frontend/src/services/settings/whatsapp-activity.service.js`.

### Permission and reach

`SETTINGS / WhatsApp Activity Log`, level `SETTINGS_WHATSAPP_ACTIVITY`, in the catalogue and in a migration granting SUPER_ADMIN only. The log is studio-wide: it is not narrowed by branch or `dataScope`, and a holder of Read / Write resends from the original sender's WhatsApp (as the production Retry already does). The changelog says so, so the studio grants it knowing that.

### Review outcomes folded in

The db-schema, security, backend-api, frontend-ui and ux-heuristics reviewers each ran once after the first implementation. Their findings that changed the design: linked `production_id` and `image_selection_notification_id` columns instead of ids parsed from `event_ref`; a nullable `recipient_address`; links stripped from previews; the Meta verify token compared in constant time; a resend whose log write fails after the send went is reported rather than marked FAILED (which would have offered it for a second send); the summary's "Sent" counts only messages awaiting delivery, so the tiles add up to the total; the screen's wording lost the developer terms (provider, template, event, codes), gained visible filter labels with the rarer filters folded under "More filters", a View control for the keyboard, an "Updated at" line, rows that stay put while a filter re-reads them, and a Resend that cannot be double-pressed.

### Out of scope

wa.me links opened in the browser (the staff member's own phone sends them), the legacy WhatsApp automation, and any change to provider configuration or env values.
