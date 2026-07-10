"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AFTER_SIGNIN_PATH, signIn } from "@/lib/auth";

/*
  Sign In — front door of AR Manager.

  Premium two-panel login for Verve Advisory. DEMO login only: the email /
  password fields are not verified — on submit we create the session and open
  Home. Auth logic in lib/auth.ts is unchanged; this page only calls signIn()
  and redirects, exactly as before. This pass is purely visual (colors, glass
  card, typography, backgrounds, animations).
*/

function IconMail({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}
function IconLock({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
function IconEye({ off = false, className = "" }: { off?: boolean; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="m4 4 16 16" />}
    </svg>
  );
}
function IconCheck({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M5 12l5 5L20 7" />
    </svg>
  );
}

const FEATURES = ["Invoice Management", "Receipt Tracking", "Aging Analysis"];

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPw, setShowPw] = useState(false);

  // Unchanged auth: demo access — sign in and open Home.
  function handleSignIn() {
    signIn("AR Manager");
    router.replace(AFTER_SIGNIN_PATH);
  }

  const inputWrap =
    "flex h-[52px] items-center gap-3 rounded-[14px] border border-white/[0.08] bg-[#111C2E] px-4 transition-all focus-within:border-[#2563EB] focus-within:ring-2 focus-within:ring-[#2563EB]/20";
  const inputEl = "w-full bg-transparent text-base text-white outline-none placeholder:text-slate-400";

  return (
    <div className="flex min-h-screen bg-[#08111F]">
      {/* ===================== LEFT · brand panel ===================== */}
      <aside className="relative hidden w-[45%] items-center justify-center overflow-hidden md:flex">
        {/* premium blue gradient-mesh finance background */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            backgroundColor: "#0a1830",
            backgroundImage:
              "radial-gradient(at 18% 20%, rgba(37,99,235,0.40) 0px, transparent 55%)," +
              "radial-gradient(at 84% 16%, rgba(29,78,216,0.32) 0px, transparent 50%)," +
              "radial-gradient(at 62% 88%, rgba(14,116,144,0.28) 0px, transparent 55%)," +
              "radial-gradient(at 28% 74%, rgba(37,99,235,0.24) 0px, transparent 52%)",
          }}
        />
        {/* subtle abstract financial graph line */}
        <svg aria-hidden viewBox="0 0 600 400" preserveAspectRatio="none" className="absolute inset-0 h-full w-full opacity-[0.10]">
          <polyline points="0,300 90,260 170,290 250,190 330,230 420,120 500,170 600,70" fill="none" stroke="#ffffff" strokeWidth="2" />
        </svg>
        {/* faint grid */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.05] [mask-image:radial-gradient(ellipse_at_center,black,transparent_78%)]"
          style={{
            backgroundImage: "linear-gradient(#ffffff 1px, transparent 1px), linear-gradient(90deg, #ffffff 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
        />
        {/* dark navy overlay to keep the background subtle */}
        <div aria-hidden className="absolute inset-0 bg-gradient-to-br from-[#08111F]/70 via-[#08111F]/55 to-[#08111F]/80" />

        <div className="animate-fade-in relative z-10 flex flex-col items-center px-12 text-center">
          {/* Verve Advisory logo — placed naturally on the background (no box) */}
          <div className="flex items-baseline">
            <span className="text-5xl font-extrabold lowercase tracking-tight text-white">verve</span>
            <span className="ml-2 text-lg font-semibold uppercase tracking-[0.28em] text-[#A8B3C7]">Advisory</span>
          </div>

          <p className="mt-10 text-2xl font-bold tracking-tight text-white">AR Manager</p>
          <p className="mt-1.5 text-sm font-medium text-[#A8B3C7]">Accounts Receivable Control Center</p>
          <p className="mt-5 max-w-xs text-sm leading-relaxed text-[#A8B3C7]">
            Manage invoices, receipts, customer balances and collections with confidence.
          </p>

          <ul className="mt-9 space-y-3.5 text-left">
            {FEATURES.map((f) => (
              <li key={f} className="flex items-center gap-3 text-sm font-medium text-white">
                <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-[#2563EB]/15 text-[#3b82f6]">
                  <IconCheck className="h-3.5 w-3.5" />
                </span>
                {f}
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* ===================== RIGHT · login panel ===================== */}
      <main className="relative flex flex-1 items-center justify-center overflow-hidden px-6 py-12">
        {/* subtle gradient + faint grid + soft glow behind the card */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{ backgroundImage: "radial-gradient(at 50% 30%, rgba(37,99,235,0.12) 0px, transparent 60%)" }}
        />
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.04] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]"
          style={{
            backgroundImage: "linear-gradient(#ffffff 1px, transparent 1px), linear-gradient(90deg, #ffffff 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#2563EB]/15 blur-[100px]" />

        <div className="animate-fade-in relative z-10 w-full max-w-md rounded-[24px] border border-white/[0.08] bg-[#18253B]/[0.92] p-8 shadow-2xl shadow-black/50 backdrop-blur-xl sm:p-12">
          <h1 className="text-[36px] font-bold leading-tight tracking-tight text-white">Sign In</h1>
          <p className="mt-2 text-lg text-[#A8B3C7]">Welcome back to AR Manager</p>

          <form
            className="mt-8 space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              handleSignIn();
            }}
          >
            {/* Email */}
            <div>
              <label htmlFor="email" className="mb-2 block text-[13px] font-medium text-[#A8B3C7]">
                Email Address
              </label>
              <div className={inputWrap}>
                <IconMail className="h-[18px] w-[18px] flex-none text-slate-500" />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className={inputEl}
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="mb-2 block text-[13px] font-medium text-[#A8B3C7]">
                Password
              </label>
              <div className={inputWrap}>
                <IconLock className="h-[18px] w-[18px] flex-none text-slate-500" />
                <input
                  id="password"
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className={inputEl}
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? "Hide password" : "Show password"}
                  className="flex-none rounded text-slate-500 transition-colors hover:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/50"
                >
                  <IconEye off={!showPw} className="h-[18px] w-[18px]" />
                </button>
              </div>
            </div>

            {/* Remember / Forgot */}
            <div className="flex items-center justify-between pt-1">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-[#A8B3C7]">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="h-4 w-4 rounded border-white/20 bg-white/5 accent-[#2563EB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/50 [color-scheme:dark]"
                />
                Remember Me
              </label>
              <button
                type="button"
                className="rounded text-sm font-medium text-[#3b82f6] transition-colors hover:text-[#60a5fa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/50"
              >
                Forgot Password?
              </button>
            </div>

            {/* Sign In button */}
            <button
              type="submit"
              className="mt-2 flex h-[54px] w-full items-center justify-center rounded-[14px] bg-gradient-to-r from-[#2563EB] to-[#1D4ED8] text-base font-semibold text-white shadow-lg shadow-[#2563EB]/30 transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-[#2563EB]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#18253B] active:translate-y-0"
            >
              Sign In
            </button>
          </form>

          <p className="mt-7 text-center text-sm text-[#A8B3C7]">
            Don&apos;t have an account?{" "}
            <button
              type="button"
              className="rounded font-medium text-[#3b82f6] transition-colors hover:text-[#60a5fa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/50"
            >
              Sign Up
            </button>
          </p>
        </div>
      </main>
    </div>
  );
}
