export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-ink text-paper hover:bg-ink-2 disabled:bg-ink-3",
  secondary: "border border-line-strong bg-surface text-ink hover:bg-sunken disabled:text-ink-3",
  ghost: "text-ink-2 hover:bg-sunken hover:text-ink disabled:text-ink-3",
  danger: "border border-block/40 bg-block-bg text-block hover:border-block disabled:opacity-60",
};
const sizes: Record<ButtonSize, string> = {
  sm: "min-h-9 px-3 text-sm",
  md: "min-h-11 px-4 text-[15px]",
};

/** Plain function (not a client module) so server components can style links as buttons. */
export const buttonClass = (variant: ButtonVariant = "primary", size: ButtonSize = "md") =>
  `inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]}`;
