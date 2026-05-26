/*
 * SakuraRin Light Avatar — subtitle prototype
 *
 * - Renders a soft "jelly light blob" on canvas (no audio captured).
 *   The reactivity is a pseudo-energy signal derived from time + a target
 *   level that swells while the avatar is "speaking".
 * - Subtitle bar receives text from POST /api/dialogue { message }.
 *   On any failure (offline, 404, non-JSON, timeout), it falls back to a
 *   local set of clumsy/cute scripted lines so the demo keeps working.
 */

(() => {
  const canvas = document.getElementById("avatar-canvas");
  const ctx = canvas.getContext("2d");
  const subtitleEl = document.getElementById("subtitle-text");
  const sourceEl = document.getElementById("subtitle-source");
  const statusEl = document.getElementById("status-label");
  const avatarBox = document.getElementById("avatar");
  const sceneEl = document.querySelector(".scene");
  const form = document.getElementById("compose");
  const input = document.getElementById("compose-input");
  const sendBtn = document.getElementById("compose-send");
  const micBtn = document.getElementById("mic");
  const soundToggle = document.getElementById("sound-toggle");
  const bgmAudio = document.getElementById("bgm-audio");

  /* ----------------------- sound design ----------------------- */
  const sound = {
    ctx: null,
    master: null,
    bgmOn: false,
  };

  function ensureAudio() {
    if (!sound.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return null;
      sound.ctx = new AudioContext();
      sound.master = sound.ctx.createGain();
      sound.master.gain.value = 0.26;
      sound.master.connect(sound.ctx.destination);
    }
    if (sound.ctx.state === "suspended") {
      sound.ctx.resume();
    }
    return sound.ctx;
  }

  function tone(freq, start, duration, options = {}) {
    const ctx = ensureAudio();
    if (!ctx || !sound.master) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const type = options.type || "sine";
    const volume = options.volume ?? 0.12;
    const attack = options.attack ?? 0.012;
    const release = options.release ?? 0.12;
    const t0 = ctx.currentTime + start;
    const t1 = t0 + duration;

    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (options.to) osc.frequency.exponentialRampToValueAtTime(options.to, t1);

    filter.type = options.filterType || "lowpass";
    filter.frequency.setValueAtTime(options.filter ?? 4200, t0);
    filter.Q.value = options.q ?? 0.8;

    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t1 + release);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(sound.master);
    osc.start(t0);
    osc.stop(t1 + release + 0.04);
  }

  function noise(start, duration, options = {}) {
    const ctx = ensureAudio();
    if (!ctx || !sound.master) return;
    const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    }
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const t0 = ctx.currentTime + start;
    src.buffer = buffer;
    filter.type = options.filterType || "bandpass";
    filter.frequency.value = options.filter ?? 5200;
    filter.Q.value = options.q ?? 2.4;
    gain.gain.setValueAtTime(options.volume ?? 0.055, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(sound.master);
    src.start(t0);
    src.stop(t0 + duration + 0.02);
  }

  const sfx = {
    toggleOn() {
      tone(523.25, 0, 0.14, { volume: 0.08, filter: 5000 });
      tone(783.99, 0.08, 0.16, { volume: 0.07, filter: 5600 });
      noise(0.02, 0.16, { volume: 0.025, filter: 6400 });
    },
    toggleOff() {
      tone(493.88, 0, 0.12, { to: 329.63, volume: 0.07, filter: 3200 });
    },
    tap() {
      tone(880, 0, 0.08, { volume: 0.055, filter: 5600 });
      noise(0, 0.08, { volume: 0.018, filter: 7200 });
    },
    listen() {
      tone(392, 0, 0.16, { to: 523.25, volume: 0.045, type: "triangle", filter: 3800 });
      noise(0.03, 0.18, { volume: 0.022, filter: 3600 });
    },
    sparkle() {
      [659.25, 783.99, 987.77, 1318.51].forEach((freq, i) => {
        tone(freq, i * 0.055, 0.13, { volume: 0.047, filter: 7200 });
      });
      noise(0.08, 0.2, { volume: 0.025, filter: 8400, q: 3.2 });
    },
    wobble() {
      tone(330, 0, 0.18, { to: 220, volume: 0.075, type: "triangle", filter: 2200 });
      tone(587.33, 0.1, 0.12, { to: 493.88, volume: 0.04, type: "sine", filter: 3800 });
    },
    error() {
      tone(277.18, 0, 0.14, { to: 246.94, volume: 0.06, type: "triangle", filter: 1800 });
      tone(369.99, 0.11, 0.12, { to: 329.63, volume: 0.045, type: "triangle", filter: 1800 });
    },
  };

  function updateSoundButton() {
    if (!soundToggle) return;
    soundToggle.classList.toggle("is-on", sound.bgmOn);
    soundToggle.setAttribute("aria-pressed", String(sound.bgmOn));
    soundToggle.setAttribute("aria-label", sound.bgmOn ? "BGMをオフにする" : "BGMをオンにする");
  }

  async function toggleBgm() {
    ensureAudio();
    sound.bgmOn = !sound.bgmOn;
    updateSoundButton();
    if (!bgmAudio) return;
    bgmAudio.volume = 0.32;
    if (sound.bgmOn) {
      try {
        await bgmAudio.play();
        sfx.toggleOn();
      } catch (err) {
        sound.bgmOn = false;
        updateSoundButton();
        sfx.error();
      }
    } else {
      bgmAudio.pause();
      sfx.toggleOff();
    }
  }

  /* mic is decorative for now — show a friendly hint, no audio capture */
  if (micBtn) {
    micBtn.addEventListener("click", (e) => {
      e.preventDefault();
      sfx.tap();
      setStatus("マイクはまだ準備中…");
      setTimeout(setIdle, 1400);
    });
  }

  if (soundToggle) {
    soundToggle.addEventListener("click", toggleBgm);
    updateSoundButton();
  }

  /* ----------------------- canvas sizing ----------------------- */
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(320, Math.round(rect.width * dpr));
    canvas.height = Math.max(320, Math.round(rect.height * dpr));
  }
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  /* ----------------------- pseudo-audio drive ----------------------- */
  const drive = {
    level: 0.14,
    target: 0.14,
    speaking: false,
    speakingUntil: 0,
    clumsyUntil: 0,
    seed: Math.random() * 1000,
  };

  function setSpeaking(ms = 2200) {
    drive.speaking = true;
    drive.target = 0.78;
    drive.speakingUntil = performance.now() + ms;
    sceneEl?.classList.add("is-speaking");
    setStatus("おしゃべり中");
  }

  function setIdle() {
    drive.speaking = false;
    drive.target = 0.18;
    sceneEl?.classList.remove("is-speaking");
    setStatus("ぼーっとしてる");
  }

  function triggerClumsy() {
    drive.clumsyUntil = performance.now() + 600;
    avatarBox.classList.add("is-clumsy");
    sfx.wobble();
    setTimeout(() => avatarBox.classList.remove("is-clumsy"), 620);
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  /* ----------------------- render loop ----------------------- */
  function wobble(t, k = 1) {
    return (
      Math.sin(t * 0.0017 * k + drive.seed) * 0.5 +
      Math.sin(t * 0.0041 * k + drive.seed * 1.7) * 0.3 +
      Math.sin(t * 0.0093 * k + drive.seed * 0.6) * 0.2
    );
  }

  // jelly-ish irregular blob: stronger harmonics → less circular, more "puni"
  function drawBlob(cx, cy, baseR, t, level, jiggle = 1) {
    const points = 128;
    const path = new Path2D();
    for (let i = 0; i <= points; i++) {
      const a = (i / points) * Math.PI * 2;
      const h =
        Math.sin(a * 3 + t * 0.0021 + drive.seed) * 0.09 * jiggle +
        Math.sin(a * 5 - t * 0.0014) * 0.06 * jiggle +
        Math.sin(a * 2 + t * 0.0009) * 0.07 * jiggle +
        Math.sin(a * 7 + t * 0.0033) * 0.035 * jiggle;
      const breath = Math.sin(t * 0.0024 + drive.seed * 0.3) * 0.05;
      const reactive = h * (0.6 + level * 1.6) + breath;
      const r = baseR * (1 + reactive + level * 0.2);
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    }
    path.closePath();
    return path;
  }

  function tick(t) {
    drive.level += (drive.target - drive.level) * 0.08;

    if (drive.speaking && t > drive.speakingUntil) {
      setIdle();
    }

    if (!drive.speaking && Math.random() < 0.0009 && t > drive.clumsyUntil) {
      triggerClumsy();
      drive.target = 0.42;
      setTimeout(() => {
        if (!drive.speaking) drive.target = 0.18;
      }, 380);
    }

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2 + wobble(t, 1.0) * w * 0.05;
    const cy = h / 2 + wobble(t, 0.7) * h * 0.04 + 4;
    const baseR = Math.min(w, h) * 0.28;

    // --- outer warm halo
    const haloGrad = ctx.createRadialGradient(cx, cy, baseR * 0.4, cx, cy, baseR * 2.2);
    haloGrad.addColorStop(0, "rgba(255, 230, 200, 0.55)");
    haloGrad.addColorStop(0.45, "rgba(255, 200, 150, 0.18)");
    haloGrad.addColorStop(1, "rgba(255, 220, 235, 0)");
    ctx.fillStyle = haloGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, baseR * 2.2 * (1 + drive.level * 0.1), 0, Math.PI * 2);
    ctx.fill();

    // --- back diffuse blob (aqua tint, larger & blurry, slightly offset)
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const back = drawBlob(cx + 10, cy + 6, baseR * 1.14, t * 0.7, drive.level * 0.7, 1.2);
    const backGrad = ctx.createRadialGradient(cx, cy, baseR * 0.2, cx, cy, baseR * 1.5);
    backGrad.addColorStop(0, "rgba(220, 240, 255, 0.85)");
    backGrad.addColorStop(0.5, "rgba(180, 220, 255, 0.5)");
    backGrad.addColorStop(1, "rgba(194, 234, 255, 0)");
    ctx.fillStyle = backGrad;
    ctx.filter = "blur(22px)";
    ctx.fill(back);
    ctx.filter = "none";
    ctx.restore();

    // --- mid lemon blob
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const mid = drawBlob(cx - 4, cy - 2, baseR * 1.0, t, drive.level, 1.05);
    const midGrad = ctx.createRadialGradient(cx - 22, cy - 30, baseR * 0.1, cx, cy, baseR * 1.25);
    midGrad.addColorStop(0, "rgba(255, 255, 255, 1)");
    midGrad.addColorStop(0.32, "rgba(255, 241, 183, 0.95)"); // lemon
    midGrad.addColorStop(0.7, "rgba(255, 212, 194, 0.75)");  // peach
    midGrad.addColorStop(1, "rgba(255, 200, 220, 0)");
    ctx.fillStyle = midGrad;
    ctx.filter = "blur(8px)";
    ctx.fill(mid);
    ctx.filter = "none";
    ctx.restore();

    // --- front jelly body (sharper edge for "ぷに" feel)
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const front = drawBlob(cx, cy, baseR * 0.82, t * 1.3, drive.level, 0.85);
    const frontGrad = ctx.createRadialGradient(
      cx - baseR * 0.25,
      cy - baseR * 0.3,
      baseR * 0.05,
      cx,
      cy,
      baseR
    );
    frontGrad.addColorStop(0, "rgba(255, 255, 255, 1)");
    frontGrad.addColorStop(0.4, "rgba(255, 235, 210, 0.95)");
    frontGrad.addColorStop(0.8, "rgba(255, 200, 220, 0.55)");
    frontGrad.addColorStop(1, "rgba(255, 180, 207, 0)");
    ctx.fillStyle = frontGrad;
    ctx.filter = "blur(3px)";
    ctx.fill(front);
    ctx.filter = "none";
    ctx.restore();

    // --- crisp core highlight
    const coreR = baseR * (0.22 + drive.level * 0.14);
    const coreGrad = ctx.createRadialGradient(
      cx - coreR * 0.4,
      cy - coreR * 0.5,
      coreR * 0.05,
      cx,
      cy,
      coreR
    );
    coreGrad.addColorStop(0, "rgba(255, 255, 255, 1)");
    coreGrad.addColorStop(0.5, "rgba(255, 245, 225, 0.95)");
    coreGrad.addColorStop(1, "rgba(255, 220, 230, 0)");
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
    ctx.fill();

    // --- tiny dancing sparkles around the blob
    const sparkles = 18;
    for (let i = 0; i < sparkles; i++) {
      const a = (i / sparkles) * Math.PI * 2 + t * 0.0006;
      const r =
        baseR * (1.08 + Math.sin(t * 0.003 + i) * 0.05) +
        drive.level * baseR * 0.4 * Math.sin(t * 0.004 + i * 1.3);
      const sx = cx + Math.cos(a) * r;
      const sy = cy + Math.sin(a) * r;
      const sr = 1.0 + Math.abs(Math.sin(t * 0.005 + i)) * 2.6 * (0.4 + drive.level);
      const tint =
        i % 3 === 0
          ? `rgba(255, 235, 200, ${0.45 + drive.level * 0.5})`
          : i % 3 === 1
          ? `rgba(220, 240, 255, ${0.45 + drive.level * 0.5})`
          : `rgba(255, 220, 230, ${0.45 + drive.level * 0.5})`;
      ctx.beginPath();
      ctx.fillStyle = tint;
      ctx.arc(sx, sy, sr * dpr, 0, Math.PI * 2);
      ctx.fill();
    }

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  /* ----------------------- subtitle plumbing ----------------------- */
  const FALLBACK_LINES = [
    "あっ、ごめんね。バックエンドさんが、いま、お昼寝中みたい。",
    "うーん、上手く繋がらなかった…でも、わたしはここにいるよ。",
    "ふわ〜、電波ちょっと弱いかも。代わりにわたしが喋っちゃうね。",
    "そのお話、もうちょっと聞かせてほしいな。…って繋がってないのに偉そう、ごめん。",
    "（こてっ）あれ？通信、こけちゃった。だいじょうぶ、立て直すね。",
    "光ってるだけで賢く見られがちなんだけど、実はけっこうドジなの。",
  ];

  function pickFallback(message) {
    const seed = (message || "").length + Date.now();
    return FALLBACK_LINES[seed % FALLBACK_LINES.length];
  }

  function setSubtitle(text, source) {
    subtitleEl.classList.add("is-swapping");
    setTimeout(() => {
      subtitleEl.textContent = text;
      subtitleEl.classList.remove("is-swapping");
    }, 180);
    sourceEl.textContent = source;
    sourceEl.dataset.state =
      source === "api"
        ? "ok"
        : source === "fallback"
        ? "fallback"
        : source === "error"
        ? "error"
        : "";
    const approxMs = Math.max(1800, Math.min(8000, text.length * 90));
    setSpeaking(approxMs);
  }

  async function askDialogue(message) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch("/api/dialogue", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ message }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      const reply =
        (typeof data?.reply?.subtitle === "string" && data.reply.subtitle) ||
        (typeof data?.subtitle === "string" && data.subtitle) ||
        (typeof data?.reply === "string" && data.reply) ||
        (typeof data?.text === "string" && data.text);
      if (!reply) throw new Error("no subtitle field");
      return {
        reply,
        source: "api",
        status: data?.reply?.status,
        motion: data?.reply?.motion,
      };
    } catch (err) {
      clearTimeout(timeout);
      return { reply: pickFallback(message), source: "fallback", motion: "bounce-slip" };
    }
  }

  /* ----------------------- form ----------------------- */
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const message = input.value.trim();
    if (!message) return;
    sendBtn.disabled = true;
    sfx.tap();
    sfx.listen();
    setStatus("聞いてる…");
    drive.target = 0.34;

    setSubtitle("（ふむふむ、聞いてる…）", "thinking");

    const { reply, source, status, motion } = await askDialogue(message);
    if (status) setStatus(status);
    if (motion && motion.includes("slip")) triggerClumsy();
    if (source === "api") sfx.sparkle();
    else sfx.error();
    setSubtitle(reply, source);
    input.value = "";
    sendBtn.disabled = false;
    input.focus();
  });

  // tiny welcome wobble after first paint
  setTimeout(() => {
    setSpeaking(2200);
  }, 600);
})();
