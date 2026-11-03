import { cn } from '@/lib/cn';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from './i18n';
import { errorKind } from '@/lib/autosave';
import { Icon, Ic, inputCls } from './options/ui';

/** Searchable combobox: filter the fetched list, or type any custom model name. */
export function ModelCombobox({ value, onChange, models, loading, error, onRefresh, canFetch, invalid, onCommit, id }: {
  value: string; onChange: (v: string) => void; models: string[]; loading: boolean; error: string; onRefresh: () => void; canFetch: boolean;
  invalid?: boolean; onCommit?: (v: string) => void; id?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState<string | null>(null); // null = show full list (not filtering yet)
  const box = useRef<HTMLDivElement>(null);
  const filtered = useMemo(() => {
    const q = (query ?? '').trim().toLowerCase();
    return q ? models.filter((m) => m.toLowerCase().includes(q)) : models;
  }, [models, query]);
  useEffect(() => setActive(0), [query, models]);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc); return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const pick = (m: string) => { onChange(m); onCommit?.(m); setQuery(null); setOpen(false); };

  return (
    <div ref={box} className="relative">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input id={id}
            role="combobox" aria-expanded={open} aria-autocomplete="list" aria-label={t.modelLabel} aria-invalid={invalid || undefined}
            value={value} placeholder={t.modelPlaceholder}
            onFocus={() => setOpen(true)}
            onBlur={() => onCommit?.(value)}
            onChange={(e) => { onChange(e.target.value); setQuery(e.target.value); setOpen(true); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              else if (e.key === 'Enter' && open && filtered[active]) { e.preventDefault(); pick(filtered[active]!); }
              else if (e.key === 'Enter') { e.preventDefault(); pick(value); }
              else if (e.key === 'Escape') setOpen(false);
            }}
            className={cn(inputCls(invalid), 'pr-8')}
          />
          <svg aria-hidden viewBox="0 0 16 16" className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </div>
        <button type="button" onClick={onRefresh} disabled={!canFetch || loading} title={t.refreshModels} aria-label={t.refreshModels}
          className="grid size-9 shrink-0 place-items-center rounded-[9px] bg-surface text-ink-2 shadow-btn transition-colors hover:bg-inset hover:text-ink focus-visible:shadow-[var(--shadow-btn),0_0_0_3px_var(--accent-ring)] disabled:opacity-40">
          <Icon d={Ic.refresh} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      {(!canFetch || error) && (
        <p className="mt-1.5 text-[12px] text-ink-3" data-model-status>
          {!canFetch ? t.modelsNeedConfig : <span className="text-red" title={error}>{t.modelsFailed(t.errKind[errorKind(error)])}</span>}
        </p>
      )}
      {open && (models.length > 0 || loading) && (
        <ul role="listbox" className="absolute left-0 right-11 top-[42px] z-20 max-h-72 overflow-y-auto rounded-[12px] bg-glass p-1 shadow-float [backdrop-filter:blur(20px)_saturate(1.3)]">
          {loading && <li className="flex h-8 items-center px-2.5 text-[13px] text-ink-3">{t.loading}</li>}
          {!loading && filtered.map((m, i) => (
            <li key={m} role="option" aria-selected={m === value}
              onMouseDown={(e) => { e.preventDefault(); pick(m); }} onMouseEnter={() => setActive(i)}
              className={`flex h-8 cursor-pointer items-center justify-between rounded-[8px] px-2.5 text-[13px] text-ink ${m === value ? 'bg-accent-tint text-accent-ink' : i === active ? 'bg-hover' : ''}`}>
              <span className="truncate">{m}</span>{m === value && <Icon d={Ic.check} className="size-3.5" />}
            </li>
          ))}
          {!loading && <li className="flex h-8 items-center px-2.5 text-[12.5px] text-ink-3">{filtered.length === 0 ? t.noModelMatch(value) : t.customModelHint}</li>}
        </ul>
      )}
    </div>
  );
}
