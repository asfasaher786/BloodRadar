import React, { useId } from "react";
import { ChevronDown } from "lucide-react";

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  children?: React.ReactNode;
}

/** Native select, styled — native controls are the most accessible option. */
const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, optional = false, className = "", id: idProp, children, ...rest },
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
        <select
          ref={ref}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`w-full h-12 px-3.5 pr-9 rounded-xl bg-surface border text-sm text-ink appearance-none
            transition-colors duration-150 outline-none cursor-pointer
            ${error ? "border-blood" : "border-border-strong focus:border-blood"} ${className}`}
          {...rest}
        >
          {children}
        </select>
        <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" aria-hidden="true" />
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-xs text-blood-ink">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
});

export default Select;
