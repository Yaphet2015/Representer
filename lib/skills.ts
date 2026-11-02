import { messages, type Lang } from './i18n';
import { KEYS, type KV } from './storage';

export interface Skill { id: string; name: string; icon?: string; template: string; builtin?: boolean }

export const DEFAULT_SKILLS: Skill[] = [
  { id: 'translate-en', name: '翻译成英文', icon: '🌐', template: '把下面的内容翻译成自然、地道的英文，只输出译文：\n\n{{input}}', builtin: true },
  { id: 'key-points', name: '提炼要点', icon: '📌', template: '基于《{{page_title}}》这个页面，提炼 3–5 个最重要的要点，用简洁的列表输出。{{input}}', builtin: true },
  { id: 'explain', name: '解释概念', icon: '💡', template: '用通俗易懂的中文解释这个概念，并结合页面《{{page_title}}》的上下文举一个例子：\n\n{{input}}', builtin: true },
  { id: 'qa', name: '出几道题', icon: '📝', template: '根据页面内容出 3 道检验理解的问答题，并附参考答案。{{input}}', builtin: true },
];

/** English versions of the built-in Skills (same ids). */
export const DEFAULT_SKILLS_EN: Skill[] = [
  { id: 'translate-en', name: 'Translate to English', icon: '🌐', template: 'Translate the following into natural, idiomatic English. Output only the translation:\n\n{{input}}', builtin: true },
  { id: 'key-points', name: 'Key points', icon: '📌', template: 'From the page “{{page_title}}”, extract the 3–5 most important points as a concise list. {{input}}', builtin: true },
  { id: 'explain', name: 'Explain', icon: '💡', template: 'Explain this concept in plain English and give one example in the context of the page “{{page_title}}”:\n\n{{input}}', builtin: true },
  { id: 'qa', name: 'Quiz me', icon: '📝', template: 'Write 3 questions that check understanding of the page, with reference answers. {{input}}', builtin: true },
];
const BUILTINS: Record<Lang, Skill[]> = { 'zh-CN': DEFAULT_SKILLS, en: DEFAULT_SKILLS_EN };

/** Show an unedited built-in Skill in the UI language; edited or custom Skills are returned as-is. */
export function localizeSkill(s: Skill, lang: Lang): Skill {
  if (!s.builtin) return s;
  const pristine = Object.values(BUILTINS).some((list) => list.some((d) => d.id === s.id && d.name === s.name && d.template === s.template));
  const target = BUILTINS[lang].find((d) => d.id === s.id);
  return pristine && target ? { ...s, name: target.name, template: target.template } : s;
}

export interface TemplateVars { input?: string; selection?: string; page_title?: string }

/** Replace {{input}} / {{selection}} / {{page_title}}. {{input}} falls back to the selection. */
export function renderTemplate(tpl: string, vars: TemplateVars): string {
  const input = (vars.input ?? '').trim() || (vars.selection ?? '').trim();
  const map: Record<string, string> = { input, selection: (vars.selection ?? '').trim(), page_title: (vars.page_title ?? '').trim() };
  let out = tpl.replace(/\{\{\s*(input|selection|page_title)\s*\}\}/g, (_, k: string) => map[k] ?? '');
  // If the template has no {{input}} slot, append the user's text so it isn't lost.
  if (!/\{\{\s*input\s*\}\}/.test(tpl) && (vars.input ?? '').trim()) out += `\n\n${vars.input!.trim()}`;
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

export function validateSkill(s: Partial<Skill>, lang: Lang = 'zh-CN'): string | null {
  const t = messages(lang);
  if (!s.name?.trim()) return t.errName;
  if (s.name.trim().length > 24) return t.errNameLong;
  if (!s.template?.trim()) return t.errTemplate;
  return null;
}

const K_SKILLS = KEYS.skills;
const K_RECENT = KEYS.skillsRecent;

/** Most-recently-used first; never-used skills follow in list order. Unknown ids are dropped. */
export function orderByRecent(skills: Skill[], recent: string[]): Skill[] {
  const byId = new Map(skills.map((s) => [s.id, s]));
  const used = recent.map((id) => byId.get(id)).filter((s): s is Skill => !!s);
  const rest = skills.filter((s) => !recent.includes(s.id));
  return [...used, ...rest];
}

export function bumpRecent(recent: string[], id: string, max = 20): string[] {
  return [id, ...recent.filter((x) => x !== id)].slice(0, max);
}

export function createSkillStore(kv: KV, lang: Lang = 'zh-CN', genId: () => string = () => `skill-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`) {
  const list = async (): Promise<Skill[]> => ((await kv.get(K_SKILLS)) as Skill[] | undefined) ?? DEFAULT_SKILLS.map((s) => ({ ...s }));
  const save = (skills: Skill[]) => kv.set(K_SKILLS, skills);
  const recent = async (): Promise<string[]> => ((await kv.get(K_RECENT)) as string[] | undefined) ?? [];
  return {
    list,
    async add(s: Omit<Skill, 'id'>): Promise<Skill> {
      const err = validateSkill(s, lang); if (err) throw new Error(err);
      const skill: Skill = { id: genId(), name: s.name.trim(), icon: s.icon?.trim() || undefined, template: s.template };
      await save([...(await list()), skill]);
      return skill;
    },
    async update(id: string, patch: Partial<Omit<Skill, 'id'>>): Promise<Skill> {
      const all = await list(); const i = all.findIndex((s) => s.id === id);
      if (i < 0) throw new Error(messages(lang).errNoSkill);
      const next = { ...all[i]!, ...patch, id };
      const err = validateSkill(next, lang); if (err) throw new Error(err);
      next.name = next.name.trim(); next.icon = next.icon?.trim() || undefined;
      all[i] = next; await save(all); return next;
    },
    async remove(id: string) {
      await save((await list()).filter((s) => s.id !== id));
      await kv.set(K_RECENT, (await recent()).filter((x) => x !== id));
    },
    async move(id: string, delta: -1 | 1) {
      const all = await list(); const i = all.findIndex((s) => s.id === id); const j = i + delta;
      if (i < 0 || j < 0 || j >= all.length) return;
      [all[i], all[j]] = [all[j]!, all[i]!]; await save(all);
    },
    /** Persist a new order (ids not listed keep their relative order at the end). */
    async reorder(ids: string[]) {
      const all = await list(); const pos = new Map(ids.map((id, i) => [id, i]));
      await save([...all].sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9)));
    },
    async moveTo(id: string, index: number) {
      const all = await list(); const i = all.findIndex((s) => s.id === id); if (i < 0) return;
      const [x] = all.splice(i, 1); all.splice(Math.max(0, Math.min(index, all.length)), 0, x!); await save(all);
    },
    /** Replace the whole list (used by undo). */
    async replaceAll(skills: Skill[]) { await save(skills.map((s) => ({ ...s }))); },
    async resetDefaults() { await save(DEFAULT_SKILLS.map((s) => ({ ...s }))); },
    recent,
    async markUsed(id: string) { await kv.set(K_RECENT, bumpRecent(await recent(), id)); },
    async ordered(): Promise<Skill[]> { return orderByRecent(await list(), await recent()); },
  };
}
