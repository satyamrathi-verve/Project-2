"use client";

/*
  Demo-only sign-in helper. There is no real backend login here — we just
  remember, in the browser's localStorage, that someone picked a role and
  clicked "Sign In". Any screen in the app can import these functions to ask:

    isSignedIn()      -> true/false, are we signed in on this device?
    getRole()         -> which role did they pick? (or null if not signed in)
    signIn(role)      -> save the chosen role and mark the session signed in
    signOut()         -> clear the session (used by the Sign out button)
*/

export type Role = "Admin" | "AR Manager" | "Accountant" | "Viewer";

export const ROLES: Role[] = ["Admin", "AR Manager", "Accountant", "Viewer"];

const STORAGE_KEY = "ar_manager_session";

interface StoredSession {
  loggedIn: boolean;
  role: Role;
}

function readSession(): StoredSession | null {
  if (typeof window === "undefined") return null; // guard for server-side rendering
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    return parsed.loggedIn ? parsed : null;
  } catch {
    return null;
  }
}

export function isSignedIn(): boolean {
  return readSession() !== null;
}

export function getRole(): Role | null {
  return readSession()?.role ?? null;
}

export function signIn(role: Role) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ loggedIn: true, role }));
}

export function signOut() {
  window.localStorage.removeItem(STORAGE_KEY);
}

/*
  Where to send someone right after they sign in (or if they land on the Sign
  In page while already signed in). Login opens the Home page; every redirect
  picks this up automatically.
*/
export const AFTER_SIGNIN_PATH = "/";
