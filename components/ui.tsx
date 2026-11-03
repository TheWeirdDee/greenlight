"use client";

import { buttonClass, type ButtonSize as Size, type ButtonVariant as Variant } from "./button-class";
import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; busy?: boolean }
>(function Button({ variant = "primary", size = "md", busy, className = "", children, disabled, ...rest }, ref) {
  return (
    <button ref={ref} className={`${buttonClass(variant, size)} ${className}`} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy ? <Spinner /> : null}
      {children}
    </button>
  );
});

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg className={`h-4 w-4 animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

const fieldBase =
  "w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-[15px] text-ink placeholder:text-ink-3 focus-visible:border-[var(--focus)] disabled:opacity-60";

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode;
}) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-err` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {hint ? (
        <p id={`${id}-hint`} className="text-[13px] text-ink-3">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-err`} role="alert" className="text-[13px] font-medium text-block">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className = "", ...p }, ref) {
  return <input ref={ref} className={`${fieldBase} ${className}`} {...p} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className = "", ...p }, ref) {
  return <textarea ref={ref} className={`${fieldBase} min-h-24 ${className}`} {...p} />;
});
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className = "", ...p }, ref) {
  return <select ref={ref} className={`${fieldBase} ${className}`} {...p} />;
});

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-lg border border-block/30 bg-block-bg px-3 py-2 text-sm text-block">
      {children}
    </p>
  );
}

export function Card({ className = "", children, as: Tag = "section", id }: { className?: string; children: ReactNode; as?: "section" | "div" | "article"; id?: string }) {
  return (
    <Tag id={id} className={`rounded-2xl border border-line bg-surface ${className}`}>
      {children}
    </Tag>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="font-mono text-[12px] font-medium uppercase tracking-[0.14em] text-ink-3">{children}</p>;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line-strong px-6 py-10 text-center">
      <h2 className="font-display text-xl text-ink">{title}</h2>
      {children ? <p className="mx-auto mt-2 max-w-md text-[15px] text-ink-2">{children}</p> : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}
