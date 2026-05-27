(() => {
  const FALLBACK_LINES = [
    "あっ、ごめんね。公式通信がいま、ふわっと迷子です。",
    "うーん、上手く繋がらなかった…でもポカはここで光ってます。",
    "電波が少しすべったかも。代わりにポカが案内します。",
    "そのお話、もうちょっと聞かせて。あ、通信こけたのに言っちゃった。",
    "（こてっ）通信、ころびました。だいじょうぶ、光は消えてません。",
    "公式キャラっぽく返したいのに、いま少しだけ光りすぎました。",
  ];

  function pickFallback(message) {
    const seed = (message || "").length + Date.now();
    return FALLBACK_LINES[seed % FALLBACK_LINES.length];
  }

  async function ask(message) {
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
    } catch {
      clearTimeout(timeout);
      return { reply: pickFallback(message), source: "fallback", motion: "bounce-slip" };
    }
  }

  window.PokaDialogue = { ask };
})();
