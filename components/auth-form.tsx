"use client";

import { useActionState, useState } from "react";
import { signInAction, signUpAction, type AuthState } from "@/app/auth-actions";
import { Button, ErrorNote, Field, Input } from "./ui";

const initial: AuthState = { error: null };

export function AuthForm({ next, initialMode, invite }: { next: string; initialMode: "signin" | "signup"; invite: boolean }) {
  const [mode, setMode] = useState<"signin" | "signup">(invite ? "signup" : initialMode);
  const [state, action, pending] = useActionState(mode === "signin" ? signInAction : signUpAction, initial);

  return (
    <div>
      <h1 className="font-display text-4xl leading-tight">{mode === "signin" ? "Welcome back" : "Create your account"}</h1>
      <p className="mt-2 text-[15px] text-ink-2">
        {invite
          ? "You've been invited to confirm a launch commitment. Sign in or create an account to respond."
          : mode === "signin"
            ? "Sign in to your launch rooms."
            : "Founders and contributors both start here."}
      </p>

      <form action={action} className="mt-8 space-y-4" key={mode}>
        <input type="hidden" name="next" value={next} />
        {mode === "signup" ? (
          <Field label="Your name" hint="Shown next to your confirmations in the activity log.">
            {(p) => <Input {...p} name="name" autoComplete="name" required maxLength={80} />}
          </Field>
        ) : null}
        <Field label="Email">{(p) => <Input {...p} name="email" type="email" autoComplete="email" required />}</Field>
        <Field label="Password" hint={mode === "signup" ? "At least 8 characters." : undefined}>
          {(p) => <Input {...p} name="password" type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} required minLength={8} />}
        </Field>
        <ErrorNote>{state.error}</ErrorNote>
        {state.notice ? (
          <p role="status" className="rounded-lg border border-ready/30 bg-ready-bg px-3 py-2 text-sm text-ready">
            {state.notice}
          </p>
        ) : null}
        <Button type="submit" busy={pending} className="w-full">
          {mode === "signin" ? "Sign in" : "Create account"}
        </Button>
      </form>

      <p className="mt-6 text-sm text-ink-2">
        {mode === "signin" ? "New to Greenlight?" : "Already have an account?"}{" "}
        <button type="button" className="font-medium text-ink underline underline-offset-4" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
          {mode === "signin" ? "Create an account" : "Sign in"}
        </button>
      </p>
    </div>
  );
}
