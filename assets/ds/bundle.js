/* @ds-bundle: {"format":4,"namespace":"InstinctLab","components":[]} */
(function () {
  var ns = (window.InstinctLab = window.InstinctLab || {});
  var reduce = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var io = null;
  function show(el) { el.classList.add("is-in"); }
  // Plays each .il-reveal once, the first time a quarter of it is on screen.
  ns.reveal = function (root) {
    var els = (root || document).querySelectorAll(".il-reveal:not(.is-in)");
    if (reduce || !("IntersectionObserver" in window)) { Array.prototype.forEach.call(els, show); return; }
    if (!io) io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { show(e.target); io.unobserve(e.target); } });
    }, { threshold: 0.25 });
    Array.prototype.forEach.call(els, function (el) { io.observe(el); });
  };
  // Runs an element's motion again from the start (for a "replay" control).
  ns.replay = function (el) {
    if (!el || !el.getAnimations) return;
    el.getAnimations({ subtree: true }).forEach(function (a) { a.cancel(); a.play(); });
  };
  // Recordings loop forever, so each gets a Pause / Play button (WCAG 2.2.2).
  // Pausing swaps the GIF for its still (the <img> src). Reduced motion starts on the still.
  ns.recordings = function (root) {
    var figs = (root || document).querySelectorAll(".il-recording:not([data-il-ready])");
    Array.prototype.forEach.call(figs, function (fig) {
      var src = fig.querySelector("source[data-gif]"), img = fig.querySelector("img");
      if (!src || !img) return;
      fig.setAttribute("data-il-ready", "");
      var gif = src.getAttribute("data-gif"), still = img.getAttribute("src");
      var btn = document.createElement("button");
      btn.type = "button"; btn.className = "il-btn il-recording-toggle";
      function set(paused) {
        src.setAttribute("srcset", paused ? still : gif);
        btn.textContent = paused ? "Play" : "Pause";
        btn.setAttribute("aria-label", (paused ? "Play" : "Pause") + " recording");
      }
      btn.addEventListener("click", function () { set(src.getAttribute("srcset") !== still); });
      var foot = fig.querySelector("figcaption") || fig;
      if (reduce) return; // the <source> media query already shows the still; nothing to pause
      set(false);
      foot.appendChild(btn);
    });
  };
  document.documentElement.classList.add("il-motion");
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { ns.reveal(); ns.recordings(); });
  else { ns.reveal(); ns.recordings(); }
})();
