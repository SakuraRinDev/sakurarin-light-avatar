# SakuraRin Light Avatar

Bright web prototype for a clumsy, cute, non-human light avatar.

- Audio: Suno BGM with browser ON/OFF, plus WebAudio-generated SE
- Subtitles: enabled
- Browser model key: none
- Server role: Codex APP server
- Model plan: server-side OpenAI API responses from `/api/dialogue` using `gpt-5-nano`, with local Codex App Server and scripted fallback
- Search router: chat replies use the OSS Vercel AI SDK structured-output router to decide whether live search is needed, with a heuristic fallback.
- Google search: `/api/search` and search-needed chat replies use the OSS `google-search-ts` package. If Google web HTML is blocked, the server falls back to Google News RSS results.
- Skills: consultation-style chat can route to the bundled skill catalog in `data/skills.json`; matching skill metadata is returned as `skill` and shown in the subtitle dock.
- Phonebook: `/api/contacts` returns demo contacts shaped around vCard/schema.org-style fields and normalized with OSS `libphonenumber-js`. The browser opens device calling via per-contact `tel:` links; no real phone numbers are bundled.
- Conversation persistence: `/api/dialogue` stores user/assistant turns. On Vercel it uses KV/Upstash REST when `KV_REST_API_URL` and `KV_REST_API_TOKEN` are configured; otherwise local development falls back to `data/conversation-events.jsonl`. Read the latest turns from `/api/conversations`.
- Feedback: the header request button posts improvement requests to `/api/feedback`, stored in the same Vercel KV/local JSONL pattern and readable from `/api/feedback?limit=30`.
- BGM asset: `assets/audio/suno-glass-archive.mp3`

## Run

```bash
npm run start
```

Open `http://127.0.0.1:5182`.

## Check

```bash
npm run check
npm test
curl http://127.0.0.1:5182/api/experience
curl "http://127.0.0.1:5182/api/search?q=OpenAI"
curl http://127.0.0.1:5182/api/contacts
curl http://127.0.0.1:5182/api/conversations
curl http://127.0.0.1:5182/api/feedback
```

## Codex App Server

When `OPENAI_API_KEY` is configured, `/api/dialogue` uses the OpenAI API with `gpt-5-nano`.
If that fails locally, `local-server.js` falls back to Codex App Server and lazily starts:

```bash
codex app-server --listen stdio://
```

The browser never receives model credentials. `/api/dialogue` returns only subtitle text and motion/status hints.
