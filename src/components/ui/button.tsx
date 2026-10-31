import type { ButtonHTMLAttributes } from "react";

const variants = {
  primary: "bg-primary text-primary-foreground",
  secondary: "border-2 border-border bg-surface text-foreground",
  danger: "border-2 border-danger bg-surface text-danger",
};

/** 48px minimum touch target; shows a busy state without changing the label's meaning. */
export function Button({
  variant = "primary",
  busy = false,
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants; busy?: boolean }) {
  return (
    <button
      className={`inline-flex min-h-12 items-center justify-center rounded-lg px-5 text-lg font-semibold disabled:opacity-60 ${variants[variant]} ${className}`}
      disabled={busy || props.disabled}
      aria-busy={busy || undefined}
      {...props}
    >
      {children}
    </button>
  );
}
