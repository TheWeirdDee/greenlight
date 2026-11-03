"use client";

import { motion, MotionConfig } from "framer-motion";

/** Scroll-triggered entrance. MotionConfig honours the user's reduced-motion preference globally. */
export function Reveal({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        className={className}
        initial={{ opacity: 0, y: 18 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
      >
        {children}
      </motion.div>
    </MotionConfig>
  );
}

/** The recovery sequence from the product brief, drawn as a stepper that lights up in order. */
export function RecoveryFlow({ steps }: { steps: Array<{ label: string; tone: "block" | "expired" | "wait" | "ready"; note: string }> }) {
  const color = { block: "var(--block-lamp)", expired: "var(--expired)", wait: "var(--wait-lamp)", ready: "var(--ready-lamp)" } as const;
  return (
    <MotionConfig reducedMotion="user">
      <ol className="grid gap-0 sm:grid-cols-3 lg:grid-cols-6">
        {steps.map((s, i) => (
          <motion.li
            key={s.label}
            className="relative border-l-2 pb-6 pl-5 sm:border-l-0 sm:border-t-2 sm:pb-0 sm:pl-0 sm:pr-4 sm:pt-5"
            style={{ borderColor: color[s.tone] }}
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.4, delay: i * 0.12 }}
          >
            <span aria-hidden="true" className="absolute -left-[7px] top-0 h-3 w-3 rounded-full sm:-top-[7px] sm:left-0" style={{ background: color[s.tone] }} />
            <p className="font-mono text-[11px] uppercase tracking-wider text-ink-3">Step {i + 1}</p>
            <p className="mt-1 font-medium leading-snug">{s.label}</p>
            <p className="mt-1 text-[13px] leading-snug text-ink-2">{s.note}</p>
          </motion.li>
        ))}
      </ol>
    </MotionConfig>
  );
}
