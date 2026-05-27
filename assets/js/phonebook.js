(() => {
  const panel = document.getElementById("phonebook");
  const toggle = document.getElementById("phonebook-toggle");
  const closeBtn = document.getElementById("phonebook-close");
  const list = document.getElementById("phonebook-list");
  let loaded = false;

  if (!panel || !toggle || !closeBtn || !list) return;

  function setOpen(open) {
    panel.classList.toggle("is-open", open);
    panel.setAttribute("aria-hidden", open ? "false" : "true");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      loadContacts();
      setTimeout(() => closeBtn.focus(), 20);
    } else {
      toggle.focus();
    }
  }

  function contactInitial(name) {
    return String(name || "?").trim().slice(0, 1).toUpperCase();
  }

  function renderContact(contact) {
    const tags = (contact.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");
    const phoneNote = contact.phoneMeta?.valid ? "" : "Demo";
    return `
      <article class="contact-card">
        <div class="contact-card__avatar" aria-hidden="true">${escapeHtml(contactInitial(contact.name))}</div>
        <div class="contact-card__body">
          <div class="contact-card__top">
            <div>
              <h3>${escapeHtml(contact.name)}</h3>
              <p>${escapeHtml(contact.organization)} / ${escapeHtml(contact.title)}</p>
            </div>
            ${contact.favorite ? '<span class="contact-card__fav">Fav</span>' : ""}
          </div>
          <dl class="contact-card__meta">
            <div><dt>TEL</dt><dd>${escapeHtml(contact.displayPhone)} ${phoneNote ? `<small>${phoneNote}</small>` : ""}</dd></div>
            <div><dt>MAIL</dt><dd>${escapeHtml(contact.email)}</dd></div>
            <div><dt>TIME</dt><dd>${escapeHtml(contact.hours)}</dd></div>
          </dl>
          <p class="contact-card__note">${escapeHtml(contact.note)}</p>
          <div class="contact-card__tags">${tags}</div>
          <div class="contact-card__actions">
            <a class="contact-card__call" href="${escapeAttr(contact.telHref)}" aria-label="${escapeAttr(contact.name)}に電話する">電話</a>
            <a class="contact-card__mail" href="mailto:${escapeAttr(contact.email)}" aria-label="${escapeAttr(contact.name)}にメールする">メール</a>
          </div>
        </div>
      </article>
    `;
  }

  async function loadContacts() {
    if (loaded) return;
    list.innerHTML = '<p class="phonebook__loading">読み込み中…</p>';
    try {
      const res = await fetch("/api/contacts", { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      list.innerHTML = (data.contacts || []).map(renderContact).join("");
      loaded = true;
    } catch {
      list.innerHTML = '<p class="phonebook__loading">電話帳を読み込めませんでした。</p>';
    }
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[char]);
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
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
