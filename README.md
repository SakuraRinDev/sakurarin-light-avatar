# SakuraRin Light Avatar

Bright web prototype for a clumsy, cute, non-human light avatar.

- Audio: Suno BGM with browser ON/OFF, plus WebAudio-generated SE
- Subtitles: enabled
- Browser model key: none
- Server role: Codex APP server
- Model plan: server-side OpenAI API responses from `/api/dialogue` using `gpt-5-nano`, with local Codex App Server and scripted fallback
- Search router: chat replies use the OSS Vercel AI SDK structured-output router to decide whether live search is needed, with a heuristic fallback.
- Google search: `/api/search` and search-needed chat replies use the OSS `google-search-ts` package. If Google web HTML is blocked, the server falls back to Google News RSS results.
- Phonebook: `/api/contacts` returns demo contacts shaped around vCard/schema.org-style fields and normalized with OSS `libphonenumber-js`. The browser opens device calling via per-contact `tel:` links; no real phone numbers are bundled.
- BGM asset: `assets/audio/suno-glass-archive.mp3`

## Run

```bash
npm run start
```

Open `http://127.0.0.1:5182`.

## Check

```bash
npm run check
curl http://127.0.0.1:5182/api/experience
curl "http://127.0.0.1:5182/api/search?q=OpenAI"
curl http://127.0.0.1:5182/api/contacts
```

## Codex App Server

When `OPENAI_API_KEY` is configured, `/api/dialogue` uses the OpenAI API with `gpt-5-nano`.
If that fails locally, `local-server.js` falls back to Codex App Server and lazily starts:

```bash
codex app-server --listen stdio://
```

The browser never receives model credentials. `/api/dialogue` returns only subtitle text and motion/status hints.
