"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import ArrowForward from "@mui/icons-material/ArrowForward";
import LockOutlined from "@mui/icons-material/LockOutlined";
import PersonOutlined from "@mui/icons-material/PersonOutlined";
import Button from "@/components/shared/Button";
import { PageLoader } from "@/components/shared/Loader";
import TextField from "@/components/shared/TextField";
import { useClientCurtain } from "./ClientCurtain";
import { CLIENT_ROUTE, clearAccessToken, getAuthenticatedUser, getDefaultAuthenticatedRoute, isClientAccount, rememberClientSignIn, setAccessToken } from "@/lib/auth";
import { login } from "@/services/auth/auth.service";

/**
 * The fields' own box, on the half-white glass card (`ClientAuthLayout`): sized for a thumb,
 * lettered at 16px so a phone does not zoom into it, and a whiter pane than the glass around it
 * rather than an outlined box - so the box reads as a place to type - with room on the left for
 * the field's icon. The label above it is set in small capitals (`LABEL`), so the box resets the
 * case it would inherit. A browser's saved login paints its own pale blue over a filled-in box; the
 * inset shadow keeps the pane's white.
 */
const FIELD = "!min-h-12 !rounded-xl sm:!min-h-14 sm:!rounded-2xl !border-white/70 !bg-white/70 !pl-11 !pr-4 sm:!pl-12 !text-base !text-[var(--client-ink)] placeholder:!text-[color-mix(in_srgb,var(--client-ink)_45%,transparent)] normal-case tracking-normal shadow-[0_1px_2px_rgba(46,36,25,0.08)] focus:!border-[var(--client-primary)] focus:!bg-white/90 focus:!ring-[color-mix(in_srgb,var(--client-primary)_30%,transparent)] autofill:!shadow-[inset_0_0_0_1000px_color-mix(in_srgb,white_88%,var(--client-sand))]";
// In the studio's ink, which holds its contrast on the half-white glass where grey would not; a
// field's own error, under it, keeps its case.
const LABEL = "!text-[11px] sm:!text-xs !font-bold uppercase tracking-[0.08em] !text-[var(--client-ink)] [&_p]:normal-case [&_p]:tracking-normal [&_p[role=alert]]:!text-rose-800";
// The icon inside the box, nudged in from its edge.
const fieldIcon = (Icon) => <Icon aria-hidden="true" className="ml-1.5 !text-[20px] text-[var(--client-earth)] sm:!text-[22px]" />;

/**
 * The payload of a freshly issued token - read only to tell a client's from a studio account's.
 * Decoded as UTF-8, so a name with an accent in it does not fail the read and turn a client away.
 */
function tokenPayload(token) {
  try {
    const part = String(token).split(".")[1] || "";
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
    const binary = window.atob(`${normalized}${"=".repeat((4 - (normalized.length % 4)) % 4)}`);
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0))));
  } catch {
    return null;
  }
}

/**
 * A client's sign-in: the username and password the studio sent them on WhatsApp, and nothing else.
 *
 * Its own page (`/client/login`) rather than the studio's, because the two people arriving are
 * different. A client has no email to sign in with, no password to reset - they keep the one the
 * studio gave them - and nothing to sign up for, so none of that is offered; what is offered is who
 * to ask. A studio account that signs in here is not kept: it is pointed at the studio's page, so
 * neither page becomes the other's back door.
 *
 * Built for the phone the message is opened on: one column, the studio's mark above, 16px fields a
 * thumb can hit (anything smaller and iOS zooms the page in on focus), no autocapitalising or
 * autocorrecting the username, the browser told which field is which so a saved password fills in,
 * and the page kept clear of the notch and the home bar. On a wide screen it sits beside the
 * studio's slides, as the studio's own sign-in does (`AuthLayout`).
 */
export default function ClientLoginForm() {
  const router = useRouter();
  const { cover } = useClientCurtain();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  // A problem with one field is said on it; anything else above the button. `staff` is the one
  // refusal that has somewhere better to send the reader.
  const [fieldErrors, setFieldErrors] = useState({});
  const [problem, setProblem] = useState("");
  const [staff, setStaff] = useState(false);
  // Until the session is read, nothing is drawn: a signed-in visitor is sent on without seeing
  // a sign-in form flash past first.
  const [checked, setChecked] = useState(false);
  const usernameRef = useRef(null);
  const passwordRef = useRef(null);

  // Already signed in: a client goes to their page, anybody else to theirs.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (getAuthenticatedUser()) router.replace(getDefaultAuthenticatedRoute());
      else setChecked(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [router]);

  const clearProblems = () => { setFieldErrors({}); setProblem(""); setStaff(false); };

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    clearProblems();
    // Said on the field that is empty, which is then where the cursor goes - rather than a button
    // that stays grey without saying why (or stays grey after the browser filled the boxes in).
    const missing = {};
    if (!username.trim()) missing.username = "Enter your username.";
    if (!password) missing.password = "Enter your password.";
    if (Object.keys(missing).length) {
      setFieldErrors(missing);
      (missing.username ? usernameRef : passwordRef).current?.focus();
      return;
    }
    setBusy(true);
    try {
      const data = await login({ username: username.trim(), password });
      const token = data?.token || data?.accessToken || data?.data?.token || data?.data?.accessToken;
      if (!token) throw new Error("The studio's server did not sign you in. Please try again.");
      // A studio account is not signed in from here; its own page is said instead.
      if (!isClientAccount(tokenPayload(token))) {
        clearAccessToken();
        setStaff(true);
        return;
      }
      setAccessToken(token);
      rememberClientSignIn(data);
      // Drawn over the sign-in before it goes, and off the project once it is there.
      await cover();
      router.replace(CLIENT_ROUTE);
    } catch (requestError) {
      if (requestError.code === "NETWORK_ERROR") setProblem("We could not reach the studio's server. Check your connection and try again.");
      else if (requestError.status === 401) {
        setFieldErrors({ password: "That username and password do not match. Check them against the message the studio sent you." });
        passwordRef.current?.focus();
      }
      else if (requestError.status === 403) setProblem("This login is no longer active. Please contact the studio.");
      else if (requestError.status === 429) setProblem("Too many tries. Please wait a minute, then try again.");
      else setProblem(requestError.data?.message || requestError.message || "Unable to sign in. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!checked) return <div className="flex min-h-[60dvh] items-center justify-center"><PageLoader label="Loading..." /></div>;

  return <div className="pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
    {/* The studio's mark is the page's, at its top left (`ClientAuthLayout`): the card is the form. */}
    <div>
      <h1 className="font-[family-name:var(--client-serif)] text-[2.1rem] font-semibold leading-none text-[var(--client-ink)] sm:text-[2.6rem]">Sign in</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-[var(--client-ink)] sm:mt-3 sm:text-base">Use the username and password the studio sent you on WhatsApp.</p>

      <form onSubmit={submit} className="mt-5 space-y-4 sm:mt-6 sm:space-y-5" noValidate>
        <TextField
          label="Username"
          required
          helperText="The username the studio sent you on WhatsApp."
          name="username"
          value={username}
          onChange={(event) => { setUsername(event.target.value); clearProblems(); }}
          ref={usernameRef}
          error={fieldErrors.username}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          disabled={busy}
          placeholder="e.g. client_dbs"
          prefix={fieldIcon(PersonOutlined)}
          className={LABEL}
          inputClassName={FIELD}
        />
        {/* Show password sits on the label's line, at its right - outside the label, so the label
            still belongs to the password box alone. */}
        <div className="relative">
          <TextField
            label="Password"
            required
            helperText="The password from the same WhatsApp message; it is case-sensitive."
            name="password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(event) => { setPassword(event.target.value); clearProblems(); }}
            ref={passwordRef}
            error={fieldErrors.password}
            autoComplete="current-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            disabled={busy}
            placeholder="••••••••••"
            prefix={fieldIcon(LockOutlined)}
            className={LABEL}
            inputClassName={`${FIELD} tracking-wide`}
          />
          <Button type="button" variant="plain" size="none" onClick={() => setShowPassword((shown) => !shown)} className="absolute -top-3 right-0 !min-h-10 px-1 !text-[13px] !font-bold sm:!text-sm text-[var(--client-ink)] underline decoration-[var(--client-primary)] decoration-2 underline-offset-4 hover:decoration-[var(--client-ink)]">
            {showPassword ? "Hide password" : "Show password"}
          </Button>
        </div>

        {problem && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{problem}</p>}
        {staff && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This sign-in is for clients. Studio staff sign in on <Link href="/login" className="font-medium underline">the studio&apos;s login page</Link>.
        </p>}

        <Button type="submit" variant="plain" disabled={busy} className="!min-h-12 w-full gap-2 !rounded-xl bg-[var(--client-primary)] !text-[15px] !font-bold sm:!min-h-14 sm:!rounded-2xl sm:!text-base text-[var(--client-ink)] shadow-[0_10px_24px_-12px_color-mix(in_srgb,var(--client-primary)_80%,transparent)] hover:bg-[var(--client-primary-hover)] disabled:bg-slate-300 disabled:text-white disabled:shadow-none">
          {busy ? "Signing in..." : <>Sign in <ArrowForward aria-hidden="true" className="!text-[18px] sm:!text-[20px]" /></>}
        </Button>
      </form>
    </div>

    <p className="mt-6 text-[13px] text-[var(--client-ink)] sm:mt-8 sm:text-sm">Forgotten your password, or it does not work? Ask the studio on WhatsApp.</p>
  </div>;
}
