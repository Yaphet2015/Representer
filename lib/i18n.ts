/** UI strings for zh-CN and en. `zh` defines the shape; `en` must provide every key. */
export type Lang = 'zh-CN' | 'en';
export type LangPref = 'auto' | Lang;

/** zh* → zh-CN, anything else → en. An explicit preference wins over the browser language. */
export function resolveLang(pref: LangPref | undefined, uiLanguage: string): Lang {
  if (pref === 'zh-CN' || pref === 'en') return pref;
  return /^zh/i.test(uiLanguage || '') ? 'zh-CN' : 'en';
}
export const uiLanguage = (): string => (typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage?.()) || (typeof navigator !== 'undefined' ? navigator.language : '') || 'en';

const zh = {
  // overlay
  tabOverview: '概览', tabChat: '对话', tabsLabel: '面板视图', overview: '概览',
  cached: '来自缓存', generatedAt: (time: string) => `生成于 ${time}`, copyOverview: '复制概览', copyMessage: '复制消息', copied: '已复制', copyFailed: '复制失败',
  jumpToSource: '在网页中定位', askTerm: (x: string) => `「${x}」是什么？它在这页里是怎么用的？`, askTermTitle: '点击向 AI 提问', excerptTitle: '核心原文', excerptFrom: (title: string, site: string) => (title && site ? `${title} · ${site}` : title || site), resummarize: '重新总结', summarizing: '总结中…', summarizingLabel: '正在总结', updated: '已更新',
  close: '关闭', closeEsc: '关闭 · Esc',
  resizeHandle: '拖动调整宽度，双击恢复默认',
  summaryFailed: (e: string) => `总结失败：${e}`, retry: '重试',
  summaryExpired: '总结已过期，请点击「重新总结」。',
  cancelSummary: '取消', summaryCancelled: '已取消自动总结', noOverviewHint: '这页还没有概览。可以现在开始总结，也可以直接和页面对话。', startSummary: '开始总结', chatNow: '直接对话',
  noSummaryChat: '还没有概览，回答时会按需读取页面原文。',
  // chat
  emptyMain: '关于这个页面，随便问点什么。', emptySide: '这是一个空的支线会话。',
  slashHintPre: '输入 ', slashHintPost: ' 查看命令', sideHintPre: '输入 ', sideHintPost: ' 可以另开一个支线，不打断主线。', newSideTitle: '新支线（/side）',
  current: (name: string) => `当前：${name}`,
  placeholderWait: '请先等待总结完成…', placeholder: '继续提问…（/ 查看命令）',
  inputLabel: '对话输入框', send: '发送',
  slashHeader: '命令 · ↑↓ 选择 · Tab/回车 确认', slashSide: '开一个支线对话，不打断主线；后面接一句话会作为第一条消息',
  runSkill: (name: string) => `运行 Skill：${name}（用输入框里的文字作为输入）`,
  mainSession: '主线', sideSession: (n: number) => `支线 ${n}`,
  mainSessionTitle: '主线会话', forkedFrom: (name: string) => `从「${name}」分叉`,
  closeSession: (name: string) => `关闭${name}`, forkTitle: '分叉出一个支线会话（也可以输入 /side）', newSide: '新支线',
  // options
  settingsTitle: 'Representer 设置', language: '界面语言', langAuto: '自动（跟随浏览器）',
  baseUrl: 'Base URL（OpenAI 兼容）', apiKey: 'API Key', model: 'Model',
  unknownError: '未知错误', testing: '测试中…', testConnection: '测试连接',
  testSending: (m: string) => `正在向 ${m} 发送测试请求…`,
  testOk: (ms: number, reply?: string) => `✓ 连接成功 · ${ms} ms${reply ? ` · 回复：${reply}` : ''}`,
  testFail: (e: string) => `✗ 连接失败：${e}`,
  thinking: '思考中…',
  systemPrompt: '自定义指令（System prompt）', systemPromptPlaceholder: '留空则只用内置指令。例如：用资深工程师的口吻回答，多举例子。',
  systemPromptDesc: '优先级高于内置指令（包括回复语言），同时用于总结和对话（包括支线和 Skills）。总结的输出格式始终由内置指令决定，不会被改坏。',
  systemPromptReset: '恢复默认', systemPromptView: '查看内置指令',
  noApiKey: '还没有填写 API Key，请先在设置页配置。',
  save: '保存', saved: '已保存 ✓',
  shortcutNow: '当前快捷键：', shortcutFallback: (k: string) => `${k}（页面内兜底）`,
  shortcutDesc: '默认 Mac 为 ⌘E、其他系统为 Ctrl+E，按一次显示、再按一次隐藏。',
  shortcutMissing: ' Chrome 没有分配该快捷键（可能与浏览器或其他扩展冲突），目前由页面内脚本兜底处理；在 chrome:// 等页面上不可用。',
  shortcutLink: '前往 chrome://extensions/shortcuts 自定义快捷键',
  modelPlaceholder: '选择或输入模型名，例如 gpt-4o-mini', refreshModels: '刷新模型列表', refresh: '刷新',
  modelsNeedConfig: '填写 Base URL 和 API Key 后会自动获取模型列表', modelsLoading: '正在获取模型列表…',
  modelsFailed: (e: string) => `获取模型列表失败：${e}`, modelsCount: (n: number) => `共 ${n} 个模型，可搜索，也可以直接输入自定义模型名`,
  loading: '加载中…', noModelMatch: (v: string) => `没有匹配的模型，回车后将使用自定义名称「${v}」`,
  connectFailed: (url: string, e: string) => `无法连接 ${url}：${e}`, notJson: '返回的不是 JSON',
  // skills manager
  skillsDesc: ['对话输入框上方的快捷指令。模板支持 ', '（输入框文字，留空时用页面选中文字）、', '、', '。'] as [string, string, string, string],
  newSkill: '＋ 新建', icon: '图标', name: '名称', namePlaceholder: '名称，例如：改写得更正式', template: '提示词模板',
  preview: '预览：', previewVars: { input: '（输入框文字）', selection: '（选中文字）', page_title: '（页面标题）' },
  saveChanges: '保存修改', add: '添加', cancel: '取消', noSkills: '还没有 Skill。', builtin: '内置',
  confirmDelete: '确定删除？', delete: '删除', moveUp: '上移', moveDown: '下移', edit: '编辑', resetSkills: '恢复内置默认 Skills',
  errName: '请填写名称', errNameLong: '名称最多 24 个字', errTemplate: '请填写提示词模板', errNoSkill: 'Skill 不存在',
  // prompt
  replyLanguage: 'Simplified Chinese',
};
export type Messages = typeof zh;

const en: Messages = {
  tabOverview: 'Overview', tabChat: 'Chat', tabsLabel: 'Panel view', overview: 'Overview',
  cached: 'Cached', generatedAt: (time) => `Generated at ${time}`, copyOverview: 'Copy overview', copyMessage: 'Copy message', copied: 'Copied', copyFailed: 'Copy failed',
  jumpToSource: 'Show in page', askTerm: (x) => `What is “${x}”, and how is it used on this page?`, askTermTitle: 'Click to ask the AI', excerptTitle: 'Key passage', excerptFrom: (title, site) => (title && site ? `${title} · ${site}` : title || site), resummarize: 'Re-summarize', summarizing: 'Summarizing…', summarizingLabel: 'Summarizing', updated: 'Updated',
  close: 'Close', closeEsc: 'Close · Esc',
  resizeHandle: 'Drag to resize, double-click to reset',
  summaryFailed: (e) => `Summary failed: ${e}`, retry: 'Retry',
  summaryExpired: 'The summary has expired. Click “Re-summarize”.',
  cancelSummary: 'Cancel', summaryCancelled: 'Automatic summary cancelled', noOverviewHint: 'This page has no overview yet. Start the summary now, or chat with the page directly.', startSummary: 'Start summary', chatNow: 'Chat now',
  noSummaryChat: 'No overview yet; replies read the page text as needed.',
  emptyMain: 'Ask anything about this page.', emptySide: 'This side chat is empty.',
  slashHintPre: 'Type ', slashHintPost: ' for commands', sideHintPre: 'Type ', sideHintPost: ' to branch a side chat without interrupting this one.', newSideTitle: 'New side (/side)',
  current: (name) => `Current: ${name}`,
  placeholderWait: 'Waiting for the summary…', placeholder: 'Ask a follow-up… (/ for commands)',
  inputLabel: 'Chat input', send: 'Send',
  slashHeader: 'Commands · ↑↓ to select · Tab/Enter to confirm', slashSide: 'Start a side chat without interrupting this one; text after it is sent as the first message',
  runSkill: (name) => `Run Skill: ${name} (uses the text in the input box)`,
  mainSession: 'Main', sideSession: (n) => `Side ${n}`,
  mainSessionTitle: 'Main chat', forkedFrom: (name) => `Forked from “${name}”`,
  closeSession: (name) => `Close ${name}`, forkTitle: 'Fork a side chat (or type /side)', newSide: 'New side',
  settingsTitle: 'Representer Settings', language: 'Language', langAuto: 'Auto (follow browser)',
  baseUrl: 'Base URL (OpenAI-compatible)', apiKey: 'API Key', model: 'Model',
  unknownError: 'Unknown error', testing: 'Testing…', testConnection: 'Test connection',
  testSending: (m) => `Sending a test request to ${m}…`,
  testOk: (ms, reply) => `✓ Connected · ${ms} ms${reply ? ` · Reply: ${reply}` : ''}`,
  testFail: (e) => `✗ Connection failed: ${e}`,
  thinking: 'Thinking…',
  systemPrompt: 'Custom instructions (system prompt)', systemPromptPlaceholder: 'Leave empty to use only the built-in instructions. E.g. Answer like a senior engineer, with examples.',
  systemPromptDesc: 'Takes priority over the built-in instructions (including reply language) and is used for both summaries and chat (including side chats and Skills). The summary format always comes from the built-in instructions, so it can\'t break.',
  systemPromptReset: 'Reset to default', systemPromptView: 'View built-in instructions',
  noApiKey: 'No API key yet. Add one in Settings first.',
  save: 'Save', saved: 'Saved ✓',
  shortcutNow: 'Current shortcut: ', shortcutFallback: (k) => `${k} (in-page fallback)`,
  shortcutDesc: 'Default is ⌘E on Mac and Ctrl+E elsewhere. Press once to show, again to hide.',
  shortcutMissing: ' Chrome did not assign this shortcut (it may conflict with the browser or another extension), so an in-page script handles it instead; this does not work on chrome:// pages.',
  shortcutLink: 'Customize shortcuts at chrome://extensions/shortcuts',
  modelPlaceholder: 'Choose or type a model, e.g. gpt-4o-mini', refreshModels: 'Refresh model list', refresh: 'Refresh',
  modelsNeedConfig: 'Fill in the Base URL and API key to load the model list', modelsLoading: 'Loading models…',
  modelsFailed: (e) => `Couldn't load models: ${e}`, modelsCount: (n) => `${n} models. Search, or type a custom model name`,
  loading: 'Loading…', noModelMatch: (v) => `No matching model. Press Enter to use “${v}”`,
  connectFailed: (url, e) => `Couldn't connect to ${url}: ${e}`, notJson: 'The response is not JSON',
  skillsDesc: ['Quick prompts shown above the chat input. Templates support ', ' (the input text, or the page selection if empty), ', ', ', '.'],
  newSkill: '＋ New', icon: 'Icon', name: 'Name', namePlaceholder: 'Name, e.g. Make it more formal', template: 'Prompt template',
  preview: 'Preview: ', previewVars: { input: '(input text)', selection: '(selected text)', page_title: '(page title)' },
  saveChanges: 'Save changes', add: 'Add', cancel: 'Cancel', noSkills: 'No Skills yet.', builtin: 'Built-in',
  confirmDelete: 'Delete?', delete: 'Delete', moveUp: 'Move up', moveDown: 'Move down', edit: 'Edit', resetSkills: 'Restore built-in Skills',
  errName: 'Please enter a name', errNameLong: 'Names can be at most 24 characters', errTemplate: 'Please enter a prompt template', errNoSkill: 'Skill not found',
  replyLanguage: 'English',
};

const MESSAGES: Record<Lang, Messages> = { 'zh-CN': zh, en };
export const messages = (lang: Lang): Messages => MESSAGES[lang];
