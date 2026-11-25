import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { CheckIcon } from './Icons';

export function ToolbarMenu({ name, label, icon, open, onOpenChange, children, right, exportTrigger }: {
  name: string;
  label: string;
  icon: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: (close: () => void) => ReactNode;
  right?: boolean;
  exportTrigger?: boolean;
}) {
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef<'first' | 'last' | null>(null);
  const items = () => Array.from(list.current?.querySelectorAll<HTMLButtonElement>(
    'button[role^="menuitem"]:not(:disabled)',
  ) ?? []);

  useEffect(() => {
    if (!open || !focusOnOpen.current) return;
    const controls = items();
    (focusOnOpen.current === 'last' ? controls.at(-1) : controls[0])?.focus();
    focusOnOpen.current = null;
  }, [open]);

  useLayoutEffect(() => {
    const menu = list.current;
    const anchor = wrapper.current;
    if (!open || !menu || !anchor) return;
    const position = () => {
      const rect = anchor.getBoundingClientRect();
      const padding = 8;
      const above = rect.top - padding;
      const below = window.innerHeight - rect.bottom - padding;
      const placeAbove = below < 180 && above > below;
      const width = menu.offsetWidth;
      const ideal = right ? rect.right - width : rect.left;
      const left = Math.max(padding, Math.min(ideal, document.documentElement.clientWidth - padding - width));
      menu.style.left = `${left - rect.left}px`;
      menu.style.right = 'auto';
      menu.style.top = placeAbove ? 'auto' : 'calc(100% + 4px)';
      menu.style.bottom = placeAbove ? 'calc(100% + 4px)' : 'auto';
      menu.style.setProperty('--menu-space', `${Math.max(80, (placeAbove ? above : below) - 4)}px`);
    };
    position();
    window.addEventListener('scroll', position);
    window.addEventListener('resize', position);
    return () => {
      window.removeEventListener('scroll', position);
      window.removeEventListener('resize', position);
    };
  }, [open, right]);

  const close = () => {
    trigger.current?.focus({ preventScroll: true });
    onOpenChange(false);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const { key } = event;
    if (open && key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (!open && (key === 'ArrowDown' || key === 'ArrowUp') && event.target === trigger.current) {
      event.preventDefault();
      focusOnOpen.current = key === 'ArrowUp' ? 'last' : 'first';
      onOpenChange(true);
    } else if (open && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) {
      event.preventDefault();
      const controls = items();
      const current = controls.indexOf(document.activeElement as HTMLButtonElement);
      const index = key === 'Home' ? 0 : key === 'End' ? controls.length - 1 : key === 'ArrowDown'
        ? (current + 1) % controls.length : (current <= 0 ? controls.length - 1 : current - 1);
      controls[index]?.focus();
    } else if (open && key === 'Tab') {
      close();
    }
  };

  return (
    <div className="dropdown-wrapper" ref={wrapper} onKeyDown={onKeyDown}
      onBlur={(event) => {
        if (open && event.relatedTarget && !wrapper.current?.contains(event.relatedTarget)) onOpenChange(false);
      }}>
      <button ref={trigger} type="button" className="btn btn--small toolbar-menu-trigger"
        onClick={(event) => {
          if (!open && event.detail === 0) focusOnOpen.current = 'first';
          onOpenChange(!open);
        }}
        aria-label={name} aria-expanded={open} aria-haspopup="menu"
        data-export-toggle={exportTrigger || undefined}>
        {icon}<span>{label}</span>
      </button>
      {open && <div ref={list} className={`dropdown-menu${right ? ' dropdown-menu--right' : ''}`}
        role="menu" aria-label={name}>{children(close)}</div>}
    </div>
  );
}

export function MenuCheck({ checked, onToggle, children }: {
  checked: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" role="menuitemcheckbox" tabIndex={-1}
      className="dropdown-item dropdown-item--checkable" aria-checked={checked} onClick={onToggle}>
      <span className="dropdown-item__check" aria-hidden="true">{checked && <CheckIcon size={13} />}</span>
      <span>{children}</span>
    </button>
  );
}
