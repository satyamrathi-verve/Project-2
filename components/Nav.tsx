"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getRole, signOut, type Role } from "@/lib/auth";
import { ThemeToggle } from "@/components/ThemeToggle";

/*
  Left sidebar. Only "Home" and "Sign In" exist to start with — everything else
  is the roadmap your team builds. Each unbuilt screen shows a "build me" tag.
  When you finish a screen, flip its `built` to true (and point `href` at the
  route you created) so it turns into a real link.
*/
const LINKS: { href: string; label: string; built: boolean }[] = [
  { href: "/", label: "Home", built: true },
  { href: "/signin", label: "Sign In", built: true },
  { href: "/masters/customers", label: "Customer Master", built: true },
  { href: "/masters/gl", label: "GL Master", built: true },
  { href: "/invoices", label: "Sales Invoices", built: true },
  { href: "/receipts", label: "Receipt Entry", built: true },
  { href: "/upload", label: "Upload Report", built: false },
  { href: "/followup/template", label: "Reminder Template", built: true },
  { href: "/followup/workspace", label: "Collections Workspace", built: true },
  { href: "/reminders", label: "Auto Email Shoot", built: false },
  { href: "/reports/statement", label: "Customer Statement", built: true },
  { href: "/reports/ageing", label: "AR Ageing", built: false },
  { href: "/cashflow", label: "Cashflow Projection", built: false },
  { href: "/dashboard", label: "Dashboard", built: false },
];

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [role, setRole] = useState<Role | null>(null);

  // Re-check the signed-in role whenever the page changes.
  useEffect(() => {
    setRole(getRole());
  }, [pathname]);

  function handleSignOut() {
    signOut();
    router.replace("/signin");
  }

  return (
    <nav className="themed flex h-full w-60 flex-col gap-1 border-r border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-4 flex items-start justify-between gap-2 px-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand">Verve</p>
          <h1 className="text-lg font-bold text-slate-900 dark:text-white">AR Manager</h1>
          {role && <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Signed in as {role}</p>}
        </div>
        <ThemeToggle />
      </div>
      {LINKS.map((l) => {
        const active = pathname === l.href;
        if (!l.built) {
          return (
            <span
              key={l.href}
              className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-slate-400 dark:text-slate-500"
            >
              {l.label}
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:bg-slate-800 dark:text-slate-500">
                build me
              </span>
            </span>
          );
        }
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? "bg-brand text-white"
                : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
      {role && (
        <button
          onClick={handleSignOut}
          className="mt-auto rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          Sign out
        </button>
      )}
    </nav>
  );
}
