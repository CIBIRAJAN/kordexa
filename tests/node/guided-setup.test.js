import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { generate30DayPlan } from "../../src/planner.js";
import { SetupCancelled, askEmailDelivery, collectOnboarding } from "../../src/prompts.js";
import {
  ROLE_OPTIONS,
  cleanText,
  parseCurrentLearning,
  parseEmail,
  parseEmailTime,
  parseGmailAppPassword,
  parseName,
  parsePlanDays,
  parseRole,
  parseSkill,
  parseSmtpHost,
  parseSmtpPort,
  parseStage,
  parseTimezone,
  parseWeeklyHours,
  skillSuggestions
} from "../../src/setup-answers.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CLI = path.join(repoRoot, "bin/kordexa.js");

function accepts(parse, cases) {
  for (const [input, expected] of cases) {
    const result = parse(input);
    assert.equal(result.ok, true, `should accept ${JSON.stringify(input)}: ${result.error}`);
    assert.equal(result.value, expected, JSON.stringify(input));
  }
}

function rejects(parse, inputs) {
  for (const input of inputs) {
    const result = parse(input);
    assert.equal(result.ok, false, `should reject ${JSON.stringify(input)}`);
    assert.ok(result.error.length > 10, "gives a helpful message");
  }
}

// Plays scripted answers and records everything shown to the learner.
function scriptedIO(answers) {
  const queue = [...answers];
  const shown = [];
  const next = (label) => {
    shown.push(label);
    if (!queue.length) throw new SetupCancelled();
    return Promise.resolve(queue.shift());
  };
  return { say: (text = "") => shown.push(text), ask: next, askHidden: next, shown, remaining: queue };
}

function runCli(args, { input = "", cwd, env = {} } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    input,
    encoding: "utf8",
    env: { ...process.env, KORDEXA_OFFLINE: "1", ...env }
  });
}

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kordexa-guided-"));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const GOOD_ANSWERS = ["Asha", "asha@gmail.com", "1", "", "", "1", "10", "30", "20:00", "IST", "", ""];

test("text cleaning removes arrow keys, control characters, quotes and extra spaces", () => {
  assert.equal(cleanText("  Asha   Rao \t"), "Asha Rao");
  assert.equal(cleanText("\u001b[AAsha\u001b[D"), "Asha");
  assert.equal(cleanText('"Asha"'), "Asha");
  assert.equal(cleanText(undefined), "");
});

test("name accepts real names and rejects empty or meaningless answers", () => {
  accepts(parseName, [["cibi", "cibi"], ["  Asha Rao ", "Asha Rao"], ["சிபி", "சிபி"], ["O'Neil", "O'Neil"]]);
  rejects(parseName, ["", "   ", "no", "none", "N/A", "idk", "123", "!!!", "x".repeat(61)]);
});

test("email rejects bad formats, common typos and placeholders", () => {
  accepts(parseEmail, [["name@gmail.com", "name@gmail.com"], ["a.b+c@mail.example.co.in", "a.b+c@mail.example.co.in"]]);
  rejects(parseEmail, ["", "no", "name", "name@", "@gmail.com", "name@gmail", "a b@gmail.com", "a@@gmail.com", "name@gmail..com"]);
  assert.match(parseEmail("name@gmial.com").error, /name@gmail\.com/);
  assert.equal(parseEmail("you@example.com", { allowPlaceholder: false }).ok, false);
});

test("role accepts menu numbers and job titles", () => {
  accepts(parseRole, [["1", ROLE_OPTIONS[0]], ["4", ROLE_OPTIONS[3]], ["data scientist", "Data Scientist"], ["ML Engineer", "ML Engineer"], ["no", ROLE_OPTIONS[0]], ["", ROLE_OPTIONS[0]]]);
  rejects(parseRole, ["0", "5", "99", "!!!", "x", "y".repeat(81)]);
  assert.match(parseRole("Product Designer").note, /no dedicated plan/);
  assert.match(parseRole("ML Engineer").note, /Data Scientist plan/);
});

test("current learning treats no-style answers as not started", () => {
  for (const input of ["", "no", "No.", "nope", "none", "nothing", "n/a", "not yet", "Not started yet", "idk", "I don't know", "-"]) {
    assert.equal(parseCurrentLearning(input).value, "not started yet", input);
  }
  accepts(parseCurrentLearning, [["Python basics", "Python basics"]]);
  rejects(parseCurrentLearning, ["???", "x".repeat(121)]);
});

test("skill recommends a choice when the learner is unsure", () => {
  for (const input of ["", "no", "idk", "not sure", "skip"]) {
    assert.equal(parseSkill(input, "Data Scientist").value, "pandas", input);
  }
  accepts((raw) => parseSkill(raw, "Cybersecurity Analyst"), [["1", "SIEM"], ["4", "Phishing"], ["log analysis", "log analysis"]]);
  rejects((raw) => parseSkill(raw, "Data Scientist"), ["0", "5", "123456", "!!!"]);
});

test("every suggested skill matches real topics in its role's plan", () => {
  for (const role of ROLE_OPTIONS) {
    for (const focusSkill of skillSuggestions(role)) {
      const plan = generate30DayPlan({ targetRole: role, focusSkill, planDays: 30 });
      assert.doesNotMatch(plan.days[1].title, /^Primary skill focus/, `${role}: ${focusSkill}`);
    }
  }
});

test("stage accepts numbers and words and rejects anything else", () => {
  accepts(parseStage, [["1", "beginner"], ["2", "intermediate"], ["3", "advanced"], ["Beginner", "beginner"], ["INTER", "intermediate"], ["expert", "advanced"], ["fresher", "beginner"], ["", "beginner"], ["no", "beginner"]]);
  rejects(parseStage, ["0", "4", "banana", "-1"]);
});

test("weekly hours accepts natural answers and rejects impossible ones", () => {
  accepts(parseWeeklyHours, [["10", 10], ["10 hours", 10], ["8h", 8], ["7.5", 8], ["10 hours per week", 10], ["80", 80]]);
  rejects(parseWeeklyHours, ["", "abc", "0", "-5", "81", "1000", "ten", "no"]);
});

test("plan length enforces the 30-day minimum and a maximum", () => {
  accepts(parsePlanDays, [["30", 30], ["45 days", 45], ["10", 30], ["1", 30], ["0", 30], ["6 weeks", 42], ["2 months", 60], ["365", 365]]);
  assert.match(parsePlanDays("10").note, /start at 30 days/);
  rejects(parsePlanDays, ["", "abc", "-30", "366", "99999", "4.5", "no"]);
});

test("email time understands common formats and rejects impossible times", () => {
  accepts(parseEmailTime, [["20:00", "20:00"], ["8:30", "08:30"], ["8", "08:00"], ["8pm", "20:00"], ["8 PM", "20:00"], ["8:30 pm", "20:30"], ["12am", "00:00"], ["12pm", "12:00"], ["20.15", "20:15"], ["2000", "20:00"], ["noon", "12:00"], ["midnight", "00:00"]]);
  rejects(parseEmailTime, ["", "abc", "24:00", "99:99", "13pm", "0pm", "8:60", "-1", "no"]);
});

test("timezone understands codes, cities and full names", () => {
  accepts(parseTimezone, [["IST", "Asia/Kolkata"], ["ist", "Asia/Kolkata"], ["India", "Asia/Kolkata"], ["Chennai", "Asia/Kolkata"], ["Asia/Calcutta", "Asia/Kolkata"], ["Asia/Kolkata", "Asia/Kolkata"], ["UTC", "UTC"], ["GMT", "UTC"], ["London", "Europe/London"], ["new york", "America/New_York"], ["PST", "America/Los_Angeles"], ["UTC+5:30", "Asia/Kolkata"]]);
  rejects(parseTimezone, ["", "abc", "Mars/Base", "no", "123", "XYZ"]);
});

test("mail settings reject invalid values", () => {
  accepts(parseSmtpHost, [["smtp.zoho.com", "smtp.zoho.com"], ["SMTP.Gmail.com", "smtp.gmail.com"], ["smtp://smtp.zoho.com", "smtp.zoho.com"]]);
  rejects(parseSmtpHost, ["", "no", "localhost", "smtp zoho com", "me@gmail.com"]);
  accepts(parseSmtpPort, [["587", 587], ["465", 465]]);
  rejects(parseSmtpPort, ["", "0", "70000", "abc", "-1"]);
  accepts(parseGmailAppPassword, [["abcd efgh ijkl mnop", "abcdefghijklmnop"]]);
  rejects(parseGmailAppPassword, ["", "short", "my-normal-password", "abcd1234abcd1234"]);
});

test("guided setup completes with simple answers and skips email by default", async () => {
  const io = scriptedIO(GOOD_ANSWERS);
  const answers = await collectOnboarding({ io });
  assert.equal(answers.learner.name, "Asha");
  assert.equal(answers.learner.targetRole, ROLE_OPTIONS[0]);
  assert.equal(answers.learner.currentLearning, "not started yet");
  assert.equal(answers.learner.focusSkill, "RAG");
  assert.equal(answers.learner.weeklyHours, 10);
  assert.equal(answers.schedule.timezone, "Asia/Kolkata");
  assert.equal(answers.emailConnected, false);
  assert.equal(io.remaining.length, 0);
});

test("guided setup never mentions SMTP unless the learner chooses another provider", async () => {
  const io = scriptedIO(GOOD_ANSWERS);
  await collectOnboarding({ io });
  assert.doesNotMatch(io.shown.join("\n"), /SMTP/i);
});

test("pressing Enter on required questions asks again with a clear message", async () => {
  const io = scriptedIO(["", "   ", "Asha", "", "asha@gmail.com", ...GOOD_ANSWERS.slice(2)]);
  const answers = await collectOnboarding({ io });
  assert.equal(answers.learner.name, "Asha");
  assert.equal(io.shown.filter((line) => /Please enter your name/.test(line)).length, 2);
  assert.ok(io.shown.some((line) => /Please enter your email/.test(line)));
});

test("pressing Enter on every optional question uses safe defaults", async () => {
  const io = scriptedIO(["Asha", "asha@gmail.com", "", "", "", "", "", "", "", "", "", ""]);
  const answers = await collectOnboarding({ io });
  assert.equal(answers.learner.targetRole, ROLE_OPTIONS[0]);
  assert.equal(answers.learner.focusSkill, "RAG");
  assert.equal(answers.learner.currentStage, "beginner");
  assert.equal(answers.learner.weeklyHours, 8);
  assert.equal(answers.learner.planDays, 30);
  assert.equal(answers.schedule.dailyEmailTime, "08:00");
  assert.ok(parseTimezone(answers.schedule.timezone).ok);
});

test("wrong answers are explained and asked again at every question", async () => {
  const io = scriptedIO([
    "no", "Asha",
    "notanemail", "asha@gmail.com",
    "9", "1",
    "???", "Python",
    "99", "RAG",
    "banana", "2",
    "abc", "12",
    "9999", "45",
    "25:00", "8pm",
    "Mars", "Chennai",
    "7", "3",
    "99", ""
  ]);
  const answers = await collectOnboarding({ io });
  assert.equal(answers.learner.currentStage, "intermediate");
  assert.equal(answers.learner.planDays, 45);
  assert.equal(answers.schedule.dailyEmailTime, "20:00");
  assert.equal(io.shown.filter((line) => /^ {2}! /.test(line)).length, 12);
});

test("review step can change an answer before saving", async () => {
  const io = scriptedIO([...GOOD_ANSWERS.slice(0, -1), "1", "Asha Rao", ""]);
  assert.equal((await collectOnboarding({ io })).learner.name, "Asha Rao");
});

test("changing the role in review asks for a matching first skill", async () => {
  const io = scriptedIO([...GOOD_ANSWERS.slice(0, -1), "3", "4", "", ""]);
  const answers = await collectOnboarding({ io });
  assert.equal(answers.learner.targetRole, "Data Scientist");
  assert.equal(answers.learner.focusSkill, "pandas");
});

test("quit stops setup at any question", async () => {
  await assert.rejects(collectOnboarding({ io: scriptedIO(["Asha", "quit"]) }), SetupCancelled);
});

test("Gmail setup asks only for an app password and retries a normal password", async () => {
  const io = scriptedIO(["1", "my-normal-password", "abcd efgh ijkl mnop"]);
  const email = await askEmailDelivery(io, { email: "asha@gmail.com" });
  assert.deepEqual(email, { smtpHost: "smtp.gmail.com", smtpPort: 465, smtpUser: "asha@gmail.com", smtpPass: "abcdefghijklmnop", smtpFrom: "asha@gmail.com" });
  assert.doesNotMatch(io.shown.join("\n"), /abcd efgh|my-normal-password/);
});

test("pressing Enter at any email login step skips email safely", async () => {
  assert.deepEqual(await askEmailDelivery(scriptedIO(["1", ""]), { email: "asha@gmail.com" }), {});
  assert.deepEqual(await askEmailDelivery(scriptedIO(["2", ""]), { email: "asha@gmail.com" }), {});
  assert.deepEqual(await askEmailDelivery(scriptedIO(["2", "smtp.zoho.com", "", "", ""]), { email: "asha@zoho.com" }), {});
  assert.deepEqual(await askEmailDelivery(scriptedIO([""]), { email: "asha@gmail.com" }), {});
});

test("another provider validates its settings", async () => {
  const io = scriptedIO(["2", "not a server", "smtp.zoho.com", "abc", "587", "", "app-secret"]);
  const email = await askEmailDelivery(io, { email: "asha@zoho.com" });
  assert.deepEqual(email, { smtpHost: "smtp.zoho.com", smtpPort: 587, smtpUser: "asha@zoho.com", smtpPass: "app-secret", smtpFrom: "asha@zoho.com" });
});

test("a saved email login is kept by pressing Enter and never shown", async () => {
  const io = scriptedIO([""]);
  assert.deepEqual(await askEmailDelivery(io, { email: "a@gmail.com", smtpUser: "a@gmail.com", smtpPass: "saved-secret" }), {});
  assert.doesNotMatch(io.shown.join("\n"), /saved-secret/);
});

test("non-interactive setup rejects every invalid option and writes nothing", () => {
  withTempDir((dir) => {
    const result = runCli(["--yes", "--offline", "--name", "123", "--email", "bad", "--stage", "banana", "--weekly-hours", "abc", "--days", "xyz", "--time", "99:99", "--timezone", "Mars"], { cwd: dir });
    assert.equal(result.status, 1);
    for (const flag of ["--name", "--email", "--stage", "--weekly-hours", "--days", "--time", "--timezone"]) {
      assert.ok(result.stderr.includes(flag), flag);
    }
    assert.deepEqual(fs.readdirSync(dir), []);
  });
});

test("unknown options and missing values are explained", () => {
  withTempDir((dir) => {
    assert.match(runCli(["--yes", "--emial", "a@gmail.com"], { cwd: dir }).stderr, /Unknown option "--emial"/);
    assert.match(runCli(["--yes", "--email"], { cwd: dir }).stderr, /add a value after --email/);
    assert.deepEqual(fs.readdirSync(dir), []);
  });
});

test("a mistyped command suggests the right one instead of starting setup", () => {
  withTempDir((dir) => {
    const result = runCli(["stauts"], { cwd: dir });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown command "stauts"\. Did you mean "status"\?/);
    assert.deepEqual(fs.readdirSync(dir), []);
  });
});

test("commands explain when setup has not run yet", () => {
  withTempDir((dir) => {
    const result = runCli(["status"], { cwd: dir });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Run npx kordexa first/);
  });
});

test("guided setup works through piped answers and saves the result", () => {
  withTempDir((dir) => {
    const result = runCli(["--offline"], { cwd: dir, input: `${GOOD_ANSWERS.join("\n")}\n` });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /You're all set, Asha\./);
    assert.match(result.stdout, /npx kordexa setup-email/);
    const config = JSON.parse(fs.readFileSync(path.join(dir, "kordexa.config.json"), "utf8"));
    assert.equal(config.schedule.timezone, "Asia/Kolkata");
    assert.match(fs.readFileSync(path.join(dir, ".github/workflows/kordexa-daily.yml"), "utf8"), /cron: "30 14 \* \* \*"/);
  });
});

test("input ending early stops setup and saves nothing", () => {
  withTempDir((dir) => {
    const result = runCli(["--offline"], { cwd: dir, input: "Asha\n" });
    assert.equal(result.status, 130);
    assert.match(result.stdout, /Nothing was saved/);
    assert.deepEqual(fs.readdirSync(dir), []);
  });
});

test("setup protects the home folder unless the learner confirms", () => {
  withTempDir((dir) => {
    const env = { HOME: dir };
    assert.equal(runCli(["--offline"], { cwd: dir, env, input: "\n" }).status, 130);
    assert.deepEqual(fs.readdirSync(dir), []);

    const scripted = runCli(["--yes", "--offline"], { cwd: dir, env });
    assert.equal(scripted.status, 1);
    assert.match(scripted.stderr, /home folder/);
    assert.deepEqual(fs.readdirSync(dir), []);

    assert.equal(runCli(["--yes", "--offline", "--allow-home"], { cwd: dir, env }).status, 0);
    assert.equal(fs.existsSync(path.join(dir, "kordexa.config.json")), true);
  });
});

test("daily commands reject invalid numbers with clear messages", () => {
  withTempDir((dir) => {
    assert.equal(runCli(["--yes", "--offline", "--role", "Data Scientist"], { cwd: dir }).status, 0);
    const cases = [
      [["research", "--day", "abc", "--offline"], /--day must be a whole number from 1 to 30/],
      [["research", "--day", "99", "--offline"], /outside this 30-day plan/],
      [["links", "--day", "0", "--offline"], /--day must be a whole number/],
      [["log-progress", "--day", "1"], /what you finished/],
      [["log-progress", "--day", "abc", "--completed", "x", "--evidence", "y"], /--day must be/],
      [["log-progress", "--day", "1", "--completed", "x", "--evidence", "y", "--confidence", "9"], /--confidence must be/],
      [["log-progress", "--day", "1", "--completed", "x", "--evidence", "y", "--minutes", "-5"], /--minutes must be/],
      [["weekly-summary", "--week", "abc"], /--week must be/],
      [["weekly-summary", "--week", "99"], /--week must be/],
      [["plan", "--days", "abc"], /number of days/],
      [["send-today", "--dry-run", "--day", "abc", "--offline"], /--day must be/]
    ];
    for (const [args, message] of cases) {
      const result = runCli(args, { cwd: dir });
      assert.equal(result.status, 1, args.join(" "));
      assert.match(result.stderr, message, args.join(" "));
    }
    assert.equal(fs.existsSync(path.join(dir, "data/progress-log.json")), false);
  });
});
