import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { writeClipboard } from '../lib/clipboard';
import { IconCheck, IconX } from './icons';

interface Toast {
  id: number;
  text: string;
  detail?: string;
  kind: 'ok' | 'error' | 'info';
}

interface Ctx {
  toast: (text: string, opts?: { detail?: string; kind?: Toast['kind'] }) => void;
  /** Copies text to the clipboard and confirms with a toast ("Copied EV code"). */
  copy: (text: string, what: string, html?: string) => Promise<void>;
}

const ToastCtx = createContext<Ctx | null>(null);

export function useToast(): Ctx {
  const c = useContext(ToastCtx);
  if (!c) throw new Error('useToast outside ToastProvider');
  return c;
}

const preview = (t: string) => {
  const one = t.replace(/\s+/g, ' ').trim();
  return one.length > 64 ? one.slice(0, 61) + '…' : one;
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const toast = useCallback<Ctx['toast']>((text, opts) => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-2), { id, text, detail: opts?.detail, kind: opts?.kind ?? 'ok' }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), opts?.kind === 'error' ? 5000 : 2200);
  }, []);

  const copy = useCallback<Ctx['copy']>(
    async (text, what, html) => {
      if (!text) {
        toast(`Nothing to copy: ${what} is empty`, { kind: 'info' });
        return;
      }
      const ok = await writeClipboard(text, html);
      if (ok) {
        const lines = text.split(/\r?\n/).length;
        toast(`Copied ${what}`, { detail: lines > 1 ? `${lines.toLocaleString('en')} lines` : preview(text) });
      } else toast('Copy failed. Your browser blocked clipboard access.', { kind: 'error' });
    },
    [toast],
  );

  const value = useMemo(() => ({ toast, copy }), [toast, copy]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={'toast toast-' + t.kind}>
            <span className="toast-icon">{t.kind === 'error' ? <IconX size={14} /> : <IconCheck size={14} />}</span>
            <span className="toast-text">{t.text}</span>
            {t.detail && <span className="toast-detail">{t.detail}</span>}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
