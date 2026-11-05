import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), "src", ...parts), "utf8");

// Guest selfie search and WhatsApp photo-match messages, with no login code, on both guest pages.
test("AI Feature: the join card's box is the consent - no code - and the waiting message promises WhatsApp only when it is on", () => {
  const experience = read("components", "ai-feature", "guest", "GuestEventExperience.js");
  assert.match(experience, /if \(whatsappSummary && !current\?\.whatsappSummary\?\.on\) \{\s*try \{ current = \(await consentGuestWhatsApp\(code, data\.session\)\)\.data \|\| current; \}/);
  const summary = read("components", "ai-feature", "guest", "GuestWhatsAppSummary.js");
  assert.doesNotMatch(summary, /requestGuestWhatsAppCode|verifyGuestWhatsAppCode|PinBoxes|Send code/, "no code step for the WhatsApp message");
  assert.match(read("components", "ai-feature", "guest", "GuestJoinCard.js"), /Send me a WhatsApp when my photos are found/);
  const mine = read("components", "ai-feature", "guest", "MyPhotosTab.js");
  assert.match(mine, /whatsappOn \? "Your photos haven't been found yet" : "No photos found yet"/);
  assert.match(mine, /We'll notify you on WhatsApp when your photos are available\./);
  assert.match(read("components", "ai-feature", "guest", "GuestGallery.js"), /whatsappOn=\{Boolean\(meta\?\.features\?\.whatsappSummary && guest\?\.whatsappSummary\?\.on\)\}/);
});

test("Photo Selling: every guest's first screen asks name and WhatsApp number (and the PIN where set), the tick only where offered, no code", () => {
  // The first screen is the AI Feature's guest login (GuestLanding + GuestJoinCard), told what the store asks.
  const landing = read("components", "photo-selling", "store", "StoreLanding.js");
  assert.match(landing, /<GuestLanding meta=\{loginMeta\(meta\)\} onJoin=\{join\}/, "the AI Feature's login page");
  assert.match(landing, /guestAccess: \{ requireName: true, requirePhone: true, allowRegistration: true \}/, "name and number from every guest");
  assert.match(landing, /phoneLabel: "WhatsApp number"/);
  assert.match(landing, /requiresPin: Boolean\(meta\.requirePin\)/, "the PIN on the same screen, where set");
  assert.match(landing, /whatsappSummary: Boolean\(meta\.whatsapp\?\.offered\)/, "the WhatsApp tick only where messages are offered");
  assert.match(landing, /whatsappConsent: whatsappSummary/, "the tick is the consent");
  assert.match(landing, /return null;/, "no code step: the store never asks for one");
  assert.doesNotMatch(landing, /verification code|OTP|one-time/i);
  const card = read("components", "ai-feature", "guest", "GuestJoinCard.js");
  assert.match(card, /if \(access\.requireName && !form\.name\.trim\(\)\)/, "the name is required");
  assert.match(card, /if \(access\.requirePhone && !form\.phone\.trim\(\)\)/, "the number is required");
  assert.match(card, /\{askPin && <PinBoxes /);
  assert.match(card, /\{offerWhatsApp && <label /);
  assert.match(card, /useState\(\{ name: "", phone: "", pin: "", whatsappSummary: false \}\)/, "the box starts unticked");
  assert.match(read("services", "photo-selling", "photo-store-public.service.js"), /JSON\.stringify\(\{ \.\.\.\(pin \? \{ pin \} : \{\}\), name, phone, whatsappConsent: Boolean\(whatsappConsent\) \}\)/);
  const store = read("components", "photo-selling", "store", "StoreExperience.js");
  assert.match(store, /: !guest\s*\? <StoreGuestDetails .*offered=\{offered\}/, "a device from before is asked once");
  const details = read("components", "photo-selling", "store", "StoreGuestDetails.js");
  assert.match(details, /whatsappConsent: guest \? guest\.whatsappOn : false/, "the box starts unticked for a new guest");
  assert.match(details, /label="WhatsApp number" required/);
  assert.match(details, /\{offered && <label /);
  assert.doesNotMatch(details, /verification code|OTP|one-time/i, "no login code");
  const selfie = read("components", "photo-selling", "store", "StoreSelfieSearch.js");
  assert.match(selfie, /Please wait - we'll notify you on WhatsApp when your photos are available\./);
  assert.match(selfie, /Stop WhatsApp messages/);
  const service = read("services", "photo-selling", "photo-store-public.service.js");
  for (const call of ["getStoreGuest", "saveStoreGuest", "stopStoreWhatsApp", "getStoreGuestPhotos"]) assert.match(service, new RegExp(`export const ${call} =`));
});

test("Photo Selling settings: selfie search and WhatsApp switches with the server's status, on the studio defaults and each gallery", () => {
  for (const file of [["components", "photo-selling", "settings", "PhotoSellingSettingsDialog.js"], ["components", "photo-selling", "gallery", "GallerySettingsTab.js"]]) {
    const source = read(...file);
    assert.match(source, /label="Enable guest selfie search"/, file.at(-1));
    assert.match(source, /label="Enable WhatsApp photo-match notifications"/, file.at(-1));
    assert.match(source, /<WhatsAppMessagesStatus /, file.at(-1));
  }
  const status = read("components", "photo-selling", "shared", "WhatsAppMessagesStatus.js");
  assert.match(status, /switched off on this server/);
  assert.match(status, /waiting for Meta's approval/);
  assert.doesNotMatch(status, /META_WHATSAPP|accessToken|phoneNumberId|providerMessageId/, "no secret or provider id is ever shown");
});

test("AI Feature has one notification - New match notification, the guest's WhatsApp match message - on its default settings and each event", () => {
  for (const file of [["components", "ai-feature", "shared", "SettingsGroupForm.js"], ["components", "ai-feature", "settings", "ProcessingSettings.js"]]) {
    const source = read(...file);
    assert.doesNotMatch(source, /New photo notification|label="New photo"|Processing completed|WhatsApp guests their photo summary|name="newMatch"|notifications\.newMatch/, file.at(-1));
    assert.match(source, /guestWhatsAppSummary[^\n]*label="New match notification"|label="New match notification"[^\n]*guestWhatsAppSummary/, file.at(-1));
  }
});

test("Your Selfies: one shared section on both guest pages - thumbnails with remove, X/10, Add Selfie disabled at ten", () => {
  const selfies = read("components", "shared", "GuestSelfies.js");
  assert.match(selfies, /Your Selfies/);
  assert.match(selfies, /Upload up to \{limit\} selfies to help us find your photos\./);
  assert.match(selfies, /\{items\.length\}\/\{limit\} selfies/);
  assert.match(selfies, /disabled=\{full\} onClick=\{onAdd\}/);
  assert.match(selfies, /You have \{limit\} selfies\. Remove one to add another\./);
  assert.match(selfies, /label=\{`Remove selfie \$\{index \+ 1\}`\}/);
  assert.match(selfies, /URL\.createObjectURL\(blob\)/, "private thumbnails, fetched with the session");
  assert.match(selfies, /URL\.revokeObjectURL/);
  const ai = read("components", "ai-feature", "guest", "GuestGallery.js");
  assert.match(ai, /<GuestSelfies selfies=\{selfies\} loadThumbnail=\{loadSelfie\} onRemove=\{removeSelfie\} onAdd=\{\(\) => setReplacing\(true\)\}/);
  const store = read("components", "photo-selling", "store", "StoreExperience.js");
  assert.match(store, /<GuestSelfies selfies=\{selfies\} loadThumbnail=\{loadSelfie\} onRemove=\{removeSelfie\} onAdd=\{\(\) => setSearchingAgain\(true\)\}/);
  for (const [file, calls] of [[["services", "ai-feature", "ai-feature-public.service.js"], ["listGuestSelfies", "removeGuestSelfie", "fetchGuestSelfieThumbnail"]], [["services", "photo-selling", "photo-store-public.service.js"], ["listStoreSelfies", "removeStoreSelfie", "fetchStoreSelfieThumbnail"]]]) {
    const source = read(...file);
    for (const call of calls) assert.match(source, new RegExp(`(export const|export async function) ${call}[ (]`), call);
  }
});
