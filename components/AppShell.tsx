"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import { isSignedIn } from "@/lib/auth";

/*
  Wraps every page. The Sign In screen is the one exception — it's a
  full-screen login card with no sidebar. Every other page keeps the normal
  sidebar + content layout, and only shows once we've confirmed someone is
  actually signed in (otherwise it bounces them to Sign In first).

  Below the md breakpoint the sidebar becomes an off-canvas drawer: this
  component owns the open/closed state, renders the hamburger trigger and the
  backdrop, and hands isOpen/onClose down to <Nav>. Desktop (md+) is
  untouched — the sidebar stays permanently visible in the flex layout.
*/
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isSignInPage = pathname === "/signin";
  const [ready, setReady] = useState(false);
  const [isSidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!isSignInPage && !isSignedIn()) {
      router.replace("/signin");
      return;
    }
    setReady(true);
  }, [pathname, isSignInPage, router]);

  // A route change means a nav item was picked (or a redirect happened) —
  // either way the mobile drawer should close.
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!isSidebarOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setSidebarOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isSidebarOpen]);

  // Lock background scrolling while the mobile drawer is open, restore it on close/unmount.
  useEffect(() => {
    if (!isSidebarOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isSidebarOpen]);

  if (isSignInPage) {
    return <>{children}</>;
  }

  if (!ready) {
    return null; // brief blank check, avoids flashing the app before we know you're signed in
  }

  return (
    <div className="flex h-screen">
      {!isSidebarOpen && (
        <button
          type="button"
          aria-label="Open navigation menu"
          onClick={() => setSidebarOpen(true)}
          className="fixed left-4 top-4 z-50 rounded-lg bg-white p-2 text-slate-700 shadow print:hidden dark:bg-slate-800 dark:text-slate-200 md:hidden"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        </button>
      )}

      {/* Always mounted (not conditionally rendered) so it fades in/out over
          the same 300ms as the drawer's slide animation instead of vanishing
          instantly — otherwise the drawer is briefly seen sliding out over
          fully-lit, undimmed content mid-transition. */}
      <button
        type="button"
        aria-label="Close navigation menu"
        aria-hidden={!isSidebarOpen || undefined}
        tabIndex={isSidebarOpen ? 0 : -1}
        onClick={() => setSidebarOpen(false)}
        className={`fixed inset-0 z-30 bg-black/40 transition-opacity duration-300 ease-in-out print:hidden md:hidden ${
          isSidebarOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      <Nav isOpen={isSidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="flex-1 overflow-y-auto p-4 pt-20 md:p-6 md:pt-6 xl:p-8">{children}</main>
    </div>
  );
}
