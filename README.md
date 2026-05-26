# SakuraRin Light Avatar

Bright web prototype for a clumsy, cute, non-human light avatar.

- Audio: Suno BGM with browser ON/OFF, plus WebAudio-generated SE
- Subtitles: enabled
- Browser model key: none
- Server role: Codex APP server
- Initial model plan: local Codex App Server responses from `/api/dialogue`, with scripted fallback
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
```

## Codex App Server

`local-server.js` lazily starts:

```bash
codex app-server --listen stdio://
```

The browser never receives model credentials. `/api/dialogue` talks to Codex through `codex-bridge.js`, then returns only subtitle text and motion/status hints.
