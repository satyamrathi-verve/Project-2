"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FormField, inputClass } from "@/components/FormField";
import { AFTER_SIGNIN_PATH, isSignedIn, signIn, ROLES, type Role } from "@/lib/auth";

/*
  The Sign In screen — the front door of AR Manager.

  This is a DEMO login only: there is no password and no real backend check.
  You simply pick which role you want to explore the tool as, click Sign In,
  and we remember that choice in the browser (localStorage) via lib/auth.ts.
*/
export default function SignInPage() {
  const router = useRouter();
  const [role, setRole] = useState<Role>("AR Manager");
  const [checkingSession, setCheckingSession] = useState(true);

  // If this device already has a signed-in session, skip the form entirely.
  useEffect(() => {
    if (isSignedIn()) {
      router.replace(AFTER_SIGNIN_PATH);
      return;
    }
    setCheckingSession(false);
  }, [router]);

  function handleSignIn() {
    signIn(role); // remember the chosen role for this browser
    router.replace(AFTER_SIGNIN_PATH);
  }

  // Nothing to show while we check localStorage — avoids a flash of the login
  // form for someone who's already signed in.
  if (checkingSession) return null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-100 via-slate-50 to-blue-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/60">
        {/* App name + tagline */}
        <div className="mb-8 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand">Verve</p>
          <h1 className="mt-1 text-3xl font-bold text-slate-900">AR Manager</h1>
          <p className="mt-2 text-sm text-slate-500">Accounts Receivable Control Center</p>
        </div>

        {/* Plain-language explanation that this is demo access */}
        <div className="mb-6 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          This is a demo access screen. Pick the role you&apos;d like to explore the
          tool as — no password needed.
        </div>

        <FormField label="Sign in as">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className={inputClass}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </FormField>

        <button
          onClick={handleSignIn}
          className="mt-6 w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
        >
          Sign In
        </button>

        <p className="mt-6 text-center text-xs text-slate-400">
          Demo only — no real password check. Your role is remembered on this
          device until you sign out.
        </p>
      </div>
    </div>
  );
}
