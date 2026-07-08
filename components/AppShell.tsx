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
*/
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isSignInPage = pathname === "/signin";
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isSignInPage && !isSignedIn()) {
      router.replace("/signin");
      return;
    }
    setReady(true);
  }, [pathname, isSignInPage, router]);

  if (isSignInPage) {
    return <>{children}</>;
  }

  if (!ready) {
    return null; // brief blank check, avoids flashing the app before we know you're signed in
  }

  return (
    <div className="flex h-screen">
      <Nav />
      <main className="flex-1 overflow-y-auto p-8">{children}</main>
    </div>
  );
}
