<div align="center">

# Representer

**网页 AI 总结与继续对话 —— 开源、BYOK 的 Chrome 扩展**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
[![React + TypeScript](https://img.shields.io/badge/React-TypeScript-3178C6?logo=typescript&logoColor=white)](https://react.dev)
[![WXT](https://img.shields.io/badge/built%20with-WXT-67D55E)](https://wxt.dev)

[English](./README.md) · 简体中文

<img src="docs/screenshots/zh-CN/overview.png" alt="Representer 在网页右侧显示 AI 总结和分节要点" width="820" />

</div>

**Representer** 是一个开源 Chrome 扩展：一键总结任意网页，生成带高亮的概览（核心短语、可点击的术语）、分节要点和一句核心原文，还能接着追问。BYOK（自带 API Key），兼容任意 OpenAI 接口（OpenAI、OpenRouter、DeepSeek、Ollama 等），数据只存在本地浏览器。

## 功能

- ✨ **AI 总结 + 要点**：用 [defuddle](https://github.com/kepano/defuddle) 提取正文，由模型生成概览和分节大纲：概览里只标一两处核心短语和几个术语（点术语会在对话里预填一个提问），每个分支用不同颜色区分，一眼扫完；页面里有好句子时，底部还会摘录一句原文，点击可跳到原处。
- 💬 **继续对话**：基于总结和原文追问，回复流式输出，对话按页面保存。
- 🌿 **支线会话 `/side`**：把当前对话分叉成独立支线，可随时切换、关闭。
- ⚡ **自定义 Skills**：常用提示词做成一键按钮，支持 `{{input}}` / `{{selection}}` / `{{page_title}}` 占位符；最近使用的会出现在输入框上方。
- 🎛️ **自定义指令**：可以加一段自己的 System prompt（语气、侧重点、语言等），附加在内置指令之后，同时作用于总结和对话，总结格式不会被改坏。
- 🗂️ **24 小时缓存**：24 小时内重复打开同一页面直接读缓存，不耗 token；可手动「重新总结」。
- ⌨️ **`⌘E` / `Ctrl+E`**：一键切换浮层，弹簧动画滑入；支持最小化、拖拽调整宽度（320–640px，自动记忆）。
- 🔝 **始终置顶**：浮层渲染在浏览器 top layer，不会被网站导航栏或弹窗遮挡，浮层以外的页面照常可点。
- 🌐 **多语言**：English / 简体中文，默认跟随浏览器，也可在设置中切换。
- 🔑 **BYOK，隐私优先**：请求直接从扩展发往你配置的接口，不经过任何第三方服务器。

## 截图

| 继续对话 | 支线会话 /side |
| :---: | :---: |
| <img src="docs/screenshots/zh-CN/chat.png" width="300" /> | <img src="docs/screenshots/zh-CN/side-chat.png" width="300" /> |
| **自定义 Skills** | **自带 API Key** |
| <img src="docs/screenshots/zh-CN/skills.png" width="300" /> | <img src="docs/screenshots/zh-CN/byok.png" width="300" /> |

## 安装

**Chrome 应用商店**：[安装 Representer](https://chromewebstore.google.com/detail/gdjkleekcdighnbiaihpmoimgcjhecch)。

**从源码安装**：

```bash
git clone https://github.com/Yaphet2015/Representer.git
cd Representer
npm install
npm run build        # 产物在 .output/chrome-mv3
```

1. 打开 `chrome://extensions`，开启「开发者模式」。
2. 点击「加载已解压的扩展程序」，选择 `.output/chrome-mv3`。
3. 在扩展「选项」页填写 Base URL、API Key 并选择模型。
4. 在任意网页按 **`⌘E`（Mac）/ `Ctrl+E`（Windows/Linux）** 或点击工具栏图标。

> **快捷键说明**：可在 `chrome://extensions/shortcuts` 自定义。如果 Chrome 不允许分配这个组合键，Representer 会在页面内自己监听 `⌘E` / `Ctrl+E`；这种兜底方式只在普通网页有效，`chrome://` 页面和应用商店里用不了。

## 配置

| 选项 | 说明 |
| --- | --- |
| **Base URL** | 任意 OpenAI 兼容接口，如 `https://api.openai.com/v1`、`https://openrouter.ai/api/v1`、本地 Ollama `http://localhost:11434/v1`（本地地址可不填 Key） |
| **API Key** | 只保存在本机 `chrome.storage.local` |
| **Model** | 自动从 `GET /models` 拉取，可搜索，也可手动输入 |
| **测试连接** | 向所选模型发一条极短请求，显示耗时或错误信息 |
| **自定义指令** | 可选的 System prompt，附加在内置指令之后，用于总结、对话、支线和 Skills；留空即默认 |
| **语言** | 自动 / English / 简体中文 |

**Skills** 在选项页增删改、排序。占位符：`{{input}}`（输入框文字；为空时用页面选中文字）、`{{selection}}`（页面上最近选中的文字）、`{{page_title}}`。在输入框输入 `/` 可查看全部命令。

## 开发

```bash
npm run dev       # 开发模式（热更新）
npm run build     # 生产构建
npm run compile   # 类型检查
npm test          # 单元测试
npm run zip       # 打包 zip
```

开发构建（`npm run dev`）的设置页会多一个 Mock 模式开关，返回模拟总结和回复，方便不接模型调试界面；正式构建不包含它。

技术栈：WXT · React · TypeScript · Tailwind CSS · Framer Motion · Shadow DOM · [pi durable](https://github.com/earendil-works/pi)

## 发布

新版本由 GitHub Actions 自动发布到 Chrome 应用商店：先运行 `npm run release:patch`，再执行 `git push --follow-tags`。一次性配置（API 凭证和仓库 Secrets）见 [docs/RELEASING.md](./docs/RELEASING.md)。

## 常见问题

- **数据存在哪里？** 设置、缓存、对话和 Skills 都在本地 `chrome.storage.local`，除了发给你配置的接口的请求，不会上传任何内容。
- **支持哪些模型？** 任何兼容 OpenAI `/chat/completions` 的服务；总结需要模型能稳定输出 JSON。
- **为什么某些页面打不开浮层？** Chrome 不允许扩展在 `chrome://` 页面和应用商店里运行。
- **隐私政策**：[PRIVACY.md](./PRIVACY.md)

## 许可与致谢

- [MIT License](./LICENSE)
- 部分 UI 组件改编自 [Beautiful UI](https://www.beautifului.dev)（MIT），见 `components/bui/` 和 `assets/beautifui.css`。
- 正文提取使用 [defuddle](https://github.com/kepano/defuddle)。
