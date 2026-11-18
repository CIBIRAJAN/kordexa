// Home page: hero terminals, plan configurator and tool comparison.
import { copyText } from "./common.js";
import { MAX_DAYS, MIN_DAYS, buildPlan, cronFromTime, shellQuote, weeklyLoadHours } from "./planner.js";

const CLI = "npx kordexa";
const CONFIG_FILE = "kordexa.config.json";
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/* Hero terminal stack */
const stack = $("[data-terminal-stack]");
if (stack) {
  const cards = $$(".term-card", stack);
  let front = 0;
  const arrange = () => cards.forEach((card, index) => {
    card.dataset.pos = String((index - front + cards.length) % cards.length);
  });
  arrange();
  let timer = null;
  const start = () => {
    if (reduceMotion || timer) return;
    timer = setInterval(() => { front = (front + 1) % cards.length; arrange(); }, 4200);
  };
  const stop = () => { clearInterval(timer); timer = null; };
  stack.addEventListener("mouseenter", stop);
  stack.addEventListener("mouseleave", start);
  stack.addEventListener("focusin", stop);
  stack.addEventListener("focusout", start);
  cards.forEach((card, index) => card.addEventListener("click", () => { front = index; arrange(); }));
  start();
}

/* Configurator */
const form = $("#plan-form");
const ROLE_OPTIONS = {
  agentic: { role: "Agentic AI and LLM Engineer", skill: "evaluation" },
  fullstack: { role: "Full-Stack Developer", skill: "auth" },
  security: { role: "Cybersecurity Analyst", skill: "SIEM" },
  data: { role: "Data Scientist", skill: "pandas" }
};
const SMTP = {
  gmail: ["smtp.gmail.com", 465],
  outlook: ["smtp.office365.com", 587],
  fastmail: ["smtp.fastmail.com", 465],
  postmark: ["smtp.postmarkapp.com", 587]
};
const PRESETS = {
  sprint: { days: 30, hours: 14, stage: "intermediate" },
  steady: { days: 45, hours: 12, stage: "beginner" },
  deep: { days: 90, hours: 8, stage: "beginner" }
};

let activeOutput = "command";
let selectedDay = 1;
let outputs = {};

function fillTimezones() {
  const select = form.elements.timezone;
  // Browsers may report legacy aliases, so show the current IANA name instead.
  const aliases = { "Asia/Calcutta": "Asia/Kolkata", "Asia/Katmandu": "Asia/Kathmandu", "Asia/Saigon": "Asia/Ho_Chi_Minh", "Asia/Rangoon": "Asia/Yangon" };
  const canonical = (zone) => aliases[zone] || zone;
  const detected = canonical(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const zones = typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("timeZone").map(canonical)
    : ["Asia/Kolkata", "Europe/London", "America/New_York", "America/Los_Angeles", "Asia/Singapore"];
  const all = [...new Set(["UTC", detected, "Asia/Kolkata", ...zones])];
  select.replaceChildren(...all.map((zone) => {
    const option = el("option", "", zone);
    option.value = zone;
    return option;
  }));
  select.value = detected;
}

function clampDays(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return MIN_DAYS;
  return Math.min(MAX_DAYS, Math.max(MIN_DAYS, parsed));
}

function readForm() {
  const data = new FormData(form);
  const roleChoice = data.get("roleChoice");
  const targetRole = roleChoice === "custom"
    ? (String(data.get("customRole")).trim() || "Agentic AI and LLM Engineer")
    : ROLE_OPTIONS[roleChoice].role;
  return {
    name: String(data.get("name")).trim() || "Learner",
    email: String(data.get("email")).trim() || "learner@example.com",
    targetRole,
    currentLearning: String(data.get("currentLearning")).trim() || "not started yet",
    focusSkill: String(data.get("focusSkill")).trim() || "RAG and agent workflows",
    currentStage: String(data.get("stage")),
    weeklyHours: Number.parseInt(data.get("weeklyHours"), 10) || 8,
    planDays: clampDays(data.get("planDays")),
    dailyEmailTime: String(data.get("time")) || "08:00",
    timezone: String(data.get("timezone") || "UTC"),
    smtp: String(data.get("smtp")),
    offline: data.get("offline") === "on"
  };
}

function localDate(timezone) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function buildOutputs(values) {
  const [host, port] = SMTP[values.smtp];
  const flags = [
    ["--name", values.name],
    ["--email", values.email],
    ["--role", values.targetRole],
    ["--current-learning", values.currentLearning],
    ["--skill", values.focusSkill],
    ["--stage", values.currentStage],
    ["--weekly-hours", values.weeklyHours],
    ["--days", values.planDays],
    ["--time", values.dailyEmailTime],
    ["--timezone", values.timezone],
    ["--smtp-host", host],
    ["--smtp-port", port]
  ].filter(([, value]) => value !== "");
  const lines = flags.map(([flag, value]) => `  ${flag} ${shellQuote(value)}`);
  if (values.offline) lines.push("  --offline");
  const command = `${CLI} --yes \\\n${lines.join(" \\\n")}`;

  const config = {
    version: 1,
    command: "/kordexa",
    dataDir: "data",
    learner: {
      name: values.name,
      email: values.email,
      targetRole: values.targetRole,
      currentLearning: values.currentLearning,
      focusSkill: values.focusSkill,
      currentStage: values.currentStage,
      weeklyHours: values.weeklyHours,
      planDays: values.planDays
    },
    schedule: { dailyEmailTime: values.dailyEmailTime, timezone: values.timezone, startDate: localDate(values.timezone) },
    email: { provider: "smtp", to: values.email, fromEnv: ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"] },
    agents: ["claude", "codex", "gemini", "openclaw", "antigravity", "hermas", "generic"]
  };

  const env = [
    "# Keep this file out of git. Add your own app password locally.",
    `SMTP_HOST=${host}`,
    `SMTP_PORT=${port}`,
    `SMTP_USER=${values.email}`,
    "SMTP_PASS=",
    `SMTP_FROM=${values.email}`
  ].join("\n");

  const cron = cronFromTime(values.dailyEmailTime, values.timezone);
  const workflow = [
    "# .github/workflows/kordexa-daily.yml",
    "on:",
    "  schedule:",
    `    # GitHub Actions cron is UTC. Generated from ${values.dailyEmailTime} ${values.timezone}.`,
    `    - cron: "${cron}"`,
    "  workflow_dispatch:"
  ].join("\n");

  return {
    command: { text: command, file: "setup-command.sh" },
    config: { text: `${JSON.stringify(config, null, 2)}\n`, file: CONFIG_FILE },
    env: { text: `${env}\n`, file: "env.local.template" },
    workflow: { text: `${workflow}\n`, file: "schedule-snippet.yml" }
  };
}

function renderOutput() {
  const output = outputs[activeOutput];
  $("#output-code").textContent = output.text;
  $("#output-panel").setAttribute("aria-labelledby", `tab-${activeOutput}`);
  $$('[role="tab"]', form.closest(".configurator")).forEach((tab) => {
    const selected = tab.dataset.output === activeOutput;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  $("#output-download").textContent = `Download ${output.file}`;
}

function renderPlan(plan) {
  const total = plan.days.length;
  $("#plan-title").textContent = `${total} days toward ${plan.label}`;
  $("#plan-capstone").textContent = `Capstone: ${plan.capstone}.`;

  const bar = $("#phase-bar");
  bar.replaceChildren(...plan.phases.map((phase) => {
    const segment = el("span", `phase phase-${phase.key}`);
    segment.title = `Days ${phase.from}-${phase.to}: ${phase.name}`;
    segment.dataset.grow = String(phase.to - phase.from + 1);
    segment.style.flexGrow = segment.dataset.grow;
    return segment;
  }));
  $("#phase-legend").replaceChildren(...plan.phases.map((phase) => {
    const item = el("li");
    item.append(el("i", `swatch phase-${phase.key}`), el("b", "", `${phase.from}-${phase.to}`), document.createTextNode(` ${phase.name}`));
    return item;
  }));

  selectedDay = Math.min(selectedDay, total);
  const grid = $("#day-grid");
  grid.replaceChildren(...plan.days.map((day) => {
    const button = el("button", `day-cell phase-${day.difficulty}`, String(day.day));
    button.type = "button";
    button.dataset.day = String(day.day);
    button.setAttribute("aria-label", `Day ${day.day}: ${day.title}`);
    button.setAttribute("aria-pressed", String(day.day === selectedDay));
    return button;
  }));
  renderDay(plan);
}

function renderDay(plan) {
  const day = plan.days[selectedDay - 1];
  const { learnMinutes, buildMinutes, reviewMinutes } = day.timeBox;
  $("#day-kicker").textContent = `Day ${day.day} · ${day.difficulty.replaceAll("-", " ")}`;
  $("#day-title").textContent = day.title;
  $("#day-task").textContent = day.task;
  $("#day-concepts").replaceChildren(...day.concepts.map((concept) => el("li", "", concept)));
  $("#day-time").textContent = `Learn ${learnMinutes}m · Build ${buildMinutes}m · Review ${reviewMinutes}m`;
  $("#day-artifact").textContent = day.portfolioArtifact;
  $$(".day-cell").forEach((cell) => cell.setAttribute("aria-pressed", String(Number(cell.dataset.day) === selectedDay)));
}

function renderInsights(values, plan) {
  const load = weeklyLoadHours(plan);
  const peak = load.afterFirstWeek;
  const notes = [];
  if (plan.matched > 0) {
    notes.push(["good", `"${plan.primarySkill}" matches ${plan.matched} blueprint ${plan.matched === 1 ? "topic" : "topics"}, moved to the front of the plan.`]);
  } else {
    notes.push(["info", `"${plan.primarySkill}" isn't a blueprint topic, so day 2 becomes a custom focus day.`]);
  }
  if (values.weeklyHours < peak) {
    notes.push(["warn", `Plan days need about ${peak.toFixed(1)} hours a week after week 1. You set ${values.weeklyHours}, so expect to stretch some days.`]);
  } else {
    notes.push(["good", `${values.weeklyHours} hours a week covers the plan's ${peak.toFixed(1)}-hour peak.`]);
  }
  if (values.timezone !== "UTC") {
    notes.push(["info", "GitHub cron is fixed in UTC, so the send time shifts by an hour if your timezone observes daylight saving."]);
  }
  $("#insights").replaceChildren(...notes.map(([kind, text]) => el("li", `insight insight-${kind}`, text)));
}

let currentPlan = null;
function refresh() {
  const values = readForm();
  form.elements.customRole.closest(".field").hidden = form.elements.roleChoice.value !== "custom";
  $("#days-value").textContent = `${values.planDays} days`;
  const emailField = form.elements.email;
  const emailValid = !emailField.value || emailField.validity.valid;
  $("#email-error").hidden = emailValid;
  emailField.setAttribute("aria-invalid", String(!emailValid));
  currentPlan = buildPlan(values);
  outputs = buildOutputs(values);
  renderOutput();
  renderPlan(currentPlan);
  renderInsights(values, currentPlan);
}

function applyRole(key) {
  form.elements.roleChoice.value = key;
  form.elements.focusSkill.value = ROLE_OPTIONS[key].skill;
  selectedDay = 1;
  refresh();
}

if (form) {
  fillTimezones();
  form.addEventListener("input", (event) => {
    if (event.target.name === "planDays") {
      form.elements.planDays.value = clampDays(event.target.value);
    }
    if (event.target.name === "roleChoice" && ROLE_OPTIONS[event.target.value]) {
      form.elements.focusSkill.value = ROLE_OPTIONS[event.target.value].skill;
    }
    $$("[data-preset]").forEach((button) => button.setAttribute("aria-pressed", "false"));
    refresh();
  });
  form.addEventListener("submit", (event) => event.preventDefault());

  $$("[data-preset]").forEach((button) => button.addEventListener("click", () => {
    const preset = PRESETS[button.dataset.preset];
    form.elements.planDays.value = preset.days;
    form.elements.weeklyHours.value = preset.hours;
    form.elements.stage.value = preset.stage;
    $$("[data-preset]").forEach((other) => other.setAttribute("aria-pressed", String(other === button)));
    refresh();
  }));

  const tabs = $$('[role="tab"]', form.closest(".configurator"));
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => { activeOutput = tab.dataset.output; renderOutput(); });
    tab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      const next = tabs[(index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
      activeOutput = next.dataset.output;
      renderOutput();
      next.focus();
    });
  });

  $("#output-copy").addEventListener("click", (event) => copyText(outputs[activeOutput].text, event.currentTarget));
  $("#output-download").addEventListener("click", () => {
    const output = outputs[activeOutput];
    const url = URL.createObjectURL(new Blob([output.text], { type: "text/plain" }));
    const link = el("a");
    link.href = url;
    link.download = output.file;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  $("#day-grid").addEventListener("click", (event) => {
    const cell = event.target.closest(".day-cell");
    if (!cell) return;
    selectedDay = Number(cell.dataset.day);
    renderDay(currentPlan);
  });

  $$("[data-role-pick]").forEach((button) => button.addEventListener("click", () => {
    applyRole(button.dataset.rolePick);
    $("#configure").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
  }));

  refresh();
}

/* Comparison */
const CAPABILITIES = [
  "Runs inside your coding agent",
  "One daily build artifact with proof",
  "Sourced, dated research digests",
  "Scheduled email delivery",
  "Local-first data",
  "Free and open source"
];
const ALTERNATIVES = [
  { name: "Course marketplaces", note: "Video catalogs and certificates", best: "Accredited certificates", marks: "npnpnn" },
  { name: "General AI chat", note: "Ask anything in a browser tab", best: "Instant answers", marks: "npppnn" },
  { name: "Developer roadmaps", note: "Community skill maps", best: "Seeing the big picture", marks: "nnpnyy" },
  { name: "Cloud LMS suites", note: "Corporate learning platforms", best: "Organization-wide tracking", marks: "nppynn" },
  { name: "Manual trackers", note: "Notes apps and spreadsheets", best: "Total flexibility", marks: "npnnpp" }
];
const MARK = { y: ["yes", "Yes"], p: ["partial", "Partly"], n: ["no", "No"] };

const picker = $("#compare-picker");
if (picker) {
  const list = $("#compare-list");
  const render = (index) => {
    const option = ALTERNATIVES[index];
    $("#compare-name").textContent = option.name;
    $("#compare-note").textContent = option.note;
    $("#compare-best").textContent = option.best;
    list.replaceChildren(...CAPABILITIES.map((capability, position) => {
      const [kind, label] = MARK[option.marks[position]];
      const item = el("li", `mark mark-${kind}`);
      item.append(el("span", "mark-dot", label), el("span", "", capability));
      return item;
    }));
    $$("button", picker).forEach((button, position) => button.setAttribute("aria-pressed", String(position === index)));
  };
  picker.replaceChildren(...ALTERNATIVES.map((option, index) => {
    const button = el("button", "chip-button", option.name);
    button.type = "button";
    button.addEventListener("click", () => render(index));
    return button;
  }));
  render(0);
}
