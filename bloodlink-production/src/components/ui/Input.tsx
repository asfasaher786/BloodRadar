import React, { useId } from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
  /** Required fields get a visible asterisk; optional fields say "(optional)". */
  optional?: boolean;
  icon?: React.ReactNode;
}

/** Labelled text input with inline validation state. */
const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, optional = false, icon, className = "", id: idProp, ...rest },
  ref
) {
  const autoId = useId();
  const id = idProp || autoId;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className="w-full">
      <label htmlFor={id} className="block font-semibold mb-1.5 text-xs text-ink">
        {label}
        {optional && <span className="ml-1 font-normal text-muted">(optional)</span>}
      </label>
      <div className="relative">
        {icon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" aria-hidden="true">
            {icon}
          </span>
        )}
        <input
          ref={ref}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`w-full h-12 px-3.5 rounded-xl bg-card border text-sm text-ink placeholder:text-muted
            transition-colors duration-150 outline-none
            focus:ring-2 focus:ring-blood/15 focus:border-blood
            ${icon ? "pl-10" : ""}
            ${error ? "border-blood" : "border-border-strong"} ${className}`}
          {...rest}
        />
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-xs text-blood-ink">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
});

export default Input;
