# Representer 隐私政策 / Privacy Policy

最后更新 / Last updated: 2026-11-19

## 中文

Representer 是一个开源 Chrome 扩展，用于对你正在浏览的网页或公开 PDF 生成 AI 总结、思维导图大纲并继续对话。我们重视你的隐私，**Representer 的开发者不运营任何服务器，也不收集、存储或接收你的任何数据。**

### 处理哪些数据
- **网页内容**：只有在你主动打开 Representer 浮层（快捷键或工具栏图标）时，Representer 才会提取当前网页的标题、网址和正文。如果你使用 Skill 的 `{{selection}}` 占位符，还会用到你在页面上选中的文字。
- **PDF 内容**：只有在你于 PDF 标签页点击工具栏或使用同一快捷键打开侧栏时，才会处理该已授权文档（不会在后台扫描其他 PDF）。打开侧栏后会在本地读取该文档，并像普通网页浮层一样用你配置的模型自动生成 Overview。提取的文本层和页面目录会发送到你配置的 API；在模型支持视觉时，还可以按需发送部分页面的渲染图（可选，单次运行有页数上限，不会一次打包全部页面）。若模型不接受图片，请求会明确失败，不会静默改走纯文本。你可以取消或重试。
- **你输入的内容**：对话消息和 Skill 提示词。
- **设置**：你填写的 API Base URL、API Key、模型名称，以及 Skills、浮层宽度等偏好。

### 数据发送到哪里
- Representer 采用 **BYOK（自带密钥）** 模式。生成总结或回答时，上述网页内容、打开已授权 PDF 侧栏后提取的文本（以及按需页面渲染图）和对话内容**只会直接发送到你在设置页配置的 API 地址**（例如 OpenAI、OpenRouter 或你本机的 Ollama），并附带你的 API Key 用于鉴权。
- 这些数据由你选择的服务商按其隐私政策处理。Representer 的开发者无法访问这些请求。
- 未填写 API Key 时，不会向你配置的模型接口发出请求。打开已授权的 PDF 侧栏仍会在本地抓取该公开文档（不携带登录凭据、不跟随重定向）。
- Representer 不包含任何统计、分析、广告或追踪代码，也不会加载远程代码。

### 本地存储
设置、API Key、总结缓存（24 小时内有效，网页与 PDF 使用不同的缓存命名空间）、对话记录、概览历史和 Skills 均保存在你浏览器的 `chrome.storage.local` 中，仅存在于你的设备上。原始 PDF 字节只为已授权的视觉会话留在内存中，不写入存储。短期 PDF 授权记录（URL、标签号、随机标识和时间，不含 PDF 文本或字节）可写在 `chrome.storage.session` 中，浏览器会话结束即清除。你可以在扩展中点击「重新总结」清除单个页面的缓存和对话，或通过卸载扩展删除全部数据。

### 数据共享与出售
我们不出售、不出租、不与任何第三方共享你的数据。数据不会用于广告、信用评估或与扩展单一用途无关的任何目的。

### 儿童隐私
Representer 不面向 13 岁以下儿童，也不会有意收集儿童信息。

### 变更与联系
本政策如有变更，将更新于本页面。如有疑问，请在 GitHub 提交 Issue：https://github.com/Yaphet2015/Representer/issues

## English

Representer is an open-source Chrome extension that creates AI summaries, mind-map outlines and follow-up chat for the webpage or public PDF you are viewing. **The developers of Representer do not operate any server and do not collect, store or receive any of your data.**

### Data processed
- **Page content**: only when you open the Representer overlay (keyboard shortcut or toolbar icon), Representer reads the current page's title, URL and main text, plus your selected text if a Skill uses the `{{selection}}` placeholder.
- **PDF content**: only when you open the side panel on a PDF tab (toolbar or the same shortcut; other PDFs are not scanned in the background). The sidebar then reads that authorized document locally and starts an Overview with your configured model, like the webpage overlay. The extracted text layer and page catalog are sent to your configured API; when the model accepts images, rendered page images may also be sent on demand (optional, with a per-run page cap; pages are not all packed into one request). If the model does not accept images, the request fails clearly; there is no silent text-only fallback. You can cancel or retry.
- **Your input**: chat messages and Skill prompts.
- **Settings**: the API base URL, API key and model you enter, plus Skills and UI preferences.

### Where data goes
- Representer is **BYOK (bring your own key)**. To generate a summary or answer, page content, PDF text extracted after you open an authorized sidebar (and on-demand rendered page images) and chat messages are sent **only, and directly, to the API endpoint you configure** (e.g. OpenAI, OpenRouter, or a local Ollama server), together with your API key for authentication. That provider processes the data under its own privacy policy; Representer's developers have no access to these requests.
- When no API key is set, no requests are made to your configured model API. Opening an authorized PDF sidebar still fetches that public document locally (credentials omitted, redirects refused).
- Representer contains no analytics, advertising or tracking code and does not load remote code.

### Local storage
Settings, your API key, the summary cache (valid for 24 hours; webpages and PDFs use separate cache namespaces), chat history, overview history and Skills are stored in your browser's `chrome.storage.local` on your device only. Raw PDF bytes are kept in memory only for an authorized visual session and are not written to storage. A short PDF authorization record (URL, tab, token and time — not PDF text or bytes) may be kept in `chrome.storage.session` and is cleared when the browser session ends. Use “Re-summarize” to clear a page's cache and chat, or uninstall the extension to remove all data.

### Sharing and sale
We do not sell, rent or share your data with anyone. Data is never used for advertising, creditworthiness or any purpose unrelated to the extension's single purpose.

### Children
Representer is not directed at children under 13 and does not knowingly collect their information.

### Changes and contact
Changes to this policy will be posted on this page. Questions: https://github.com/Yaphet2015/Representer/issues
