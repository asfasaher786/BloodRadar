import React, { useId, useRef } from "react";

export interface TabDef {
  id: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
}

interface TabsProps {
  tabs: TabDef[];
  activeId: string;
  onChange: (id: string) => void;
  /** Renders the panel content for the active tab. */
  children: React.ReactNode;
  className?: string;
}

/** Accessible tabs (WAI-ARIA tabs pattern): roving tabindex + arrow keys. */
export default function Tabs({ tabs, activeId, onChange, children, className = "" }: TabsProps) {
  const baseId = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = tabs.findIndex(t => t.id === activeId);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const len = tabs.length;
    let next = -1;
    if (e.key === "ArrowRight") next = (activeIndex + 1) % len;
    else if (e.key === "ArrowLeft") next = (activeIndex - 1 + len) % len;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = len - 1;
    if (next >= 0) {
      e.preventDefault();
      onChange(tabs[next].id);
      tabRefs.current[next]?.focus();
    }
  };

  return (
    <div className={className}>
      <div role="tablist" aria-label="Sections" onKeyDown={onKeyDown}
        className="flex gap-1 p-1.5 bg-surface-2 rounded-xl">
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            ref={el => { tabRefs.current[i] = el; }}
            role="tab"
            id={`${baseId}-tab-${tab.id}`}
            aria-selected={tab.id === activeId}
            aria-controls={`${baseId}-panel-${tab.id}`}
            aria-label={typeof tab.label === "string" ? tab.label : undefined}
            tabIndex={tab.id === activeId ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-lg text-xs font-semibold
              transition-colors duration-150 cursor-pointer
              ${tab.id === activeId ? "bg-card text-blood shadow-1" : "text-muted hover:text-ink"}`}
          >
            {tab.icon}
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel-${activeId}`}
        aria-labelledby={`${baseId}-tab-${activeId}`}
        tabIndex={0}
      >
        {children}
      </div>
    </div>
  );
}
