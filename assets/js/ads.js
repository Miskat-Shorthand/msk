/* AdSense slots.
 * HTML hanya berisi <div class="ad-slot" data-ad="KEY"></div>.
 * Isi ID slot dari AdSense (Ads > By ad unit > Display ads) di SLOTS di bawah.
 * Slot yang ID-nya masih kosong TIDAK ditampilkan (tidak ada kotak kosong).
 */
(function () {
  "use strict";
  var CLIENT = "ca-pub-2825498315021318";
  var SLOTS = {
    "article-rail":   "",  // sidebar kanan desktop lebar (article.html)
    "article-inline": "",  // di bawah artikel, semua layar (article.html)
    "index-inline":   "",  // antara testimonial & Recent articles (index.html)
    "unit-inline":    ""   // di bawah konten unit (unit.html)
  };

  function isVisible(node) {
    return node.getClientRects().length > 0 && node.getBoundingClientRect().width > 0;
  }

  function fill(slot) {
    if (slot.getAttribute("data-ad-state"))
      return;
    var id = SLOTS[slot.getAttribute("data-ad")];
    if (!id || !/^\d+$/.test(id))
      return;
    if (!isVisible(slot))
      return;
    var ins = document.createElement("ins");
    ins.className = "adsbygoogle";
    ins.style.display = "block";
    ins.setAttribute("data-ad-client", CLIENT);
    ins.setAttribute("data-ad-slot", id);
    ins.setAttribute("data-ad-format", "auto");
    ins.setAttribute("data-full-width-responsive", "true");
    slot.appendChild(ins);
    slot.setAttribute("data-ad-state", "filled");
    slot.classList.add("ad-slot--live");
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch (e) {
      slot.setAttribute("data-ad-state", "error");
    }
  }

  function scan() {
    var slots = document.querySelectorAll(".ad-slot");
    for (var i = 0; i < slots.length; i++)
      fill(slots[i]);
  }

  // Slot yang tersembunyi (mis. rail di layar kecil) tidak boleh di-push:
  // AdSense error "availableWidth=0". Jadi scan ulang saat layar berubah.
  var timer = null;
  function later() {
    clearTimeout(timer);
    timer = setTimeout(scan, 200);
  }
  window.addEventListener("load", scan);
  window.addEventListener("resize", later);
  window.addEventListener("orientationchange", later);
})();
