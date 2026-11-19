import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Options-page building blocks (spec §10). Only design tokens, no hard-coded palette colors. */
export const inputCls = (invalid?: boolean) => cn(
  'h-9 w-full rounded-[9px] bg-field px-3 text-[13.5px] text-ink placeholder:text-ink-3 outline-none transition-[box-shadow,background-color] duration-150',
  invalid ? 'shadow-[inset_0_0_0_1px_var(--red)] focus:shadow-[inset_0_0_0_1px_var(--red),0_0_0_3px_var(--red-tint)]'
    : 'shadow-[inset_0_0_0_1px_var(--line)] focus:bg-surface focus:shadow-[inset_0_0_0_1px_var(--accent),0_0_0_3px_var(--accent-ring)]',
);

export function Input({ invalid, className, ...p }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input aria-invalid={invalid || undefined} className={cn(inputCls(invalid), className)} {...p} />;
}

export function Card({ id, title, desc, action, foot, children, ...rest }: { id: string; title: ReactNode; desc?: ReactNode; action?: ReactNode; foot?: ReactNode; children?: ReactNode } & Record<`data-${string}`, unknown>) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-6 rounded-[14px] bg-surface shadow-card" {...rest}>
      <header className="flex items-start justify-between gap-4 px-6 pt-5">
        <div className="min-w-0">
          <h2 id={`${id}-h`} className="text-[15px] font-[650] leading-6 text-ink">{title}</h2>
          {desc && <p className="mt-0.5 text-[12.5px] leading-5 text-ink-2">{desc}</p>}
        </div>
        {action && <div className="flex shrink-0 items-center">{action}</div>}
      </header>
      {children && <div className="px-6 pb-6 pt-4">{children}</div>}
      {foot && <div className="flex items-center justify-between gap-4 border-t border-line px-6 py-3.5">{foot}</div>}
    </section>
  );
}

export function Field({ label, htmlFor, children }: { label: ReactNode; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="grid items-center gap-x-4 gap-y-1.5 min-[860px]:grid-cols-[140px_1fr]">
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink-2">{label}</label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={cn('relative h-[18px] w-8 shrink-0 rounded-full transition-colors duration-150 focus-visible:shadow-[0_0_0_3px_var(--accent-ring)] disabled:opacity-60',
        checked ? 'bg-accent' : 'bg-hover-2')}>
      <span className={cn('absolute top-[2px] size-[14px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.25)] transition-[left] duration-150', checked ? 'left-[16px]' : 'left-[2px]')} />
    </button>
  );
}

export function Tag({ tone = 'gray', children }: { tone?: 'gray' | 'amber'; children: ReactNode }) {
  return <span className={cn('inline-flex h-[18px] items-center rounded-[5px] px-1.5 text-[11px] font-medium leading-none',
    tone === 'amber' ? 'bg-amber-tint text-amber' : 'bg-hover text-ink-2')}>{children}</span>;
}

export function Select({ value, onChange, children, ...rest }: { value: string; onChange: (v: string) => void; children: ReactNode } & Record<string, unknown>) {
  return (
    <span className="relative inline-flex">
      <select value={value} onChange={(e) => onChange(e.target.value)} {...rest}
        className="h-8 appearance-none rounded-[9px] bg-surface pl-3 pr-8 text-[13px] text-ink shadow-btn outline-none focus-visible:shadow-[var(--shadow-btn),0_0_0_3px_var(--accent-ring)]">
        {children}
      </select>
      <svg aria-hidden viewBox="0 0 16 16" className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-2"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-[6px] bg-surface px-1.5 font-sans text-[12px] text-ink-2 shadow-[0_0_0_1px_var(--line-strong),0_1px_0_var(--line-strong)]">{children}</kbd>;
}

export const Ic = {
  plug: <path d="M6 2v3M10 2v3M4.5 5h7v2.5a3.5 3.5 0 0 1-7 0zM8 11v3" />,
  pen: <path d="M10.5 2.5l3 3L6 13H3v-3z" />,
  bolt: <path d="M9 1.5L3.5 9H8l-1 5.5L12.5 7H8z" />,
  kbd: <path d="M2 4.5h12v7H2zM4.5 7h.01M7 7h.01M9.5 7h.01M5 9.5h6" />,
  gear: <><circle cx="8" cy="8" r="2" /><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" /></>,
  grip: <path d="M6 3.5h.01M10 3.5h.01M6 8h.01M10 8h.01M6 12.5h.01M10 12.5h.01" strokeWidth="2.2" />,
  dots: <path d="M3.5 8h.01M8 8h.01M12.5 8h.01" strokeWidth="2.2" />,
  eye: <><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="1.8" /></>,
  eyeOff: <path d="M2 2l12 12M6.6 3.7A6.6 6.6 0 0 1 8 3.5c4.1 0 6.5 4.5 6.5 4.5a11 11 0 0 1-1.9 2.4M4.1 5.1A10.6 10.6 0 0 0 1.5 8s2.4 4.5 6.5 4.5c.9 0 1.7-.2 2.4-.5" />,
  refresh: <path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v2.5h-2.5" />,
  plus: <path d="M8 3v10M3 8h10" />,
  ext: <path d="M9 2.5h4.5V7M13.5 2.5L7.5 8.5M11.5 9.5v4h-9v-9h4" />,
  check: <path d="M3.5 8.5l3 3 6-7" />,
  clock: <><circle cx="8" cy="8" r="6" /><path d="M8 4.5V8l2.5 1.5" /></>,
};
export function Icon({ d, className }: { d: ReactNode; className?: string }) {
  return <svg aria-hidden viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={cn('size-4 shrink-0', className)}>{d}</svg>;
}
