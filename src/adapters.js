import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "./config.js";

const MAIL_RESUME_POLICY = `Mail resume policy: apply this to every supported agent, not only Codex. When an agent runs in a resumable browser or workspace instance, treat each resume as a daily-mail checkpoint: load the harness or status, resolve the current plan day, and run npx kordexa send-today for the due day after SMTP setup. If SMTP secrets are missing or real sending has not been approved, run npx kordexa send-today --dry-run and ask before sending. GitHub Actions remains the scheduled no-browser path.`;

const UNIVERSAL_PROMPT = `Use /kordexa (or legacy /eduorchestrate) as the learner command. When invoked, load the Kordexa workflow and its prebuilt terminal-card program; never recreate, type out, or hand-design the card UI in the agent prompt. Ask for missing learner profile details, ask what the learner is currently studying, ask the first skill they want to focus on, generate or update an adaptive plan with a fixed 30-day minimum, research current and trending references, send or preview daily emails, log progress, load the bundled default card or CLI-produced card artifact, summarize the week, recommend the next skill after the plan window, and keep recommendations practical, sourced, and focused. Research resolves a concrete top video link (digest.topVideo.url) and top GitHub repo (digest.topRepo.url) so the daily email carries a watchable link, not only search queries; on network failure it falls back to search URLs, and --offline or KORDEXA_OFFLINE=1 skips resolution. The dependency-free mailer supports implicit TLS (port 465) and STARTTLS (port 587). ${MAIL_RESUME_POLICY} If native slash commands are unavailable, treat "kordexa", "use Kordexa", "eduorchestrate", or "use EduOrchestrate" as equivalent to /kordexa.`;

// Primary adapters carry the Kordexa name. Legacy /eduorchestrate adapters stay
// available, but every adapter runs the kordexa package: on npm, the
// eduorchestrate name belongs to the separate upstream project.
const LEGACY_MENTIONS = [
  ["legacy /eduorchestrate", "\u0001"],
  ['"eduorchestrate", or "use EduOrchestrate"', "\u0002"]
];

const MANAGED_START = "<!-- kordexa:start -->";
const MANAGED_END = "<!-- kordexa:end -->";
const OLD_GENERATED_HEADING = /^# (?:(?:EduOrchestrate|Kordexa) Agent Instructions|Gemini (?:EduOrchestrate|Kordexa) Context)\s/;

function primary(text) {
  let output = text;
  for (const [mention, token] of LEGACY_MENTIONS) output = output.split(mention).join(token);
  output = output.replace(/EDUORCHESTRATE/g, "KORDEXA").replace(/EduOrchestrate/g, "Kordexa").replace(/eduorchestrate/g, "kordexa");
  for (const [mention, token] of LEGACY_MENTIONS) output = output.split(token).join(mention);
  return output;
}

// Per-command Claude Code slash commands. Each becomes a separate /<name>
// entry in the slash menu so the daily loop is reachable without typing npx.
const CLAUDE_COMMANDS = [
  {
    name: "eduorchestrate-status",
    description: "EduOrchestrate: current learning day, momentum, and next action",
    allowedTools: "Bash(npx kordexa status:*)",
    body: "Show the learner's EduOrchestrate status. Run `npx kordexa status` and present, using only the command output: learner, role, primary skill, currently learning, active day, progress (completed/total), momentum, risk, and the next action. Do not invent values."
  },
  {
    name: "eduorchestrate-research",
    description: "EduOrchestrate: resolve today's sourced links (video, docs, repo)",
    argumentHint: "[day]",
    allowedTools: "Bash(npx kordexa research:*), Bash(npx kordexa status:*)",
    body: "Resolve the learner's research links. If \"$ARGUMENTS\" contains a day number use it, otherwise read the current day from `npx kordexa status`. Then run `npx kordexa research --day <day>` and present the resolved top YouTube video link (with its title), the official docs, and the GitHub repo result. Keep it short and link-first."
  },
  {
    name: "eduorchestrate-send",
    description: "EduOrchestrate: preview today's learning email (dry-run, never sends)",
    allowedTools: "Bash(npx kordexa send-today --dry-run:*)",
    body: "Preview today's EduOrchestrate email. Run `npx kordexa send-today --dry-run` and summarize what would be sent: subject, the top video link, docs, build task, and timebox. This command is preview-only — never run it without --dry-run."
  },
  {
    name: "eduorchestrate-log",
    description: "EduOrchestrate: log today's progress with evidence",
    argumentHint: "<what you did> | <evidence link>",
    allowedTools: "Bash(npx kordexa log-progress:*), Bash(npx kordexa status:*)",
    body: "Log the learner's progress. Read what they completed and an evidence link/path from \"$ARGUMENTS\". If either is missing, ASK for it — never log a placeholder entry. Read the current day from `npx kordexa status`, then run `npx kordexa log-progress --day <day> --completed \"<note>\" --evidence \"<link>\"` (optionally --confidence <1-5>) and confirm the updated momentum."
  },
  {
    name: "eduorchestrate-card",
    description: "EduOrchestrate: render the skill progression card",
    allowedTools: "Bash(npx kordexa progress-card:*)",
    body: "Render the learner's skill progression card. Run `npx kordexa progress-card` and show completed/total days, the commit-style grid, and the terminal-card status lines. Mention the saved data/terminal-card.svg."
  },
  {
    name: "eduorchestrate-weekly",
    description: "EduOrchestrate: summarize a learning week",
    argumentHint: "[week]",
    allowedTools: "Bash(npx kordexa weekly-summary:*)",
    body: "Summarize a learning week. Run `npx kordexa weekly-summary --week <n>` (n from \"$ARGUMENTS\", default 1) and present planned vs completed days and the next-week focus."
  },
  {
    name: "eduorchestrate-next",
    description: "EduOrchestrate: recommend the next skill after the plan window",
    allowedTools: "Bash(npx kordexa recommend-next:*)",
    body: "Recommend the next skill. Run `npx kordexa recommend-next` and present whether the learner can advance, the recommended next skill, and the reason."
  }
];

function commandMarkdown(command) {
  const frontmatter = ["---", `description: ${command.description}`];
  if (command.argumentHint) frontmatter.push(`argument-hint: ${command.argumentHint}`);
  if (command.allowedTools) frontmatter.push(`allowed-tools: ${command.allowedTools}`);
  frontmatter.push("---", "");
  return `${frontmatter.join("\n")}${command.body}\n`;
}

export function writeAgentAdapters(rootDir = process.cwd()) {
  const outputs = [];
  // Kordexa primary adapters
  outputs.push(writeFile(rootDir, ".claude/skills/kordexa/SKILL.md", primary(claudeSkill())));
  outputs.push(writeFile(rootDir, ".kordexa/adapters/codex/AGENTS.md", primary(agentsMd())));
  outputs.push(writeFile(rootDir, ".kordexa/adapters/openclaw/SKILL.md", primary(genericSkill("openclaw"))));
  outputs.push(writeFile(rootDir, ".kordexa/adapters/antigravity/manifest.json", primary(adapterManifest("antigravity"))));
  outputs.push(writeFile(rootDir, ".kordexa/adapters/hermas/manifest.json", primary(adapterManifest("hermas"))));
  outputs.push(writeFile(rootDir, ".kordexa/adapters/generic/KORDEXA.md", primary(genericInstructions())));
  outputs.push(writeFile(rootDir, ".kordexa/mcp/server.js", primary(mcpServer())));
  outputs.push(writeFile(rootDir, ".kordexa/mcp/manifest.json", primary(mcpManifest())));

  // EduOrchestrate legacy compatibility adapters
  outputs.push(writeFile(rootDir, ".claude/skills/eduorchestrate/SKILL.md", claudeSkill()));
  outputs.push(writeManagedFile(rootDir, "AGENTS.md", primary(agentsMd())));
  outputs.push(writeManagedFile(rootDir, "GEMINI.md", primary(geminiMd())));
  outputs.push(writeFile(rootDir, ".eduorchestrate/adapters/codex/AGENTS.md", agentsMd()));
  outputs.push(writeFile(rootDir, ".eduorchestrate/adapters/openclaw/SKILL.md", genericSkill("openclaw")));
  outputs.push(writeFile(rootDir, ".eduorchestrate/adapters/antigravity/manifest.json", adapterManifest("antigravity")));
  outputs.push(writeFile(rootDir, ".eduorchestrate/adapters/hermas/manifest.json", adapterManifest("hermas")));
  outputs.push(writeFile(rootDir, ".eduorchestrate/adapters/generic/EDUORCHESTRATE.md", genericInstructions()));
  outputs.push(writeFile(rootDir, ".eduorchestrate/mcp/server.js", mcpServer()));
  outputs.push(writeFile(rootDir, ".eduorchestrate/mcp/manifest.json", mcpManifest()));

  for (const command of CLAUDE_COMMANDS) {
    outputs.push(writeFile(rootDir, `.claude/commands/${command.name}.md`, commandMarkdown(command)));
    const kordexaName = command.name.replace("eduorchestrate-", "kordexa-");
    outputs.push(writeFile(rootDir, `.claude/commands/${kordexaName}.md`, primary(commandMarkdown(command))));
  }
  return outputs;
}

function writeFile(rootDir, relativePath, content) {
  const filePath = path.join(rootDir, relativePath);
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, "utf8");
  return relativePath;
}

// AGENTS.md and GEMINI.md are shared with the learner's project, so Kordexa only
// owns the section between these markers.
function writeManagedFile(rootDir, relativePath, content) {
  const filePath = path.join(rootDir, relativePath);
  const block = `${MANAGED_START}\n${content.trimEnd()}\n${MANAGED_END}\n`;
  if (!fs.existsSync(filePath)) return writeFile(rootDir, relativePath, block);
  const existing = fs.readFileSync(filePath, "utf8");
  const start = existing.indexOf(MANAGED_START);
  const end = existing.indexOf(MANAGED_END);
  if (start >= 0 && end > start) {
    return writeFile(rootDir, relativePath, `${existing.slice(0, start)}${block.trimEnd()}${existing.slice(end + MANAGED_END.length)}`);
  }
  if (OLD_GENERATED_HEADING.test(existing)) {
    const backupPath = `${filePath}.kordexa-backup`;
    if (!fs.existsSync(backupPath)) fs.copyFileSync(filePath, backupPath);
    return writeFile(rootDir, relativePath, block);
  }
  return writeFile(rootDir, relativePath, `${existing.trimEnd()}\n\n${block}`);
}

function cliExamples() {
  return `npx kordexa
npx kordexa harness
npx kordexa courses
npx kordexa status
npx kordexa research --day 1
npx kordexa send-today --dry-run
npx kordexa log-progress --day 1 --completed "Built setup" --evidence "Repo link"
npx kordexa weekly-summary --week 1
npx kordexa progress-card
npx kordexa terminal-card
npx kordexa recommend-next`;
}

function claudeSkill() {
  return `---\nname: eduorchestrate\ndescription: Use /eduorchestrate to onboard a learner, create an adaptive job-role plan with a 30-day minimum, research trends, send daily plan emails, log progress, load the prebuilt skill progression card, summarize weeks, recommend the next skill, and review progress.\n---\n\n# EduOrchestrate\n\n${UNIVERSAL_PROMPT}\n\nRun local commands when needed:\n\n\`\`\`bash\n${cliExamples()}\n\`\`\`\n`;
}

function agentsMd() {
  return `# EduOrchestrate Agent Instructions\n\n${UNIVERSAL_PROMPT}\n\n## Command\n\nExpose or honor \`/eduorchestrate\` for this repo. If the host agent cannot register slash commands, respond to \`/eduorchestrate\`, \`eduorchestrate\`, or \`use EduOrchestrate\` as the same workflow.\n\n## Workflow\n\n1. Load \`kordexa.config.json\` when present.\n2. Ask for missing name, email, target role, current learning topic, first skill focus, current stage, desired plan days, daily email time, and timezone.\n3. Generate or update \`data/30-day-plan.json\`; never generate fewer than 30 days.\n4. Use \`npx kordexa research --day <n>\` for sourced docs, trend scans, YouTube search, and GitHub sample-code search links.\n5. Send or preview daily email with \`npx kordexa send-today --dry-run\` or \`npx kordexa send-today\`; browser/workspace agents must check and send the due daily mail on resume after SMTP setup, while GitHub Actions remains the scheduled no-browser path.\n6. Log evidence with \`npx kordexa log-progress --day <n> --completed "..." --evidence "..."\`.\n7. Do not create or type card UI in the agent. Use the prebuilt default card at \`skills/eduorchestrate/assets/default-terminal-card.svg\` or the initialized copy at \`data/default-terminal-card.svg\`.\n8. Load the compact execution harness with \`npx kordexa harness\` before doing research, mail, progress, or review work.\n9. Use \`npx kordexa courses\` for role-specific official/MNC course catalogs, free-course discovery links, and newsletters; do not default to Coursera or Udemy.\n10. When learner-specific state is needed, call the prebuilt CLI program with \`npx kordexa progress-card\` or \`npx kordexa terminal-card\`; then load \`data/progression-card.md\` or \`data/terminal-card.svg\`.\n11. Summarize with \`npx kordexa status\` and \`npx kordexa weekly-summary --week <n>\`.\n12. Recommend the next skill after the plan with \`npx kordexa recommend-next\`.\n13. Keep the learner focused on one daily build artifact.\n`;
}

function geminiMd() {
  return `# Gemini EduOrchestrate Context\n\n${UNIVERSAL_PROMPT}\n\nWhen the user types \`/eduorchestrate\`, run the EduOrchestrate workflow from \`AGENTS.md\` and prefer the NPX CLI for local state changes.\n`;
}

function genericSkill(agentName) {
  return `---\nname: eduorchestrate\ndescription: Universal EduOrchestrate adapter for ${agentName}. Use /eduorchestrate for learner onboarding, adaptive plans with a 30-day minimum, trend research, daily email plans, progress logging, prebuilt skill progression cards, weekly summaries, and next-skill recommendations.\n---\n\n# EduOrchestrate Adapter\n\n${UNIVERSAL_PROMPT}\n\nPrefer:\n\n\`\`\`bash\n${cliExamples()}\n\`\`\`\n`;
}

function adapterManifest(agentName) {
  return `${JSON.stringify({
    name: "eduorchestrate",
    command: "/eduorchestrate",
    agent: agentName,
    description: "Universal learner orchestration command for onboarding, adaptive plans with a 30-day minimum, trend research, daily emails, progress logging, prebuilt GitHub-style progression cards, weekly summaries, next-skill recommendations, setup diagnostics, and review.",
    fallbackCommands: ["eduorchestrate", "use EduOrchestrate", "npx kordexa"],
    entrypoint: "npx kordexa",
    capabilities: ["onboarding", "token-conscious-harness", "role-course-sources", "adaptive-plan-minimum-30-days", "first-skill-focus", "trend-research-digest", "resolved-top-video-link", "resolved-top-repo-link", "daily-email", "implicit-tls-and-starttls-mail", "progress-log", "progression-card", "terminal-card-svg", "weekly-summary", "next-skill-recommendation", "setup-diagnostics"],
    instructions: UNIVERSAL_PROMPT
  }, null, 2)}\n`;
}

function genericInstructions() {
  return `# Universal EduOrchestrate Adapter\n\n${UNIVERSAL_PROMPT}\n\nUse this file for agents without a documented custom slash-command format. The expected visible command is \`/eduorchestrate\`.\n\n\`\`\`bash\n${cliExamples()}\n\`\`\`\n`;
}

function mcpManifest() {
  return `${JSON.stringify({
    name: "eduorchestrate",
    command: "node .eduorchestrate/mcp/server.js",
    tools: ["eduorchestrate_onboard", "eduorchestrate_harness", "eduorchestrate_courses", "eduorchestrate_plan30", "eduorchestrate_research", "eduorchestrate_links", "eduorchestrate_send_today", "eduorchestrate_log_progress", "eduorchestrate_progress_card", "eduorchestrate_terminal_card", "eduorchestrate_weekly_summary", "eduorchestrate_recommend_next", "eduorchestrate_status"]
  }, null, 2)}\n`;
}

function mcpServer() {
  return `#!/usr/bin/env node\nimport { spawnSync } from "node:child_process";\nimport readline from "node:readline";\n\nconst tools = [\n  { name: "eduorchestrate_onboard", description: "Run EduOrchestrate onboarding." },\n  { name: "eduorchestrate_harness", description: "Create the compact token-conscious execution harness." },\n  { name: "eduorchestrate_courses", description: "Create role-specific official course, free learning, and newsletter source pack." },\n  { name: "eduorchestrate_plan30", description: "Generate a 30-day-minimum EduOrchestrate plan." },\n  { name: "eduorchestrate_research", description: "Create a sourced trend research digest for a day or topic." },\n  { name: "eduorchestrate_links", description: "Resolve and persist today's top video, repo, and doc links." },\n  { name: "eduorchestrate_send_today", description: "Send or dry-run today's learning email." },\n  { name: "eduorchestrate_log_progress", description: "Log learner progress evidence." },\n  { name: "eduorchestrate_progress_card", description: "Run the prebuilt program that writes the role, skill, GitHub-style progression, and terminal card artifacts." },\n  { name: "eduorchestrate_terminal_card", description: "Run the prebuilt program that writes the exact SVG terminal-card artifact." },\n  { name: "eduorchestrate_weekly_summary", description: "Summarize a learning week." },\n  { name: "eduorchestrate_recommend_next", description: "Recommend the next skill after the current plan window." },\n  { name: "eduorchestrate_status", description: "Show current plan and momentum status." }\n];\n\nfunction respond(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n"); }\nfunction run(args) { const out = spawnSync("npx", ["kordexa", ...args], { encoding: "utf8" }); return { stdout: out.stdout, stderr: out.stderr, status: out.status }; }\n\nconst rl = readline.createInterface({ input: process.stdin });\nrl.on("line", (line) => {\n  const msg = JSON.parse(line);\n  if (msg.method === "initialize") return respond(msg.id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "eduorchestrate", version: "0.4.2" } });\n  if (msg.method === "tools/list") return respond(msg.id, { tools });\n  if (msg.method === "tools/call") {\n    const name = msg.params?.name;\n    const args = msg.params?.arguments || {};\n    const dryRun = args.dryRun !== false;\n    if (name === "eduorchestrate_onboard") return respond(msg.id, { content: [{ type: "text", text: JSON.stringify(run(["--yes"]), null, 2) }] });\n    if (name === "eduorchestrate_harness") return respond(msg.id, { content: [{ type: "text", text: JSON.stringify(run(["harness", "--mode", args.mode || "daily"]), null, 2) }] });\n    if (name === "eduorchestrate_courses") return respond(msg.id, { content: [{ type: "text", text: JSON.stringify(run(["courses"]), null, 2) }] });\n    if (name === "eduorchestrate_plan30") return respond(msg.id, { content: [{ type: "text", text: JSON.stringify(run(["plan", "--days", String(Math.max(30, Number(args.days || 30)))]), null, 2) }] });\n    if (name === "eduorchestrate_research") return respond(msg.id, { content: [{ type: "text", text: JSON.stringify(run(["research", "--day", String(args.day || 1), ...(args.topic ? ["--topic", args.topic] : [])]), null, 2) }] });\n    if (name === "eduorchestrate_links") return respond(msg.id, { content: [{ type: "text", text: JSON.stringify(run(["links", "--day", String(args.day || 1), ...(args.topic ? ["--topic", args.topic] : [])]), null, 2) }] });\n    if (name === "eduorchestrate_send_today") return respond(msg.id, { content: [{ type: "text", text: JSON.stringify(run(["send-today", ...(dryRun ? ["--dry-run"] : [])]), null, 2) }] });\n    if (name === "eduorchestrate_log_progress") return respond(msg.id, { content: [{ type: "text", text: JSON.stringify(run(["log-progress", "--day", String(args.day || 1), "--completed", args.completed || "Completed today's task", "--evidence", args.evidence || "Evidence not provided"]), null, 2) }] });\n    if (name === "eduorchestrate_progress_card") return respond(msg.id, { content: [{ type: "text", text: JSON.stringify(run(["progress-card"]), null, 2) }] });\n    if (name === "eduorchestrate_terminal_card") return respond(msg.id, { content: [{ type: "text", text: JSON.stringify(run(["terminal-card"]), null, 2) }] });\n    if (name === "eduorchestrate_weekly_summary") return respond(msg.id, { content: [{ type: "text", text: JSON.stringify(run(["weekly-summary", "--week", String(args.week || 1)]), null, 2) }] });\n    if (name === "eduorchestrate_recommend_next") return respond(msg.id, { content: [{ type: "text", text: JSON.stringify(run(["recommend-next"]), null, 2) }] });\n    if (name === "eduorchestrate_status") return respond(msg.id, { content: [{ type: "text", text: JSON.stringify(run(["status"]), null, 2) }] });\n  }\n});\n`;
}
