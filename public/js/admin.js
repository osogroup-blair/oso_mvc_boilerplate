// Client-side behavior for the schema-driven admin forms.
// Handles: adding rows to array-of-object tables, adding items to primitive arrays.
// Everything else is native HTML (datalist relations, standard inputs).
(function () {
  "use strict";

  // ── Array of objects: add a row by cloning the <template> ──
  document.addEventListener("click", function (e) {
    const addRowBtn = e.target.closest("[data-add-row]");
    if (addRowBtn) {
      const wrapper = addRowBtn.closest("div").parentElement;
      const table = wrapper.querySelector("[data-array-table]");
      const tpl = table.querySelector("template");
      const tbody = table.querySelector("tbody");
      const index = tbody.querySelectorAll("[data-row]").length;
      // Replace the __i__ placeholder with the real row index.
      const html = tpl.innerHTML.replace(/__i__/g, String(index));
      tbody.insertAdjacentHTML("beforeend", html);
      return;
    }

    // ── Array of primitives: add an input ──
    const addItemBtn = e.target.closest("[data-add-item]");
    if (addItemBtn) {
      const wrapper = addItemBtn.closest("[data-array-primitive]");
      const items = wrapper.querySelector("[data-items]");
      const name = wrapper.dataset.name;
      const type = wrapper.dataset.inputType || "text";
      const index = items.querySelectorAll("[data-item]").length;
      const row = document.createElement("div");
      row.className = "flex gap-2 mb-1";
      row.setAttribute("data-item", "");
      row.innerHTML =
        '<input type="' + type + '" name="' + name + "[" + index + ']" ' +
        'class="flex-1 rounded border border-gray-300 px-3 py-2 text-sm" />' +
        '<button type="button" class="text-red-500 text-xs">×</button>';
      row.querySelector("button").addEventListener("click", function () {
        row.remove();
      });
      items.appendChild(row);
      return;
    }
  });
})();
