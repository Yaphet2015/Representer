import { useEffect, useState, type ReactNode } from 'react';
import { highlightTerms } from '@/lib/parse';
import { jumpTo, liveIndex, resolveItem, type Anchors, type Item } from '@/lib/locate';
import { useT } from './i18n';
import type { Summary } from '@/lib/types';
import { Sparkle } from './Icons';

/** One color per top-level branch; children inherit it. */
const BRANCH_COLORS = ['#1677ff', '#13a8a8', '#722ed1', '#fa8c16', '#eb2f96', '#52c41a'];

/** `s` = section title, `s:b` = bullet b of section s */
const itemsOf = (summary: Summary): [string, Item][] => summary.sections.flatMap((sec, i) => [
  [`${i}`, { anchor: sec.anchor, quote: sec.quote, text: sec.title }] as [string, Item],
  ...sec.bullets.map((b, j) => [`${i}:${j}`, { anchor: sec.anchors?.[j] || undefined, quote: sec.quotes?.[j] || undefined, text: b }] as [string, Item]),
]);

/**
 * Which items resolve to a block of the live page. Re-checked after DOM changes (debounced), so content
 * that loads late or shifts the page doesn't break the links; clicks resolve again anyway.
 */
function useLocatable(summary: Summary, anchors: Anchors | undefined) {
  const [ok, setOk] = useState<Set<string>>(new Set());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      try {
        const live = liveIndex(document);
        const next = new Set(itemsOf(summary).filter(([, it]) => resolveItem(live, anchors, it)).map(([k]) => k));
        setOk((prev) => (prev.size === next.size && [...next].every((k) => prev.has(k)) ? prev : next));
      } catch (e) { console.warn('[representer] locate failed', e); }
    };
    check();
    // our overlay is attached to <html>, outside <body>, so its own updates don't trigger this
    const mo = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(check, 500); });
    if (document.body) mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => { mo.disconnect(); clearTimeout(timer); };
  }, [summary, anchors]);
  return ok;
}

/** Jump target: resolves again on click, so it follows the page as it is now (or silently no-ops). */
function Jump({ item, anchors, enabled, className, children }: { item: Item; anchors?: Anchors; enabled: boolean; className: string; children: ReactNode }) {
  const t = useT();
  if (!enabled) return <span className={className}>{children}</span>;
  return (
    <button
      type="button" title={t.jumpToSource}
      onClick={() => { const el = resolveItem(liveIndex(document), anchors, item); if (el) jumpTo(el); }}
      className={`${className} -mx-1.5 cursor-pointer rounded-[6px] px-1.5 text-left transition-colors duration-150 hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring`}
    >
      {children}
    </button>
  );
}

export function Overview({ summary, anchors }: { summary: Summary; anchors?: Anchors }) {
  const t = useT();
  const ok = useLocatable(summary, anchors);
  return (
    <div className="space-y-5 px-4 py-4">
      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-[15px] font-semibold text-zinc-900">
          <Sparkle className="h-4 w-4 text-accent" /> {t.overview}
        </h3>
        <p className="text-[13.5px] leading-[1.7] text-zinc-700">
          {highlightTerms(summary.overview, summary.keyTerms).map((s, i) =>
            s.highlight ? <mark key={i} className="rounded-[4px] bg-accent-tint px-0.5 font-medium text-accent-ink">{s.text}</mark> : <span key={i}>{s.text}</span>,
          )}
        </p>
      </section>
      {summary.sections.map((sec, i) => {
        const c = BRANCH_COLORS[i % BRANCH_COLORS.length];
        return (
          <section key={i} data-branch={i}>
            <h4 className="mb-1.5 flex items-center gap-2 text-[14px] font-bold text-zinc-900">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c, boxShadow: `0 0 0 3px ${c}26` }} />
              <Jump item={{ anchor: sec.anchor, quote: sec.quote, text: sec.title }} anchors={anchors} enabled={ok.has(`${i}`)} className="block">{sec.title}</Jump>
            </h4>
            <ul className="relative ml-[4.5px]">
              {sec.bullets.map((b, j) => {
                const last = j === sec.bullets.length - 1;
                return (
                  <li key={j} className="relative pb-2 pl-[30px] last:pb-0">
                    {/* trunk continues past this item */}
                    {!last && <span className="absolute bottom-0 left-0 top-0 w-[1.5px]" style={{ background: c, opacity: 0.55 }} />}
                    {/* curved elbow from the trunk into this node */}
                    <span className="absolute left-0 top-0 h-[13px] w-4 rounded-bl-[10px] border-b-[1.5px] border-l-[1.5px]" style={{ borderColor: c, opacity: 0.55 }} />
                    <span className="absolute left-[15px] top-[10px] h-[7px] w-[7px] rounded-full" style={{ background: c }} />
                    <Jump item={{ anchor: sec.anchors?.[j] || undefined, quote: sec.quotes?.[j] || undefined, text: b }} anchors={anchors} enabled={ok.has(`${i}:${j}`)} className="block text-[13px] leading-[1.6] text-zinc-700" >{b}</Jump>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
