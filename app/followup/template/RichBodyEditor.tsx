"use client";

import type { RefObject } from "react";
import { inputClass } from "@/components/FormField";

/*
  A plain <textarea> with a lightweight formatting toolbar — not a full
  WYSIWYG. Bold, Italic, and Bullet just wrap the selection in plain marker
  characters a user could always type by hand. That keeps the stored `body`
  as plain text, which Auto Email Shoot and the Collections Workspace both
  already read directly, so nothing about that contract changes.
*/
export function RichBodyEditor({
  textareaRef,
  value,
  onChange,
  onFocus,
  onWrap,
  onBulletize,
}: {
  textareaRef: RefObject<HTMLTextAreaElement>;
  value: string;
  onChange: (v: string) => void;
  onFocus: () => void;
  onWrap: (marker: string) => void;
  onBulletize: () => void;
}) {
  return (
    <div>
      <div
        role="toolbar"
        aria-label="Body formatting"
        className="flex items-center gap-1 rounded-t-lg border border-b-0 border-slate-300 bg-slate-50 px-2 py-1.5 dark:border-slate-700 dark:bg-slate-800/60"
      >
        <ToolbarButton label="Bold" onClick={() => onWrap("**")}>
          <span className="font-bold">B</span>
        </ToolbarButton>
        <ToolbarButton label="Italic" onClick={() => onWrap("_")}>
          <span className="italic">i</span>
        </ToolbarButton>
        <ToolbarButton label="Bullet list" onClick={onBulletize}>
          <span aria-hidden>&bull;</span>
        </ToolbarButton>
        <span className="ml-2 text-[11px] text-slate-400 dark:text-slate-500">
          Select text, then click a button to format it
        </span>
      </div>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        aria-label="Email body"
        className={`${inputClass} min-h-[240px] rounded-t-none leading-relaxed`}
      />
    </div>
  );
}

function ToolbarButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded text-sm text-slate-600 transition-colors hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700"
    >
      {children}
    </button>
  );
}
