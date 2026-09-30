(function () {
  var DATA_URL = "assets/data/strokes.json";
  var POS_ORDER = ["normal", "initial", "medial", "final"];
  var state = { groups: [], query: "", activeGroup: "" };
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs)
      Object.keys(attrs).forEach(function (k) {
        if (k === "text")
          e.textContent = attrs[k];
        else if (k === "html")
          e.innerHTML = attrs[k];
        else
          e.setAttribute(k, attrs[k]);
      });
    (children || []).forEach(function (c) { if (c)
      e.appendChild(c); });
    return e;
  }
  function t(key, fallback) {
    if (window.i18n && window.i18n.t) {
      var val = window.i18n.t(key);
      return (val === key) ? fallback : val;
    }
    return fallback;
  }
  function groupLabel(group) {
    var lang = (window.i18n && window.i18n.lang) ? window.i18n.lang() : "en";
    return (group.label && (group.label[lang] || group.label.en)) || group.id;
  }
  function posLabel(pos) {
    if (!pos)
      return "";
    return t("stroke.pos." + pos, pos.charAt(0).toUpperCase() + pos.slice(1));
  }
  function formsCountLabel(count) {
    var key = count === 1 ? "stroke.card.form" : "stroke.card.forms";
    var fallback = count === 1 ? "{n} form" : "{n} forms";
    return t(key, fallback).replace("{n}", String(count));
  }
  function sortAndLabelForms(forms) {
    var sorted = forms.slice().sort(function (a, b) {
      var ai = POS_ORDER.indexOf(a.pos || "");
      var bi = POS_ORDER.indexOf(b.pos || "");
      if (ai === -1 && bi === -1)
        return 0;
      if (ai === -1)
        return 1;
      if (bi === -1)
        return -1;
      return ai - bi;
    });
    var counts = {};
    sorted.forEach(function (f) {
      var key = f.pos || "";
      counts[key] = (counts[key] || 0) + 1;
    });
    var seen = {};
    return sorted.map(function (f) {
      var key = f.pos || "";
      seen[key] = (seen[key] || 0) + 1;
      var label;
      if (f.pos) {
        label = counts[key] > 1 ? posLabel(f.pos) + " " + seen[key] : posLabel(f.pos);
      }
      else {
        label = t("stroke.form.n", "Form {n}").replace("{n}", String(seen[key]));
      }
      return { form: f, label: label };
    });
  }
  function findNormalForm(forms) {
    for (var i = 0; i < forms.length; i++) {
      if (forms[i].pos === "normal")
        return forms[i];
    }
    return null;
  }
  function imageBox(form, label, extraCls) {
    var cls = "stroke-form-img" + (extraCls ? " " + extraCls : "");
    if (form && form.img) {
      var img = el("img", { src: form.img, alt: label, loading: "lazy" });
      img.addEventListener("error", function () {
        img.replaceWith(el("span", { class: "stroke-noimage-text", text: t("stroke.noimage", "No image yet") }));
      });
      return el("div", { class: cls }, [img]);
    }
    return el("div", { class: cls + " stroke-form-img--empty" }, [
      el("span", { class: "stroke-noimage-text", text: t("stroke.noimage", "No image yet") })
    ]);
  }
  function itemNotesText(item) {
    var lang = (window.i18n && window.i18n.lang) ? window.i18n.lang() : "en";
    var n = item.notes || {};
    return (n[lang] || n.en || n.id || "").trim();
  }
  function itemTile(item) {
    var forms = item.forms || [];
    var countText = formsCountLabel(forms.length);
    var children = [
      el("span", { class: "stroke-tile-label", text: item.label }),
      imageBox(findNormalForm(forms), item.label)
    ];
    if (forms.length > 1) {
      children.push(el("span", { class: "stroke-tile-caption", text: countText }));
    }
    var btn = el("button", {
      class: "stroke-tile",
      type: "button",
      "aria-haspopup": "dialog",
      "aria-label": item.label + " — " + countText
    }, children);
    btn.addEventListener("click", function () { openDetailModal(item); });
    return btn;
  }
  var modalLastFocused = null;
  function ensureModal() {
    if (document.getElementById("strokeModalBackdrop"))
      return;
    var closeBtn = el("button", {
      class: "stroke-modal-close",
      id: "strokeModalClose",
      type: "button",
      "aria-label": t("stroke.modal.close", "Close"),
      html: "&times;"
    });
    var head = el("div", { class: "stroke-modal-head" }, [
      el("h3", { class: "stroke-modal-title", id: "strokeModalTitle" }),
      closeBtn
    ]);
    var forms = el("div", { class: "stroke-modal-forms", id: "strokeModalForms" });
    var notes = el("p", { class: "stroke-modal-notes", id: "strokeModalNotes" });
    var modal = el("div", {
      class: "stroke-modal",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "strokeModalTitle"
    }, [head, forms, notes]);
    var backdrop = el("div", { class: "stroke-modal-backdrop", id: "strokeModalBackdrop" }, [modal]);
    backdrop.addEventListener("click", function (e) { if (e.target === backdrop)
      closeDetailModal(); });
    closeBtn.addEventListener("click", closeDetailModal);
    document.body.appendChild(backdrop);
  }
  function modalFormEntry(entry) {
    var form = entry.form, label = entry.label;
    var box = imageBox(form, label, "stroke-form-img--big");
    if (form.img) {
      box.classList.add("stroke-zoomable");
      box.setAttribute("role", "button");
      box.setAttribute("tabindex", "0");
      box.setAttribute("aria-label", t("stroke.modal.zoom", "Enlarge") + " — " + label);
      var open = function () { openLightbox(form.img, label); };
      box.addEventListener("click", open);
      box.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      });
    }
    return el("div", { class: "stroke-modal-form" }, [
      box,
      el("span", { class: "stroke-modal-form-label", text: label })
    ]);
  }
  function openDetailModal(item) {
    ensureModal();
    var backdrop = document.getElementById("strokeModalBackdrop");
    document.getElementById("strokeModalTitle").textContent = item.label;
    var formsWrap = document.getElementById("strokeModalForms");
    formsWrap.innerHTML = "";
    sortAndLabelForms(item.forms || []).forEach(function (entry) {
      formsWrap.appendChild(modalFormEntry(entry));
    });
    var notesEl = document.getElementById("strokeModalNotes");
    var notesText = itemNotesText(item);
    notesEl.textContent = notesText;
    notesEl.style.display = notesText ? "" : "none";
    modalLastFocused = document.activeElement;
    backdrop.classList.add("open");
    document.body.classList.add("stroke-modal-lock");
    document.getElementById("strokeModalClose").focus();
  }
  function closeDetailModal() {
    var backdrop = document.getElementById("strokeModalBackdrop");
    if (!backdrop || !backdrop.classList.contains("open"))
      return;
    backdrop.classList.remove("open");
    if (!isLightboxOpen())
      document.body.classList.remove("stroke-modal-lock");
    if (modalLastFocused && modalLastFocused.focus)
      modalLastFocused.focus();
  }
  function isDetailModalOpen() {
    var backdrop = document.getElementById("strokeModalBackdrop");
    return !!backdrop && backdrop.classList.contains("open");
  }
  var lightboxLastFocused = null;
  function ensureLightbox() {
    if (document.getElementById("strokeLightboxBackdrop"))
      return;
    var closeBtn = el("button", {
      class: "stroke-modal-close stroke-lightbox-close",
      id: "strokeLightboxClose",
      type: "button",
      "aria-label": t("stroke.modal.close", "Close"),
      html: "&times;"
    });
    var img = el("img", { class: "stroke-lightbox-img", id: "strokeLightboxImg", alt: "" });
    var caption = el("p", { class: "stroke-lightbox-caption", id: "strokeLightboxCaption" });
    var box = el("div", {
      class: "stroke-lightbox",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "strokeLightboxCaption"
    }, [closeBtn, img, caption]);
    var backdrop = el("div", { class: "stroke-lightbox-backdrop", id: "strokeLightboxBackdrop" }, [box]);
    backdrop.addEventListener("click", function (e) { if (e.target === backdrop)
      closeLightbox(); });
    closeBtn.addEventListener("click", closeLightbox);
    document.body.appendChild(backdrop);
  }
  function openLightbox(src, label) {
    ensureLightbox();
    var backdrop = document.getElementById("strokeLightboxBackdrop");
    document.getElementById("strokeLightboxImg").src = src;
    document.getElementById("strokeLightboxImg").alt = label;
    document.getElementById("strokeLightboxCaption").textContent = label;
    lightboxLastFocused = document.activeElement;
    backdrop.classList.add("open");
    document.body.classList.add("stroke-modal-lock");
    document.getElementById("strokeLightboxClose").focus();
  }
  function closeLightbox() {
    var backdrop = document.getElementById("strokeLightboxBackdrop");
    if (!backdrop || !backdrop.classList.contains("open"))
      return;
    backdrop.classList.remove("open");
    if (!isDetailModalOpen())
      document.body.classList.remove("stroke-modal-lock");
    if (lightboxLastFocused && lightboxLastFocused.focus)
      lightboxLastFocused.focus();
  }
  function isLightboxOpen() {
    var backdrop = document.getElementById("strokeLightboxBackdrop");
    return !!backdrop && backdrop.classList.contains("open");
  }
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape")
      return;
    if (isLightboxOpen()) {
      closeLightbox();
      return;
    }
    if (isDetailModalOpen())
      closeDetailModal();
  });
  function matchesQuery(item, q) {
    if (!q)
      return true;
    return item.label.toLowerCase().indexOf(q) !== -1 || item.id.toLowerCase().indexOf(q) !== -1;
  }
  function renderChips() {
    var wrap = document.getElementById("strokeGroupChips");
    if (!wrap)
      return;
    wrap.innerHTML = "";
    var all = el("button", { class: "topic-chip" + (state.activeGroup === "" ? " active" : ""), text: t("stroke.filter.all", "All") });
    all.addEventListener("click", function () { state.activeGroup = ""; renderChips(); renderChart(); });
    wrap.appendChild(all);
    state.groups.forEach(function (g) {
      var chip = el("button", { class: "topic-chip" + (state.activeGroup === g.id ? " active" : ""), text: groupLabel(g) });
      chip.addEventListener("click", function () { state.activeGroup = g.id; renderChips(); renderChart(); });
      wrap.appendChild(chip);
    });
  }
  function renderChart() {
    var root = document.getElementById("strokeChartRoot");
    var status = document.getElementById("strokeStatus");
    if (!root)
      return;
    root.innerHTML = "";
    var q = state.query.trim().toLowerCase();
    var groupsToShow = state.groups.filter(function (g) { return !state.activeGroup || g.id === state.activeGroup; });
    var totalShown = 0;
    groupsToShow.forEach(function (group) {
      var items = group.items.filter(function (item) { return matchesQuery(item, q); });
      if (!items.length)
        return;
      totalShown += items.length;
      var sectionChildren = [
        el("h2", { class: "stroke-section-title", text: groupLabel(group) }),
        el("div", { class: "stroke-grid" }, items.map(itemTile))
      ];
      root.appendChild(el("section", { class: "stroke-section" }, sectionChildren));
    });
    if (status)
      status.textContent = totalShown ? "" : t("stroke.status.empty", "Nothing matches.");
  }
  function loadData() {
    var status = document.getElementById("strokeStatus");
    if (status)
      status.textContent = t("stroke.status.loading", "Loading chart...");
    fetch(DATA_URL)
      .then(function (res) {
      if (!res.ok)
        throw new Error("HTTP " + res.status);
      return res.json();
    })
      .then(function (data) {
      state.groups = (data && data.groups) || [];
      if (status)
        status.textContent = "";
      renderChips();
      renderChart();
    })
      .catch(function () {
      if (status) {
        status.classList.add("error");
        status.textContent = t("stroke.status.error", "Failed to load stroke chart data.");
      }
    });
  }
  document.addEventListener("DOMContentLoaded", function () {
    var searchInput = document.getElementById("strokeSearch");
    if (searchInput) {
      searchInput.addEventListener("input", function () {
        state.query = searchInput.value;
        renderChart();
      });
    }
    loadData();
  });
  document.addEventListener("i18n:ready", function () {
    if (state.groups.length) {
      renderChips();
      renderChart();
    }
  });
})();
