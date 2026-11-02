# Representer 隐私政策 / Privacy Policy

最后更新 / Last updated: 2026-11-02

## 中文

Representer 是一个开源 Chrome 扩展，用于对你正在浏览的网页生成 AI 总结、思维导图大纲并继续对话。我们重视你的隐私，**Representer 的开发者不运营任何服务器，除可关闭的匿名使用统计（见下文）外，不收集、存储或接收你的任何数据。**

### 处理哪些数据
- **网页内容**：只有在你主动打开 Representer 浮层（快捷键或工具栏图标）时，Representer 才会提取当前网页的标题、网址和正文。如果你使用 Skill 的 `{{selection}}` 占位符，还会用到你在页面上选中的文字。
- **你输入的内容**：对话消息和 Skill 提示词。
- **设置**：你填写的 API Base URL、API Key、模型名称，以及 Skills、浮层宽度等偏好。

### 数据发送到哪里
- Representer 采用 **BYOK（自带密钥）** 模式。生成总结或回答时，上述网页内容和对话内容**只会直接发送到你在设置页配置的 API 地址**（例如 OpenAI、OpenRouter 或你本机的 Ollama），并附带你的 API Key 用于鉴权。
- 这些数据由你选择的服务商按其隐私政策处理。Representer 的开发者无法访问这些请求。
- 未填写 API Key 时，不会发出任何网络请求。
- **匿名使用统计**（可在设置页关闭「匿名使用统计」）：Representer 通过 Google Analytics 4 Measurement Protocol 发送少量匿名事件——安装/更新、打开面板、生成概览（成功与否、耗时区间、是否分块）、发送对话、运行 Skill、保存设置，附带一个随机生成的匿名 ID。**绝不发送**网址、网页内容、对话、提示词、API Key 或模型输出。Representer 不包含广告代码，也不会加载远程代码。

### 本地存储
设置、API Key、总结缓存（24 小时内有效）、对话记录和 Skills 均保存在你浏览器的 `chrome.storage.local` 中，仅存在于你的设备上。你可以在扩展中点击「重新总结」清除单个页面的缓存和对话，或通过卸载扩展删除全部数据。

### 数据共享与出售
我们不出售、不出租、不与任何第三方共享你的数据。数据不会用于广告、信用评估或与扩展单一用途无关的任何目的。

### 儿童隐私
Representer 不面向 13 岁以下儿童，也不会有意收集儿童信息。

### 变更与联系
本政策如有变更，将更新于本页面。如有疑问，请在 GitHub 提交 Issue：https://github.com/Yaphet2015/Representer/issues

## English

Representer is an open-source Chrome extension that creates AI summaries, mind-map outlines and follow-up chat for the page you are viewing. **The developers of Representer do not operate any server and do not collect, store or receive any of your data**, apart from the optional anonymous usage stats described below.

### Data processed
- **Page content**: only when you open the Representer overlay (keyboard shortcut or toolbar icon), Representer reads the current page's title, URL and main text, plus your selected text if a Skill uses the `{{selection}}` placeholder.
- **Your input**: chat messages and Skill prompts.
- **Settings**: the API base URL, API key and model you enter, plus Skills and UI preferences.

### Where data goes
- Representer is **BYOK (bring your own key)**. To generate a summary or answer, page content and chat messages are sent **only, and directly, to the API endpoint you configure** (e.g. OpenAI, OpenRouter, or a local Ollama server), together with your API key for authentication. That provider processes the data under its own privacy policy; Representer's developers have no access to these requests.
- When no API key is set, no network requests are made.
- **Anonymous usage stats** (turn off with "Anonymous usage stats" in Settings): Representer sends a few anonymous events via the Google Analytics 4 Measurement Protocol (install/update, panel opened, overview generated with success, duration range and whether it was chunked, chat message sent, Skill run, settings saved) with a randomly generated anonymous ID. It **never** sends URLs, page content, chats, prompts, API keys or model output. Representer contains no advertising code and does not load remote code.

### Local storage
Settings, your API key, the summary cache (valid for 24 hours), chat history and Skills are stored in your browser's `chrome.storage.local` on your device only. Use “Re-summarize” to clear a page's cache and chat, or uninstall the extension to remove all data.

### Sharing and sale
We do not sell, rent or share your data with anyone. Data is never used for advertising, creditworthiness or any purpose unrelated to the extension's single purpose.

### Children
Representer is not directed at children under 13 and does not knowingly collect their information.

### Changes and contact
Changes to this policy will be posted on this page. Questions: https://github.com/Yaphet2015/Representer/issues
