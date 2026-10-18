<div align="center">

# Representer

**AI page summary &amp; follow-up chat for Chrome. Open source, bring your own key.**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
[![React + TypeScript](https://img.shields.io/badge/React-TypeScript-3178C6?logo=typescript&logoColor=white)](https://react.dev)
[![WXT](https://img.shields.io/badge/built%20with-WXT-67D55E)](https://wxt.dev)

English · [简体中文](./README.zh-CN.md)

<img src="docs/screenshots/overview.png" alt="Representer showing an AI summary and section outline next to a web page" width="820" />

</div>

**Representer** is an open-source Chrome extension that summarizes any web page: an overview with highlighted key terms and a section-by-section outline of key points. You can then keep asking questions about the page. It is **BYOK**: it works with any OpenAI-compatible API (OpenAI, OpenRouter, DeepSeek, Ollama, …), and all data stays in your browser.

## Features

- ✨ **AI summary + key points**: content is extracted with [defuddle](https://github.com/kepano/defuddle). The model writes an overview with highlighted key terms and a section outline, with color-coded branches for easy scanning.
- 💬 **Follow-up chat**: ask about the summary and the original page. Replies stream in, and conversations are saved per page.
- 🌿 **Side chats with `/side`**: fork the current conversation into a side session, then switch or close it any time.
- ⚡ **Custom Skills**: turn your favorite prompts into one-click buttons with `{{input}}` / `{{selection}}` / `{{page_title}}` placeholders. Recently used Skills appear above the composer.
- 🎛️ **Custom instructions**: add your own system prompt (tone, focus, language). It's added on top of the built-in instructions for both summaries and chat, so the summary format never breaks.
- 🗂️ **24-hour cache**: revisiting a page within 24h reuses its summary, so no tokens are spent. Use **Re-summarize** to regenerate.
- ⌨️ **`⌘E` / `Ctrl+E`**: toggle the panel, which slides in with a spring animation. You can minimize it and drag to resize it (320–640px; the width is remembered).
- 🔝 **Always on top**: the panel renders in the browser's top layer, so site navbars and popups can't cover it. The rest of the page stays clickable.
- 🌐 **i18n**: English and 简体中文. The language follows the browser, or you can set it in Options.
- 🔑 **BYOK, privacy first**: requests go from the extension straight to the endpoint you configure, with no third-party servers in between.

## Screenshots

| Follow-up chat | Side chat (/side) |
| :---: | :---: |
| <img src="docs/screenshots/chat.png" width="400" /> | <img src="docs/screenshots/side-chat.png" width="400" /> |
| **Custom Skills** | **Bring your own key** |
| <img src="docs/screenshots/skills.png" width="400" /> | <img src="docs/screenshots/byok.png" width="400" /> |

## Install

**Chrome Web Store**: [install Representer](https://chromewebstore.google.com/detail/gdjkleekcdighnbiaihpmoimgcjhecch).

**From source**:

```bash
git clone https://github.com/Yaphet2015/Representer.git
cd Representer
npm install
npm run build        # output: .output/chrome-mv3
```

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose `.output/chrome-mv3`.
3. Open the extension **Options**, enter a Base URL and API key, and pick a model (see [Configuration](#configuration)).
4. On any page, press **`⌘E` (Mac) / `Ctrl+E` (Windows/Linux)** or click the toolbar icon.

> **Shortcut note**: you can change the shortcut at `chrome://extensions/shortcuts`. If Chrome refuses the key combination, Representer listens for `⌘E` / `Ctrl+E` on the page itself. This fallback works on regular web pages only, not on `chrome://` pages or the Chrome Web Store.

## Configuration

| Option | Description |
| --- | --- |
| **Base URL** | Any OpenAI-compatible endpoint, e.g. `https://api.openai.com/v1`, `https://openrouter.ai/api/v1`, or local Ollama `http://localhost:11434/v1` (no key needed for local endpoints) |
| **API Key** | Stored only in `chrome.storage.local` on your machine |
| **Model** | Fetched automatically from `GET /models`. Searchable, and you can type a custom model name |
| **Test connection** | Sends a tiny request to the selected model and shows the latency or the error |
| **Custom instructions** | Optional system prompt added after the built-in instructions, for summaries, chat, side chats and Skills. Empty = default |
| **Language** | Auto / English / 简体中文 |

**Skills** can be added, edited, deleted and reordered in Options. Placeholders: `{{input}}` (composer text, or the page selection when the composer is empty), `{{selection}}` (the last text selected on the page), `{{page_title}}`. Type `/` in the composer to see all commands.

## Development

```bash
npm run dev       # dev mode with HMR (launches Chrome with the extension)
npm run build     # production build
npm run compile   # type check
npm test          # Vitest unit tests
npm run zip       # package zip
```

Dev builds (`npm run dev`) add a Mock mode toggle in Options that returns sample summaries and replies, for testing the UI without a model. Production builds leave it out.

Stack: WXT · React · TypeScript · Tailwind CSS · Framer Motion · Shadow DOM · [pi durable](https://github.com/earendil-works/pi) (OpenAI-compatible `/chat/completions`)

```
entrypoints/   background (messaging & streaming), content (Shadow DOM overlay), options
components/    UI (panel, chat, Skills, model picker…); bui/ holds base components adapted from Beautiful UI
lib/           pure logic: cache, sessions, Skills, messaging, storage, LLM calls, dev-only mock, parsing
tests/         Vitest unit tests
```

## Releasing

New versions are published to the Chrome Web Store by GitHub Actions: run `npm run release:patch`, then `git push --follow-tags`. For the one-time setup (API credentials and repository secrets), see [docs/RELEASING.md](./docs/RELEASING.md).

## FAQ

- **Where is my data?** Settings, cached summaries, chats and Skills are all stored locally in `chrome.storage.local`. Nothing is uploaded except your requests to the endpoint you configured.
- **Which models work?** Any service compatible with OpenAI `/chat/completions`. Summaries need a model that reliably outputs JSON.
- **Why won't the panel open on some pages?** Chrome doesn't allow extensions on `chrome://` pages or the Web Store.
- **Privacy policy**: [PRIVACY.md](./PRIVACY.md)

## License & credits

- [MIT License](./LICENSE)
- Some UI components are adapted from [Beautiful UI](https://www.beautifului.dev) (MIT); see `components/bui/` and `assets/beautifui.css`.
- Content extraction by [defuddle](https://github.com/kepano/defuddle).
