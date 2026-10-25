/** Dev-only mock text (sample summary/reply and the options toggle). Kept out of i18n so production builds drop it. */
import type { Lang } from './i18n';

const zh = {
  mockMode: 'Mock 模式', mockAuto: '未填 Key → 自动启用', mockManual: '已手动开启',
  mockDesc: '不调用模型，返回模拟总结和逐字输出的模拟对话，用于预览界面。',
  mockAutoDesc: '当前没有填写 API Key，所以会自动使用 Mock；填写 Key 后可自由开关。',
  mockHint: '没有填写 API Key 时会自动使用（localhost 等本地地址除外）。',
  mockPage: '这个页面',
  mockOverview: (t: string) => `这是「${t}」的模拟总结。文章先提出一个==核心观点：先理解机制，再谈做法==，再用具体例子解释背后的机制，最后给出可以落地的[[实践建议]]。开启 [[Mock 模式]]后，不需要真实模型和 API Key 也能完整预览 Representer 的界面流程。`,
  mockSections: [
    ['核心观点', ['点明页面要解决的主要问题', '说明这个问题为什么重要', '为后文的论证做铺垫']],
    ['工作原理', ['把机制拆成几个清晰的步骤', '每一步都配一个例子', '指出取舍和边界情况']],
    ['要点回顾', ['集中列出关键结论', '建议下一步可以尝试什么', '给出延伸阅读方向']],
  ] as [string, string[]][],
  mockReply: (q: string) => `（模拟回复）你问的是：「${q}」。\n\n根据总结，这个页面先提出核心观点，再一步步解释原理，最后在「要点回顾」里列出了下一步可以做什么。在设置页关闭 Mock 模式并填写 API Key，就能得到真实回答。`,
};

const en: typeof zh = {
  mockMode: 'Mock mode', mockAuto: 'No key → on automatically', mockManual: 'Turned on manually',
  mockDesc: 'Skips the model and returns a sample summary and a streamed sample reply, for previewing the UI.',
  mockAutoDesc: 'No API key is set, so mock mode is used automatically. Add a key to toggle it freely.',
  mockHint: 'Used automatically when no API key is set (except for local addresses such as localhost).',
  mockPage: 'this page',
  mockOverview: (t) => `This is a sample summary of “${t}”. The article opens with ==a core idea: understand the mechanism before the method==, explains it with concrete examples, and ends with [[practical advice]]. In [[mock mode]] you can preview the whole Representer experience without a real model or API key.`,
  mockSections: [
    ['Core idea', ['States the main problem the page tackles', 'Explains why the problem matters', 'Sets up the argument that follows']],
    ['How it works', ['Breaks the mechanism into clear steps', 'Pairs each step with an example', 'Points out trade-offs and edge cases']],
    ['Recap', ['Lists the key conclusions', 'Suggests what to try next', 'Points to further reading']],
  ],
  mockReply: (q) => `(Sample reply) You asked: “${q}”.\n\nAccording to the summary, the page first states a core idea, then explains how it works step by step, and ends with a recap of what to try next. Turn off mock mode and add an API key in settings to get real answers.`,
};

export const mockText = (lang: Lang) => (lang === 'en' ? en : zh);
