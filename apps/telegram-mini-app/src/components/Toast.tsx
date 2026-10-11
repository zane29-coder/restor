import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

type Tone = 'info' | 'error' | 'success';

interface ToastApi {
  show: (message: string, tone?: Tone) => void;
}

const ToastContext = createContext<ToastApi>({ show: () => undefined });

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

/**
 * One short message at a time, above the floating buttons. Errors stay a
 * little longer than confirmations: they are the ones a customer has to read.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ id: number; message: string; tone: Tone } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback((message: string, tone: Tone = 'info') => {
    window.clearTimeout(timer.current);
    const id = Date.now();
    setToast({ id, message, tone });
    timer.current = window.setTimeout(
      () => setToast((current) => (current?.id === id ? null : current)),
      tone === 'error' ? 4500 : 2600,
    );
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast && (
        <div
          key={toast.id}
          className={`toast toast--${toast.tone}`}
          role={toast.tone === 'error' ? 'alert' : 'status'}
          onClick={() => setToast(null)}
        >
          {toast.message}
        </div>
      )}
    </ToastContext.Provider>
  );
}
