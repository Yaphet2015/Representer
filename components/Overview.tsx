import { useEffect, useState, type ReactNode } from 'react';
import { parseMarks, stripMarks } from '@/lib/highlight';
import { cleanQuoteText } from '@/lib/parse';
import { jumpTo, liveIndex, resolveItem, type Anchors, type Item } from '@/lib/locate';
import { useT } from './i18n';
import type { Summary } from '@/lib/types';
import { Check, Refresh } from './Icons';
import { Button } from './bui/Button';
import { CopyButton } from './CopyButton';
import { overviewMarkdown } from '@/lib/copy';
import LoadingState from './bui/LoadingState';

/** the blinking end of the text still being written */
const Caret = () => <span data-caret aria-hidden className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse rounded-full bg-accent align-baseline" />;

/** One color per top-level branch; children inherit it. */
const BRANCH_COLORS = ['#1677ff', '#13a8a8', '#722ed1', '#fa8c16', '#eb2f96', '#52c41a'];

/** `s` = section title, `s:b` = bullet b of section s */
const itemsOf = (summary: Summary): [string, Item][] => [...(quoteItem(summary) ? [[QUOTE_KEY, quoteItem(summary)!] as [string, Item]] : []), ...summary.sections.flatMap((sec, i) => [
  [`${i}`, { anchor: sec.anchor, quote: sec.quote, text: sec.title }] as [string, Item],
  ...sec.bullets.map((b, j) => [`${i}:${j}`, bulletItem(sec, j)] as [string, Item]),
])];
const bulletItem = (sec: Summary['sections'][number], j: number): Item => ({ anchor: sec.anchors?.[j] || undefined, quote: sec.quotes?.[j] || undefined, text: stripMarks(sec.bullets[j]!) });
/** the quote at the bottom of the overview */
const QUOTE_KEY = 'quote';
const quoteItem = (summary: Summary): Item | null => (summary.quote ? { anchor: summary.quote.anchor, text: cleanQuoteText(summary.quote.text) } : null); // also tidies quotes cached by earlier versions

/**
 * Which items resolve to a block of the live page. Re-checked after DOM changes (debounced), so content
 * that loads late or shifts the page doesn't break the links; clicks resolve again anyway.
 */
function useLocatable(summary: Summary, anchors: Anchors | undefined, enabled = true) {
  const [ok, setOk] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!enabled) return; // still streaming: no anchors yet, and re-indexing the page on every chunk is wasted work
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
  }, [summary, anchors, enabled]);
  return ok;
}

/** Jump target: resolves again on click, so it follows the page as it is now (or silently no-ops). Not a <button>, so terms inside can be buttons. */
function Jump({ item, anchors, enabled, className, children }: { item: Item; anchors?: Anchors; enabled: boolean; className: string; children: ReactNode }) {
  const t = useT();
  if (!enabled) return <span className={className}>{children}</span>;
  const go = () => { const el = resolveItem(liveIndex(document), anchors, item); if (el) jumpTo(el); };
  return (
    <span
      role="button" tabIndex={0} title={t.jumpToSource}
      onClick={go}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); go(); } }}
      className={`${className} -mx-1.5 cursor-pointer rounded-[6px] px-1.5 text-left transition-colors duration-150 hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring`}
    >
      {children}
    </span>
  );
}

/** Text with its inline marks: strong phrases are tinted and semibold, terms get a dotted underline and ask the AI when clicked. */
function Marked({ text, onAsk }: { text: string; onAsk?: (term: string) => void }) {
  const t = useT();
  return (
    <>
      {parseMarks(text).map((g, i) => {
        if (g.kind === 'strong') return <mark key={i} className="rounded-[4px] bg-accent-tint px-0.5 font-semibold text-accent-ink">{g.text}</mark>;
        if (g.kind === 'term' && onAsk) {
          const ask = (e: { stopPropagation(): void }) => { e.stopPropagation(); onAsk(g.text); };
          return (
            <span
              key={i} role="button" tabIndex={0} title={t.askTermTitle}
              onClick={ask}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ask(e); } }}
              data-term
              className="cursor-pointer rounded-[3px] text-ink underline decoration-accent-ring decoration-dotted decoration-[1.5px] underline-offset-[3px] transition-colors duration-150 hover:bg-accent-tint hover:text-accent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
            >{g.text}</span>
          );
        }
        return <span key={i}>{g.text}</span>;
      })}
    </>
  );
}

/** A line from the page, with where it is from; jumps to its block. Rendered only when there is one. */
function Excerpt({ summary, anchors, enabled, pageTitle }: { summary: Summary; anchors?: Anchors; enabled: boolean; pageTitle?: string }) {
  const t = useT();
  const item = quoteItem(summary);
  if (!item) return null;
  const site = location.hostname.replace(/^www\./, '');
  return (
    <section data-excerpt>
      <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-ink-2">
        <span className="h-3 w-[3px] rounded-full bg-line-strong" /> {t.excerptTitle}
      </h3>
      <Jump item={item} anchors={anchors} enabled={enabled} className="block">
        <blockquote className="border-l-2 border-line-strong pl-3">
          <p className="text-[13px] leading-[1.7] text-ink-2">“{item.text}”</p>
          <footer className="mt-1.5 truncate text-right text-[11px] text-ink-3">— {t.excerptFrom(pageTitle ?? '', site)}</footer>
        </blockquote>
      </Jump>
    </section>
  );
}

/** The page's own icon: a declared one, else /favicon.ico; a letter tile if neither loads. */
export function Favicon({ host }: { host: string }) {
  const [src, setSrc] = useState<string | null>(() => {
    if (typeof document === 'undefined') return null;
    const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"][href]');
    return link?.href || `${location.origin}/favicon.ico`;
  });
  if (!src) return <span aria-hidden className="grid size-4 shrink-0 place-items-center rounded-[4px] bg-hover-2 text-[10px] font-semibold uppercase text-ink-2">{host.charAt(0) || '·'}</span>;
  return <img alt="" aria-hidden src={src} onError={() => setSrc(null)} className="size-4 shrink-0 rounded-[4px] object-contain" />;
}

/**
 * The overview's first row, sitting under the floating capsule: where the page is from, whether this came from the
 * cache, and the two actions (re-summarize, copy). There is no "Overview" title: the capsule already says it.
 */
export function SourceRow({ host, fromCache, cachedAt, onRegenerate, regenerated, children }: { host: string; fromCache?: boolean; cachedAt?: number; onRegenerate?: () => void; regenerated?: boolean; children?: ReactNode }) {
  const t = useT();
  return (
    <div data-source-row className="flex h-6 items-center gap-1.5">
      <Favicon host={host} />
      <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-3">{host}</span>
      {fromCache && (
        <span data-from-cache aria-label={t.cached}
          title={cachedAt && Number.isFinite(cachedAt) ? t.generatedAt(new Date(cachedAt).toLocaleString('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })) : undefined}
          className="max-w-[80px] shrink-0 truncate whitespace-nowrap text-[11px] font-normal text-ink-3">
          {t.cached}
        </span>
      )}
      <span className="flex shrink-0 items-center gap-0.5">
        {onRegenerate && (
          <Button variant="quiet" size="icon-sm" data-regenerate onClick={onRegenerate}
            title={regenerated ? t.updated : t.resummarize} aria-label={t.resummarize} className="text-ink-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring">
            {regenerated ? <Check className="size-3.5 text-green" /> : <Refresh className="size-3.5" />}
          </Button>
        )}
        {children}
      </span>
    </div>
  );
}

export const pageHost = () => (typeof location === 'undefined' ? '' : location.hostname.replace(/^www\./, ''));

/**
 * `streaming`: a partial overview still being written (lib/partial-json.ts). The first row then shows the status and
 * `children` (the cancel button) instead of the actions, nothing links to the page yet, and a caret marks the end.
 */
export function Overview({ summary, anchors, pageTitle, onAsk, fromCache = false, cachedAt, onRegenerate, regenerated, host = pageHost(), streaming = false, children }: { fromCache?: boolean; cachedAt?: number; summary: Summary; anchors?: Anchors; pageTitle?: string; onAsk?: (term: string) => void; onRegenerate?: () => void; regenerated?: boolean; host?: string; streaming?: boolean; children?: ReactNode }) {
  const t = useT();
  const ok = useLocatable(summary, anchors, !streaming);
  const lastSec = summary.sections.length - 1;
  const caretAt = streaming ? (lastSec < 0 ? 'overview' : summary.sections[lastSec]!.bullets.length ? `${lastSec}:${summary.sections[lastSec]!.bullets.length - 1}` : `${lastSec}`) : '';
  return (
    <div data-streaming={streaming || undefined} className="space-y-5 px-4 pb-4">
      <section>
        <div className="mb-1.5">
          {streaming ? (
            <div data-status-row className="flex h-6 items-center justify-between gap-2">
              <LoadingState label={t.summarizingLabel} tone="bg-accent" />
              {children}
            </div>
          ) : (
            <SourceRow host={host} fromCache={fromCache} cachedAt={cachedAt} onRegenerate={onRegenerate} regenerated={regenerated}>
              <CopyButton
                className="shrink-0" tip="left" label={t.copyOverview}
                getText={() => overviewMarkdown(summary, { pageTitle, excerptTitle: t.excerptTitle, excerptFrom: t.excerptFrom(pageTitle ?? '', host) })}
              />
            </SourceRow>
          )}
        </div>
        <p className="text-[13.5px] leading-[1.7] text-zinc-700">
          <Marked text={summary.overview} onAsk={streaming ? undefined : onAsk} />{caretAt === 'overview' && <Caret />}
        </p>
      </section>
      {summary.sections.map((sec, i) => {
        const c = BRANCH_COLORS[i % BRANCH_COLORS.length];
        return (
          <section key={i} data-branch={i}>
            <h4 className="mb-1.5 flex items-center gap-2 text-[14px] font-bold text-zinc-900">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c, boxShadow: `0 0 0 3px ${c}26` }} />
              <Jump item={{ anchor: sec.anchor, quote: sec.quote, text: sec.title }} anchors={anchors} enabled={ok.has(`${i}`)} className="block">{stripMarks(sec.title)}{caretAt === `${i}` && <Caret />}</Jump>
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
                    <Jump item={bulletItem(sec, j)} anchors={anchors} enabled={ok.has(`${i}:${j}`)} className="block text-[13px] leading-[1.6] text-zinc-700"><Marked text={b} onAsk={streaming ? undefined : onAsk} />{caretAt === `${i}:${j}` && <Caret />}</Jump>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      <Excerpt summary={summary} anchors={anchors} enabled={ok.has(QUOTE_KEY)} pageTitle={pageTitle} />
    </div>
  );
}
