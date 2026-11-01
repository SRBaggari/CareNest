import type { ButtonHTMLAttributes } from "react";

const variants = {
  primary: "bg-primary text-primary-foreground shadow-sm hover:brightness-110",
  secondary: "border-2 border-border bg-surface text-foreground hover:border-primary hover:text-primary",
  danger: "border-2 border-danger bg-surface text-danger hover:bg-danger-soft",
  dangerSolid: "bg-danger text-primary-foreground shadow-sm hover:brightness-110",
  ghost: "text-foreground hover:bg-sunken",
  /** A rare, destructive action that shouldn't dominate the page (it still asks to confirm). */
  quietDanger: "text-danger underline hover:bg-danger-soft",
};

const sizes = {
  md: "min-h-12 gap-2 rounded-xl px-5 text-lg",
  lg: "min-h-14 gap-3 rounded-2xl px-6 text-xl",
};

export type ButtonVariant = keyof typeof variants;

/** Shared by <Button> and links styled as buttons, so both look and size the same. */
export function buttonClass(variant: ButtonVariant = "primary", size: keyof typeof sizes = "md") {
  // max-w-full + overflow-wrap: a single long word (Tamil "எடுத்துக்கொள்ளப்பட்டது") wraps instead of overflowing a phone.
  return `inline-flex max-w-full items-center justify-center text-center font-semibold transition [overflow-wrap:anywhere] disabled:opacity-60 ${sizes[size]} ${variants[variant]}`;
}

/** 48px minimum touch target; shows a busy state without changing the label's meaning. */
export function Button({
  variant = "primary",
  size = "md",
  busy = false,
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: keyof typeof sizes; busy?: boolean }) {
  return (
    <button className={`${buttonClass(variant, size)} ${className}`} disabled={busy || props.disabled} aria-busy={busy || undefined} {...props}>
      {children}
    </button>
  );
}
