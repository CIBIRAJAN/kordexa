import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "./config.js";

const { version: PACKAGE_VERSION } = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const GENERATED_WORKFLOW = /name: (?:Kordexa|EduOrchestrate) Daily Plan[\s\S]*send-today/;

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
  const workflowPath = path.join(rootDir, ".github/workflows/kordexa-daily.yml");
  ensureDir(path.dirname(workflowPath));
  fs.writeFileSync(workflowPath, workflowContent(config), "utf8");
  removeGeneratedLegacyWorkflow(rootDir);
  return workflowPath;
}

// Two scheduled workflows would send the daily email twice. Only a file this
// tool generated is removed, so a learner's own workflow is left alone.
function removeGeneratedLegacyWorkflow(rootDir) {
  const legacyPath = path.join(rootDir, ".github/workflows/eduorchestrate-daily.yml");
  if (fs.existsSync(legacyPath) && GENERATED_WORKFLOW.test(fs.readFileSync(legacyPath, "utf8"))) {
    fs.rmSync(legacyPath);
  }
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
    `        run: npx --yes kordexa@${PACKAGE_VERSION} send-today`,
    ""
  ].join("\n");
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
