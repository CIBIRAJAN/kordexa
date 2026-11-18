// Proves the website's plan preview matches the real CLI.
// Usage: node --test site/scripts/parity.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { generate30DayPlan } from "../../src/planner.js";
import { cronFromTime as cliCron } from "../../src/workflow.js";
import { inferRoleKey as cliInfer } from "../../src/research.js";
import { buildPlan, cronFromTime, inferRoleKey, shellQuote } from "../assets/planner.js";

const roles = ["Agentic AI and LLM Engineer", "Full-Stack Developer", "Cybersecurity Analyst", "Data Scientist", "Product Designer"];
const skills = ["", "evaluation", "RAG", "SIEM", "pandas", "auth", "a skill nobody listed"];
const lengths = [1, 30, 31, 45, 90, 120];

test("plans match the CLI for every role, skill and length", () => {
  for (const targetRole of roles) for (const focusSkill of skills) for (const planDays of lengths) {
    const profile = { targetRole, focusSkill, planDays };
    const cli = generate30DayPlan(profile);
    const web = buildPlan(profile);
    assert.equal(web.roleKey, cli.roleKey);
    assert.equal(web.capstone, cli.capstone);
    assert.equal(web.days.length, cli.days.length);
    assert.deepEqual(web.phases.map((p) => `${p.from}-${p.to}`), cli.phases.map((p) => p.days));
    assert.deepEqual(web.phases.map((p) => p.name), cli.phases.map((p) => p.name));
    web.days.forEach((day, index) => {
      const expected = cli.days[index];
      assert.equal(day.title, expected.title);
      assert.deepEqual(day.concepts, expected.concepts);
      assert.equal(day.task, expected.setupOrBuildTask);
      assert.equal(day.difficulty, expected.difficulty);
      assert.deepEqual(day.timeBox, expected.timeBox);
      assert.equal(day.portfolioArtifact, expected.portfolioArtifact);
    });
  }
});

test("role inference matches the CLI", () => {
  for (const role of [...roles, "ML Engineer", "Backend Engineer", "SOC Analyst", "Analytics Lead", ""]) {
    assert.equal(inferRoleKey(role), cliInfer(role));
  }
});

test("cron schedules match the CLI", () => {
  for (const zone of ["UTC", "Asia/Kolkata", "America/New_York", "Asia/Tokyo", "Not/AZone"]) {
    for (const time of ["00:00", "07:30", "08:00", "23:45", "bad"]) {
      assert.equal(cronFromTime(time, zone), cliCron(time, zone));
    }
  }
});

test("shell quoting neutralises special characters", () => {
  assert.equal(shellQuote("RAG evaluation"), '"RAG evaluation"');
  assert.equal(shellQuote("$(rm -rf ~)"), "'$(rm -rf ~)'");
  assert.equal(shellQuote("it's"), "'it'\\''s'");
});
