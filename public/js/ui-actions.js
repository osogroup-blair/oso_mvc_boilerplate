// Explicit delegated actions: no eval or executable data attributes.
document.addEventListener("submit", event => {
  const message = event.target.dataset.confirm;
  if (message && !window.confirm(message)) event.preventDefault();
});
document.addEventListener("change", event => {
  if (event.target.matches("[data-auto-submit]")) event.target.form.requestSubmit();
});
document.addEventListener("input", event => {
  const input = event.target;
  if (!input.matches("[data-relation-input]")) return;
  const option = Array.from(input.list?.options ?? []).find(item => item.dataset.label === input.value);
  const target = document.getElementsByName(input.dataset.relationTarget)[0];
  if (target) target.value = option?.dataset.id ?? "";
});
document.addEventListener("click", async event => {
  const target = event.target.closest("button, a, [data-sidebar]");
  if (!target) return;
  if (target.dataset.modalOpen) document.getElementById(target.dataset.modalOpen)?.classList.remove("hidden");
  if (target.dataset.modalClose) document.getElementById(target.dataset.modalClose)?.classList.add("hidden");
  if (target.dataset.tab) window.switchTab?.(target.dataset.tab);
  if (target.dataset.checkAll) window.setAllChecked?.(target.dataset.checkAll === "true");
  if (target.dataset.sidebar === "open") window.openSidebar?.();
  if (target.dataset.sidebar === "close") window.closeSidebar?.();
  if (target.hasAttribute("data-remove-row")) target.closest("tr")?.remove();
  if (target.hasAttribute("data-remove-item")) target.closest("[data-item]")?.remove();
  if (target.dataset.copyUrl) {
    try { await navigator.clipboard.writeText(new URL(target.dataset.copyUrl, location.origin).href); window.alert("URL copied!"); }
    catch { window.alert("Copy failed. Select the file link to copy its address."); }
  }
});
