const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const { CLIENT_ROUTES } = require("../src/middleware/authMiddleware");
const invitations = require("../src/modules/client/invitations/service");

/*
 * Invitation Cards: a client sees the shoots the studio has designs for - their own booked shoots
 * first - picks a design, gets an invitation filled in from their booking, writes it and sets a song;
 * a guest opens it by its link. Another client's invitation answers nothing. Real rows, removed at
 * the end; no file is uploaded.
 */

// The paywall is tested as it runs live, whatever a local .env turned off for testing.
process.env.INVITATION_PAYWALL = "on";
const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TCIV-${STAMP}-${name}`;
const F = {};
// Shoot names of the suite's own, so designs the studio has added on this database never mix in.
const WEDDING = tag("Wedding");
const RECEPTION = tag("Reception");
const KIDS = tag("Kids");

const projectData = (name) => ({
  enquiryId: tag(`enq-${name}`), eventId: tag(`ev-${name}`), whatsappGroupName: `WED ${name} ${STAMP}`, clientMainNumber: "+919876543210",
  sourceBranch: "Erode TN", vertical: "WED", deliverables: "[]", initialConvertedValue: 1000, crmName: "Test", projectStatus: "Pre Production",
});
// Free on purpose unless a test says otherwise: most of what is tested here is not about paying.
const design = (title, shootTypes, extra = {}) => prisma.invitationTemplate.create({ data: { title: tag(title), shootTypes, style: "royal", coverUrl: "https://example.com/cover.webp", isFree: true, ...extra } });
const song = (title, shootTypes, extra = {}) => prisma.invitationSong.create({ data: { title: tag(title), shootTypes, audioUrl: "https://example.com/song.mp3", ...extra } });

before(async () => {
  for (const name of ["mine", "theirs"]) await prisma.salesCrmLead.upsert({ where: { enquiryId: tag(`enq-${name}`) }, create: { enquiryId: tag(`enq-${name}`), name: tag(`enq-${name}`), ...(name === "mine" ? { groomName: "Sanjay", brideName: "Deepa" } : {}) }, update: {} });
  F.mine = await prisma.salesProject.create({ data: projectData("mine") });
  F.theirs = await prisma.salesProject.create({ data: projectData("theirs") });
  await prisma.projectShoot.create({ data: { shootId: tag("sh-rec"), projectId: F.mine.id, shoot: RECEPTION, dateCreated: new Date("2026-12-12"), eventStartTime: "18:30", shootPlace: "Grand Hall", district: "Erode" } });
  await prisma.projectShoot.create({ data: { shootId: tag("sh-wed"), projectId: F.mine.id, shoot: WEDDING, dateCreated: new Date("2026-12-13"), shootPlace: "Temple" } });
  F.weddingDesign = await design("Gold", [WEDDING, RECEPTION], { sortOrder: 1 });
  F.kidsDesign = await design("Balloons", [KIDS], { style: "playful" });
  F.offDesign = await design("Off", [RECEPTION], { isActive: false });
  F.goneDesign = await design("Gone", [RECEPTION], { deletedAt: new Date() });
  F.everySong = await song("Every", [], { sortOrder: 1 });
  F.kidsSong = await song("Lullaby", [KIDS]);
});

after(async () => {
  // The project takes its shoots and invitations with it; the designs and songs go after.
  await prisma.salesProject.deleteMany({ where: { eventId: { startsWith: `TCIV-${STAMP}` } } });
  await prisma.salesCrmLead.deleteMany({ where: { enquiryId: { startsWith: `TCIV-${STAMP}` } } });
  await prisma.invitationTemplate.deleteMany({ where: { title: { startsWith: `TCIV-${STAMP}` } } });
  await prisma.invitationSong.deleteMany({ where: { title: { startsWith: `TCIV-${STAMP}` } } });
  await prisma.$disconnect();
});

const ours = (shoots) => shoots.filter((shoot) => shoot.name.startsWith(`TCIV-${STAMP}`));

test("a client token reaches the invitation routes", () => {
  for (const route of ["GET /api/client/invitations", "GET /api/client/invitations/designs", "POST /api/client/invitations"]) assert.ok(CLIENT_ROUTES.has(route), route);
});

test("the shoots listed are those with a live design, the client's own booked shoots first", async () => {
  const { shoots } = await invitations.clientOverview([F.mine.id]);
  const listed = ours(shoots);
  // Neither name is in the studio's Shoot Types, so the two booked ones fall back to name order.
  assert.deepEqual(listed.map((shoot) => [shoot.name, shoot.mine, shoot.designs]), [
    [RECEPTION, true, 1],
    [WEDDING, true, 1],
    [KIDS, false, 1],
  ], "a switched-off or removed design is not counted, and a shoot the client has not booked comes after theirs");
});

test("a shoot's designs, and every song - its own and every-shoot songs first", async () => {
  const reception = await invitations.designsFor(RECEPTION);
  assert.deepEqual(reception.designs.map((d) => d.id), [F.weddingDesign.id]);
  assert.ok(reception.songs.some((s) => s.id === F.everySong.id));
  const order = reception.songs.map((s) => s.id);
  assert.ok(order.indexOf(F.everySong.id) < order.indexOf(F.kidsSong.id), "a song for this shoot comes before one for other shoots");
  assert.equal(reception.songs.find((s) => s.id === F.kidsSong.id).suggested, false);
  assert.equal(reception.songs.find((s) => s.id === F.everySong.id).suggested, true);
  const kids = await invitations.designsFor(KIDS);
  assert.deepEqual(kids.designs.map((d) => [d.id, d.style]), [[F.kidsDesign.id, "playful"]]);
  assert.equal(reception.songSeconds, 10);
});

test("the designs are shown with the client's own names and the shoot's day - nothing saved", async () => {
  const preview = await invitations.previewFor([F.mine.id], RECEPTION);
  assert.deepEqual([preview.names, preview.date, preview.venue], ["Sanjay & Deepa", "2026-12-12", "Grand Hall, Erode"]);
  assert.equal(await prisma.clientInvitation.count({ where: { projectId: F.mine.id } }), 0);
});

test("a new invitation starts from the booking: names, the shoot's day, time and place, and the celebration", async () => {
  const made = await invitations.createInvitation({ projectIds: [F.mine.id], userId: null, templateId: F.weddingDesign.id, shootName: RECEPTION });
  F.invitation = made;
  assert.match(made.token, /^[A-Za-z0-9_-]{16}$/);
  assert.match(made.link, new RegExp(`/inv/${made.token}$`));
  assert.equal(made.content.names, "Sanjay & Deepa", "the client's own names from the enquiry - never the WhatsApp group code");
  assert.equal(made.content.date, "2026-12-12");
  assert.equal(made.content.time, "18:30");
  assert.equal(made.content.venue, "Grand Hall, Erode");
  assert.ok(made.content.events.some((event) => event.name === RECEPTION));
  assert.ok(made.songId, "a song is set to start with");
});

test("a design that is not for the shoot, or switched off, cannot be started", async () => {
  await assert.rejects(invitations.createInvitation({ projectIds: [F.mine.id], clientName: "", templateId: F.kidsDesign.id, shootName: RECEPTION }), /no longer available/);
  await assert.rejects(invitations.createInvitation({ projectIds: [F.mine.id], clientName: "", templateId: F.offDesign.id, shootName: RECEPTION }), /no longer available/);
});

test("the client writes their invitation; a link is only ever a web address, and a song must be one the studio offers", async () => {
  const content = { ...F.invitation.content, names: "Deepa & Sanjay", mapUrl: "https://maps.google.com/?q=Grand+Hall" };
  const saved = await invitations.updateInvitation(F.invitation.id, [F.mine.id], { content, songStart: 42 });
  assert.equal(saved.content.names, "Deepa & Sanjay");
  assert.equal(saved.songStart, 42);
  assert.equal(invitations.invitationSchema.safeParse({ content: { mapUrl: "javascript:alert(1)" } }).success, false);
  assert.equal(invitations.invitationSchema.safeParse({ content: { events: [{ name: "x", mapUrl: "data:text/html,hi" }] } }).success, false);
  const other = await invitations.updateInvitation(F.invitation.id, [F.mine.id], { songId: F.kidsSong.id });
  assert.equal(other.songId, F.kidsSong.id, "a song tied to other shoots may still be chosen");
  await prisma.invitationSong.update({ where: { id: F.kidsSong.id }, data: { isActive: false } });
  await assert.rejects(invitations.updateInvitation(F.invitation.id, [F.mine.id], { songId: F.everySong.id + 100000 }), /no longer available/);
  await prisma.invitationSong.update({ where: { id: F.kidsSong.id }, data: { isActive: true } });
});

test("family cards and a gallery are kept - but never a photo linked from somewhere else", async () => {
  const families = [{ names: "Mr. Rajesh & Mrs. Shrimila", line: "Join us to celebrate our son's marriage", photos: ["https://elsewhere.example/a.jpg"] }];
  const saved = await invitations.updateInvitation(F.invitation.id, [F.mine.id], { content: { ...F.invitation.content, names: "Deepa & Sanjay", families, gallery: ["https://elsewhere.example/b.jpg"] } });
  assert.deepEqual(saved.content.families, [{ names: "Mr. Rajesh & Mrs. Shrimila", line: "Join us to celebrate our son's marriage", photos: [] }]);
  assert.deepEqual(saved.content.gallery, []);
  assert.equal(invitations.invitationSchema.safeParse({ content: { families: [{}, {}, {}, {}] } }).success, false, "up to three family cards");
  F.invitation = saved;
});

test("another client's bookings reach none of it", async () => {
  assert.equal(await invitations.clientInvitation(F.invitation.id, [F.theirs.id]), null);
  assert.equal(await invitations.updateInvitation(F.invitation.id, [F.theirs.id], { songStart: 1 }), null);
  assert.equal(await invitations.removeInvitation(F.invitation.id, [F.theirs.id]), false);
  const { invitations: listed } = await invitations.clientOverview([F.theirs.id]);
  assert.equal(listed.length, 0);
});

test("a priced design: two free edits, a third waits on payment; sharing waits too; unchanged saves are not counted", async () => {
  const PAID_SHOOT = tag("Sangeet");
  const priced = await design("Paid", [PAID_SHOOT], { price: 499, isFree: false });
  const made = await invitations.createInvitation({ projectIds: [F.mine.id], userId: null, templateId: priced.id, shootName: PAID_SHOOT });
  assert.deepEqual([made.access.price, made.access.paid, made.access.canShare, made.access.freeEditsLeft], [499, false, false, 2]);
  assert.ok(made.previewKey, "the client can preview it before paying");
  const edit = (names) => invitations.updateInvitation(made.id, [F.mine.id], { content: { ...made.content, names } });
  assert.equal((await edit("One")).access.freeEditsLeft, 1);
  assert.equal((await invitations.updateInvitation(made.id, [F.mine.id], { content: { ...made.content, names: "One" } })).access.freeEditsLeft, 1, "a save that changes nothing is not an edit");
  assert.equal((await edit("Two")).access.freeEditsLeft, 0);
  await assert.rejects(edit("Three"), (error) => error.status === 402 && error.code === "PAYMENT_REQUIRED");

  // The guest link is not open until it is paid; the client's own preview key opens it.
  assert.deepEqual(Object.keys(await invitations.publicInvitation(made.token)).sort(), ["locked", "names", "shootName"]);
  assert.equal((await invitations.publicInvitation(made.token, made.previewKey)).content.names, "Two");
  assert.equal(invitations.previewKeyOpens(made.token, made.previewKey, Date.now() + 4 * 60 * 60 * 1000), false, "a preview key lasts a few hours");
  assert.equal(invitations.previewKeyOpens(F.invitation.token, made.previewKey), false, "and opens only its own invitation");

  const asked = await invitations.requestUnlock(made.id, [F.mine.id]);
  assert.ok(asked.access.requestedAt);
  assert.equal(await invitations.requestUnlock(made.id, [F.theirs.id]), null, "another client cannot ask for it");

  assert.ok((await invitations.teamInvitations()).some((row) => row.id === made.id && row.status === "requested" && row.price === 499));
  assert.equal(await invitations.markPaid(made.id, null, true), true);
  const paid = await invitations.clientInvitation(made.id, [F.mine.id]);
  assert.deepEqual([paid.access.paid, paid.access.canShare, paid.access.canEdit, paid.previewKey], [true, true, true, null]);
  assert.equal((await edit("Four")).content.names, "Four", "paid: edits without limit");
  assert.ok(!(await invitations.publicInvitation(made.token)).locked, "paid: guests open it by the link");
  assert.equal(await prisma.notification.count({ where: { type: "INVITATION_UNLOCK", entityId: String(made.id) } }), 0, "the request leaves the bell once paid");
});

test("a design not marked free, with no price yet, still locks after the free edits - the studio names the price", async () => {
  const SHOOT = tag("Mehandi");
  const unpriced = await design("Unpriced", [SHOOT], { isFree: false });
  const made = await invitations.createInvitation({ projectIds: [F.mine.id], userId: null, templateId: unpriced.id, shootName: SHOOT });
  assert.deepEqual([made.access.price, made.access.free, made.access.canShare, made.access.freeEditsLeft], [0, false, false, 2]);
  await invitations.updateInvitation(made.id, [F.mine.id], { content: { ...made.content, names: "A" } });
  await invitations.updateInvitation(made.id, [F.mine.id], { content: { ...made.content, names: "B" } });
  await assert.rejects(invitations.updateInvitation(made.id, [F.mine.id], { content: { ...made.content, names: "C" } }), (error) => error.status === 402);
  assert.ok((await invitations.teamInvitations()).some((row) => row.id === made.id && row.status === "unpaid"));
});

test("the studio can set one client's own price and free edits, and mark several paid at once", async () => {
  const SHOOT = tag("Reception2");
  const plain = await design("Terms", [SHOOT], { isFree: false, price: 150 });
  const made = await invitations.createInvitation({ projectIds: [F.mine.id], userId: null, templateId: plain.id, shootName: SHOOT });
  assert.equal(made.access.price, 150);
  assert.equal(invitations.termsSchema.safeParse({ price: 99 }).success, false);
  assert.equal(invitations.termsSchema.safeParse({ editLimit: 21 }).success, false);
  await invitations.setTerms(made.id, { price: 120, editLimit: 4 });
  const own = await invitations.clientInvitation(made.id, [F.mine.id]);
  assert.deepEqual([own.access.price, own.access.freeEdits, own.access.freeEditsLeft], [120, 4, 4]);
  await invitations.setTerms(made.id, { price: null, editLimit: null });
  assert.deepEqual([(await invitations.clientInvitation(made.id, [F.mine.id])).access.price, (await invitations.clientInvitation(made.id, [F.mine.id])).access.freeEdits], [150, 2]);
  assert.equal(await invitations.markPaidMany([made.id, 999999999], null, true), 1);
  assert.equal((await invitations.clientInvitation(made.id, [F.mine.id])).access.paid, true);  assert.equal(await invitations.removeInvitations([made.id]), 1, "the studio deletes it");
  assert.equal(await invitations.publicInvitation(made.token), null, "and its link opens nothing");
  assert.equal(await invitations.removeInvitations([made.id]), 0);
});

test("a design marked free is never locked", async () => {
  assert.deepEqual([F.invitation.access.free, F.invitation.access.canShare, F.invitation.access.freeEditsLeft, F.invitation.previewKey], [true, true, null, null]);
});

test("a guest opens the invitation by its link, with ten seconds of its song from the chosen second", async () => {
  const opened = await invitations.publicInvitation(F.invitation.token);
  assert.equal(opened.style, "royal");
  assert.equal(opened.content.names, "Deepa & Sanjay");
  assert.deepEqual([opened.song.start, opened.song.seconds], [42, 10]);
  assert.equal(await invitations.publicInvitation("not-a-token"), null);
  assert.equal(await invitations.publicInvitation("AAAAAAAAAAAAAAAA"), null);
});

test("a design the studio removes later leaves invitations already shared playing", async () => {
  await invitations.removeTemplate(F.weddingDesign.id, null);
  assert.ok(await invitations.publicInvitation(F.invitation.token));
  assert.equal((await invitations.designsFor(RECEPTION)).designs.length, 0, "but it is not offered any more");
});

test("a deleted invitation's link opens nothing", async () => {
  assert.equal(await invitations.removeInvitation(F.invitation.id, [F.mine.id]), true);
  assert.equal(await invitations.publicInvitation(F.invitation.token), null);
});

test("a song is an MP3 or M4A by its own bytes, not by what it claims", async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString("base64");
  await assert.rejects(invitations.saveSong({ title: tag("Fake"), artist: "", shootTypes: [], sortOrder: 0, isActive: true, audio: `data:audio/mpeg;base64,${png}` }, null), /not really an MP3/);
  await assert.rejects(invitations.saveSong({ title: tag("Wav"), artist: "", shootTypes: [], sortOrder: 0, isActive: true, audio: `data:audio/wav;base64,${png}` }, null), /MP3 or M4A/);
  assert.ok(invitations.AUDIO_TYPES["audio/mpeg"].matches(Buffer.from("ID3\u0004\u0000", "latin1")));
  assert.ok(invitations.AUDIO_TYPES["audio/mp4"].matches(Buffer.from("\u0000\u0000\u0000\u0018ftypM4A ", "latin1")));
});

test("a design needs a name, a shoot, a theme and its artwork", () => {
  assert.equal(invitations.templateSchema.safeParse({ title: "x", shootTypes: [], style: "royal" }).success, false);
  assert.equal(invitations.templateSchema.safeParse({ title: "x", shootTypes: ["Wedding"], style: "neon" }).success, false);
  assert.equal(invitations.templateSchema.safeParse({ title: "x", shootTypes: ["Wedding"], style: "floral", accent: "#C9A227", price: 149 }).success, true);
  assert.equal(invitations.templateSchema.safeParse({ title: "x", shootTypes: ["Wedding"], style: "floral", price: 0 }).success, false, "a price is needed");
  assert.equal(invitations.templateSchema.safeParse({ title: "x", shootTypes: ["Wedding"], style: "floral", price: 99 }).success, false, "within the studio's Rs 100-200");
  assert.equal(invitations.templateSchema.safeParse({ title: "x", shootTypes: ["Wedding"], style: "floral", price: 201 }).success, false);
  assert.equal(invitations.templateSchema.safeParse({ title: "x", shootTypes: ["Wedding"], style: "floral", isFree: true }).success, true, "or marked free");
});

test("design artwork is a GIF, PNG, JPG or WebP by its own bytes, up to 15 MB - nothing else is stored", async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString("base64");
  await assert.rejects(invitations.storeArtwork(`data:image/gif;base64,${png}`), /not really a GIF/);
  await assert.rejects(invitations.storeArtwork(`data:image/svg+xml;base64,${png}`), /GIF, PNG, JPG or WebP/);
  await assert.rejects(invitations.storeArtwork("https://example.com/art.gif"), /could not be read/);
  const big = Buffer.alloc(15 * 1024 * 1024 + 1, 0).toString("base64");
  await assert.rejects(invitations.storeArtwork(`data:image/gif;base64,${big}`), /15 MB or smaller/);
});

