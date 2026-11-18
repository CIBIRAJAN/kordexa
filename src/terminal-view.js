import { cleanText } from "./setup-answers.js";

// Readable command results for people. Agents and scripts keep receiving JSON.

const OPEN_COMMAND = { darwin: "open", win32: "start" }[process.platform] || "xdg-open";
const STYLES = { bold: 1, dim: 2, accent: 36, good: 32, warn: 33 };
const MOMENTUM = { strong: "Strong", steady: "Steady", "needs-support": "Needs support", blocked: "Blocked", "not-started": "Not started" };
const DOCTOR_CHECKS = {
  config: "Learner settings",
  agentsMd: "Codex and generic agent instructions",
  geminiMd: "Gemini instructions",
  claudeSkill: "Claude Code skill",
  mcpManifest: "MCP connection",
  workflow: "Daily email schedule",
  localEnv: "Local settings file",
  localEmail: "Email connection"
};
const DOCTOR_STATUS = {
  ready: "Everything is ready.",
  "needs-setup": "Setup isn't finished yet.",
  "needs-upgrade": "Your project needs a small update.",
  "needs-email-setup": "Kordexa is ready, but email isn't connected yet."
};

function createPainter({ color, width }) {
  const paint = (style, text) => (color ? `\u001b[${STYLES[style]}m${text}\u001b[0m` : text);
  const pageWidth = Math.max(40, Math.min(width || 80, 88));

  const wrap = (value, indent = 2) => {
    const limit = pageWidth - indent;
    const lines = [];
    let line = "";
    for (const word of cleanText(value).split(" ")) {
      if (line && `${line} ${word}`.length > limit) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) lines.push(line);
    return lines.map((text) => `${" ".repeat(indent)}${text}`);
  };

  const rows = (entries) => {
    const visible = entries.filter(([, value]) => value !== undefined && value !== null && value !== "");
    const labelWidth = Math.max(...visible.map(([label]) => label.length), 0) + 2;
    return visible.flatMap(([label, value]) => {
      const [first, ...rest] = wrap(value, labelWidth + 2).map((line) => line.trimStart());
      return [
        `  ${paint("dim", label.padEnd(labelWidth))}${first}`,
        ...rest.map((line) => `${" ".repeat(labelWidth + 2)}${line}`)
      ];
    });
  };

  return {
    paint,
    wrap,
    rows,
    title: (text) => [paint("bold", cleanText(text))],
    section: (text) => ["", paint("accent", paint("bold", text))],
    rule: () => [paint("dim", "─".repeat(Math.min(pageWidth, 56)))],
    success: (text) => [`${paint("good", "✓")} ${paint("bold", cleanText(text))}`],
    notice: (text) => [`${paint("warn", "!")} ${paint("bold", cleanText(text))}`],
    bullets: (items) => items.flatMap((item) => {
      const [first, ...rest] = wrap(item, 4);
      return [`  • ${first.trimStart()}`, ...rest];
    }),
    command: (text, purpose) => [`  ${paint("accent", text)}${purpose ? `  ${paint("dim", purpose)}` : ""}`],
    resource: (label, item) => {
      if (!item?.url) return [];
      const name = cleanText(item.title) || item.url;
      return [`  ${paint("dim", label.padEnd(7))}${name}`, `  ${" ".repeat(7)}${paint("accent", cleanText(item.url))}`];
    }
  };
}

function momentumLabel(value) {
  return MOMENTUM[value] || value;
}

const VIEWS = {
  email(p, result, { day, digest, review, totalDays, completedDays, previewPath, emailConnected }) {
    const message = result.message || result;
    const time = day.timeBox;
    return [
      ...(result.dryRun ? p.notice("Preview only. No email was sent.") : p.success(`Email sent to ${result.to}`)),
      "",
      ...p.title(message.subject),
      ...p.rows([["To", message.to]]),
      ...p.rule(),
      ...p.section("Today's task"),
      ...p.wrap(day.setupOrBuildTask),
      "",
      ...p.rows([
        ["Skill", day.primarySkill],
        ["Concepts", day.concepts.join(", ")],
        ["Time", `Learn ${time.learnMinutes}m · Build ${time.buildMinutes}m · Review ${time.reviewMinutes}m`],
        ["Level", day.difficulty.replaceAll("-", " ")]
      ]),
      ...p.section("Open these first"),
      ...p.resource("Watch", digest.topVideo),
      ...p.resource("Build", digest.topRepo),
      ...p.resource("Read", digest.topDoc),
      ...p.section("Before you finish"),
      ...p.bullets(day.reviewQuestions),
      ...p.section("Your progress"),
      ...p.rows([
        ["Completed", `${completedDays} of ${totalDays} days`],
        ["Momentum", momentumLabel(review.momentum)]
      ]),
      ...(result.dryRun ? [
        ...p.section("Next"),
        ...p.command(`${OPEN_COMMAND} ${previewPath}`, "See the full email"),
        ...p.command(emailConnected ? "npx kordexa send-today" : "npx kordexa setup-email", emailConnected ? "Send it" : "Connect your email")
      ] : [])
    ];
  },

  skipped(p, result) {
    return [
      ...p.success("Your plan is complete, so no email was sent."),
      ...p.rows([["Next skill", result.recommendation?.recommendedNextSkill]]),
      ...p.section("Next"),
      ...p.command("npx kordexa recommend-next", "See what to learn next")
    ];
  },

  plan(p, result, { plan }) {
    return [
      ...p.success(`Your ${result.days}-day plan is ready`),
      "",
      ...p.rows([
        ["Goal", plan.learner.targetRole],
        ["First skill", plan.primarySkill],
        ["Day 1", plan.days[0].title]
      ]),
      ...p.section("Plan phases"),
      ...p.rows(plan.phases.map((phase) => [`Days ${phase.days}`, phase.name])),
      ...p.section("Next"),
      ...p.command("npx kordexa status", "See today's task")
    ];
  },

  status(p, status) {
    return [
      ...p.title(`${status.learner}'s learning plan`),
      ...p.rule(),
      ...p.rows([
        ["Goal", status.targetRole],
        ["First skill", status.primarySkill],
        ["Progress", `${status.completedDays} of ${status.daysPlanned} days`],
        ["Current day", `Day ${status.activeDay}`],
        ["Momentum", momentumLabel(status.momentum)],
        ["Daily email", status.emailTime]
      ]),
      ...p.section("Next task"),
      ...p.wrap(status.nextAction),
      ...(status.latestEvidence ? [...p.section("Latest proof"), ...p.wrap(status.latestEvidence)] : []),
      ...(/^Resolve blocker/.test(status.risk) ? [...p.section("Needs attention"), ...p.wrap(status.risk)] : [])
    ];
  },

  research(p, { path, digest }) {
    return [
      ...p.success(`Research is ready for Day ${digest.day}`),
      "",
      ...p.title(digest.topic),
      ...p.section("Start here"),
      ...p.resource("Watch", digest.topVideo),
      ...p.resource("Build", digest.topRepo),
      ...p.resource("Read", digest.topDoc),
      "",
      ...p.rows([["Saved to", path]])
    ];
  },

  links(p, result) {
    return [
      ...p.success(`Links are ready for Day ${result.day}`),
      "",
      ...p.title(result.topic),
      ...p.section("Start here"),
      ...p.resource("Watch", result.topVideo),
      ...p.resource("Build", result.topRepo),
      ...p.resource("Read", result.topDoc),
      "",
      ...p.rows([["Saved to", result.path]])
    ];
  },

  harness(p, { jsonPath, harness }) {
    return [
      ...p.success("Your AI agent instructions are ready"),
      "",
      ...p.rows([
        ["Current day", `Day ${harness.activeDay.day}: ${harness.activeDay.title}`],
        ["Task", harness.activeDay.task],
        ["Saved to", jsonPath]
      ])
    ];
  },

  courses(p, { markdownPath, learningSources }) {
    const list = (items) => items.flatMap((item) => [`  ${cleanText(item.title)}`, `  ${p.paint("accent", cleanText(item.url))}`]);
    return [
      ...p.success(`Learning sources are ready for ${learningSources.targetRole}`),
      ...p.section("Recommended courses"),
      ...list(learningSources.recommendedSources.slice(0, 5)),
      ...p.section("Stay updated"),
      ...list(learningSources.newsletters.slice(0, 3)),
      "",
      ...p.rows([["Full list", markdownPath]])
    ];
  },

  logged(p, { entry, review }) {
    return [
      ...p.success(`Day ${entry.day} is logged`),
      "",
      ...p.rows([
        ["Completed", entry.completed],
        ["Proof", entry.evidence],
        ["Progress", `${review.completedDays} days completed`],
        ["Momentum", momentumLabel(review.momentum)]
      ]),
      ...p.section(`Next: Day ${review.activeDay}`),
      ...p.wrap(review.nextAction)
    ];
  },

  weekly(p, summary) {
    return [
      ...p.title(`Week ${summary.week} summary`),
      ...p.rows([["Days", summary.range]]),
      ...p.rule(),
      ...p.wrap(summary.summary),
      ...(summary.completed.length ? [...p.section("Completed"), ...p.bullets(summary.completed.map((item) => `Day ${item.day}: ${item.completed}`))] : []),
      ...p.section("Next week's focus"),
      ...p.wrap(summary.nextWeekFocus)
    ];
  },

  recommendation(p, result) {
    return [
      ...p.title("Your next skill"),
      ...p.rule(),
      ...p.wrap(result.recommendedNextSkill),
      "",
      ...p.rows([
        ["Why", result.reason],
        ["Progress", `${result.completedDays} of ${result.requiredDays} days completed`]
      ]),
      ...(result.canAdvance ? [] : ["", ...p.wrap("Finish your current plan before moving to this skill.")])
    ];
  },

  card(p, { card, markdownPath, terminalSvgPath }) {
    return [
      ...p.title(`${card.role} progress`),
      ...p.rule(),
      ...p.rows([
        ["First skill", card.skill],
        ["Progress", `${card.completedDays} of ${card.totalDays} days`],
        ["Current day", `Day ${card.activeDay}: ${card.activeTopic}`]
      ]),
      ...p.section("Your plan"),
      ...card.grid.map((row) => `  ${row}`),
      "",
      ...p.wrap("# done   > today   . upcoming"),
      "",
      ...p.rows([["Report", markdownPath], ["Image", terminalSvgPath]])
    ];
  },

  terminalCard(p, { terminalSvgPath }) {
    return [...p.success("Your progress image is ready"), "", ...p.rows([["Saved to", terminalSvgPath]])];
  },

  secrets(p, { commands }) {
    return [
      ...p.title("Add these secrets to GitHub"),
      ...p.wrap("Run each command from your project folder after signing in with GitHub CLI."),
      "",
      ...commands.flatMap((command) => p.command(command))
    ];
  },

  doctor(p, { status, checks, nextSteps = [], warnings = [] }) {
    return [
      ...(status === "ready" ? p.success(DOCTOR_STATUS[status]) : p.notice(DOCTOR_STATUS[status])),
      "",
      ...Object.entries(DOCTOR_CHECKS).map(([key, label]) => `  ${checks[key] ? p.paint("good", "✓") : p.paint("warn", "•")} ${label}`),
      ...(nextSteps.length ? [...p.section("Next"), ...p.bullets(nextSteps)] : []),
      ...(warnings.length ? [...p.section("Warnings"), ...p.bullets(warnings)] : [])
    ];
  }
};

export function renderView(kind, payload, context = {}, options = {}) {
  const painter = createPainter({ color: Boolean(options.color), width: options.width });
  return VIEWS[kind](painter, payload, context).join("\n");
}

export function terminalSupportsColor(stream = process.stdout, env = process.env) {
  return Boolean(stream.isTTY) && !env.NO_COLOR && env.TERM !== "dumb";
}
