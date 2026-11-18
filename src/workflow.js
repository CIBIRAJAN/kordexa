import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "./config.js";

const { version: PACKAGE_VERSION } = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const WORKFLOW_FILE = ".github/workflows/kordexa-daily.yml";
const LEGACY_WORKFLOW_FILE = ".github/workflows/eduorchestrate-daily.yml";

export function cronFromTime(time, timezone = "UTC") {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time || "08:00");
  if (!match) return "0 8 * * *";
  const hour = Math.min(23, Math.max(0, Number.parseInt(match[1], 10)));
  const minute = Math.min(59, Math.max(0, Number.parseInt(match[2], 10)));
  if (!timezone || timezone.toUpperCase() === "UTC") return `${minute} ${hour} * * *`;
  const utc = localTimeToUtc(hour, minute, timezone);
  return `${utc.minute} ${utc.hour} * * *`;
}

export function writeGithubWorkflow(config, rootDir = process.cwd()) {
  const workflowPath = path.join(rootDir, WORKFLOW_FILE);
  ensureDir(path.dirname(workflowPath));
  const existing = readIfExists(workflowPath);
  if (existing === null || isGeneratedWorkflow(existing)) {
    fs.writeFileSync(workflowPath, workflowContent(config), "utf8");
  }
  // Two scheduled workflows would send the daily email twice.
  const legacyPath = path.join(rootDir, LEGACY_WORKFLOW_FILE);
  const legacy = readIfExists(legacyPath);
  if (legacy !== null && isGeneratedWorkflow(legacy)) fs.rmSync(legacyPath);
  return workflowPath;
}

// Reports whether scheduled delivery is current, without changing any files.
export function workflowStatus(rootDir = process.cwd()) {
  const primary = readIfExists(path.join(rootDir, WORKFLOW_FILE));
  const legacy = readIfExists(path.join(rootDir, LEGACY_WORKFLOW_FILE));
  const warnings = [];
  const primaryIsCustom = primary !== null && !isGeneratedWorkflow(primary);
  const primaryIsCurrent = primary !== null && normalizeWorkflow(primary) === normalizeWorkflow(workflowContent({}));
  if (primaryIsCustom) {
    warnings.push(`${WORKFLOW_FILE} has your own changes, so Kordexa left it unchanged. Make sure it runs npx kordexa send-today.`);
  }
  if (legacy !== null && !isGeneratedWorkflow(legacy) && /send-today/.test(legacy)) {
    warnings.push(`${LEGACY_WORKFLOW_FILE} has your own changes, so Kordexa left it unchanged. Remove its schedule to avoid sending the daily email twice.`);
  }
  const customRunsKordexa = primaryIsCustom && /npx (?:--yes )?kordexa(?:@\S+)? send-today/.test(primary);
  const current = primaryIsCurrent || customRunsKordexa;
  const outdated = !current && (primary !== null || legacy !== null);
  return { current, outdated, warnings };
}

export function workflowContent(config) {
  const time = config.schedule?.dailyEmailTime || "08:00";
  const timezone = config.schedule?.timezone || "UTC";
  return [
    "name: Kordexa Daily Plan",
    "",
    "on:",
    "  schedule:",
    `    # GitHub Actions cron is UTC. Generated from ${time} ${timezone}.`,
    `    - cron: "${cronFromTime(config.schedule?.dailyEmailTime, config.schedule?.timezone)}"`,
    "  workflow_dispatch:",
    "",
    "permissions:",
    "  contents: read",
    "",
    "jobs:",
    "  send-daily-plan:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: actions/setup-node@v4",
    "        with:",
    '          node-version: "20"',
    "      - name: Send today's Kordexa email",
    "        env:",
    "          SMTP_HOST: ${{ secrets.SMTP_HOST }}",
    "          SMTP_PORT: ${{ secrets.SMTP_PORT }}",
    "          SMTP_USER: ${{ secrets.SMTP_USER }}",
    "          SMTP_PASS: ${{ secrets.SMTP_PASS }}",
    "          SMTP_FROM: ${{ secrets.SMTP_FROM }}",
    "          RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}",
    "          RESEND_FROM: ${{ secrets.RESEND_FROM }}",
    `        run: npx --yes kordexa@${PACKAGE_VERSION} send-today`,
    ""
  ].join("\n");
}

function previousWorkflow(brand, runCommand) {
  return [
    `name: ${brand} Daily Plan`,
    "",
    "on:",
    "  schedule:",
    "    # GitHub Actions cron is UTC. Generated from 08:00 UTC.",
    '    - cron: "0 8 * * *"',
    "  workflow_dispatch:",
    "",
    "jobs:",
    "  send-daily-plan:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: actions/setup-node@v4",
    "        with:",
    '          node-version: "20"',
    "      - run: npm install --no-package-lock",
    `      - name: Send today's ${brand} email`,
    "        env:",
    "          SMTP_HOST: ${{ secrets.SMTP_HOST }}",
    "          SMTP_PORT: ${{ secrets.SMTP_PORT }}",
    "          SMTP_USER: ${{ secrets.SMTP_USER }}",
    "          SMTP_PASS: ${{ secrets.SMTP_PASS }}",
    "          SMTP_FROM: ${{ secrets.SMTP_FROM }}",
    `        run: ${runCommand}`,
    ""
  ].join("\n");
}

// Learner-specific values are ignored, so any other difference means the file
// was edited by hand and must not be replaced.
function normalizeWorkflow(content) {
  return content
    .replace(/\r\n/g, "\n")
    .replace(/# GitHub Actions cron is UTC\. Generated from .*/, "# schedule")
    .replace(/- cron: ".*"/, '- cron: "schedule"')
    .replace(/kordexa@\S+ send-today/, "kordexa@version send-today")
    .trim();
}

const GENERATED_WORKFLOWS = new Set([
  workflowContent({}),
  workflowContent({}).replace(/ {10}RESEND_API_KEY: .*\n {10}RESEND_FROM: .*\n/, ""),
  previousWorkflow("Kordexa", "node bin/kordexa.js send-today || node bin/eduorchestrate.js send-today"),
  previousWorkflow("EduOrchestrate", "node bin/eduorchestrate.js send-today")
].map(normalizeWorkflow));

function isGeneratedWorkflow(content) {
  return GENERATED_WORKFLOWS.has(normalizeWorkflow(content));
}

function readIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
}

function localTimeToUtc(hour, minute, timezone) {
  try {
    const now = new Date();
    const candidate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute));
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    });
    const parts = Object.fromEntries(formatter.formatToParts(candidate).map((part) => [part.type, part.value]));
    const seenMinutes = Number.parseInt(parts.hour, 10) * 60 + Number.parseInt(parts.minute, 10);
    const desiredMinutes = hour * 60 + minute;
    const corrected = new Date(candidate.getTime() + (desiredMinutes - seenMinutes) * 60 * 1000);
    return { hour: corrected.getUTCHours(), minute: corrected.getUTCMinutes() };
  } catch {
    return { hour, minute };
  }
}
