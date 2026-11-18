import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { generate30DayPlan } from "../../src/planner.js";
import { renderView, terminalSupportsColor } from "../../src/terminal-view.js";

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../bin/kordexa.js");
const plan = generate30DayPlan({ targetRole: "Data Scientist", focusSkill: "pandas", planDays: 30 });
const review = { momentum: "not-started", completedDays: 0, activeDay: 1, nextAction: "Analyze a small CSV." };
const digest = {
  day: 1,
  topic: "pandas basics",
  topVideo: { title: "pandas tutorial", url: "https://www.youtube.com/watch?v=abc12345678" },
  topRepo: { title: "pandas-dev/pandas", url: "https://github.com/pandas-dev/pandas" },
  topDoc: { title: "pandas docs", url: "https://pandas.pydata.org/docs/" }
};
const preview = {
  dryRun: true,
  message: { to: "asha@gmail.com", subject: "Kordexa Day 1: Setup", text: "plain", html: "<!doctype html><html></html>" }
};
const context = { day: plan.days[0], digest, review, totalDays: 30, completedDays: 0, previewPath: "data/email-preview.html", emailConnected: false };

test("email preview is readable and hides raw JSON and HTML", () => {
  const output = renderView("email", preview, context);
  assert.match(output, /Preview only\. No email was sent\./);
  assert.match(output, /Kordexa Day 1: Setup/);
  assert.match(output, /Today's task/);
  assert.match(output, /Learn 35m · Build 45m · Review 15m/);
  assert.match(output, /https:\/\/github\.com\/pandas-dev\/pandas/);
  assert.match(output, /(open|start|xdg-open) data\/email-preview\.html/);
  assert.match(output, /npx kordexa setup-email/);
  assert.doesNotMatch(output, /<html|<!doctype|"dryRun"|\\n/);
});

test("a sent email confirms delivery without preview steps", () => {
  const output = renderView("email", { sent: true, to: "asha@gmail.com", subject: "Kordexa Day 1: Setup" }, { ...context, emailConnected: true });
  assert.match(output, /Email sent to asha@gmail\.com/);
  assert.doesNotMatch(output, /Preview only|email-preview/);
});

test("every command has a readable view", () => {
  const card = { role: "Data Scientist", skill: "pandas", completedDays: 1, totalDays: 30, activeDay: 2, activeTopic: "SQL", grid: ["01-07 # > . . . . ."] };
  const views = {
    skipped: [{ recommendation: { recommendedNextSkill: "model evaluation" } }],
    plan: [{ days: 30 }, { plan }],
    status: [{ learner: "Asha", targetRole: "Data Scientist", primarySkill: "pandas", completedDays: 1, daysPlanned: 30, activeDay: 2, momentum: "strong", emailTime: "20:00 UTC", nextAction: "Build", latestEvidence: "repo", risk: "No active blocker logged." }],
    research: [{ path: "data/r.json", digest }],
    links: [{ path: "data/links.json", day: 1, topic: "pandas", ...digest }],
    harness: [{ jsonPath: "data/h.json", harness: { activeDay: { day: 1, title: "Setup", task: "Build" } } }],
    courses: [{ markdownPath: "data/l.md", learningSources: { targetRole: "Data Scientist", recommendedSources: [{ title: "Kaggle", url: "https://kaggle.com" }], newsletters: [{ title: "Blog", url: "https://example.com" }] } }],
    logged: [{ entry: { day: 1, completed: "Built", evidence: "repo" }, review }],
    weekly: [{ week: 1, range: "1-7", summary: "Good work.", completed: [{ day: 1, completed: "Built" }], nextWeekFocus: "SQL" }],
    recommendation: [{ recommendedNextSkill: "SQL", reason: "Useful.", completedDays: 1, requiredDays: 30, canAdvance: false }],
    card: [{ card, markdownPath: "data/c.md", terminalSvgPath: "data/c.svg" }],
    terminalCard: [{ terminalSvgPath: "data/c.svg" }],
    secrets: [{ commands: ["gh secret set RESEND_API_KEY"] }],
    doctor: [{ status: "needs-email-setup", checks: { config: true, localEmail: false }, nextSteps: ["Connect email."] }]
  };
  for (const [kind, [payload, viewContext]] of Object.entries(views)) {
    const output = renderView(kind, payload, viewContext);
    assert.ok(output.trim().length > 10, kind);
    assert.doesNotMatch(output.trimStart(), /^[{[]"?/, kind);
    assert.doesNotMatch(output, /undefined|\[object Object\]|NaN/, kind);
  }
});

test("long text wraps to the terminal width", () => {
  const long = { learner: "Asha", targetRole: "Data Scientist", primarySkill: "pandas", completedDays: 0, daysPlanned: 30, activeDay: 1, momentum: "steady", emailTime: "20:00", risk: "", nextAction: "word ".repeat(40) };
  const lines = renderView("status", long, {}, { width: 50 }).split("\n");
  assert.ok(lines.every((line) => line.length <= 56), lines.join("\n"));
});

test("colors appear only when enabled and external text cannot inject terminal codes", () => {
  const unsafe = { ...digest, topVideo: { title: "Safe\u001b[31m title\u0007", url: "https://youtube.com/watch?v=1" } };
  const plain = renderView("research", { path: "data/r.json", digest: unsafe });
  assert.doesNotMatch(plain, /\u001b|\u0007/);
  assert.match(plain, /Safe title/);
  assert.match(renderView("research", { path: "data/r.json", digest }, {}, { color: true }), /\u001b\[/);
});

test("color follows the terminal and NO_COLOR", () => {
  assert.equal(terminalSupportsColor({ isTTY: true }, {}), true);
  assert.equal(terminalSupportsColor({ isTTY: false }, {}), false);
  assert.equal(terminalSupportsColor({ isTTY: true }, { NO_COLOR: "1" }), false);
  assert.equal(terminalSupportsColor({ isTTY: true }, { TERM: "dumb" }), false);
});

test("agents and scripts still receive complete JSON", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kordexa-view-"));
  try {
    const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: "utf8", env: { ...process.env, KORDEXA_OFFLINE: "1" } });
    assert.equal(run("--yes", "--offline", "--name", "Asha", "--email", "asha@gmail.com", "--role", "Data Scientist").status, 0);
    const result = JSON.parse(run("send-today", "--dry-run", "--offline").stdout);
    assert.equal(result.dryRun, true);
    assert.match(result.message.html, /<html/);
    assert.match(fs.readFileSync(path.join(dir, "data/email-preview.html"), "utf8"), /<html/);
    assert.equal(JSON.parse(run("status", "--json").stdout).learner, "Asha");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
