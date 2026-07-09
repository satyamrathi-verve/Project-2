"use client";

import { useEffect, useState } from "react";

/*
  Persists a small piece of state to this browser's localStorage. Used only
  by the Reminder Template screen for Attachments/Signature, which have no
  column in reminder_templates — this keeps them feeling saved without any
  schema change or writes to Supabase.
*/
export function useLocalStorageState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) setValue(JSON.parse(raw));
    } catch {
      // malformed or unavailable storage — fall back to the initial value
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // storage full/unavailable — this is a nice-to-have, fail silently
    }
  }, [key, value, hydrated]);

  return [value, setValue] as const;
}
