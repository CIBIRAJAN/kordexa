import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { main } from "../../src/cli.js";

process.env.KORDEXA_OFFLINE = "1";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SETUP = ["--yes", "--name", "Learner", "--email", "learner@example.com", "--role", "Data Scientist", "--days", "30", "--offline"];

async function inTempDir(fn) {
  const oldCwd = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kordexa-"));
  process.chdir(dir);
  const originalLog = console.log;
  console.log = () => {};
  try {
    return await fn(dir);
  } finally {
    console.log = originalLog;
    process.chdir(oldCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  });
}

test("package installs under the kordexa name without claiming the upstream command", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  assert.equal(pkg.name, "kordexa");
  assert.equal(pkg.bin.kordexa, "bin/kordexa.js");
  assert.equal(pkg.bin.eduorchestrate, undefined);
});

test("license keeps the original author's copyright notice", () => {
  const license = fs.readFileSync(path.join(repoRoot, "LICENSE"), "utf8");
  assert.match(license, /Copyright \(c\) 2026 Haroon K M \(EduOrchestrate\)/);
});

test("scheduled workflow runs the published package in a learner project", async () => {
  await inTempDir(async (dir) => {
    await main(SETUP);
    const { version } = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
    const workflow = fs.readFileSync(path.join(dir, ".github/workflows/kordexa-daily.yml"), "utf8");
    assert.ok(workflow.includes(`run: npx --yes kordexa@${version} send-today`));
    assert.doesNotMatch(workflow, /bin\/kordexa\.js|npm install/);
    assert.match(workflow, /SMTP_PASS: \$\{\{ secrets\.SMTP_PASS \}\}/);
  });
});

test("setup creates one scheduled workflow so email is not sent twice", async () => {
  await inTempDir(async (dir) => {
    await main(SETUP);
    assert.deepEqual(fs.readdirSync(path.join(dir, ".github/workflows")), ["kordexa-daily.yml"]);
  });
});

test("harness follows the learner's active day", async () => {
  await inTempDir(async (dir) => {
    await main(SETUP);
    await main(["log-progress", "--day", "1", "--completed", "Set up", "--evidence", "repo"]);
    await main(["log-progress", "--day", "2", "--completed", "Basics", "--evidence", "repo"]);
    await main(["harness"]);
    const harness = JSON.parse(fs.readFileSync(path.join(dir, "data/kordexa-harness.json"), "utf8"));
    const plan = JSON.parse(fs.readFileSync(path.join(dir, "data/30-day-plan.json"), "utf8"));
    assert.equal(harness.activeDay.day, 3);
    assert.equal(harness.activeDay.title, plan.days[2].title);
  });
});

test("no generated file tells an agent to run the upstream package", async () => {
  await inTempDir(async (dir) => {
    await main(SETUP);
    for (const file of filesUnder(dir)) {
      if (file.endsWith("init.json")) continue;
      assert.doesNotMatch(fs.readFileSync(file, "utf8"), /npx eduorchestrate|"eduorchestrate", \.\.\.args/, path.relative(dir, file));
    }
  });
});

test("primary adapters use the Kordexa name and legacy slash commands remain", async () => {
  await inTempDir(async (dir) => {
    await main(SETUP);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, ".kordexa/mcp/manifest.json"), "utf8"));
    assert.equal(manifest.command, "node .kordexa/mcp/server.js");
    assert.ok(manifest.tools.includes("kordexa_status"));
    assert.match(fs.readFileSync(path.join(dir, ".claude/skills/kordexa/SKILL.md"), "utf8"), /^---\nname: kordexa\n/);
    assert.match(fs.readFileSync(path.join(dir, ".claude/skills/eduorchestrate/SKILL.md"), "utf8"), /^---\nname: eduorchestrate\n/);
    assert.equal(fs.existsSync(path.join(dir, ".claude/commands/eduorchestrate-status.md")), true);
  });
});

