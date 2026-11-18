// Shared behaviour for every page: theme, copy buttons, command palette, reveal.
const CLI = "npx kordexa";

const root = document.documentElement;
const themeButton = document.querySelector("[data-theme-toggle]");

function syncThemeButton() {
  if (!themeButton) return;
  const dark = root.dataset.theme === "dark";
  themeButton.setAttribute("aria-pressed", String(dark));
  themeButton.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
}
syncThemeButton();
themeButton?.addEventListener("click", () => {
  root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
  try { localStorage.setItem("kx-theme", root.dataset.theme); } catch { /* preference simply won't persist */ }
  syncThemeButton();
});

export async function copyText(text, button) {
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.className = "offscreen";
    document.body.append(area);
    area.select();
    copied = document.execCommand("copy");
    area.remove();
  }
  if (button) {
    const original = button.dataset.label || button.textContent;
    button.dataset.label = original;
    button.textContent = copied ? "Copied" : "Press Ctrl+C";
    clearTimeout(button.copyTimer);
    button.copyTimer = setTimeout(() => { button.textContent = original; }, 1600);
  }
  return copied;
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-copy]");
  if (button) copyText(button.dataset.copy, button);
});

// Command palette
const home = document.body.dataset.page === "home" ? "" : "/";
const paletteItems = [
  ["Configure your plan", "Section", `${home}#configure`],
  ["Daily flow", "Section", `${home}#flow`],
  ["Features", "Section", `${home}#features`],
  ["Role blueprints", "Section", `${home}#roles`],
  ["Compare tools", "Section", `${home}#compare`],
  ["What's new in Phase 1", "Section", `${home}#updates`],
  ["FAQ", "Section", `${home}#faq`],
  ["Documentation", "Docs", "/docs"],
  ["Quickstart", "Docs", "/docs#quickstart"],
  ["CLI reference", "Docs", "/docs#cli"],
  ["Agent integrations", "Docs", "/docs#agents"],
  ["Email and scheduling", "Docs", "/docs#email"],
  ["Troubleshooting", "Docs", "/docs#troubleshooting"],
  ["Release notes", "Docs", "/docs#release-notes"],
  ...["plan", "status", "harness", "courses", "research --day 1", "links --day 1", "send-today --dry-run", "weekly-summary --week 1", "recommend-next", "progress-card", "terminal-card", "setup-secrets", "doctor"]
    .map((command) => [`${CLI} ${command}`, "Copy", null])
];

const dialog = document.querySelector("[data-palette]");
if (dialog) {
  const input = dialog.querySelector("input");
  const list = dialog.querySelector("ul");
  let active = 0;
  let matches = [];

  const render = () => {
    const query = input.value.trim().toLowerCase();
    matches = paletteItems.filter(([label, kind]) => `${label} ${kind}`.toLowerCase().includes(query));
    active = Math.min(active, Math.max(matches.length - 1, 0));
    list.replaceChildren(...matches.map(([label, kind], index) => {
      const item = document.createElement("li");
      item.id = `palette-${index}`;
      item.role = "option";
      item.setAttribute("aria-selected", String(index === active));
      const name = document.createElement("span");
      name.textContent = label;
      const tag = document.createElement("small");
      tag.textContent = kind;
      item.append(name, tag);
      item.addEventListener("click", () => choose(index));
      return item;
    }));
    if (!matches.length) {
      const empty = document.createElement("li");
      empty.className = "palette-empty";
      empty.textContent = "No matches. Try a command like status.";
      list.append(empty);
    }
    input.setAttribute("aria-activedescendant", matches.length ? `palette-${active}` : "");
    list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  };

  const choose = async (index) => {
    const match = matches[index];
    if (!match) return;
    const [label, , href] = match;
    if (href) {
      dialog.close();
      location.href = href;
      return;
    }
    await copyText(label);
    dialog.close();
  };

  const open = () => {
    input.value = "";
    active = 0;
    render();
    dialog.showModal();
    input.focus();
  };

  document.querySelectorAll("[data-palette-open]").forEach((button) => button.addEventListener("click", open));
  input.addEventListener("input", () => { active = 0; render(); });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!matches.length) return;
      active = (active + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
      render();
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(active);
    }
  });
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (dialog.open) dialog.close(); else open();
    }
  });
}

// Reveal on scroll. Content stays visible if observers are unavailable.
const revealTargets = document.querySelectorAll("[data-reveal]");
if ("IntersectionObserver" in window && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { rootMargin: "0px 0px -8% 0px" });
  revealTargets.forEach((target) => {
    target.classList.add("will-reveal");
    observer.observe(target);
  });
}
