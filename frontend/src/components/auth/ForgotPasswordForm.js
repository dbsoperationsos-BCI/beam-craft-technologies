"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import PhoneField from "@/components/shared/PhoneField";
import { requestPasswordResetOtp, verifyPasswordResetOtp } from "@/services/auth/auth.service";

/**
 * Getting back in, by a code on your mobile.
 *
 * There is no email route here. The studio's people know their own number and do not all read the
 * address their login was created with — several are work addresses nobody opens — so recovery is a
 * six-digit code to the number they gave during onboarding, and that is the whole of it.
 *
 * The number is the one on their **employee record**, or on the login itself for an account that is
 * not a person: recovery being code-only means an account with nowhere to receive one can never
 * reset its own password, and the studio's Super Admin has no employee record at all. `user.mobile`
 * is where that number goes, set from Admin → User Management.
 *
 * Nothing here says whether a number belongs to anybody. That is deliberate on the server and must
 * not be undone here: a form that answers differently is a way of asking who works at the studio.
 */


/** What the code is worth, and what the countdown counts. The server holds the same two minutes. */
const OTP_SECONDS = 120;

/*
 * `mm:ss`, both halves padded, so the clock is one fixed width from 01:59 down to 00:00 rather than
 * a digit narrower for the last minute — a countdown that shifts on the screen as it runs reads as
 * a glitch on the one screen where somebody is watching it closely.
 */
const asClock = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

export default function ForgotPasswordForm() {
  const router = useRouter();
  const { notice, showNotice, showError, clearNotice } = useNotice();

  // "asking" is the number; "code" is the six digits sent to it. There is no third state - a
  // verified code leaves this screen for the one that sets the password.
  const [step, setStep] = useState("asking");

  const [mobile, setMobile] = useState("");
  const [otp, setOtp] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const otpRef = useRef(null);

  /*
   * The countdown, ticking to zero and stopping.
   *
   * One interval, cleared when it runs out or when the component goes, so a form left open does not
   * keep a timer alive. It only ever counts down — a new code restarts it by setting the seconds
   * again, which is a state change rather than a second interval.
   */
  useEffect(() => {
    if (secondsLeft <= 0) return undefined;
    const timer = setInterval(() => setSecondsLeft((current) => (current <= 1 ? 0 : current - 1)), 1000);
    return () => clearInterval(timer);
  }, [secondsLeft]);

  const expired = step === "code" && secondsLeft <= 0;

  /** Asks for a code, and starts the two minutes. Also how Resend works — it is the same request. */
  const sendCode = useCallback(async () => {
    const number = mobile.trim();
    if (!number || busy) return;
    setBusy(true);
    try {
      const response = await requestPasswordResetOtp(number);
      setOtp("");
      /*
       * One second less than the server granted, so the clock starts at 01:59 and not at a 02:00
       * that is already untrue: the code was minted, sent and answered before this line ran. It
       * also means the countdown reaches zero a moment *before* the code does rather than after,
       * so Resend is never offered against an OTP the server would still accept.
       */
      setSecondsLeft(Math.max(0, (Number(response?.expiresInSeconds) || OTP_SECONDS) - 1));
      setStep("code");
      showNotice(response?.message || "If this mobile number belongs to an account, a code has been sent to it.");
      // The box somebody is about to type into, so the code can be entered without reaching for it.
      setTimeout(() => otpRef.current?.focus(), 0);
    } catch (error) {
      showError(error?.message || "Unable to send the code. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [busy, mobile, showError, showNotice]);

  /**
   * Checks the code and, if it is right, goes on to choose the password.
   *
   * The token it comes back with is the same one an emailed link carries, so the next screen is the
   * one the emailed route reaches — there is one place a password is set.
   */
  const verifyCode = useCallback(async () => {
    const code = otp.trim();
    if (code.length !== 6 || busy) return;
    setBusy(true);
    try {
      const response = await verifyPasswordResetOtp({ mobile: mobile.trim(), otp: code });
      if (!response?.token) throw new Error("That code could not be checked. Ask for a new one.");
      router.push(`/reset-password?token=${encodeURIComponent(response.token)}`);
    } catch (error) {
      showError(error?.message || "That code is not right, or it has expired. Ask for a new one.");
      setBusy(false);
    }
  }, [busy, mobile, otp, router, showError]);

  /** Back to the number, abandoning a live code — for somebody who typed the wrong number. */
  const useAnotherNumber = () => {
    setStep("asking");
    setOtp("");
    setSecondsLeft(0);
    clearNotice();
  };

  function submit(event) {
    event.preventDefault();
    if (step === "asking") return void sendCode();
    return void verifyCode();
  }

  const lead = step === "asking"
    ? "Enter your registered mobile number and we'll send you a six-digit code."
    : "Enter the six-digit code sent to your mobile. It is valid for two minutes.";

  return <div>
    <p className="text-lg font-semibold text-slate-800">DBS - CRM</p>
    <h1 className="mt-10 text-3xl font-semibold tracking-tight text-slate-900">Reset your password</h1>
    <p className="mt-3 text-sm leading-6 text-slate-500">{lead}</p>
    <FloatingNotice notice={notice} onClose={clearNotice} />

    <form onSubmit={submit} className="mt-7 space-y-5">
      {/* The application's own phone control, with its country picker — the same one the number was
          recorded with, so what is typed here is the shape the record holds. Locked once a code is
          out: changing the number under a live code would ask for one phone and check the other. */}
      <PhoneField
        required
        label="Mobile number"
        field="mobile"
        value={mobile}
        onChange={(_field, next) => setMobile(next)}
        disabled={busy || step === "code"}
      />

      {step === "code" && <div>
        <label className="block text-sm font-medium text-slate-700">Six-digit code
          <input
            ref={otpRef}
            required
            // `inputMode` rather than `type="number"`: a numeric keypad on a phone, without the
            // spinner and the scroll-to-change a number input brings on a desktop.
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={otp}
            // Digits only, so a pasted "123 456" or "code: 123456" still lands as six digits.
            onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
            disabled={busy || expired}
            placeholder="000000"
            className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-center text-lg tracking-[0.4em] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-400"
          />
        </label>
        {/* What is left, said as a clock rather than as a bar: somebody typing a code wants to know
            whether they have time, and "0:38" answers that exactly. */}
        <div className="mt-2 flex items-center justify-between text-sm">
          <span aria-live="polite" className={expired ? "text-red-600" : "text-slate-500"}>
            {expired ? "This code has expired." : `Expires in ${asClock(secondsLeft)}`}
          </span>
          <button
            type="button"
            onClick={() => void sendCode()}
            // Only once it has expired: a Resend that works while a code is live is how somebody
            // ends up with two codes and types the one that no longer counts.
            disabled={busy || !expired}
            className="font-medium text-blue-600 hover:text-blue-700 disabled:cursor-not-allowed disabled:text-slate-400"
          >
            Resend code
          </button>
        </div>
      </div>}

      <button
        type="submit"
        disabled={busy || (step === "code" && (expired || otp.length !== 6))}
        className="w-full rounded-lg bg-blue-600 px-4 py-3 font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
      >
        {busy ? "Please wait..." : step === "asking" ? "Send OTP" : "Verify code"}
      </button>
    </form>

    {/* Only while a code is out, and only for the one thing that goes wrong here: the number was
        typed incorrectly, so the code is on its way to a phone nobody is holding. */}
    {step === "code" && <button
      type="button"
      onClick={useAnotherNumber}
      disabled={busy}
      className="mt-5 text-sm font-medium text-blue-600 hover:text-blue-700 disabled:text-slate-400"
    >
      Use a different mobile number
    </button>}

    <Link href="/login" className="mt-8 block text-sm font-medium text-blue-600 hover:text-blue-700">← Back to login</Link>
  </div>;
}
