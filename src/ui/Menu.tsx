import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconCheck } from './icons';

export type MenuItem =
  | {
      label: ReactNode;
      hint?: ReactNode;
      onSelect: () => void;
      disabled?: boolean;
      checked?: boolean;
      keepOpen?: boolean;
    }
  | { heading: string }
  | 'sep';

interface PopProps {
  items: MenuItem[];
  /** Anchor rect or point. */
  at: { x: number; y: number; alignRight?: boolean; below?: number };
  onClose: () => void;
  label: string;
}

/** Floating menu with arrow-key navigation; closes on Escape, outside click or selection. */
export function MenuPopover({ items, at, onClose, label }: PopProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: at.x, top: at.y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = at.alignRight ? at.x - r.width : at.x;
    let top = at.y;
    if (left + r.width > window.innerWidth - 8) left = window.innerWidth - r.width - 8;
    if (left < 8) left = 8;
    if (top + r.height > window.innerHeight - 8) {
      top = at.below !== undefined ? at.below - r.height - 4 : window.innerHeight - r.height - 8;
      if (top < 8) top = 8;
    }
    setPos({ left, top });
    (el.querySelector('[role=menuitem]:not([disabled]), [role=menuitemcheckbox]:not([disabled])') as HTMLElement | null)?.focus();
  }, [at.x, at.y, at.alignRight, at.below]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const onBlur = () => onClose();
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onBlur);
    window.addEventListener('resize', onBlur);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', onBlur);
    };
  }, [onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const els = Array.from(
      ref.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not([disabled]), [role=menuitemcheckbox]:not([disabled])') ?? [],
    );
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      els[(i + 1) % els.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      els[(i - 1 + els.length) % els.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      els[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      els[els.length - 1]?.focus();
    } else if (e.key === 'Tab') {
      onClose();
    }
  };

  return createPortal(
    <div
      ref={ref}
      className="menu"
      role="menu"
      aria-label={label}
      style={{ left: pos.left, top: pos.top }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) => {
        if (it === 'sep') return <div key={i} className="menu-sep" role="separator" />;
        if ('heading' in it)
          return (
            <div key={i} className="menu-heading">
              {it.heading}
            </div>
          );
        const isCheck = it.checked !== undefined;
        return (
          <button
            key={i}
            type="button"
            role={isCheck ? 'menuitemcheckbox' : 'menuitem'}
            aria-checked={isCheck ? it.checked : undefined}
            className="menu-item"
            disabled={it.disabled}
            onClick={() => {
              it.onSelect();
              if (!it.keepOpen) onClose();
            }}
          >
            {isCheck && <span className="menu-check">{it.checked && <IconCheck size={14} />}</span>}
            <span className="menu-label">{it.label}</span>
            {it.hint && <span className="menu-hint">{it.hint}</span>}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

/** A button that opens a MenuPopover beneath it. */
export function MenuButton({
  label,
  children,
  items,
  className = 'btn',
  alignRight,
  title,
  disabled,
}: {
  label: string;
  children: ReactNode;
  items: MenuItem[] | (() => MenuItem[]);
  className?: string;
  alignRight?: boolean;
  title?: string;
  disabled?: boolean;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<PopProps['at'] | null>(null);
  const open = () => {
    const r = btn.current!.getBoundingClientRect();
    setAt({ x: alignRight ? r.right : r.left, y: r.bottom + 4, alignRight, below: r.top });
  };
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={className}
        aria-haspopup="menu"
        aria-expanded={!!at}
        title={title}
        disabled={disabled}
        onClick={() => (at ? setAt(null) : open())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            open();
          }
        }}
      >
        {children}
      </button>
      {at && (
        <MenuPopover
          label={label}
          items={typeof items === 'function' ? items() : items}
          at={at}
          onClose={() => {
            setAt(null);
            btn.current?.focus();
          }}
        />
      )}
    </>
  );
}
