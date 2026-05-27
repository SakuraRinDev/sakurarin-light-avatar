(() => {
  const panel = document.getElementById("feedback-panel");
  const toggle = document.getElementById("feedback-toggle");
  const closeBtn = document.getElementById("feedback-close");
  const form = document.getElementById("feedback-form");
  const category = document.getElementById("feedback-category");
  const message = document.getElementById("feedback-message");
  const status = document.getElementById("feedback-status");
  const submit = document.getElementById("feedback-submit");

  if (!panel || !toggle || !closeBtn || !form || !category || !message || !status || !submit) return;

  function setOpen(open) {
    panel.classList.toggle("is-open", open);
    panel.setAttribute("aria-hidden", open ? "false" : "true");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      status.textContent = "";
      setTimeout(() => message.focus(), 20);
    } else {
      toggle.focus();
    }
  }

  async function submitFeedback(event) {
    event.preventDefault();
    const text = message.value.trim();
    if (text.length < 2) {
      status.textContent = "もう少しだけ書いてね。";
      return;
    }

    submit.disabled = true;
    status.textContent = "送信中…";
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          category: category.value,
          message: text,
          page: location.href,
          sessionId: window.PokaSessionId || "",
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || `status ${response.status}`);
      status.textContent = "届いたよ。ありがとう。";
      form.reset();
      setTimeout(() => setOpen(false), 900);
    } catch {
      status.textContent = "送信でこけました。もう一回だけお願い。";
    } finally {
      submit.disabled = false;
    }
  }

  toggle.addEventListener("click", () => setOpen(true));
  closeBtn.addEventListener("click", () => setOpen(false));
  form.addEventListener("submit", submitFeedback);
  panel.addEventListener("click", (event) => {
    if (event.target === panel) setOpen(false);
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && panel.classList.contains("is-open")) setOpen(false);
  });
})();
