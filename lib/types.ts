export type IconType = 'target' | 'lightbulb' | 'list' | 'chart' | 'flag' | 'book' | 'warning' | 'check';
export const ICON_TYPES: IconType[] = ['target', 'lightbulb', 'list', 'chart', 'flag', 'book', 'warning', 'check'];

export interface Section {
  title: string; icon: IconType; bullets: string[];
  /** short verbatim page excerpt the title comes from (for jumping to it in the page) */
  quote?: string;
  /** quotes[i] is the verbatim excerpt for bullets[i] ('' = none). Missing in summaries cached before this existed. */
  quotes?: string[];
}
export interface Summary { overview: string; keyTerms: string[]; sections: Section[] }
export interface ChatMessage { role: 'user' | 'assistant'; content: string; /** what the UI shows instead of content (e.g. a Skill run) */ label?: string }
export interface Settings { baseUrl: string; apiKey: string; model: string; mock: boolean; /** extra user instructions added to the built-in prompts ('' = none) */ systemPrompt?: string; /** UI language override */ lang?: 'auto' | 'zh-CN' | 'en' }
export const DEFAULT_SETTINGS: Settings = { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini', mock: false, systemPrompt: '', lang: 'auto' };
