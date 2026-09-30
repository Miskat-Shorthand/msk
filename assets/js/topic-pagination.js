(function () {
  var PAGE_SIZE = 12;
  var currentPage = 1;
  function rows() {
    return Array.prototype.slice.call(document.querySelectorAll(".topic-directory .topic-row"));
  }
  function totalPages() {
    var n = rows().length;
    return Math.max(1, Math.ceil(n / PAGE_SIZE));
  }
  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    if (attrs)
      Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text != null)
      e.textContent = text;
    return e;
  }
  function paginationRange(current, total) {
    var delta = 1;
    var range = [];
    for (var i = 1; i <= total; i++) {
      if (i === 1 || i === total || (i >= current - delta && i <= current + delta))
        range.push(i);
    }
    var withDots = [];
    var prev = null;
    range.forEach(function (p) {
      if (prev !== null && p - prev > 1)
        withDots.push("…");
      withDots.push(p);
      prev = p;
    });
    return withDots;
  }
  function renderPage() {
    var list = rows();
    var total = totalPages();
    if (currentPage > total)
      currentPage = total;
    if (currentPage < 1)
      currentPage = 1;
    var start = (currentPage - 1) * PAGE_SIZE;
    var end = start + PAGE_SIZE;
    list.forEach(function (row, idx) {
      row.hidden = !(idx >= start && idx < end);
    });
    renderControls(total);
  }
  function goToPage(p) {
    currentPage = p;
    renderPage();
    var heading = document.querySelector('[data-i18n="index.dir.heading"]');
    if (heading)
      heading.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function renderControls(total) {
    var wrap = document.getElementById("topicDirectoryPagination");
    if (!wrap)
      return;
    wrap.innerHTML = "";
    if (total <= 1)
      return;
    var prev = el("button", { class: "page-btn", "aria-label": "Previous page" }, "\u2039");
    if (currentPage <= 1)
      prev.disabled = true;
    prev.addEventListener("click", function () { if (currentPage > 1)
      goToPage(currentPage - 1); });
    wrap.appendChild(prev);
    paginationRange(currentPage, total).forEach(function (p) {
      if (p === "…") {
        wrap.appendChild(el("span", { class: "page-ellipsis" }, "…"));
        return;
      }
      var btn = el("button", { class: "page-btn" + (p === currentPage ? " active" : "") }, String(p));
      if (p !== currentPage)
        btn.addEventListener("click", function () { goToPage(p); });
      wrap.appendChild(btn);
    });
    var next = el("button", { class: "page-btn", "aria-label": "Next page" }, "\u203a");
    if (currentPage >= total)
      next.disabled = true;
    next.addEventListener("click", function () { if (currentPage < total)
      goToPage(currentPage + 1); });
    wrap.appendChild(next);
  }
  document.addEventListener("DOMContentLoaded", renderPage);
})();
