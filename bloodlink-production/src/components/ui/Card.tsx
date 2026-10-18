import React from "react";

interface CardProps {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  id?: string;
}

/** Standard surface card with an optional header row. */
export default function Card({ title, subtitle, icon, actions, children, className = "", id }: CardProps) {
  return (
    <section id={id} className={`rounded-3xl border border-border bg-card shadow-1 ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 px-6 pt-5 pb-4 border-b border-border">
          <div className="flex items-center gap-2.5 min-w-0">
            {icon && <span className="shrink-0 text-blood" aria-hidden="true">{icon}</span>}
            <div className="min-w-0">
              {title && <h3 className="font-display font-bold text-base text-ink leading-tight">{title}</h3>}
              {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="shrink-0 flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-6">{children}</div>
    </section>
  );
}
