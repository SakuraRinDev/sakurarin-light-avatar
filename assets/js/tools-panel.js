(() => {
  const panel = document.getElementById("tools-panel");
  const toggle = document.getElementById("tools-toggle");
  const closeBtn = document.getElementById("tools-close");
  const skillsList = document.getElementById("skills-list");
  const mcpList = document.getElementById("mcp-list");

  if (!panel || !toggle || !closeBtn || !skillsList || !mcpList) return;

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function renderItems(target, items, emptyText) {
    if (!items.length) {
      target.innerHTML = `<p class="tools-panel__empty">${escapeHtml(emptyText)}</p>`;
      return;
    }
    target.innerHTML = items
      .map(
        (item) => `
          <article class="tool-card">
            <strong>${escapeHtml(item.title || item.name || item.id)}</strong>
            <span>${escapeHtml(item.id || item.name)}</span>
            <p>${escapeHtml(item.summary || item.description || "")}</p>
          </article>
        `,
      )
      .join("");
  }

  async function loadTools() {
    skillsList.innerHTML = '<p class="tools-panel__empty">読み込み中...</p>';
    mcpList.innerHTML = '<p class="tools-panel__empty">読み込み中...</p>';
    try {
      const [skillsRes, mcpRes] = await Promise.all([
        fetch("/api/skills", { headers: { accept: "application/json" } }),
        fetch("/api/mcp", { headers: { accept: "application/json" } }),
      ]);
      const [skills, mcp] = await Promise.all([skillsRes.json(), mcpRes.json()]);
      if (!skillsRes.ok || !skills.ok) throw new Error("skills failed");
      if (!mcpRes.ok || !mcp.ok) throw new Error("mcp failed");
      renderItems(skillsList, skills.skills || [], "スキルがありません。");
      renderItems(mcpList, mcp.tools || [], "MCPツールがありません。");
    } catch {
      skillsList.innerHTML = '<p class="tools-panel__empty">読み込みでこけました。</p>';
      mcpList.innerHTML = '<p class="tools-panel__empty">もう一回開いてみて。</p>';
    }
  }

  function setOpen(open) {
    panel.classList.toggle("is-open", open);
    panel.setAttribute("aria-hidden", open ? "false" : "true");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      loadTools();
      setTimeout(() => closeBtn.focus(), 20);
    } else {
      toggle.focus();
    }
  }

  toggle.addEventListener("click", () => setOpen(true));
  closeBtn.addEventListener("click", () => setOpen(false));
  panel.addEventListener("click", (event) => {
    if (event.target === panel) setOpen(false);
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && panel.classList.contains("is-open")) setOpen(false);
  });
})();
