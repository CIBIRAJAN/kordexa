import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { main } from "../../src/cli.js";
import { loadConfig } from "../../src/config.js";

process.env.KORDEXA_OFFLINE = "1";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SETUP = ["--yes", "--offline", "--name", "Asha", "--email", "asha@example.com", "--role", "Data Scientist", "--skill", "pandas", "--days", "45"];
const RERUN = ["--yes", "--offline"];
const WORKFLOWS = ".github/workflows";

// Runs a CLI command and returns the JSON it printed.
async function run(argv) {
  const printed = [];
  const originalLog = console.log;
  console.log = (line) => printed.push(line);
  try {
    await main(argv);
  } finally {
    console.log = originalLog;
  }
  return printed.length ? JSON.parse(printed.at(-1)) : null;
}

async function inTempDir(fn) {
  const oldCwd = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kordexa-safe-"));
  process.chdir(dir);
  try {
    return await fn(dir);
  } finally {
    process.chdir(oldCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function write(dir, relative, content) {
  const filePath = path.join(dir, relative);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

const readText = (dir, relative) => fs.readFileSync(path.join(dir, relative), "utf8");
const readJson = (dir, relative) => JSON.parse(readText(dir, relative));

function previousWorkflow(brand, runCommand) {
  return `name: ${brand} Daily Plan

on:
  schedule:
    # GitHub Actions cron is UTC. Generated from 07:30 Asia/Kolkata.
    - cron: "0 2 * * *"
  workflow_dispatch:

jobs:
  send-daily-plan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm install --no-package-lock
      - name: Send today's ${brand} email
        env:
          SMTP_HOST: \${{ secrets.SMTP_HOST }}
          SMTP_PORT: \${{ secrets.SMTP_PORT }}
          SMTP_USER: \${{ secrets.SMTP_USER }}
          SMTP_PASS: \${{ secrets.SMTP_PASS }}
          SMTP_FROM: \${{ secrets.SMTP_FROM }}
        run: ${runCommand}
`;
}

test("setup keeps a project's own AGENTS.md and GEMINI.md content", async () => {
  await inTempDir(async (dir) => {
    write(dir, "AGENTS.md", "# My team rules\n\nAlways run the linter.\n");
    write(dir, "GEMINI.md", "# My Gemini rules\n");
    await run(SETUP);
    await run(RERUN);

    const agents = readText(dir, "AGENTS.md");
    assert.match(agents, /^# My team rules\n\nAlways run the linter\./);
    assert.match(agents, /npx kordexa/);
    assert.equal(agents.match(/<!-- kordexa:start -->/g).length, 1, "managed section is not duplicated");
    assert.match(readText(dir, "GEMINI.md"), /^# My Gemini rules/);
  });
});

test("content a learner adds around the managed section survives setup", async () => {
  await inTempDir(async (dir) => {
    await run(SETUP);
    fs.appendFileSync(path.join(dir, "AGENTS.md"), "\n## Added later\n");
    await run(RERUN);
    assert.match(readText(dir, "AGENTS.md"), /<!-- kordexa:end -->\n+## Added later/);
  });
});

test("an old generated AGENTS.md is upgraded and backed up", async () => {
  await inTempDir(async (dir) => {
    write(dir, "AGENTS.md", "# EduOrchestrate Agent Instructions\n\nRun npx eduorchestrate status.\n");
    await run(SETUP);
    assert.doesNotMatch(readText(dir, "AGENTS.md"), /npx eduorchestrate/);
    assert.match(readText(dir, "AGENTS.md.kordexa-backup"), /npx eduorchestrate status/);
  });
});

test("re-running setup keeps email login and other local settings", async () => {
  await inTempDir(async (dir) => {
    await run(SETUP);
    write(dir, ".env.local", "# my notes\nSMTP_HOST=smtp.example.com\nSMTP_PORT=587\nSMTP_USER=me@example.com\nSMTP_PASS=test-value\nSMTP_FROM=me@example.com\nGITHUB_TOKEN=test-token\n");
    await run(RERUN);
    const env = readText(dir, ".env.local");
    for (const line of ["# my notes", "SMTP_HOST=smtp.example.com", "SMTP_PORT=587", "SMTP_USER=me@example.com", "SMTP_PASS=test-value", "SMTP_FROM=me@example.com", "GITHUB_TOKEN=test-token"]) {
      assert.ok(env.split("\n").includes(line), line);
    }
  });
});

test("setup flags can still change one saved email setting", async () => {
  await inTempDir(async (dir) => {
    await run(SETUP);
    write(dir, ".env.local", "SMTP_HOST=smtp.example.com\nSMTP_PASS=test-value\n");
    await run([...RERUN, "--smtp-host", "smtp.new.example.com"]);
    const env = readText(dir, ".env.local").split("\n");
    assert.ok(env.includes("SMTP_HOST=smtp.new.example.com"));
    assert.ok(env.includes("SMTP_PASS=test-value"));
  });
});

test("re-running setup keeps the learner's profile", async () => {
  await inTempDir(async (dir) => {
    await run(SETUP);
    await run(RERUN);
    const config = readJson(dir, "kordexa.config.json");
    assert.equal(config.learner.name, "Asha");
    assert.equal(config.learner.targetRole, "Data Scientist");
    assert.equal(config.learner.focusSkill, "pandas");
    assert.equal(config.learner.planDays, 45);
    assert.equal(readJson(dir, "data/30-day-plan.json").days.length, 45);
  });
});

test("re-running setup keeps the start date unless a restart is requested", async () => {
  await inTempDir(async (dir) => {
    await run(SETUP);
    const config = readJson(dir, "kordexa.config.json");
    config.schedule.startDate = "2026-01-01";
    write(dir, "kordexa.config.json", JSON.stringify(config));

    await run(RERUN);
    assert.equal(readJson(dir, "kordexa.config.json").schedule.startDate, "2026-01-01");

    await run([...RERUN, "--restart"]);
    assert.notEqual(readJson(dir, "kordexa.config.json").schedule.startDate, "2026-01-01");
  });
});

test("package does not install a command owned by the upstream project", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  assert.deepEqual(Object.keys(pkg.bin), ["kordexa"]);
  assert.equal(fs.existsSync(path.join(repoRoot, "bin/eduorchestrate.js")), false);
});

for (const [brand, runCommand] of [
  ["EduOrchestrate", "node bin/eduorchestrate.js send-today"],
  ["Kordexa", "node bin/kordexa.js send-today || node bin/eduorchestrate.js send-today"]
]) {
  test(`setup replaces the old generated ${brand} workflow`, async () => {
    await inTempDir(async (dir) => {
      write(dir, `${WORKFLOWS}/eduorchestrate-daily.yml`, previousWorkflow(brand, runCommand));
      await run(SETUP);
      assert.deepEqual(fs.readdirSync(path.join(dir, WORKFLOWS)), ["kordexa-daily.yml"]);
    });
  });
}

test("setup keeps a customized legacy workflow and warns about duplicate email", async () => {
  await inTempDir(async (dir) => {
    const custom = previousWorkflow("EduOrchestrate", "node bin/eduorchestrate.js send-today").replace("      - run: npm install --no-package-lock\n", "      - run: ./notify-team.sh\n");
    write(dir, `${WORKFLOWS}/eduorchestrate-daily.yml`, custom);
    const output = await run(SETUP);
    assert.equal(readText(dir, `${WORKFLOWS}/eduorchestrate-daily.yml`), custom);
    assert.match(output.warnings.join(" "), /sending the daily email twice/);
  });
});

test("setup does not overwrite a customized Kordexa workflow", async () => {
  await inTempDir(async (dir) => {
    const custom = "name: My schedule\njobs:\n  send:\n    steps:\n      - run: npx kordexa send-today\n";
    write(dir, `${WORKFLOWS}/kordexa-daily.yml`, custom);
    const output = await run(SETUP);
    assert.equal(readText(dir, `${WORKFLOWS}/kordexa-daily.yml`), custom);
    assert.match(output.warnings.join(" "), /left it unchanged/);
  });
});

test("setup leaves an unrelated learner workflow alone without warnings", async () => {
  await inTempDir(async (dir) => {
    write(dir, `${WORKFLOWS}/eduorchestrate-daily.yml`, "name: My own workflow\n");
    const output = await run(SETUP);
    assert.equal(readText(dir, `${WORKFLOWS}/eduorchestrate-daily.yml`), "name: My own workflow\n");
    assert.equal(output.warnings, undefined);
  });
});

test("doctor reports missing email login without exposing saved values", async () => {
  await inTempDir(async (dir) => {
    await run(SETUP);
    const missing = await run(["doctor"]);
    assert.equal(missing.status, "needs-email-setup");
    assert.equal(missing.checks.localEmail, false);
    assert.match(missing.nextSteps.join(" "), /SMTP_USER, SMTP_PASS/);

    fs.appendFileSync(path.join(dir, ".env.local"), "SMTP_USER=me@example.com\nSMTP_PASS=test-value\n");
    const ready = await run(["doctor"]);
    assert.equal(ready.status, "ready");
    assert.doesNotMatch(JSON.stringify(ready), /test-value/);
  });
});

test("doctor guides an older project through a safe workflow upgrade", async () => {
  await inTempDir(async (dir) => {
    await run(SETUP);
    fs.appendFileSync(path.join(dir, ".env.local"), "SMTP_USER=me@example.com\nSMTP_PASS=test-value\n");
    fs.rmSync(path.join(dir, `${WORKFLOWS}/kordexa-daily.yml`));
    write(dir, `${WORKFLOWS}/eduorchestrate-daily.yml`, previousWorkflow("EduOrchestrate", "node bin/eduorchestrate.js send-today"));

    const before = await run(["doctor"]);
    assert.equal(before.status, "needs-upgrade");
    assert.match(before.nextSteps.join(" "), /npx kordexa --yes/);

    await run(RERUN);
    assert.equal((await run(["doctor"])).status, "ready");
    assert.ok(readText(dir, ".env.local").split("\n").includes("SMTP_PASS=test-value"));
  });
});

test("the primary config wins even when the legacy file is newer", async () => {
  await inTempDir(async (dir) => {
    await run(SETUP);
    const config = readJson(dir, "kordexa.config.json");
    write(dir, "eduorchestrate.config.json", JSON.stringify({ ...config, schedule: { ...config.schedule, dailyEmailTime: "23:00" } }));
    config.schedule.dailyEmailTime = "06:00";
    write(dir, "kordexa.config.json", JSON.stringify(config));
    const future = new Date(Date.now() + 86400000);
    fs.utimesSync(path.join(dir, "eduorchestrate.config.json"), future, future);
    assert.equal(loadConfig(dir).schedule.dailyEmailTime, "06:00");
  });
});

test("a project with only the legacy config still loads", async () => {
  await inTempDir(async (dir) => {
    await run(SETUP);
    fs.renameSync(path.join(dir, "kordexa.config.json"), path.join(dir, "eduorchestrate.config.json"));
    assert.equal(loadConfig(dir).learner.name, "Asha");
  });
});

test("setup writes one config file", async () => {
  await inTempDir(async (dir) => {
    await run(SETUP);
    assert.equal(fs.existsSync(path.join(dir, "kordexa.config.json")), true);
    assert.equal(fs.existsSync(path.join(dir, "eduorchestrate.config.json")), false);
  });
});

test("active day is the earliest unfinished day after back-filling", async () => {
  await inTempDir(async (dir) => {
    await run(SETUP);
    const log = (day) => run(["log-progress", "--day", String(day), "--completed", "Work", "--evidence", "repo"]);
    await log(1);
    await log(2);
    await log(4);
    await log(3);
    assert.equal((await run(["status"])).activeDay, 5);

    await log(7);
    assert.equal((await run(["status"])).activeDay, 5);
    await run(["harness"]);
    assert.equal(readJson(dir, "data/kordexa-harness.json").activeDay.day, 5);
  });
});

test("active day stays on the last day when the plan is complete", async () => {
  await inTempDir(async (dir) => {
    await run(SETUP);
    const entries = Array.from({ length: 45 }, (_, index) => ({ day: index + 1, completed: "Work", evidence: "repo", minutes: 60, confidence: 4, blocker: "" }));
    write(dir, "data/progress-log.json", JSON.stringify(entries));
    assert.equal((await run(["status"])).activeDay, 45);
  });
});

test("log-progress without a day records the earliest unfinished day", async () => {
  await inTempDir(async () => {
    await run(SETUP);
    await run(["log-progress", "--day", "1", "--completed", "Work", "--evidence", "repo"]);
    await run(["log-progress", "--day", "3", "--completed", "Work", "--evidence", "repo"]);
    const output = await run(["log-progress", "--completed", "Work", "--evidence", "repo"]);
    assert.equal(output.entry.day, 2);
  });
});

test("canonical skill still honors the legacy eduorchestrate trigger", () => {
  const skill = fs.readFileSync(path.join(repoRoot, "skills/kordexa/SKILL.md"), "utf8");
  assert.match(skill, /\(or legacy `eduorchestrate`\)/);
});
