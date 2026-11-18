import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { main } from "../../src/cli.js";
import { dailyEmailKey, resendConfigFromEnv, sendWithResend } from "../../src/email.js";

process.env.KORDEXA_OFFLINE = "1";

const TEST_KEY = "re_test_value_not_real";
const resend = { apiKey: TEST_KEY, from: "Kordexa <onboarding@resend.dev>" };
const message = { to: "learner@gmail.com", subject: "Day 1", html: "<p>Plan</p>", text: "Plan" };
const noWait = async () => {};

function reply(status, body, headers = {}) {
  return { ok: status < 400, status, headers: { get: (name) => headers[name] ?? null }, json: async () => body };
}

async function withFetch(replies, fn) {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    const next = replies.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  try {
    return await fn(calls);
  } finally {
    global.fetch = original;
  }
}

async function inProject(fn) {
  const oldCwd = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kordexa-resend-"));
  const log = console.log;
  const printed = [];
  console.log = (line) => printed.push(String(line));
  process.chdir(dir);
  try {
    await main(["--yes", "--offline", "--name", "Asha", "--email", "learner@gmail.com", "--role", "Data Scientist"]);
    fs.appendFileSync(path.join(dir, ".env.local"), `RESEND_API_KEY=${TEST_KEY}\n`);
    return await fn(dir, printed);
  } finally {
    console.log = log;
    process.chdir(oldCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("Resend is used only when an API key is configured", () => {
  assert.equal(resendConfigFromEnv({}), null);
  assert.deepEqual(resendConfigFromEnv({ RESEND_API_KEY: TEST_KEY }), resend);
  assert.equal(resendConfigFromEnv({ RESEND_API_KEY: TEST_KEY, RESEND_FROM: "Plans <a@b.co>" }).from, "Plans <a@b.co>");
});

test("daily email key is stable, private and specific to each plan day", () => {
  const key = dailyEmailKey("Learner@Gmail.com", "2026-11-18", 3);
  assert.equal(key, dailyEmailKey("learner@gmail.com", "2026-11-18", 3));
  assert.notEqual(key, dailyEmailKey("learner@gmail.com", "2026-11-18", 4));
  assert.doesNotMatch(key, /gmail|learner/i);
  assert.ok(key.length <= 256);
});

test("an email is sent with the required Resend request format", async () => {
  await withFetch([reply(200, { id: "email_1" })], async (calls) => {
    const result = await sendWithResend({ resend, message, idempotencyKey: "day-1" });
    assert.deepEqual(result, { sent: true, to: message.to, subject: "Day 1", transport: "resend", id: "email_1" });
    assert.equal(calls[0].url, "https://api.resend.com/emails");
    assert.equal(calls[0].init.headers.authorization, `Bearer ${TEST_KEY}`);
    assert.equal(calls[0].init.headers["idempotency-key"], "day-1");
    assert.ok(calls[0].init.headers["user-agent"]);
    assert.deepEqual(JSON.parse(calls[0].init.body), { from: resend.from, to: [message.to], subject: "Day 1", html: "<p>Plan</p>", text: "Plan" });
  });
});

test("temporary failures retry with the same key so no duplicate is sent", async () => {
  await withFetch([reply(429, {}, { "retry-after": "1" }), new Error("network down"), reply(200, { id: "email_2" })], async (calls) => {
    const result = await sendWithResend({ resend, message, idempotencyKey: "day-2", wait: noWait });
    assert.equal(result.id, "email_2");
    assert.equal(calls.length, 3);
    assert.deepEqual(calls.map((call) => call.init.headers["idempotency-key"]), ["day-2", "day-2", "day-2"]);
  });
});

test("permanent failures stop immediately with a clear message", async () => {
  const cases = [
    [401, { message: "API key is invalid" }, /didn't accept the API key/],
    [403, { message: "You can only send testing emails to your own email address. Please verify a domain." }, /can only email the address on your Resend account/],
    [422, { message: "Invalid to field" }, /error 422.*Invalid to field/]
  ];
  for (const [status, body, expected] of cases) {
    await withFetch([reply(status, body)], async (calls) => {
      await assert.rejects(sendWithResend({ resend, message, wait: noWait }), (error) => {
        assert.match(error.message, expected);
        assert.doesNotMatch(error.message, new RegExp(TEST_KEY));
        return true;
      });
      assert.equal(calls.length, 1);
    });
  }
});

test("repeated outages end with a helpful error", async () => {
  await withFetch([new Error("down"), new Error("down"), new Error("down")], async (calls) => {
    await assert.rejects(sendWithResend({ resend, message, wait: noWait }), /Couldn't reach Resend/);
    assert.equal(calls.length, 3);
  });
  await withFetch([reply(500, {}), reply(503, {}), reply(500, { message: "Server error" })], async (calls) => {
    await assert.rejects(sendWithResend({ resend, message, wait: noWait }), /error 500/);
    assert.equal(calls.length, 3);
  });
});

test("send-today delivers through Resend and keeps the key out of saved results", async () => {
  await inProject(async (dir, printed) => {
    await withFetch([reply(200, { id: "email_3" })], async (calls) => {
      await main(["send-today", "--day", "1", "--offline"]);
      assert.equal(calls.length, 1);
      assert.match(calls[0].init.headers["idempotency-key"], /-day-1$/);
    });
    const latest = fs.readFileSync(path.join(dir, "data/latest-email.json"), "utf8");
    assert.equal(JSON.parse(latest).transport, "resend");
    assert.doesNotMatch(latest + printed.join("\n"), new RegExp(TEST_KEY));
  });
});

test("a dry run never contacts Resend", async () => {
  await inProject(async () => {
    await withFetch([], async (calls) => {
      await main(["send-today", "--dry-run", "--day", "1", "--offline"]);
      assert.equal(calls.length, 0);
    });
  });
});

test("the scheduled workflow passes Resend settings from GitHub secrets", async () => {
  await inProject(async (dir) => {
    const workflow = fs.readFileSync(path.join(dir, ".github/workflows/kordexa-daily.yml"), "utf8");
    assert.match(workflow, /RESEND_API_KEY: \$\{\{ secrets\.RESEND_API_KEY \}\}/);
    assert.match(workflow, /RESEND_FROM: \$\{\{ secrets\.RESEND_FROM \}\}/);
    assert.doesNotMatch(workflow, new RegExp(TEST_KEY));
  });
});

test("setup upgrades the earlier generated workflow to include Resend", async () => {
  await inProject(async (dir) => {
    const file = path.join(dir, ".github/workflows/kordexa-daily.yml");
    const earlier = fs.readFileSync(file, "utf8").replace(/ {10}RESEND_API_KEY: .*\n {10}RESEND_FROM: .*\n/, "");
    fs.writeFileSync(file, earlier);
    assert.equal((await main(["doctor"])).status, "needs-upgrade");
    await main(["--yes", "--offline"]);
    assert.match(fs.readFileSync(file, "utf8"), /RESEND_API_KEY/);
    assert.equal((await main(["doctor"])).status, "ready");
  });
});

test("setup-secrets asks for the Resend key without printing it", async () => {
  await inProject(async () => {
    const result = await main(["setup-secrets"]);
    assert.deepEqual(result.commands, ["gh secret set RESEND_API_KEY"]);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(TEST_KEY));
  });
});

test("doctor counts a Resend key as connected email", async () => {
  await inProject(async () => {
    const result = await main(["doctor"]);
    assert.equal(result.checks.localEmail, true);
    assert.equal(result.status, "ready");
    assert.doesNotMatch(JSON.stringify(result), new RegExp(TEST_KEY));
  });
});
