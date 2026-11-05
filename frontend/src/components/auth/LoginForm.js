"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import { brandNameFor } from "@/components/shared/BrandFallbackLogo";
import AppLogo from "@/components/shared/AppLogo";
import useStudioBranding from "@/components/shared/useStudioBranding";
import useFormErrors from "@/components/shared/useFormErrors";
import { login } from "@/services/auth/auth.service";
import { getDefaultAuthenticatedRoute, hasAccessToken, rememberClientSignIn, setAccessToken } from "@/lib/auth";

// A box's border: red while it carries a message, the usual blue focus otherwise.
const boxTone = (error) => (error ? "border-red-400 focus:border-red-500 focus:ring-red-100" : "border-slate-300 focus:border-blue-500 focus:ring-blue-100");

export default function LoginForm() {
  const router = useRouter();
  const branding = useStudioBranding();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const { notice, showNotice, showError, clearNotice } = useNotice();
  const fields = useFormErrors();
  const resetDone = useSearchParams().get("reset") === "1";

  useEffect(() => {
    if (resetDone) showNotice("Your password has been updated. Please sign in with it.", "success");
  }, [resetDone, showNotice]);

  useEffect(() => {
    const timer = window.setTimeout(() => { if (hasAccessToken()) router.replace(getDefaultAuthenticatedRoute()); }, 0);
    return () => window.clearTimeout(timer);
  }, [router]);

  async function submit(event) {
    event.preventDefault();
    clearNotice();
    if (!fields.check({
      username: username.trim() ? "" : "Enter your username or email.",
      password: password ? "" : "Enter your password.",
    })) return;
    setLoading(true);
    try {
      const data = await login({ email: username, username, password });
      const token = data?.token || data?.accessToken || data?.data?.token || data?.data?.accessToken;
      if (!token) throw new Error("No access token was returned");
      setAccessToken(token);
      // A client goes on to the client website, if the studio runs one (`/client` hands it over).
      rememberClientSignIn(data);
      router.replace(getDefaultAuthenticatedRoute());
    } catch (requestError) {
      if (requestError.code === "NETWORK_ERROR") showError("Backend server is not reachable. Please check local backend is running.");
      else if (requestError.status === 401) showError("Username or Password Incorrect");
      else if (requestError.status >= 500) showError("Login service is unavailable. Please try again after checking the backend terminal.");
      else showError(requestError.data?.message || "Unable to sign in. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return <div>
    <div className="flex flex-col items-center gap-3">
      {/* Through `AppLogo` rather than an <img> of its own, which is what left this page blank
          for a studio with no Global Logo set: the guard here was on the uploaded URL, so there was
          nothing to fall back to. The shared component answers with the uploaded logo when there is
          one and the bundled mark when there is not, on every surface alike. */}
      <AppLogo variant="login" priority />
      {/* The same name the top bar writes: the studio's own, and nothing where the Global Name has
          been left empty. Lettered the same way too - Montserrat, regular weight, the same slate -
          so the brand reads alike on the bar and here. Only the size differs, because here it sits
          under a full-width mark rather than beside a 14px one. */}
      {brandNameFor(branding) && <p className="text-center font-[family-name:var(--font-montserrat)] text-[22px] font-normal text-slate-700">{brandNameFor(branding)}</p>}
    </div>
    <h1 className="mt-10 text-3xl font-semibold tracking-tight text-slate-900">Sign in to your Account</h1>
    <p className="mt-2 text-sm text-slate-500">Welcome back. Please enter your details.</p>
    <FloatingNotice notice={notice} onClose={clearNotice} />
    <form noValidate onSubmit={submit} className="mt-7 space-y-5">
      <label className="block text-sm font-medium text-slate-700">Username or email<input required autoComplete="username" value={username} onChange={(event) => { setUsername(event.target.value); fields.clear("username"); }} aria-invalid={fields.errors.username ? true : undefined} className={`mt-2 block w-full rounded-lg border bg-white px-3 py-3 outline-none focus:ring-2 ${boxTone(fields.errors.username)}`} />{fields.errors.username && <p role="alert" className="mt-1.5 font-normal text-red-600">{fields.errors.username}</p>}</label>
      <label className="block text-sm font-medium text-slate-700">Password<div className="relative mt-2"><input required autoComplete="current-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => { setPassword(event.target.value); fields.clear("password"); }} aria-invalid={fields.errors.password ? true : undefined} className={`block w-full rounded-lg border bg-white px-3 py-3 pr-16 outline-none focus:ring-2 ${boxTone(fields.errors.password)}`} /><button type="button" onClick={() => setShowPassword((visible) => !visible)} className="absolute inset-y-0 right-3 text-sm text-slate-500 hover:text-slate-800">{showPassword ? "Hide" : "Show"}</button></div>{fields.errors.password && <p role="alert" className="mt-1.5 font-normal text-red-600">{fields.errors.password}</p>}</label>
      <div className="text-right"><Link href="/forgot-password" className="text-sm font-medium text-blue-600 hover:text-blue-700">Forgot Password?</Link></div>
      <button disabled={loading} className="w-full rounded-lg bg-blue-600 px-4 py-3 font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300">{loading ? "Signing in..." : "Sign in"}</button>
    </form>
    <p className="mt-8 text-center text-sm text-slate-500">Don’t have an Account? <span aria-disabled="true" className="cursor-not-allowed font-medium text-slate-400">Sign up</span></p>
  </div>;
}
