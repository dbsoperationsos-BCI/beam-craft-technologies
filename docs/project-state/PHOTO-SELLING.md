# Photo Selling

Visual Curation → **Photo Selling**: the studio's own galleries of photos sold to guests -
created, filled with photos, priced and published entirely inside Photo Selling - with server-priced
carts, Cashfree payments, verified orders and authorised delivery. Guests find their photos by a
selfie and see only the photos they are in - never the gallery whole; what they buy is each photo's **original**, stored privately and downloadable only once the server
has verified their payment. It needs nothing from any other module: no AI Feature event, no Image
Selection project.

Read by section: `grep -n '^## ' docs/project-state/PHOTO-SELLING.md`.

## Where it sits

| Side | Location |
| --- | --- |
| Web sidebar | Visual Curation → Photo Selling, an entry beside AI Feature — `frontend/src/constants/navigation.mjs` |
| Web staff screens | `/visual-curation/ai/photo-selling` (Overview), `/galleries`, `/galleries/[galleryId]?step=`, `/orders` — `frontend/src/components/photo-selling/` |
| Web guest store | `/s/[code]` and `/s/[code]/orders/[orderRef]` — `frontend/src/components/photo-selling/store/` |
| Desktop | Photo Selling, a sidebar entry beside AI Feature (`#/ai-curation/photo-selling`) in `Image-Selection_Desktop---BCT`; uploads originals through its transfer engine (`src-tauri/src/queue.rs`) |
| Backend staff API | `/api/photo-selling/*` — `backend/src/modules/photo-selling/routes.js` |
| Backend guest API | `/api/public/photo-selling/*` — `backend/src/modules/photo-selling/public/routes.js` |
| Webhook | `POST /api/public/photo-selling/webhooks/cashfree` — `payments/webhook.js` |
| Tables | `photo_sale_*` (migrations `20261023130000_photo_selling`, `20261026120000_photo_selling_originals`) |
| R2, originals | `photo-selling/gallery-<id>/originals/<uuid>/<name>` in the studio's existing bucket (or a separate one when named) — the originals, `shared/storage.js` |
| R2, public bucket | `photo-selling/gallery-<id>/{previews,thumbnails,watermarked,watermark}/` — shown only, never sold |

## The flow

**Create → Upload photos → Set prices → Publish**: the first three are steps of the gallery
workspace (`1 · Details`, `2 · Photos`, `3 · Prices`, then `Orders`; a tick marks each step that
is done). **Publish** is not a step: the header's Publish button appears once nothing blocks it
(Prices ends with one too), and until then the banner above every step lists what is missing
and leads to the step that fixes it. An older `?step=preview` link opens the last-used step. **Share** is not a step:
as on an AI Feature event, the header's Share button opens **Share with guests**
(`gallery/GalleryShareDialog.js`, laid out as `ai-feature/event/ShareDialog.js`) - the gallery link
with copy / open / New link code, the Access PIN with Require a PIN and Reset PIN, the QR beside its
short code, status and closing date, the ready-to-send message, and QR Template / Done. **QR Template**
(`gallery/GalleryQrTemplateDialog.js`, laid out as `ai-feature/event/QrTemplateDialog.js`) takes the
Share dialog's place, back arrow and Back return to it: the ten shared designs (`lib/qrPoster.mjs`),
a live preview, Heading / Under the heading / Instruction and the other lines, and Download PDF /
Download PNG at A1 (7016 x 9933 px at 300 dpi). It reads the gallery's own kit (`GET
galleries/:id/qr-kit`) each time it opens and starts from the gallery's saved design and words; a
download by someone at Read / Write keeps the chosen design and words with the gallery (only after
the file was saved, only when they changed), so the next poster starts from them. There is no QR
poster step: this is the gallery's one poster screen, and an older `?step=qr` link opens Share.
Both draw with one hook, `useSalePoster` in `shared/SaleQrPosterEditor.js`. Publishing
opens it, and `?step=share` (an older link) does too. It shows no "opened" figures: Photo Selling
does not count store visits per link. The rest of the management screens follow the AI Feature's
patterns too: event-style gallery cards, its status pill, its dashboard range bar and empty state.
Each card has the AI Feature's ⋮ (`galleries/GalleriesPage.js` + `GalleryActionDialog.js`): **Open
Gallery** for anyone who may see it; for Read / Write **Edit** (the Details step - a link naming a
step opens it over the remembered one), **Duplicate**, **Archive** / **Restore** and **Delete** (on
every gallery - live, archived and sold ones too; see Deleting a gallery) - each asking first. **Duplicate** (`POST
galleries/:id/duplicate`, only a `title`) copies the set-up into a new private draft: welcome note,
price, tax, packages, look, match strictness, watermark and QR poster; never what belongs to the
original event - client, date, venue, photos, cover, orders, closing date - nor its link: the copy has
its own link and short code and, where the original asks for a PIN, its own PIN. A logo watermark is
copied into the copy's own folder (none, if the original's logo is no longer stored). All or nothing:
a failure part-way (a storage fault) deletes the new draft and any copied file, and is reported.

- **Create** asks for the event's details up front: its name (required), the client and their phone,
  the event date, venue and a welcome note. It saves a DRAFT and opens the Photos step. Everything
  else - price, tax, PIN, how guests find photos, match strictness, colour, watermark and QR poster -
  is copied on from **Photo Selling's own settings** (see Settings), never from the AI Feature's.
- **Details** holds the event and client, the closing date, the watermark, colour and how closely a
  face must match a guest's selfie.
- **Photos** uploads straight into the gallery (drag-and-drop, choose files or a folder) with
  progress, pause, retry-failed and cancel - each photo's original, plus a preview made on the
  uploader's computer. Photos can be hidden, given their own price, set as the cover, or removed. A
  photo with no original stored (uploaded before originals were kept) is marked and not for sale
  until it is uploaded again. While no private originals bucket is set up, uploading is refused and
  the step says why.
- **Prices**: one price per photo (the original), optional per-photo prices, tax (inclusive or
  added), packages ("any N photos for ₹X").
- **QR poster** (not a step - Share with guests → QR Template): a printable A1 poster whose code
  opens this gallery's own store (see QR posters); its design and words are saved with the gallery.
- **Publish** (the header's button): offered only when nothing blocks it - photos on sale, ready for
  selfie search, a price, a watermark. What blocks it is the banner above every step, each item
  leading to its step; advice (payments not set up, photos without an original) shows on Details.
  The server's own preview endpoint (`GET galleries/:id/preview`) remains; the web no longer has a
  preview tab.
- Every step saves as it goes: a gallery left half done is a draft in Galleries → Drafts, reopened
  with everything it held. Any gallery can be deleted, its files and originals too (see Deleting a
  gallery); one with orders keeps only its orders' record.

## Settings

Galleries → ⋮ (beside **+ New Gallery**) → **Settings** opens them in a dialog over the Galleries page
(`settings/PhotoSellingSettingsDialog.js`; `?photoSettings=1` opens it - not `?settings=`, which is the app-wide Settings overlay's - and the old
`/visual-curation/ai/photo-selling/settings` address redirects there). Settings is not a section of
the header switch (Overview / Galleries / Orders). Closing with unsaved edits asks first; a save
closes the dialog and says so. On the same
`IMAGE_SELECTION / Photo Selling` permission (Read sees it, Read / Write saves). One row,
`photo_sale_setting` ("default"), read and written only by `settings/service.js`; the AI Feature's
settings are never read in its place, and nothing here changes the AI Feature.

- **New gallery defaults** - price per photo, tax and whether prices include it, whether a PIN is
  required, the watermark design, the button colour. Copied onto a gallery when it is created, so a
  later change never alters an existing gallery.
- **Selfie search** - how closely a face must match (guests find photos only by selfie; there is no
  browsing to switch on).
- **Buyers' downloads** - how many times, for how many days after payment, each photo bought can be
  downloaded (20 and 365 until changed; the environment's `PHOTO_SELLING_DOWNLOAD_LIMIT` / `_DAYS`
  give the starting values). Frozen on each order at checkout.
- **QR poster defaults** - the design and words new galleries' posters start with, previewed on a
  placeholder link (`GET settings/qr-sample`).

Watermark designs themselves are the studio's shared library (the presets every module draws from);
Photo Selling keeps its own choice of default, and each gallery its own copy of the design.

## QR posters

Each gallery has a printable poster - the shared poster designs (`frontend/src/lib/qrPoster.mjs`, ten
designs, also used by the AI Feature) with Photo Selling's own words (`lib/photoSellingQr.mjs`: "YOUR
PHOTOS / ARE READY / SCAN TO VIEW & BUY"; the AI Feature's "register your face" words never print on
a sales poster). The design id and words are saved on the gallery (`qr_template_id`, `qr_text`),
starting from the settings and kept from the last download in QR Template. The code, PIN and studio logo come from `GET galleries/:id/qr-kit`, built
on the server from the gallery's own short code (`storeUrl`), so a poster can only ever open the
gallery it was made for; a new link code or PIN is what the next download prints. The studio's name and logo on the poster are the studio-wide branding (Settings → Branding Logo, stored with Image Selection's settings) - the one thing Photo Selling reads from another module's settings, and only to draw the mark. Exports: A1 PNG at
300 dpi or an A1 PDF, as the AI Feature's posters.

## Purchase flow and states

`DRAFT → PUBLISHED` (gallery) → cart → `PENDING` order (items `PENDING_PAYMENT`) → Cashfree checkout
→ payment verified by the server → order `PAID`, items `READY` → each download through a fresh
single-use ticket.

1. The guest opens `/s/<code>` (PIN first, where set), takes a selfie, and adds photos from their own
   matches to the cart. Opening the store is not a match: with no matching search, nothing can be
   seen, priced or bought.
2. The cart is priced by the server (`POST :code/cart/quote`); the browser sends photo ids only.
3. Checkout writes the order with every line's price frozen, then opens a Cashfree order for the
   exact total.
4. The order becomes `PAID` only when the server asks Cashfree and finds a SUCCESS payment for that
   amount and currency (`payments/service.js`). The return redirect and the webhook are prompts to
   ask, never the answer. Only then are its items unlocked - `READY` where the original is stored,
   `UNAVAILABLE` where it has gone.
5. The order page asks for a download ticket per photo (`POST …/items/:itemId/download`) and the
   browser fetches the original through `GET download/:itemId?t=`.

## Access

One permission, `IMAGE_SELECTION / Photo Selling` (level `ISPHOTO_SELLING`), granted to SUPER_ADMIN
by the migration and to nobody else. Read opens every screen; Read / Write is needed for every
change (create, upload, edit, publish, prices, packages, re-issue a link, check a
payment). The staff router mounts `protect` + `requireModule`; no controller reads a role. The
watermark preset list is served by Photo Selling's own `GET /api/photo-selling/watermark-presets`, so
choosing one needs no AI Feature settings grant.

**Do not grant it to a branch-scoped role yet.** Galleries and orders (which carry buyers' names and
numbers) are studio-wide. Before a role that reaches only some branches is ticked, galleries need a
`branch_id` and narrowing through `reachableBranchIds(user, { module: "IMAGE_SELECTION", feature:
"Photo Selling" })`.

The guest store authenticates by link code (+ optional 4-digit PIN), then by a store session JWT
scoped to the store; an order by that session or by its order key; a download by a 10-minute
ticket naming one order item. An id on its own opens nothing.

## Data model

| Table | What it is |
| --- | --- |
| `photo_sale_gallery` | A gallery: name, client and client phone, date, venue, welcome note, QR poster design and words, cover photo, price per photo in paise (`price_paise`), tax in basis points, watermark snapshot (logo copied into the gallery's folder), link token/PIN, visit count, `deleted_at` (a deleted gallery kept only as its orders' record) |
| `photo_sale_photo` | A photo uploaded into a gallery: its original's key (`original_key`), type and size, its preview and thumbnail keys, the original's file name, folder path and SHA-256, availability, optional own price, face-indexing state. Unique (gallery, hash) - a re-upload is the same photo |
| `photo_sale_face` | A face found in a gallery photo: the engine that found it and its unit vector |
| `photo_sale_package` | "Any N photos for ₹X"; the cheapest combination is applied by the server |
| `photo_sale_order` | The buyer, frozen totals (subtotal, discount, tax, total) and the pricing snapshot |
| `photo_sale_order_item` | One photo bought (`kind` ORIGINAL) with frozen unit and charged prices, file name, path and hash; fulfilment state and download count. DIGITAL items and the four `delivered_*` columns belong to orders made before originals were sold |
| `photo_sale_payment` | One Cashfree attempt; `provider_order_id` = `<orderRef>-<attempt>` (unique) |
| `photo_sale_payment_event` | Audit of every webhook, verification and checkout; `dedupe_key` unique |
| `photo_sale_download` | Each download: STARTED, then SERVED or FAILED, and the hash of the ticket that opened it (`ticket_hash`, unique - a ticket serves once) |
| `photo_sale_setting` | Photo Selling's own settings, one row ("default"): gallery defaults, download policy, QR poster defaults |
| `photo_sale_storage_cleanup` | Files still to be deleted from R2: one row per key (or gallery-folder sweep), written in the transaction that deleted their owner, removed once the file is gone |
| `photo_sale_selfie_search` | A guest's search: consent time, engine and threshold, matched photo ids and scores, 24h expiry - no selfie, no vector |
| `photo_sale_watermark` | The store's watermarked previews, per photo per look |

The tables link to nothing outside the module but `user` (who created or uploaded, who delivered on
older orders). Rollback: unmount the two routers (or revert the change); nothing else reads these
tables.

## Uploads and storage

- **What travels.** Each upload is multipart: `original` (the file from the uploader's disk, byte
  for byte), and - from an uploader that could decode it - `preview` (the 2048px web-size copy made
  on its computer by the AI Feature's compression worker and upload engine, reused through the web
  adapter's `uploadItem`) and `thumbnail`, with the original's name, folder path, size, capture time
  and SHA-256. The desktop sends the same parts from its transfer engine. A format the uploader
  cannot decode (HEIC, TIFF) is sent as the original alone and the server makes the preview (up to
  80 MB).
- **Checked before anything is stored** (`photos/service.js`): the route refuses at once, before
  reading a byte, when no private originals bucket is set up or the gallery is archived or unknown;
  the body streams to a temporary file (never held in memory) up to `PHOTO_SELLING_MAX_ORIGINAL_MB`
  (default 200, 413 above it); the file's first bytes must be JPEG, PNG, WebP, TIFF or HEIC/HEIF
  whatever its name says; its SHA-256 must equal the declared fingerprint (422 otherwise). The
  temporary file is deleted when the request ends, whatever happened.
- **Originals - the saleable files - go to the studio's existing R2 bucket** (`R2_BUCKET_NAME`), in
  Photo Selling's own folder, streamed as they arrived (never decoded, resized or re-encoded), under
  `photo-selling/gallery-<galleryId>/originals/<uuid>/<sanitised file name>`, with
  `Cache-Control: private, no-store` - the studio's choice (2026-10-27): no bucket of Photo Selling's
  own. That bucket is served publicly at `R2_PUBLIC_BASE_URL` (bucket-wide; checked 2026-10-27), so
  what keeps an original from being opened is that its address cannot be known: a 122-bit random
  folder per photo, a key that is never in any response, page or log, and downloads only ever
  streamed through the server after a verified payment. An anonymous request for a gallery's folder
  answers 404 (checked against the real bucket). If `R2_PRIVATE_BUCKET_NAME` or
  `PHOTO_SELLING_ORIGINALS_BUCKET` names a bucket with public access off, originals go there instead,
  nothing else changing. Only an R2 not configured at all refuses uploads (before a byte is read).
  Verified against the real bucket on 2026-10-27: a 6 MB original went in and came back with the same
  SHA-256, and the durable cleanup left nothing of the test folder. Keys are made on the server
  from the gallery id and a UUID; none is ever taken from a request, and none is ever sent to a
  browser. There is no presigned URL anywhere: a paid download is streamed through the server.
- **Previews are only shown**: the preview and thumbnail go to the public bucket under
  `photo-selling/gallery-<id>/`, and guests only ever get watermarked copies of them - except the
  cover the studio chose, whose clean preview (never its original) is the login's background while
  that photo is on sale (owner's decision, 2026-10-31).
- **One photo per gallery per fingerprint**: a retried or repeated upload is answered with the photo
  already there (`duplicate: true`) and stores nothing twice; two uploads of one photo at once keep
  one row and delete the loser's files, original included. A storage or database failure deletes
  whatever that upload had already written, so it is simply sent again. A photo stored before
  originals were kept gets its original when it is uploaded again.
- Removing a photo nobody has bought deletes its row, its previews and its original (through the
  durable cleanup below). A photo somebody has ordered is only taken off sale (`removed_at`), so its
  buyers keep their downloads; uploading it again brings it back.

## Deleting a gallery

`DELETE galleries/:id` (Read / Write, `galleries/service.js` `removeGallery`) deletes any gallery -
a draft, a live one (it stops selling at once) or an archived one. One that never took an order goes
entirely, rows and files. One with orders (owner's decision, 2026-10-31) keeps the order and payment
records for the studio's accounts: the gallery row stays with `deleted_at` set (migration
`20261031140000_photo_sale_gallery_deleted_at`) - left out of every list, every staff screen (404),
and every public link, QR code and buyer order page (`resolveCode` answers nothing; the code stays
taken so an old QR never leads elsewhere) - and so does each photo an order names, off sale, as its
order line's record. Everything else goes in the same transaction: the other photos, faces,
watermarked copies, and every guest's details, selfies, matches, searches and messages. Buyers can
no longer download, since the originals are deleted with every other file; the confirmation says so
and points to Archive for keeping their downloads. In Orders such an order shows its gallery as
"(deleted)" with a note, no thumbnails or downloads, and no Re-issue buyer link (the server refuses
it, 409). An order placed in the instant before the delete makes it fail (409, try again), never half
done. The answer carries `ordersKept`. Its files leave R2 durably (`shared/cleanup.js`):

1. Every key the gallery's own rows name - originals, previews, thumbnails, watermarked copies, the
   watermark logo - and one sweep of its own folder `photo-selling/gallery-<id>/` in each bucket are
   written to `photo_sale_storage_cleanup` **in the same transaction** that deletes the rows.
2. The deletion is tried at once. A file R2 will not delete stays recorded with its error and is
   retried by the worker every ten minutes, with backoff, until it is gone; only then is its row
   removed. The answer says how many files are still waiting (`filesRemaining`), never "all gone"
   while any remain; Settings shows the count waiting.
3. Only the gallery's own folder can be touched: a key outside it is dropped when planned and refused
   when worked on, and the folder sweep (which finds what an interrupted upload left behind) runs only
   once the gallery's keyed files are gone. No other module's files, no other gallery's, no bucket.
4. Asked again for a gallery already deleted: 404, nothing else. The same file recorded twice is one
   row (`key_hash` unique).

Removed photos and failed uploads go through the same path.
- **The bucket must have no expiry rule.** The shared public bucket has been seen to lose objects
  after about ten days (an age-based lifecycle rule the app's token cannot read); the originals
  bucket must be created without one, or bought originals disappear.

## Pricing

`pricing/pricing.js` is the only place a price is computed. One thing is sold: a photo's original.
The client sends photo ids only; the server checks each is for sale in this gallery (available, not
removed, original stored - `orders.FOR_SALE`), prices it (the photo's own price, else the gallery's),
applies packages by an exact cheapest-combination search, allocates package prices across lines in
whole paise, and computes tax (inclusive: the tax inside the total; exclusive: added). Totals and
every line are frozen on the order; a later price change alters nothing already ordered.

## Payments (Cashfree)

- **Create**: checkout validates and prices the cart, writes the order and items in one transaction,
  then creates a Cashfree order for attempt 1 and returns only `paymentSessionId` and the
  environment. The browser opens Cashfree's hosted checkout with the v3 JS SDK.
- **Verify**: an order is PAID only when the server asks Cashfree (`GET /pg/orders/{id}` and
  `/payments`) and a SUCCESS payment matches the order's amount and currency exactly. The return
  redirect and the webhook body are prompts to ask, never the answer.
- **Idempotency**: marking paid is a conditional update in a transaction; whichever caller flips the
  order unlocks the items, every other caller changes nothing. A later FAILED notice never undoes
  SUCCESS. A second attempt that also succeeds is recorded as `DUPLICATE_PAYMENT` (refund due).
- **Retry**: an open checkout is handed back; a PENDING bank confirmation blocks a new attempt; if
  Cashfree cannot be asked about the last attempt, no new one is made.
- **Reconcile**: besides the order page (polled while the buyer waits) and the staff "check" action,
  the worker asks Cashfree every ten minutes about attempts still open after two minutes (this
  environment's, the last week, 50 at a time; `payments/service.reconcileStale`), so a buyer who
  closed the tab on a payment that went through is unlocked without a webhook.
- **Webhook**: HMAC-SHA256 of `timestamp + rawBody` with the client secret, Base64, compared in
  constant time; recorded once by `x-idempotency-key` (or a hash of type/order/payment/status); a
  failure to apply deletes the record and answers 500 so Cashfree retries.
  Address: `POST https://<api host>/api/public/photo-selling/webhooks/cashfree` (production:
  `https://api-operations.dontblinkstudioz.com/...`), webhook version **2025-01-01** (payload
  `data.order.order_id`, `data.payment.payment_status`), events `PAYMENT_SUCCESS_WEBHOOK`,
  `PAYMENT_FAILED_WEBHOOK`, `PAYMENT_USER_DROPPED_WEBHOOK` (any other signed type is recorded and
  reconciled the same way; `PAYMENT_CHARGES_WEBHOOK` is only recorded). The signing key is the
  account's **`CASHFREE_CLIENT_SECRET`** - Cashfree's Payment Gateway webhooks have no separate
  webhook secret. An order id this store never made is acknowledged (200) and touches nothing.
- **Environments**: `CASHFREE_ENV=sandbox` by default. Production also needs
  `PHOTO_SELLING_PRODUCTION_PAYMENTS=true`. With no keys, galleries open but checkout refuses before
  an order is made.
- **Readiness is Cashfree's answer, not the keys' presence** (`config.cashfree().credentials`, in the
  staff status as `payments.credentials`): the keys are checked by looking up an order that cannot
  exist (`GET /pg/orders/dbs-key-check-<random>`) - "not found" (404) only comes after Cashfree
  accepted them, 401/403 means refused. `VALID` / `INVALID` / `UNREACHABLE` / `UNCHECKED` /
  `NOT_CONFIGURED`. Refused keys (wrong keys, or sandbox keys with `CASHFREE_ENV=production`) turn
  checkout off with a reason naming the environment; an unreachable Cashfree does not (a passing
  outage) but is said. Checked when the worker starts, every half hour, and on the staff status when
  the current keys were never checked or were not accepted (at most every five minutes); remembered per
  set of keys by a fingerprint, never the keys. A buyer is told only "Online payment isn't available
  right now" - never which setting is missing; and attempts already made are still settled while new
  checkouts are off.
  Measured against the real sandbox (2026-10-28): made-up keys → `INVALID` in about 260 ms.
- **Refunds** are made in the Cashfree dashboard; they are not recorded here (net sales are before
  refunds, and the overview says so).

## Delivery

- **What a buyer gets** is the photo's original file, exactly as uploaded, under its own name.
- **Only after verified payment.** A download ticket is issued only for an item of a `PAID` order
  that is `READY` - and only a server-verified payment makes an order `PAID`. A pending, failed or
  cancelled order, an item of another order, a photo id instead of an item id, or a web-size item
  from an older order is refused.
- **Tickets**: a JWT naming one order item, signed with a key derived from `JWT_SECRET`, valid for
  10 minutes, with a random id. Using it records that id's hash on the download row (unique), before
  a byte is read - so a ticket serves one download; presented again it answers 410, and an expired
  one 410 too. The order, the item and the policy are checked again when the ticket is used, so a
  ticket outlives nothing - not a refund, not a removed photo.
- **Streaming**: `GET /api/public/photo-selling/download/:itemId?t=` streams the original from the
  originals store with `Content-Disposition: attachment`, `Cache-Control: no-store` and its length.
  The bucket and key are never revealed. A download counts once its last byte is sent; an
  interrupted one is recorded as FAILED and does not count.
- **Repeat downloads** (`config.downloadPolicy`): each bought photo can be downloaded
  `PHOTO_SELLING_DOWNLOAD_LIMIT` times (default 20) for `PHOTO_SELLING_DOWNLOAD_DAYS` days after
  payment (default 365); the order page shows how many are left, and why when none are.
- An original missing when an order is paid leaves that item `UNAVAILABLE`; the overview counts
  these as "Paid, can't download" for the studio to resolve with the buyer.
- Lost access: staff re-issue an order link (`#k=` key in the fragment) from the order panel.

## Finding photos: by selfie only

A guest never sees a gallery whole. Opening the link shows the gallery's name, prices and one way
in - **Find my photos** - and the only photos a guest is ever shown, can add to a cart or buy are
the ones their own selfie matched.

- **No listing.** There is no route that lists a store's photos. The landing page carries no photo
  (a cover only if the studio chose one - Photos step, Use as cover - shown without the watermark
  behind the login and on a phone's cover strip, and gone once that photo is hidden or removed). A search's result is its own matched photos; quote and
  checkout refuse (409, naming them) any photo outside the device's matches (`public/service.js`
  `onlyMatched` → `search.matchedPhotoIds`), so an edited request cannot reach other photos. A
  logged-in device that has not matched anything can buy nothing.
- **Confident matches only.** A photo is a match when any face in it is at or above the gallery's
  threshold (a group photo counts; each photo is listed once, best first). Below it nothing is shown
  "just in case". No match is its own answer - "No matching photos found", with tips and a new
  selfie - and a failed search is an error with *Try again*; neither ever falls back to the gallery.
- **Thresholds** (`faces/thresholds.js`): the gallery picks Standard / Stricter / Broader
  (`match_strictness`): cosine 0.62 / 0.68 / 0.55 (0.62 is the AI Feature's own "high confidence"
  band). Matches are likenesses, never identity checks, and the store says so.
- **Indexing** (`faces/service.js`, queue job `index-photo`): every uploaded photo is queued as it
  arrives - `QUEUED → PROCESSING → DONE | FAILED` (`NONE` while no engine is set up). Claimed by a
  conditional update so a photo is indexed once; a repeated job replaces its faces. Engine down: the
  job waits and retries. A sweep every 10 minutes re-queues anything stuck. The Photos step shows
  "Preparing" and a *Retry failed* action (`POST galleries/:id/photos/reindex`).
- **Not searchable until ready.** Publishing is blocked with no face engine (`FACE_MATCHING_OFF`),
  while photos are still being prepared (`INDEXING`) and when no photo on sale could be indexed
  (`NONE_SEARCHABLE`). Only `DONE` photos are searched or sold, so a photo added to a live gallery
  becomes findable once indexed; the store says when photos are still being prepared.
- **Verified with the real engine** (2026-10-27, InsightFace, 30 real wedding photos indexed - 60
  faces): a selfie cropped from a photo outside the gallery returned 25 of the 30 (that couple's),
  in 1.4 s; another store's photo with the same faces was not returned; a matched photo priced and an
  unmatched one of the same gallery was refused (409); a face from another shoot answered NO_MATCH
  with no photos; a picture with no face answered 422; a non-image 400.
- **Privacy.** Explicit consent is required and recorded. The selfie is checked by its own bytes
  (and size: 240px to 40MP), described in memory and dropped - never stored, logged or returned. For a
  registered guest (every guest who entered by the first screen) the face vector made from it and a
  small private thumbnail are kept as one of their up to 10 selfies, for that gallery only, until they
  remove it (owner-approved, 2026-10-29; below). A search keeps only the matched photo ids and scores, answers
  its own device only, expires after 24 hours (swept hourly) and can be deleted by the guest
  ("Delete my search" - its photos can then no longer be bought from that device; anything already
  bought stays bought). The selfie is re-encoded before any engine sees it, so its EXIF (location,
  device) is dropped. Selfies are never used for training.
- **Limits.** 20 searches per device per day, 600 per gallery per hour, 20 per network per hour (an
  IPv6 /64 counts as one), at most 4 running at once; each search is reserved before the engine
  runs, so parallel requests cannot slip under a limit. Wrong PINs are capped per address and per
  gallery (100 per 15 minutes, whatever the address).
- **Picture addresses expire.** A watermarked copy's address is signed with an expiry about a day
  out; an edited or expired one, or one for a photo since hidden or removed, answers 404.
- **Engines and indexing.** A passing fault (storage, a throttled engine) retries with backoff; only a
  permanent one or the last attempt marks a photo FAILED. Switching engines: the sweep re-indexes
  photos whose faces came from the other engine. Expired searches are also purged opportunistically
  while guests search, so retention holds with the worker running elsewhere.

### Face engine

Selfie search is the AI Feature's own engine and nothing else: its InsightFace bridge
(`ai-feature/face-engine/engine.js` - SCRFD detection + ArcFace `buffalo_l` embeddings, one Python
process shared by every module), the AI Feature's unit-vector cosine similarity
(`ai-feature/shared/vectors.js`) and its 0.62 high-confidence band. Photo Selling adds no algorithm
and calls no outside service - only its own faces table (`photo_sale_face`), its own gallery scoping
and the strictness levels in `faces/thresholds.js`. It is on wherever the AI Feature's engine is
(`AI_FACE_ENGINE_ENABLED=true`); with it off, galleries cannot be published (guests could find
nothing). There is no Photo Selling face setting.

**Licence.** The engine's code is MIT; InsightFace publishes the `buffalo_l` weights for
non-commercial research only. The studio has decided (2026-10-28) that Photo Selling is governed
exactly as the AI Feature already is on the same weights, so no Photo Selling-only licence switch
remains; holding InsightFace's commercial licence for paid use is the studio's responsibility, for
both modules alike. (AWS Rekognition and `PHOTO_SELLING_FACE_LICENSE_CONFIRMED` were removed the same
day. AI Photo Culling's own optional Rekognition provider is separate and unchanged.)

**Readiness is the engine running, not its settings** (`shared/config.js faceMatching()`, behind
`GET /api/photo-selling/status`, every gallery's `server` block, the publish checklist and the guest's
search availability). It reads the AI Feature engine's own cheap `health()` - no spawn and no model
load per call - and answers a `state`:

| `state` | Meaning | Publishing |
| --- | --- | --- |
| `NOT_CONFIGURED` | The face engine is switched off (`AI_FACE_ENGINE_ENABLED`) | Blocked (`FACE_MATCHING_OFF`, with the reason) |
| `MODEL_MISSING` | The engine's model files are not on disk (`INSIGHTFACE_HOME`) | Blocked |
| `ENGINE_OFFLINE` | The engine was started and could not load; details in `/api/health/face-engine` | Blocked |
| `STARTING` | Loading (about 10 s); a read asks it to start here, since searches and indexing run in this process, and never waits | Blocked until it answers |
| `READY` | The engine answered ready | Allowed, once the photos are indexed |
| `WORKER_ELSEWHERE` | `PHOTO_SELLING_EMBEDDED_WORKER=false`: that worker's engine cannot be seen from here | Allowed, once the photos are indexed - which only a working engine does |

The reason shown to staff never carries a server path or interpreter. Measured on the real engine
(2026-10-28): cold `STARTING` → `READY` in 11.8 s; a missing model folder → `MODEL_MISSING`; an
interpreter that cannot run → `ENGINE_OFFLINE` in 0.5 s; 1000 readiness reads in 565 ms.

**Server setup** (no new install - the AI Feature's engine, its `backend/.venv-face` and its models):
`AI_FACE_ENGINE_ENABLED=true`, already on wherever the AI Feature recognises faces (the deploy's
health gate checks it). Nothing else; the status turns `READY` once the engine has loaded.

Measured locally (2026-10-23, the local engine, 24 real wedding photos + 6 from another shoot): a
guest's selfie returned exactly the 3 photos the person is in (scores 0.96-0.98) and none of the
other 21; a face from the other shoot returned no match in either direction. Not yet measured on a
large labelled set - do that before relying on the Broader level.

## Guest WhatsApp photo-match messages

Added 2026-10-29 (owner-approved migration `20261030120000_photo_selling_guest_notifications`).

- **Switches.** Studio defaults and each gallery: **Enable guest selfie search** (default on - the
  store as it was) and **Enable WhatsApp photo-match notifications** (default off), copied onto a new
  gallery, editable per gallery on web (Settings tab) and desktop (Details step). Nothing is sent
  unless the server's own `PHOTO_SELLING_WHATSAPP_ENABLED` is "true" too - separate from the AI
  Feature's switch. The settings screens show what the server has in place and, with
  `META_WHATSAPP_BUSINESS_ACCOUNT_ID`, whether Meta has approved the template - never a token or raw
  error.
- **Guest.** The store's first screen is always its **Login** - the AI Feature's guest login page
  itself (`store/StoreLanding.js` composes `ai-feature/guest/GuestLanding` + `GuestJoinCard` with
  the store's own words): every guest gives their name and WhatsApp number, with the PIN there too
  where the gallery has one (`POST :code/session { name, phone, pin?, whatsappConsent? }`, one
  `PhotoSaleGuest` per gallery per store session); the selfie page (upload or camera, a preview, then
  Find my photos) comes only after it and never asks for the details again. Behind the login the
  store wears the AI Feature's guest gallery shell - `GuestEventHeader` (studio mark, gallery name,
  "Hi <name>", with the store's Cart and My orders in its `actions` and no Leave, since a store's
  selfies and matches belong to its session), `MobileEventHero`, the Find your photos card's look,
  a "Your Moments" summary (`store/StoreMatchesSummary.js`) over the matched photos, and
  `GuestEventFooter`. A session the device
  kept (30 days, for this gallery only) is checked with the server (`GET :code/guest`) before
  anything behind the login is shown, so a refresh stays logged in; a session the server refuses
  then, or on any later call, clears it and returns to the Login with "Your session has ended".
  **No code is sent** (owner's decision). Where messages are offered - the gallery's
  switch, the server's and a template named - an unticked "Send me a WhatsApp when new photos of me are
  found" is shown; the tick is the consent. A device whose session predates the first screen is asked
  once (`PUT :code/guest`), and no selfie runs before it (409). A 10-digit mobile reads as +91; other numbers need their country code; the
  dial codes served are `PHOTO_SELLING_WHATSAPP_DIAL_CODES`.
- **Selfies.** Every registered guest keeps up to 10 selfies (`PhotoSaleGuestSelfie`, migration
  `20261030130000_photo_selling_guest_selfies`): each search takes a slot first (one conditional
  UPDATE on `photo_sale_guest.selfie_count`, so selfies sent at once cannot pass ten; an eleventh is a
  429) and, once matched, keeps the face vector and a 240px private thumbnail (originals bucket,
  `photo-selling/gallery-<id>/selfies/`) and records the search's matches as the guest's (`SELFIE` -
  never messaged about). A failed search gives the slot back. "Your Selfies" lists them
  (`GET :code/guest/selfies`, thumbnails through `GET :code/guest/selfies/:id/thumbnail` with the
  session); removing one (`DELETE :code/guest/selfies/:id`) deletes its vector, its search and - through
  the durable clean-up - its thumbnail, and drops the matches no remaining selfie supports at the
  gallery's strictness. "Stop WhatsApp messages" withdraws consent only; the gallery's deletion removes
  everything. Consent given later counts as told what was already found (a `CONSENT_BASELINE` row).
- **Later uploads.** When a photo finishes face indexing, its faces are compared with every
  consenting guest's at the gallery's strictness; a match is recorded once (`NEW_PHOTO`, unique guest
  + photo, so a reindex adds nothing) and the gallery's run is scheduled (`notify-gallery`, a quiet
  `PHOTO_SELLING_NOTIFY_QUIET_MS` later, once however many photos match). A run waits while any
  photo on sale is still being indexed. A failed index has no faces, so no match.
- **Message.** One per guest per settled batch, template `photos_ready` (Utility): body {{1}} guest
  name, {{2}} new photos, {{3}} gallery title; the "Visit Your Gallery" button takes `s/<code>`.
  Each match is claimed by exactly one `PhotoSaleNotification` in the transaction that writes it, so
  nothing is reported twice. QUEUED → SENDING → SENT; a Meta refusal for a passing reason gives the
  matches back for the next run, a permanent one (a bad number) does not; no answer (network, timeout)
  is UNCERTAIN and never resent. The worker's ten-minute sweep re-schedules galleries with matches
  nobody reported and marks a send left SENDING as UNCERTAIN.
- **Delivery reports.** Meta's delivery webhook (`/api/public/whatsapp/meta/webhook`, mounted when
  `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN` and `META_WHATSAPP_APP_SECRET` are set) finds the message by
  `provider_message_id` and moves it forward only: SENT → DELIVERED (`delivered_at`) → READ
  (`read_at`), so a duplicate or late report changes nothing. FAILED is taken only by a message still
  SENT - a delivered or read one keeps its matches. A failure for a passing reason (Meta codes
  130429, 131056, 131000, 131016, 133004, 131057) gives its matches back for the next run, at
  most three times per guest (two failures at the same instant may pass that once more); any other
  code - an undeliverable number, a template problem, 131048 (the number's own spam limit) - keeps
  them claimed. A READ that comes first records `delivered_at` too. The AI Feature's guest summary follows the same rules
  (`services/whatsappNotificationDelivery.js`). A report that arrives before the send has stored
  Meta's id - or that failed to apply (the database for a moment) - is kept in
  `whatsapp_pending_status` (signed webhooks only, once per report; `sent` reports are not kept) and
  applied, in Meta's order, by the send the moment it stores the id; a sweep at start-up and every 5
  minutes applies any the send missed, the least recently checked first, and every kept report is
  deleted 7 days after it arrived (`services/whatsappPendingStatus.js`). A report that could be
  neither applied nor kept is answered 500, so Meta sends it again.
- **Seeing them.** A guest who comes back (the WhatsApp link) sees their kept matches - their search's
  and later uploads' - beyond the search's 24 hours (`GET :code/guest/photos`); they can be bought as a
  search's matches can. With none yet, a ticked guest is told "Your photos haven't been found yet.
  Please wait - we'll notify you on WhatsApp when your photos are available."

## API

Staff (`/api/photo-selling`, JWT + permission): `GET status`, `GET overview?range=`,
`GET watermark-presets`, `GET|PUT settings`, `GET settings/qr-sample`, `GET|POST galleries`,
`GET|PATCH|DELETE galleries/:id` (DELETE answers `{ deleted, filesRemaining }`),
`GET galleries/:id/preview`, `GET galleries/:id/qr-kit`, `POST galleries/:id/(publish|unpublish|archive|restore|duplicate)`,
`PATCH galleries/:id/link`, `GET galleries/:id/photos?scope=&sort=&search=&page=`,
`POST galleries/:id/photos/upload` (multipart `original`, optional `preview` + `thumbnail`, and the
original's fields), `PATCH galleries/:id/photos` (`{ photoIds, available?, pricePaise? }`),
`POST galleries/:id/photos/remove`, `POST galleries/:id/photos/reindex {photoIds?}`,
`PUT galleries/:id/packages`, `GET orders`, `GET orders/:id`, `POST orders/:id/verify`,
`POST orders/:id/reissue-link`.

Guest (`/api/public/photo-selling`): `GET :code`, `POST :code/session { name, phone, pin?, whatsappConsent? }`,
`POST :code/cart/quote` and `POST :code/checkout`
(`items: [{ photoId }]`), `GET :code/orders`, `GET :code/orders/:ref`, `POST :code/orders/:ref/pay`,
`POST :code/orders/:ref/items/:itemId/download`, `POST :code/selfie-search` (multipart `selfie`,
`consent=true`; answers at once), `GET :code/selfie-search/latest`, `GET|DELETE :code/selfie-search/:id`,
`GET|PUT :code/guest` (`{ name, phone, whatsappConsent }`), `DELETE :code/guest/whatsapp`,
`GET :code/guest/photos` (this device's guest's kept matches),
`GET w/:photoId/:hash/:variant?s=` (watermarked copy), `GET download/:itemId?t=` (the original,
streamed, single use). Order routes accept the session (`Authorization: Bearer`) or `X-Order-Key`.

## Configuration

`R2_BUCKET_NAME` (originals' home, in `photo-selling/`; `R2_PRIVATE_BUCKET_NAME` / `PHOTO_SELLING_ORIGINALS_BUCKET` optionally move them to a private bucket), `PHOTO_SELLING_MAX_ORIGINAL_MB`,
`PHOTO_SELLING_DOWNLOAD_LIMIT`, `PHOTO_SELLING_DOWNLOAD_DAYS`, `CASHFREE_ENV`, `CASHFREE_CLIENT_ID`,
`CASHFREE_CLIENT_SECRET`, `CASHFREE_API_VERSION`, `PHOTO_SELLING_PRODUCTION_PAYMENTS`,
`PHOTO_SELLING_NOTIFY_URL`, `PHOTO_SELLING_PUBLIC_URL`, `AI_FACE_ENGINE_ENABLED` (the AI Feature's
face engine, which selfie search uses), `PHOTO_SELLING_EMBEDDED_WORKER`, `PHOTO_SELLING_QUEUE_NAME`,
`PHOTO_SELLING_WHATSAPP_ENABLED`, `PHOTO_SELLING_WHATSAPP_TEMPLATE_NAME` / `_LANGUAGE`,
`PHOTO_SELLING_WHATSAPP_DIAL_CODES`, `PHOTO_SELLING_NOTIFY_QUIET_MS`, `META_WHATSAPP_BUSINESS_ACCOUNT_ID` — see `backend/.env.example`. In front of
the API, Nginx's `client_max_body_size` must allow `PHOTO_SELLING_MAX_ORIGINAL_MB` for the upload
route.

## Known limits

- Currency INR; Indian mobile numbers only (Cashfree INR checkout).
- No coupons, no prints, no in-app refunds.
- Linking or importing an AI Feature event's photos is not built; a gallery's photos are uploaded.
- Originals go through the API server (streamed to a temporary file, then to R2), not straight to
  R2 by presigned upload, so the server's disk and its proxy's body limit bound the largest original.
- Not yet run against the Cashfree sandbox (no keys on this machine). The R2 path was run against the
  real bucket once (round trip and cleanup); the tests otherwise use in-process stand-ins.
- Originals in the publicly served bucket are protected by their unguessable key, not by a bucket
  policy: a key that leaked would be a working address. Naming a bucket with public access off
  (`R2_PRIVATE_BUCKET_NAME`) closes that, and moves new originals with no code change. The shared
  bucket has also been seen to lose objects under `image-selection/` after about ten days (a lifecycle
  rule the app's token cannot read); confirm in the Cloudflare dashboard that no such rule covers
  `photo-selling/`, or bought originals could disappear.
- Search quality checked on a small real set only.
- Faces found in a gallery's photos stay until the photo or gallery is deleted (not on archive).
- Store visits are counted per store session, so the conversion rate is approximate.
