(function () {
  var saved = null;
  try { saved = localStorage.getItem("kx-theme"); } catch (error) { saved = null; }
  var dark = saved ? saved === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
})();
