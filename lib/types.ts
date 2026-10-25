export type IconType = 'target' | 'lightbulb' | 'list' | 'chart' | 'flag' | 'book' | 'warning' | 'check';
export const ICON_TYPES: IconType[] = ['target', 'lightbulb', 'list', 'chart', 'flag', 'book', 'warning', 'check'];

export interface Section {
  title: string; icon: IconType; bullets: string[];
  /** id of the page block (`p12`) the title is based on; see lib/locate.ts */
  anchor?: string;
  /** anchors[i] is the block id for bullets[i] ('' = none) */
  anchors?: string[];
  /** legacy (short-lived format): verbatim page excerpts instead of ids; still read for cached summaries */
  quote?: string; quotes?: string[];
}
/** A line from the page itself: `anchor` is the id of the block it was taken from; the text was checked against that block. */
export interface Excerpt { text: string; anchor: string }
export interface Summary {
  /** may carry inline marks: `==key phrase==` and `[[term]]` (see lib/highlight.ts) */
  overview: string;
  /** legacy (earlier versions listed terms separately); ignored when reading, so old cached summaries still display */
  keyTerms?: string[];
  sections: Section[];
  /** 0-1 line quoted from the page, shown at the bottom of the overview */
  quote?: Excerpt;
}
export interface ChatMessage { role: 'user' | 'assistant'; content: string; /** what the UI shows instead of content (e.g. a Skill run) */ label?: string }
export interface Settings { baseUrl: string; apiKey: string; model: string; mock: boolean; /** extra user instructions added to the built-in prompts ('' = none) */ systemPrompt?: string; /** UI language override */ lang?: 'auto' | 'zh-CN' | 'en' }
export const DEFAULT_SETTINGS: Settings = { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini', mock: false, systemPrompt: '', lang: 'auto' };
