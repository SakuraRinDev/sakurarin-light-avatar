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
  const skillEl = document.getElementById("skill-label");
  const statusEl = document.getElementById("status-label");
  const avatarBox = document.getElementById("avatar");
  const sceneEl = document.querySelector(".scene");
  const form = document.getElementById("compose");
  const input = document.getElementById("compose-input");
  const sendBtn = document.getElementById("compose-send");
  const soundToggle = document.getElementById("sound-toggle");
  const locationToggle = document.getElementById("location-toggle");
  const bgmAudio = document.getElementById("bgm-audio");
  const audio = window.PokaAudio?.createAudioController({ toggle: soundToggle, bgm: bgmAudio });
  const sfx = audio?.sfx || {};
  window.PokaSessionId = window.PokaSessionId || `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  if (soundToggle) {
    audio?.init();
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
    setStatus("出番待ち");
  }

  function triggerClumsy() {
    drive.clumsyUntil = performance.now() + 600;
    avatarBox.classList.add("is-clumsy");
    sfx.wobble?.();
    setTimeout(() => avatarBox.classList.remove("is-clumsy"), 620);
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function roundCoord(value) {
    return Math.round(Number(value) * 1000) / 1000;
  }

  function setLocationState(location) {
    window.PokaLocation = location || null;
    if (!locationToggle) return;
    locationToggle.classList.toggle("is-on", Boolean(location));
    locationToggle.setAttribute("aria-pressed", location ? "true" : "false");
  }

  locationToggle?.addEventListener("click", () => {
    if (window.PokaLocation) {
      setLocationState(null);
      setStatus("現在地オフ");
      sfx.tap?.();
      return;
    }
    if (!navigator.geolocation) {
      setStatus("位置情報なし");
      setSubtitle("この端末では現在地が使えないみたい。こてっ。", "fallback");
      sfx.error?.();
      return;
    }
    locationToggle.disabled = true;
    setStatus("現在地確認中…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords = position.coords || {};
        setLocationState({
          latitude: roundCoord(coords.latitude),
          longitude: roundCoord(coords.longitude),
          accuracy: Math.round(Number(coords.accuracy || 0)),
          capturedAt: new Date().toISOString(),
        });
        locationToggle.disabled = false;
        setStatus("現在地オン");
        sfx.sparkle?.();
      },
      () => {
        setLocationState(null);
        locationToggle.disabled = false;
        setStatus("現在地オフ");
        setSubtitle("現在地の許可が取れなかったみたい。ポカ、ちょっと迷子です。", "fallback");
        sfx.error?.();
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
    );
  });

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
        : source === "search"
        ? "search"
        : source === "fallback"
        ? "fallback"
        : source === "error"
        ? "error"
        : "";
    const approxMs = Math.max(1800, Math.min(8000, text.length * 90));
    setSpeaking(approxMs);
  }

  function setSkill(skill) {
    if (!skillEl) return;
    skillEl.textContent = skill?.id ? `skill:${skill.id}` : "";
  }

  /* ----------------------- form ----------------------- */
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const message = input.value.trim();
    if (!message) return;
    sendBtn.disabled = true;
    sfx.tap?.();
    sfx.listen?.();
    setStatus("聞いてる…");
    drive.target = 0.34;

    setSubtitle("（ふむふむ、聞いてる…）", "thinking");

    const { reply, source, status, motion, skill } = await window.PokaDialogue.ask(message, window.PokaSessionId, {
      location: window.PokaLocation || null,
    });
    if (status) setStatus(status);
    if (motion && motion.includes("slip")) triggerClumsy();
    if (source === "api") sfx.sparkle?.();
    else sfx.error?.();
    setSkill(skill);
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
