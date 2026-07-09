"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AFTER_SIGNIN_PATH, signIn } from "@/lib/auth";

/*
  Sign In — front door of AR Manager.

  A faithful recreation of the reference two-panel login, rebranded to Verve
  Advisory. DEMO login only: the email/password fields are not verified — on
  submit we create the session and open Home. The auth logic in lib/auth.ts is
  unchanged; this page just calls signIn() and redirects as before.
*/

function IconMail({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}
function IconLock({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
function IconEye({ off = false, className = "" }: { off?: boolean; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="m4 4 16 16" />}
    </svg>
  );
}

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [showPw, setShowPw] = useState(false);

  // Unchanged auth: demo access — sign in and open Home.
  function handleSignIn() {
    signIn("AR Manager");
    router.replace(AFTER_SIGNIN_PATH);
  }

  return (
    <div className="min-h-screen bg-[#0e7fda] p-4">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-[1120px] flex-col overflow-hidden rounded-[26px] md:flex-row">
        {/* ===================== LEFT PANEL (~40%) ===================== */}
        <div className="relative flex w-full items-center justify-center bg-[#0e7fda] p-5 md:w-[40%] md:p-6">
          <div className="relative h-52 w-full overflow-hidden rounded-[20px] bg-gradient-to-br from-[#0a2338] via-[#0e3053] to-[#091d34] shadow-xl md:h-full">
            {/* finance-toned dark-blue overlay + large decorative circle at the top */}
            <div aria-hidden className="absolute -right-12 -top-12 h-44 w-44 rounded-full bg-[#2b8cf0]/25 blur-[1px]" />
            <div aria-hidden className="absolute inset-0 bg-[#0a1c33]/40" />
            {/* centered Verve Advisory logo */}
            <div className="absolute inset-0 flex items-center justify-center px-6">
              <div className="text-center">
                <span className="block text-4xl font-extrabold lowercase tracking-tight text-white sm:text-5xl">verve</span>
                <span className="mt-1.5 block text-[11px] font-semibold uppercase tracking-[0.42em] text-white/70">Advisory</span>
              </div>
            </div>
          </div>
        </div>

        {/* ===================== RIGHT PANEL (~60%) ===================== */}
        <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-[#0f1d33] px-6 py-14">
          {/* top decorative circle */}
          <div aria-hidden className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full bg-[#15325a]" />
          {/* bottom-right decorative shape */}
          <div aria-hidden className="pointer-events-none absolute -bottom-24 -right-24 h-80 w-80 rounded-full bg-[#174a86]" />

          <div className="relative z-10 w-full max-w-sm">
            <h1 className="mb-8 text-center text-[26px] font-normal tracking-wide text-white">Sign In</h1>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSignIn();
              }}
            >
              {/* login card */}
              <div className="rounded-2xl bg-[#1b2840] p-6 shadow-xl shadow-black/30">
                {/* Email */}
                <label htmlFor="email" className="block text-[11px] text-slate-400">
                  Email
                </label>
                <div className="mt-1.5 flex items-center gap-3 border-b border-white/10 pb-2.5">
                  <IconMail className="h-4 w-4 flex-none text-[#2b8cf0]" />
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
                  />
                </div>

                {/* Password */}
                <label htmlFor="password" className="mt-5 block text-[11px] text-slate-400">
                  Password
                </label>
                <div className="mt-1.5 flex items-center gap-3 border-b border-white/10 pb-2.5">
                  <IconLock className="h-4 w-4 flex-none text-[#2b8cf0]" />
                  <input
                    id="password"
                    type={showPw ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    aria-label={showPw ? "Hide password" : "Show password"}
                    className="flex-none rounded text-slate-400 transition-colors hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2b8cf0]/50"
                  >
                    <IconEye off={!showPw} className="h-4 w-4" />
                  </button>
                </div>

                {/* Remember / Forgot */}
                <div className="mt-5 flex items-center justify-between">
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(e) => setRemember(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-white/20 bg-white/5 accent-[#2b8cf0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2b8cf0]/50 [color-scheme:dark]"
                    />
                    Remember Me
                  </label>
                  <button
                    type="button"
                    className="rounded text-xs font-medium text-[#2b8cf0] transition-colors hover:text-[#5aa8f5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2b8cf0]/50"
                  >
                    Forgot Password ?
                  </button>
                </div>
              </div>

              {/* Sign In button */}
              <button
                type="submit"
                className="mt-6 w-full rounded-xl bg-[#2b8cf0] py-3 text-sm font-semibold text-white shadow-lg shadow-[#2b8cf0]/30 transition-colors hover:bg-[#1f7fe0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2b8cf0]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f1d33]"
              >
                Sign In
              </button>
            </form>

            <p className="mt-5 text-center text-xs text-slate-400">
              Don&apos;t have an account ?{" "}
              <button
                type="button"
                className="rounded font-medium text-[#2b8cf0] transition-colors hover:text-[#5aa8f5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2b8cf0]/50"
              >
                Sign Up
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
