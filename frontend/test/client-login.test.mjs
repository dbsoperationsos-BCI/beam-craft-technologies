import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { CLIENT_LOGIN_TEMPLATE_KEY, clientLoginMessage, clientLoginPayload, clientLoginProblems, clientUsernameFor, emptyClientLogin } from "../src/lib/clientLogin.mjs";
import { TEMPORARY_PASSWORD_PATTERN } from "../src/lib/temporaryPassword.mjs";

const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");
const FORM = read("components", "sales", "CreateProjectFormPanel.js");
const SECTION = read("components", "sales", "ClientCredentialsSection.js");
const READY = read("components", "sales", "ClientLoginReadyDialog.js");
const BOOKING_PANEL = read("components", "sales", "ProjectBookingPanel.js");
const AUTH = read("lib", "auth.js");
const REQUIRE_AUTH = read("components", "auth", "RequireAuth.js");
const PORTAL = read("components", "client", "ClientPortalPage.js");
const BOOKING = read("components", "sales", "projectBooking.js");
const SETTINGS = read("components", "settings", "SettingsOverlay.js");

test("a client login is their mobile number and a generated password - no switch, and no email", () => {
  const login = emptyClientLogin();
  assert.deepEqual(Object.keys(login), ["temporaryPassword"], "the username is not typed - it is the number");
  assert.match(login.temporaryPassword, TEMPORARY_PASSWORD_PATTERN);
  // With no Client Main Number yet, the username is what is missing; no email is asked for.
  assert.deepEqual(Object.keys(clientLoginProblems(login)), ["username"]);
  assert.doesNotMatch(SECTION, /ToggleSwitch|Login Email|type="email"/);
});

test("the username is the ten digits of the Client Main Number, shown and never typed", () => {
  const login = emptyClientLogin();
  // Without the country code, whatever the number is written as.
  assert.equal(clientUsernameFor("+91 96787 87888"), "9678787888");
  assert.equal(clientUsernameFor("+919678787888"), "9678787888");
  assert.equal(clientUsernameFor("9678787888"), "9678787888");
  // Not a full number yet: no username, and the form says where it comes from.
  assert.equal(clientUsernameFor("+91 96787"), "");
  assert.equal(clientUsernameFor(null), "");
  assert.match(clientLoginProblems(login, { clientMainNumber: "+91 967" }).username, /Add the client's 10-digit mobile number as the Client Main Number first\./);
  assert.deepEqual(clientLoginProblems(login, { clientMainNumber: "+91 9678787888" }), {});
  assert.deepEqual(clientLoginPayload(login, { clientMainNumber: "+91 9678787888" }), { username: "9678787888", temporaryPassword: login.temporaryPassword });
  // Read-only in the section: the number decides it, nobody types it.
  assert.match(SECTION, /label="Username"\s+helperText=\{`[^`]*\$\{usernameHint\}`\}\s+readOnly\s+value=\{username\}/);
  assert.match(FORM, /const clientUsername = clientUsernameFor\(form\.clientMainNumber\);/);
  assert.match(FORM, /<ClientCredentialsSection value=\{clientLogin\} username=\{clientUsername\}/);
});

test("the message is the studio's Client Login Credential template, filled in", () => {
  assert.equal(CLIENT_LOGIN_TEMPLATE_KEY, "CLIENT_LOGIN_CREDENTIALS");
  const template = { key: CLIENT_LOGIN_TEMPLATE_KEY, body: "Hi,\n\n{project name}\nUsername: {username}\nPassword: {password}\nLogin here: {login link}" };
  const values = { projectName: "WED Priya & Arjun", username: "priya.arjun", temporaryPassword: "abcd-efgh-jkmn", loginLink: "https://os.example.com/login" };
  assert.equal(clientLoginMessage(template, values), "Hi,\n\nWED Priya & Arjun\nUsername: priya.arjun\nPassword: abcd-efgh-jkmn\nLogin here: https://os.example.com/login");
  // No template: the wording it was seeded with - and never a password change the client cannot make.
  const fallback = clientLoginMessage(null, values);
  assert.match(fallback, /Your login for WED Priya & Arjun has been created/);
  assert.match(fallback, /Password: abcd-efgh-jkmn/);
  assert.doesNotMatch(fallback, /email|change|choose your own/i);
  assert.match(SETTINGS, /templateKey="CLIENT_LOGIN_CREDENTIALS"/);
});

test("saving makes the login, then Client Login Ready hands it over - the Screening Form Ready dialog's shape", () => {
  // Not when the client already has a login from an earlier event: the project joins that one.
  assert.match(FORM, /const sendingClientLogin = mode === "create" && mayCreateClientLogin && !existingClientLogin;/);
  assert.match(FORM, /clientLogin: sendingClientLogin \? clientLoginPayload\(clientLogin, \{ clientMainNumber: form\.clientMainNumber \}\) : null/);
  // Nothing reaches the client before the project exists: no WhatsApp, and no Client Login Ready on the
  // form itself (the form's own dialogs - the saved draft's offer - are not about the login).
  assert.doesNotMatch(FORM, /window\.open|wa\.me|ClientLoginReadyDialog/, "nothing is sent before the project exists");
  assert.match(BOOKING_PANEL, /if \(handover\) return <ClientLoginReadyDialog \{\.\.\.handover\} onClose=\{\(\) => \{ setHandover\(null\); onClose\?\.\(\); \}\} \/>;/);
  // The shared message box with its Copy, and Close + Send WhatsApp in the footer.
  assert.match(READY, /title="Client Login Ready"/);
  assert.match(READY, /<ShareableMessage label="Message to send them" message=\{message\} rows=\{9\} onTextChange=\{setMessageText\} \/>/);
  assert.match(READY, /\{canSend && <SendWhatsAppButton className="max-sm:flex-1" message=\{messageText\} onSend=\{sendOnWhatsApp\} \/>\}/);
  assert.match(READY, /await sendClientLoginWhatsApp\(projectId, text\);/);
});

test("Create Project's rail groups the project's sections under Project, then Client Credentials", () => {
  assert.match(FORM, /const projectSectionLinks = \[\["project-details", "Project Details"\], \["sales-remarks", "Sales Remarks"\], \["service-creation", "Service Creation"\], \["sale-extras", "Extra"\], \["schedule-payment", "Shedule Payment"\], \["payment-received", "Payment Received"\]\];/);
  assert.match(FORM, /\["project", "Project", projectSectionLinks\.filter\(/);
  // On Create Project and on Edit Sale Details alike.
  assert.match(FORM, /\.\.\.\(mayCreateClientLogin \? \[CLIENT_CREDENTIALS_LINK\] : \[\]\)/);
  /*
   * On the booking's own permission, the way the server asks it (`answersForAProject`): Sales
   * Manager, Projects, or Show All Projects at Read / Write. It used to ask for
   * `ADMIN / User Management`, which the server never asked for - so the section was hidden from
   * the very people whose booking it is, and took the form's left rail with it, the rail having
   * one entry left to show.
   */
  assert.match(FORM, /const \{ canWrite: salesManagerWrite \} = useModuleAccess\("SALES", "Sales Manager"\);/);
  assert.match(FORM, /const \{ canWrite: projectsWrite \} = useModuleAccess\("PROJECT", "Projects"\);/);
  assert.match(FORM, /const \{ canWrite: showAllProjectsWrite \} = useModuleAccess\("PROJECT", "Show All Projects"\);/);
  assert.match(FORM, /const mayCreateClientLogin = salesManagerWrite \|\| projectsWrite \|\| showAllProjectsWrite;/);
  assert.doesNotMatch(FORM, /useModuleAccess\("ADMIN", "User Management"\)/);
  assert.match(FORM, /\{mayCreateClientLogin && <SchemaFormSection id="client-credentials" title="Client Credentials">/);
  assert.match(BOOKING, /\.\.\.\(project\.clientLogin \? \{ clientLogin: project\.clientLogin \} : \{\}\)/);
  // Both read-only: the username is the client's mobile number, the password is generated.
  assert.match(SECTION, /label="Username"\s+helperText=\{`[^`]*\$\{usernameHint\}`\}\s+readOnly/);
  assert.match(SECTION, /<TextField label="Temporary Password" helperText=\{`[^`]*\$\{hint\}`\} readOnly/);
});

test("a client's sign-in lands on its own page, which offers no password change", () => {
  assert.match(AUTH, /return isClientAccount\(\) \? CLIENT_ROUTE : "\/hrm\/client-details";/);
  assert.match(REQUIRE_AUTH, /setAuthorized\(hasToken && !client\);/);
  assert.match(REQUIRE_AUTH, /else if \(client\) router\.replace\(CLIENT_ROUTE\);/);
  assert.match(PORTAL, /if \(!isClientAccount\(signedIn\)\) \{ router\.replace\(getDefaultAuthenticatedRoute\(\)\); return; \}/);
  // The studio gives the password and the client keeps it.
  assert.doesNotMatch(PORTAL, /ChangePassword|changeMyPassword/);
  assert.equal(fs.existsSync(path.join(import.meta.dirname, "..", "src", "components", "profile", "ChangePasswordForm.js")), false);
});

test("Edit Sale Details shows the client login, or makes one for a project booked without it", () => {
  const EDIT = read("components", "sales", "ClientLoginEditSection.js");
  assert.match(FORM, /: <ClientLoginEditSection projectId=\{project\?\.id\} projectName=\{project\?\.whatsappGroupName\} clientMainNumber=\{project\?\.clientMainNumber\} \/>/);
  // An existing login: its username, its status and whether the client has changed the password -
  // never the password itself.
  assert.match(EDIT, /<RecordSummaryCard rows=\{\[\["Username", state\.login\.username\], \["Status", state\.login\.active \? "Active" : "Switched off"\], \["Password", clientPasswordLabel\(state\.login\)\]\]\} \/>/);
  // None: the same fields, made now, then handed over in Client Login Ready over the form.
  assert.match(EDIT, /const made = await createClientLogin\(projectId, payload\);/);
  // Handed over with the username the server made from the project's saved number.
  assert.match(EDIT, /username: made\?\.data\?\.username \|\| payload\.username/);
  assert.match(EDIT, /<ClientLoginReadyDialog \{\.\.\.handover\} layer="dialogOverPanel"/);
});

test("a client signs in on their own page, built for the phone the message is opened on", () => {
  const FORM_PAGE = read("components", "client", "ClientLoginForm.js");
  const ROUTE = read("app", "client", "login", "page.js");
  assert.match(AUTH, /export const CLIENT_LOGIN_ROUTE = "\/client\/login";/);
  assert.match(ROUTE, /<ClientAuthLayout><ClientLoginForm \/><\/ClientAuthLayout>/);
  // 16px fields a thumb can hit - smaller and iOS zooms the page in on focus.
  // Compact on a phone, roomier from sm up - the typed text 16px throughout, so iOS never zooms in.
  assert.ok(FORM_PAGE.includes('const FIELD = "!min-h-12 !rounded-xl sm:!min-h-14 sm:!rounded-2xl !border-white/70 !bg-white/70 !pl-11 !pr-4 sm:!pl-12 !text-base !text-[var(--client-ink)]'));
  // On the half-white glass everything is lettered in the studio's ink, never a grey that fades on it.
  // The studio's mark is the page's, at its top left on the dark ground - not on the card.
  assert.doesNotMatch(FORM_PAGE, /<AppLogo/);
  assert.ok(read("components", "client", "ClientAuthLayout.js").includes('<AppLogo variant="navbar" surface="dark" priority />'));
  assert.doesNotMatch(FORM_PAGE, /text-slate-(400|500|600)/);
  // Each field carries its icon inside the box, and Show password sits on the password label's line.
  assert.match(FORM_PAGE, /prefix=\{fieldIcon\(PersonOutlined\)\}/);
  assert.match(FORM_PAGE, /prefix=\{fieldIcon\(LockOutlined\)\}/);
  assert.ok(FORM_PAGE.includes('className="absolute -top-3 right-0 !min-h-10 px-1 !text-[13px] !font-bold sm:!text-sm text-[var(--client-ink)] underline decoration-[var(--client-primary)] decoration-2 underline-offset-4 hover:decoration-[var(--client-ink)]"'));
  // Sign in is the palette's gold, with ink - not white - on it, which gold is too light to carry.
  assert.ok(FORM_PAGE.includes("bg-[var(--client-primary)] !text-[15px] !font-bold sm:!min-h-14 sm:!rounded-2xl sm:!text-base text-[var(--client-ink)]"));
  assert.match(FORM_PAGE, /autoComplete="username"/);
  assert.match(FORM_PAGE, /autoComplete="current-password"/);
  assert.match(FORM_PAGE, /autoCapitalize="none"/);
  assert.match(FORM_PAGE, /pb-\[env\(safe-area-inset-bottom\)\]/);
  // A studio account is not signed in from here, and nothing offers a reset a client cannot make.
  assert.match(FORM_PAGE, /if \(!isClientAccount\(tokenPayload\(token\)\)\) \{\s+clearAccessToken\(\);/);
  assert.doesNotMatch(FORM_PAGE, /forgot-password|Sign up/);
  // The message's link, and signing out, both lead here.
  assert.match(READY, /loginLink: `\$\{publicOrigin\(\)\}\$\{CLIENT_LOGIN_ROUTE\}`/);
  assert.ok(PORTAL.includes("clearAccessToken(); router.replace(CLIENT_LOGIN_ROUTE);"), "signing out goes back to the client sign-in");
});


test("the client sign-in's film strip carries its own pictures, kept in Settings → Project Management → Client page images", () => {
  const LAYOUT = read("components", "client", "ClientAuthLayout.js");
  const PANEL = read("components", "settings", "LoginSlidePanel.js");
  // Its own list on the public branding, not the staff sign-in's Login Slide.
  assert.ok(LAYOUT.includes("const pictures = Array.isArray(branding?.clientLoginSlides) ? branding.clientLoginSlides.filter(Boolean) : [];"));
  assert.doesNotMatch(LAYOUT, /branding\?\.loginSlides/);
  // A Project Management group with one entry, offered on the permission its endpoint checks.
  assert.match(SETTINGS, /\.\.\.\(canWriteClientPageImages \|\| canReadPaymentReminder \|\| canReadShootCrewNotice \? \[\{\s*id: "project-management",\s*title: "Project Management",\s*children: \[\s*\.\.\.\(canWriteClientPageImages \? \[\{ id: "client-page-images", title: "Client page images", render: \(\) => <ClientPageImagesPanel unsavedRef=\{clientPageImagesUnsavedRef\} \/> \}\] : \[\]\),/);
  assert.match(SETTINGS, /useModuleAccess\("SETTINGS", "Client Page Images"\)/);
  assert.match(SETTINGS, /"client-page-images": clientPageImagesUnsavedRef,/, "an unsaved picture is warned about on the way out");
  // The Login Slide panel, pointed at the other list and its own endpoint.
  assert.ok(PANEL.includes('field="clientLoginSlides"'));
  assert.ok(PANEL.includes("const writeClientPageImages = async (slides) => (await saveClientPageImages(slides))?.data || {};"));
  assert.match(read("services", "image-selection", "image-selection.service.js"), /export const saveClientPageImages = \(clientLoginSlides\) => apiRequest\(clientPageImagesBase, \{ method: "PUT"/);
});

test("the client sign-in opens on the film: a strip that winds in and lands on the page's own", () => {
  const LAYOUT = read("components", "client", "ClientAuthLayout.js");
  const SPLASH = read("components", "client", "FilmSplash.js");
  // The opening carries the same reel as the page, and lands on the page's strip.
  assert.ok(LAYOUT.includes("{opening && <FilmSplash targetRef={stripRef} onDone={opened}>{film(true)}</FilmSplash>}"));
  // It starts rolled up, and unrolls on the page strip's own track and tilt: a roll seen from
  // above lays the film out behind it, the film uncovered up to the roll.
  assert.ok(SPLASH.includes('<div ref={trackRef} className="absolute left-0 top-0 -rotate-2">'));
  assert.ok(SPLASH.includes("{ clipPath: laidTo(to) },"));
  assert.ok(SPLASH.includes("roll.animate(["));
  assert.ok(SPLASH.includes('<div data-turning className="film-sprockets h-3" />'), "the roll's sprocket holes turn as it rolls");
  assert.doesNotMatch(SPLASH, /Tap anywhere to skip|onPointerDown|title/, "no name, no skip line, no tap to skip");
  // The page's strip waits, hidden and still, and drifts on only once the opening has handed over.
  assert.ok(LAYOUT.includes('${opening ? "motion-safe:invisible" : ""}'));
  assert.ok(LAYOUT.includes('${opening ? "" : "film-drift "}w-max'));
  // Laid again over the page's strip whenever the page scrolls under it.
  assert.ok(SPLASH.includes('window.addEventListener("scroll", repin, { passive: true });'));
  // Never for a device asking for less motion; a real key ends it - not autofill's keydown.
  assert.ok(SPLASH.includes("motion-reduce:hidden"));
  assert.ok(SPLASH.includes('window.matchMedia("(prefers-reduced-motion: reduce)").matches'));
  assert.ok(SPLASH.includes("const onKey = (event) => { if (event.key && !MODIFIERS.has(event.key)) finishRef.current(); };"));
  assert.ok(SPLASH.includes("const safety = window.setTimeout(finish, TOTAL + 1000);"), "never left standing over the form");
  assert.ok(SPLASH.includes('aria-hidden="true"'));
});

test("between the sign-in and the project, film is drawn across: down over one page, on down off the next", () => {
  const CURTAIN = read("components", "client", "ClientCurtain.js");
  const LAYOUT = read("app", "client", "layout.js");
  const FORM = read("components", "client", "ClientLoginForm.js");
  const AUTH_LAYOUT = read("components", "client", "ClientAuthLayout.js");
  const CSS = read("app", "globals.css");
  // In the layout both pages share, which stays put as the client moves between them.
  assert.match(LAYOUT, /<ClientCurtainProvider>\{children\}<\/ClientCurtainProvider>/);
  // Signing in draws it before going; the project draws it off once it has something to show.
  assert.ok(FORM.includes("await cover();\n      router.replace(CLIENT_ROUTE);") || FORM.includes("await cover();\r\n      router.replace(CLIENT_ROUTE);"));
  assert.ok(PORTAL.includes("if (user && !project.loading) reveal();"));
  // Signing out goes the same way, and the sign-in shown under it does not unroll its film again.
  assert.ok(PORTAL.includes("const signOut = async () => { await cover(); clearAccessToken(); router.replace(CLIENT_LOGIN_ROUTE); };"));
  assert.ok(AUTH_LAYOUT.includes("const [opening, setOpening] = useState(() => !isDrawn());"));
  // Never left closed, never for a device asking for less motion, and motion only under the guard.
  assert.ok(CURTAIN.includes("const READY_WITHIN = 8000;"));
  assert.ok(CURTAIN.includes('if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return Promise.resolve();'));
  assert.match(CSS, /@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*\.curtain-close \{ animation: curtain-close/);
});
