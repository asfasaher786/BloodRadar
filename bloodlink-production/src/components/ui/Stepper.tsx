import React from "react";
import { Check } from "lucide-react";

export interface StepDef {
  id: string;
  title: string;
  /** Optional small subtitle shown under the step title. */
  caption?: string;
}

interface StepperProps {
  steps: StepDef[];
  current: number; // 0-based index of the active step
  /** Render prop for the current step's content. */
  children: React.ReactNode;
  orientation?: "horizontal" | "vertical";
}

/**
 * Onboarding stepper. Uses <ol> semantics; the current step is announced
 * via aria-current="step"; completed steps show a check (decoration only,
 * the real state lives in the step list).
 */
export default function Stepper({ steps, current, children, orientation = "horizontal" }: StepperProps) {
  const active = steps[current];
  if (!active) return null;

  return (
    <div className="w-full">
      <ol className={`flex ${orientation === "horizontal" ? "flex-row" : "flex-col gap-2"} items-stretch w-full`} aria-label="Progress">
        {steps.map((step, i) => {
          const state = i < current ? "done" : i === current ? "current" : "todo";
          return (
            <li
              key={step.id}
              aria-current={state === "current" ? "step" : undefined}
              className={`flex items-center gap-2 ${orientation === "horizontal" ? "flex-1" : ""}`}
            >
              {/* Connector (horizontal only) */}
              {orientation === "horizontal" && i > 0 && (
                <span
                  aria-hidden="true"
                  className={`h-0.5 flex-1 rounded-full ${i <= current ? "bg-blood" : "bg-border"}`}
                />
              )}
              <span
                aria-hidden="true"
                className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0
                  ${state === "done" ? "bg-blood text-white" : state === "current" ? "bg-blood-soft text-blood border-2 border-blood" : "bg-surface-2 text-muted border border-border"}`}
              >
                {state === "done" ? <Check className="w-3.5 h-3.5" /> : i + 1}
              </span>
              <span className={`min-w-0 ${orientation === "horizontal" ? "hidden md:block" : ""}`}>
                <span className={`block text-xs font-semibold truncate ${state === "current" ? "text-blood" : state === "done" ? "text-ink" : "text-muted"}`}>
                  {step.title}
                </span>
                {step.caption && <span className="block text-[10px] text-muted truncate">{step.caption}</span>}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="mt-5">{children}</div>
    </div>
  );
}
