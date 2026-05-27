(() => {
  const INITIAL_BGM_ON = true;

  function createAudioController({ toggle, bgm }) {
    const state = {
      ctx: null,
      master: null,
      bgmOn: INITIAL_BGM_ON,
      bgmStarted: false,
    };

    function ensureAudio() {
      if (!state.ctx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return null;
        state.ctx = new AudioContext();
        state.master = state.ctx.createGain();
        state.master.gain.value = 0.26;
        state.master.connect(state.ctx.destination);
      }
      if (state.ctx.state === "suspended") state.ctx.resume();
      return state.ctx;
    }

    function tone(freq, start, duration, options = {}) {
      const ctx = ensureAudio();
      if (!ctx || !state.master) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      const t0 = ctx.currentTime + start;
      const t1 = t0 + duration;

      osc.type = options.type || "sine";
      osc.frequency.setValueAtTime(freq, t0);
      if (options.to) osc.frequency.exponentialRampToValueAtTime(options.to, t1);

      filter.type = options.filterType || "lowpass";
      filter.frequency.setValueAtTime(options.filter ?? 4200, t0);
      filter.Q.value = options.q ?? 0.8;

      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(options.volume ?? 0.12, t0 + (options.attack ?? 0.012));
      gain.gain.exponentialRampToValueAtTime(0.0001, t1 + (options.release ?? 0.12));

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(state.master);
      osc.start(t0);
      osc.stop(t1 + (options.release ?? 0.12) + 0.04);
    }

    function noise(start, duration, options = {}) {
      const ctx = ensureAudio();
      if (!ctx || !state.master) return;
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
      gain.connect(state.master);
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
        tone(587.33, 0.1, 0.12, { to: 493.88, volume: 0.04, filter: 3800 });
      },
      error() {
        tone(277.18, 0, 0.14, { to: 246.94, volume: 0.06, type: "triangle", filter: 1800 });
        tone(369.99, 0.11, 0.12, { to: 329.63, volume: 0.045, type: "triangle", filter: 1800 });
      },
    };

    function updateToggle() {
      if (!toggle) return;
      toggle.classList.toggle("is-on", state.bgmOn);
      toggle.setAttribute("aria-pressed", String(state.bgmOn));
      toggle.setAttribute("aria-label", state.bgmOn ? "BGMをオフにする" : "BGMをオンにする");
    }

    async function playBgm({ withSfx = false } = {}) {
      if (!bgm || !state.bgmOn) return false;
      bgm.volume = 0.32;
      try {
        await bgm.play();
        state.bgmStarted = true;
        if (withSfx) sfx.toggleOn();
        return true;
      } catch {
        state.bgmStarted = false;
        return false;
      }
    }

    function pauseBgm() {
      if (bgm) bgm.pause();
      state.bgmStarted = false;
    }

    function startOnUserGesture() {
      if (state.bgmOn && !state.bgmStarted) playBgm();
    }

    function init() {
      updateToggle();
      if (toggle) {
        toggle.addEventListener("click", async () => {
          ensureAudio();
          state.bgmOn = !state.bgmOn;
          updateToggle();
          if (state.bgmOn) {
            const started = await playBgm({ withSfx: true });
            if (!started) sfx.error();
          } else {
            pauseBgm();
            sfx.toggleOff();
          }
        });
      }
      playBgm();
      ["pointerdown", "keydown", "touchstart"].forEach((eventName) => {
        window.addEventListener(eventName, startOnUserGesture, { passive: true });
      });
    }

    return { init, sfx, state, playBgm };
  }

  window.PokaAudio = { createAudioController };
})();
