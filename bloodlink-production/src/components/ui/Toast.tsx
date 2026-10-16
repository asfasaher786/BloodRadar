import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

type ToastTone = "success" | "error" | "info";
interface ToastItem { id: number; tone: ToastTone; message: string; }

const ToastContext = createContext<{ toast: (message: string, tone?: ToastTone) => void }>({
  toast: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

const ICONS: Record<ToastTone, React.ReactNode> = {
  success: <CheckCircle2 className="w-4 h-4 text-safe-ink shrink-0" aria-hidden="true" />,
  error: <AlertCircle className="w-4 h-4 text-blood-ink shrink-0" aria-hidden="true" />,
  info: <Info className="w-4 h-4 text-muted shrink-0" aria-hidden="true" />,
};

/** Toast provider + viewport. Announcements go to an aria-live region. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = useCallback((message: string, tone: ToastTone = "info") => {
    const id = ++counter.current;
    setItems(prev => [...prev.slice(-3), { id, tone, message }]);
    window.setTimeout(() => dismiss(id), 5000);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {createPortal(
        <div
          aria-live="polite"
          aria-atomic="false"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[110] flex flex-col gap-2 w-[min(92vw,24rem)]"
        >
          {items.map(t => (
            <div
              key={t.id}
              role="status"
              className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-card border border-border shadow-3 scale-in"
            >
              {ICONS[t.tone]}
              <p className="text-xs font-medium text-ink flex-1">{t.message}</p>
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss notification"
                className="p-1 -m-1 rounded text-muted hover:text-ink transition-colors duration-150"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}
