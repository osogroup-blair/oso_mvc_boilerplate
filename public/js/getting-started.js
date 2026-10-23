(() => {
  const announce = message => { document.getElementById("guide-status").textContent = message; };
  for (const button of document.querySelectorAll("[data-copy]")) {
    button.hidden = false;
    button.addEventListener("click", async () => {
      const command = document.getElementById(button.dataset.copy).textContent;
      try {
        if (!navigator.clipboard) throw Error("Clipboard unavailable");
        await navigator.clipboard.writeText(command);
        button.textContent = "Copied!";
        announce("Copied to clipboard.");
        setTimeout(() => { button.textContent = "Copy"; }, 1800);
      } catch { announce("Clipboard access is unavailable. Select the command text and copy it manually."); }
    });
  }
  const cards = [...document.querySelectorAll("[data-feature]")];
  const toolbar = document.querySelector("[data-feature-toolbar]");
  const count = document.getElementById("feature-count");
  const search = document.getElementById("feature-search");
  let category = "all";
  const filter = () => {
    const term = search.value.trim().toLowerCase();
    let visible = 0;
    for (const card of cards) {
      const matches = (category === "all" || card.dataset.category === category) && card.textContent.toLowerCase().includes(term);
      card.hidden = !matches;
      if (matches) visible++;
    }
    document.getElementById("no-features").hidden = visible > 0;
    count.textContent = `${visible} ${visible === 1 ? "feature" : "features"} to build on`;
  };
  toolbar.hidden = false; count.hidden = false;
  search.addEventListener("input", filter);
  for (const button of toolbar.querySelectorAll("[data-filter]")) button.addEventListener("click", () => {
    category = button.dataset.filter;
    for (const other of toolbar.querySelectorAll("[data-filter]")) other.setAttribute("aria-pressed", String(other === button));
    filter();
  });
  const key = "mvc-boilerplate-implementation-v1";
  const boxes = [...document.querySelectorAll("[data-check]")];
  let saved = [];
  try { const value = JSON.parse(localStorage.getItem(key) || "[]"); if (Array.isArray(value)) saved = value; } catch { /* Storage is an optional enhancement. */ }
  for (const box of boxes) box.checked = saved.includes(box.dataset.check);
  const progress = () => {
    const done = boxes.filter(box => box.checked);
    document.getElementById("progress-text").textContent = `${done.length} of ${boxes.length} complete`;
    document.getElementById("progress-fill").style.width = `${done.length / boxes.length * 100}%`;
    document.querySelector('[role="progressbar"]').setAttribute("aria-valuenow", String(done.length));
    try { localStorage.setItem(key, JSON.stringify(done.map(box => box.dataset.check))); }
    catch { document.querySelector(".progress-note").textContent = "Progress is available for this visit; browser storage is unavailable."; }
  };
  document.querySelector("[data-progress]").hidden = false;
  for (const box of boxes) box.addEventListener("change", progress);
  document.querySelector(".reset-progress").addEventListener("click", () => { for (const box of boxes) box.checked = false; progress(); announce("Implementation checklist reset."); });
  progress();
})();
