// Applies the design system's motion layer (assets/ds/motion.css + bundle.js) to the report and story pages (2026-11-26).
// Runs before bundle.js: marks the parts, then bundle.js plays each plate once when a quarter of it is on screen.
(function () {
  var q = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  q("section.plate").forEach(function (p) { p.classList.add("il-reveal", "il-m-develop"); });
  // the words, then the evidence, then the verdict (the order inside a plate)
  q("section.plate .rey").forEach(function (el) { el.classList.add("il-m-underline"); el.style.setProperty("--d", "300ms"); });
  q("section.plate .dish canvas, section.plate figure.gif img").forEach(function (el) { el.classList.add("il-m-focus"); });
  q("section.plate .n14").forEach(function (strip) {
    q("i", strip).forEach(function (dot, i) { dot.classList.add("il-m-grow"); dot.style.setProperty("--i", i); dot.style.setProperty("--d", "350ms"); });
    var b = strip.querySelector("b"), m = b && /^(\d+) of 14$/.exec(b.textContent.trim());
    if (m) { b.setAttribute("role", "img"); b.setAttribute("aria-label", b.textContent.trim()); b.innerHTML = '<span class="il-m-count" style="--to:' + m[1] + ';--d:350ms" aria-hidden="true"></span> of 14'; }
  });
  q("section.plate dl.story .stamp").forEach(function (el) { el.classList.add("il-m-stamp"); el.style.setProperty("--d", "900ms"); });
  // A plate taller than about 4 screens can never be a quarter on screen: reveal it once half a screen of it shows.
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting && e.intersectionRect.height >= window.innerHeight * 0.5) { e.target.classList.add("is-in"); io.unobserve(e.target); } });
    }, { threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5] });
    q("section.plate").forEach(function (p) { io.observe(p); });
  }
})();
