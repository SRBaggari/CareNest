import { useId, type ComponentProps, type ReactNode } from "react";

type FieldShellProps = {
  label: string;
  hint?: string;
  errors?: string[];
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
};

/** Label + hint + error wiring shared by all form controls (aria-describedby / aria-invalid). */
function FieldShell({ label, hint, errors, children }: FieldShellProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = errors?.length ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="text-base text-muted">
          {hint}
        </p>
      )}
      {children({ id, describedBy, invalid: Boolean(errors?.length) })}
      {errorId && (
        <p id={errorId} className="font-medium text-danger">
          {errors!.join(" ")}
        </p>
      )}
    </div>
  );
}

const controlClass =
  "min-h-12 w-full rounded-xl border-2 border-border bg-surface px-4 text-lg transition hover:border-muted focus:border-primary aria-[invalid=true]:border-danger";

export function TextField({
  label,
  hint,
  errors,
  ...input
}: { label: string; hint?: string; errors?: string[] } & ComponentProps<"input">) {
  return (
    <FieldShell label={label} hint={hint} errors={errors}>
      {({ id, describedBy, invalid }) => (
        <input id={id} aria-describedby={describedBy} aria-invalid={invalid} className={controlClass} {...input} />
      )}
    </FieldShell>
  );
}

export function SelectField({
  label,
  hint,
  errors,
  options,
  ...select
}: {
  label: string;
  hint?: string;
  errors?: string[];
  options: { value: string; label: string }[];
} & ComponentProps<"select">) {
  return (
    <FieldShell label={label} hint={hint} errors={errors}>
      {({ id, describedBy, invalid }) => (
        <select id={id} aria-describedby={describedBy} aria-invalid={invalid} className={controlClass} {...select}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </FieldShell>
  );
}
