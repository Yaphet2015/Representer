import { useEffect, useRef, useState, type KeyboardEvent as RKE, type PointerEvent as RPE } from 'react';
import { chromeKV } from '@/lib/storage';
import { createSkillStore, localizeSkill, renderTemplate, validateSkill, type Skill } from '@/lib/skills';
import { arrayMove } from '@/lib/autosave';
import { cn } from '@/lib/cn';
import { useLang, useT } from './i18n';
import { Button } from './bui/Button';
import { Card, Icon, Ic, inputCls, Tag } from './options/ui';

type Draft = { id?: string; name: string; icon: string; template: string };
const EMPTY: Draft = { name: '', icon: '', template: '{{input}}' };
export type Toast = (msg: string, undo?: () => void) => void;
type Drag = { id: string; from: number; over: number; dy: number; startY: number; mids: number[]; tops: number[]; h: number };

/** Keyboard reorder step for a picked-up row: returns the new index (clamped). */
export const keyStep = (i: number, key: string, n: number): number =>
  key === 'ArrowUp' ? Math.max(0, i - 1) : key === 'ArrowDown' ? Math.min(n - 1, i + 1) : key === 'Home' ? 0 : key === 'End' ? n - 1 : i;

/** Index the dragged row lands at: how many other rows' midpoints are above its center. */
export const dropIndex = (mids: number[], from: number, center: number): number =>
  mids.reduce((n, m, j) => (j !== from && m < center ? n + 1 : n), 0);

export function SkillsManager({ toast = () => {} }: { toast?: Toast }) {
  const t = useT(); const lang = useLang();
  const store = createSkillStore(chromeKV, lang);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [err, setErr] = useState('');
  const [menu, setMenu] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [picked, setPicked] = useState<{ id: string; orig: Skill[] } | null>(null);
  const [live, setLive] = useState('');
  const listRef = useRef<HTMLUListElement>(null);
  const reload = () => store.list().then((l) => setSkills(l.map((s) => localizeSkill(s, lang))));
  useEffect(() => { reload(); }, [lang]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!(e.target as Element).closest?.('[data-skill-menu]')) setMenu(null); };
    document.addEventListener('mousedown', close); return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  const save = async () => {
    if (!draft) return;
    const e = validateSkill(draft, lang); if (e) { setErr(e); return; }
    try {
      if (draft.id) await store.update(draft.id, { name: draft.name, icon: draft.icon, template: draft.template });
      else { const s = await store.add({ name: draft.name, icon: draft.icon, template: draft.template }); await store.moveTo(s.id, 0); }
      setDraft(null); setErr(''); reload();
    } catch (x: any) { setErr(x.message); }
  };
  const withUndo = async (msg: string, fn: () => Promise<unknown>) => {
    const before = await store.list(); await fn(); await reload();
    toast(msg, async () => { await store.replaceAll(before); reload(); });
  };
  const remove = (s: Skill) => withUndo(`${s.name} · ${s.builtin ? t.hide : t.delete}`, () => store.remove(s.id));

  // pointer drag (handle only)
  const onGripDown = (e: RPE, s: Skill, i: number) => {
    if (e.button !== 0 || draft) return;
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-skill-row]') ?? []);
    const rects = rows.map((r) => r.getBoundingClientRect());
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({ id: s.id, from: i, over: i, dy: 0, startY: e.clientY, mids: rects.map((r) => r.top + r.height / 2), tops: rects.map((r) => r.top), h: rects[i]?.height ?? 48 });
  };
  const onGripMove = (e: RPE) => {
    if (!drag) return;
    const dy = e.clientY - drag.startY;
    setDrag({ ...drag, dy, over: dropIndex(drag.mids, drag.from, drag.mids[drag.from]! + dy) });
  };
  const onGripUp = async () => {
    if (!drag) return;
    const { from, over } = drag; setDrag(null);
    if (from === over) return;
    const next = arrayMove(skills, from, over); setSkills(next);
    await store.reorder(next.map((s) => s.id));
  };
  // keyboard: Space picks up / drops, arrows move, Esc cancels
  const onGripKey = async (e: RKE, s: Skill, i: number) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (picked?.id === s.id) { setPicked(null); setLive(t.dragDropped(s.name, i + 1)); await store.reorder(skills.map((x) => x.id)); }
      else { setPicked({ id: s.id, orig: skills }); setLive(t.dragPicked(s.name, i + 1, skills.length)); }
    } else if (picked?.id === s.id && ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      const j = keyStep(i, e.key, skills.length); if (j === i) return;
      setSkills(arrayMove(skills, i, j)); setLive(t.dragMoved(j + 1, skills.length));
      requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-grip="${s.id}"]`)?.focus());
    } else if (e.key === 'Escape' && picked) { e.preventDefault(); setSkills(picked.orig); setPicked(null); }
  };

  const editor = (key: string) => draft && (
    <li key={key} className="my-2 rounded-[12px] bg-surface shadow-float" data-skill-editor
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setDraft(null); setErr(''); } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); } }}>
      <div className="px-5 pt-4">
        <div className="text-[14px] font-[650] text-ink">{draft.id ? t.editSkillTitle : t.newSkillTitle}</div>
        <div className="text-[12.5px] text-ink-2">{t.editSkillDesc}</div>
      </div>
      <div className="space-y-4 px-5 py-4">
        <div className="grid items-center gap-x-4 gap-y-1.5 min-[860px]:grid-cols-[120px_1fr]">
          <span className="text-[13px] font-medium text-ink-2">{t.iconAndName}</span>
          <div className="flex gap-2">
            <input aria-label={t.icon} value={draft.icon} onChange={(e) => setDraft({ ...draft, icon: e.target.value })} placeholder="⚡" maxLength={4} className={cn(inputCls(), 'w-12 shrink-0 px-0 text-center')} />
            <input autoFocus aria-label={t.name} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={t.namePlaceholder} className={inputCls(!!err && !draft.name.trim())} />
          </div>
        </div>
        <div className="grid gap-x-4 gap-y-1.5 min-[860px]:grid-cols-[120px_1fr]">
          <span className="pt-2 text-[13px] font-medium text-ink-2">{t.template}</span>
          <div>
            <textarea aria-label={t.template} value={draft.template} rows={4} onChange={(e) => setDraft({ ...draft, template: e.target.value })}
              className={cn(inputCls(), 'h-auto min-h-[96px] resize-y py-2 font-mono text-[13px] leading-relaxed')} />
            <p className="mt-1.5 truncate text-[12px] text-ink-3">{t.preview}{renderTemplate(draft.template, t.previewVars).replace(/\s+/g, ' ')}</p>
            {err && <p className="mt-1 text-[12px] text-red">{err}</p>}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-line px-5 py-3">
        <span>{draft.id && <Button variant="quiet" size="sm" className="text-red hover:bg-red-tint" onClick={() => { const s = skills.find((x) => x.id === draft.id); setDraft(null); if (s) remove(s); }}>{t.delete}</Button>}</span>
        <span className="flex gap-2">
          <Button variant="quiet" size="sm" onClick={() => { setDraft(null); setErr(''); }}>{t.cancel}</Button>
          <Button variant="accent" size="sm" data-skill-save onClick={save}>{t.save2}</Button>
        </span>
      </div>
    </li>
  );

  const builtins = skills.filter((s) => s.builtin).length;
  return (
    <Card id="skills" data-skills-manager title={t.skillsTitle}
      desc={<>{t.skillsDescV2[0]}<code className="font-mono text-[12px]">{'{{input}} {{selection}} {{page_title}}'}</code>{t.skillsDescV2[1]}</>}
      action={<Button variant="secondary" size="sm" className="whitespace-nowrap" disabled={!!draft} onClick={() => { setDraft({ ...EMPTY }); setErr(''); }}><Icon d={Ic.plus} className="size-3.5" />{t.newShort}</Button>}
      foot={<><span className="text-[12px] text-ink-3" data-skills-count>{t.skillsCount(skills.length, builtins)}</span>
        <Button variant="quiet" size="sm" onClick={() => withUndo(t.restored, () => store.resetDefaults())}>{t.restoreBuiltins}</Button></>}>
      <p aria-live="assertive" className="sr-only">{live}</p>
      <ul ref={listRef} className="-mx-3" data-skill-list>
        {draft && !draft.id && editor('new')}
        {skills.length === 0 && !draft && <li className="px-3 py-3 text-[13px] text-ink-3">{t.noSkills}</li>}
        {skills.map((s, i) => {
          if (draft?.id === s.id) return editor(s.id);
          const dragging = drag?.id === s.id;
          const lineTop = drag && !dragging && drag.over < drag.from && drag.over === i;
          const lineBottom = drag && !dragging && drag.over > drag.from && drag.over === i;
          const isPicked = picked?.id === s.id;
          return (
            <li key={s.id} data-skill-row data-id={s.id}
              style={dragging ? { transform: `translateY(${drag!.dy}px) rotate(-0.6deg)` } : undefined}
              className={cn('group relative flex h-12 items-center gap-2.5 rounded-[10px] px-3 [&+&]:shadow-[0_-1px_0_var(--line)]',
                dragging ? 'z-10 bg-surface !shadow-float' : 'hover:bg-hover hover:!shadow-none [&:hover+&]:!shadow-none',
                isPicked && 'bg-surface !shadow-[0_0_0_2px_var(--accent-ring)]')}>
              {lineTop && <span aria-hidden className="absolute -top-0.5 left-2 right-2 h-1 -translate-y-1/2 rounded-full bg-accent" />}
              {lineBottom && <span aria-hidden className="absolute -bottom-0.5 left-2 right-2 h-1 translate-y-1/2 rounded-full bg-accent" />}
              <button type="button" data-grip={s.id} aria-label={t.dragHandle(s.name)} aria-pressed={isPicked}
                onPointerDown={(e) => onGripDown(e, s, i)} onPointerMove={onGripMove} onPointerUp={onGripUp} onPointerCancel={() => setDrag(null)}
                onKeyDown={(e) => onGripKey(e, s, i)} onBlur={() => { if (isPicked) { setPicked(null); store.reorder(skills.map((x) => x.id)); } }}
                className={cn('-ml-1 grid h-8 w-5 shrink-0 touch-none place-items-center rounded-[6px] text-ink-3 focus-visible:shadow-[0_0_0_3px_var(--accent-ring)]', dragging ? 'cursor-grabbing' : 'cursor-grab')}>
                <Icon d={Ic.grip} />
              </button>
              <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-inset text-[14px]">{s.icon || '⚡'}</span>
              <span className="shrink-0 text-[13.5px] font-[550] text-ink">{s.name}</span>
              {s.builtin && <Tag>{t.builtin}</Tag>}
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-3">{s.template.replace(/\s+/g, ' ')}</span>
              <span className="flex shrink-0 items-center gap-0.5 text-ink-3 group-hover:text-ink-2">
                <button type="button" title={t.edit} aria-label={`${t.edit} ${s.name}`} onClick={() => { setDraft({ id: s.id, name: s.name, icon: s.icon ?? '', template: s.template }); setErr(''); }}
                  className="grid size-7 place-items-center rounded-[7px] hover:bg-hover-2 hover:text-ink focus-visible:shadow-[0_0_0_3px_var(--accent-ring)]"><Icon d={Ic.pen} className="size-3.5" /></button>
                <span className="relative" data-skill-menu>
                  <button type="button" title={t.more} aria-label={`${t.more} ${s.name}`} aria-haspopup="menu" aria-expanded={menu === s.id} onClick={() => setMenu(menu === s.id ? null : s.id)}
                    className="grid size-7 place-items-center rounded-[7px] hover:bg-hover-2 hover:text-ink focus-visible:shadow-[0_0_0_3px_var(--accent-ring)]"><Icon d={Ic.dots} /></button>
                  {menu === s.id && (
                    <div role="menu" className="absolute right-0 top-8 z-30 w-40 rounded-[12px] bg-glass p-1 shadow-float [backdrop-filter:blur(20px)_saturate(1.3)]"
                      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setMenu(null); } }}>
                      {[
                        { k: 'dup', label: t.duplicate, run: async () => { const c = await store.add({ name: (s.name + t.copySuffix).slice(0, 24), icon: s.icon, template: s.template }); await store.moveTo(c.id, i + 1); reload(); } },
                        { k: 'top', label: t.moveTop, disabled: i === 0, run: async () => { await store.moveTo(s.id, 0); reload(); } },
                        { k: 'up', label: t.moveUp, disabled: i === 0, run: async () => { await store.move(s.id, -1); reload(); } },
                        { k: 'down', label: t.moveDown, disabled: i === skills.length - 1, run: async () => { await store.move(s.id, 1); reload(); } },
                        { k: 'del', label: s.builtin ? t.hide : t.delete, danger: true, run: () => remove(s) },
                      ].map((m) => (
                        <button key={m.k} type="button" role="menuitem" disabled={m.disabled} autoFocus={m.k === 'dup'}
                          onClick={() => { setMenu(null); m.run(); }}
                          className={cn('flex h-8 w-full items-center rounded-[8px] px-2.5 text-left text-[13px] hover:bg-hover focus-visible:bg-hover disabled:opacity-40', m.danger ? 'text-red' : 'text-ink')}>{m.label}</button>
                      ))}
                    </div>
                  )}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
