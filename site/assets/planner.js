// Browser port of the CLI's plan logic (src/planner.js, src/workflow.js).
// site/scripts/parity.test.mjs checks that both produce identical plans.
import { BLUEPRINTS } from "./blueprints.js";

export const MIN_DAYS = 30;
export const MAX_DAYS = 120;

export function inferRoleKey(role) {
  if (/agentic|llm|ai engineer|artificial intelligence|machine learning/i.test(role)) return "agentic-ai";
  if (/full.?stack|frontend|backend|web/i.test(role)) return "full-stack";
  if (/cyber|security|soc|threat/i.test(role)) return "cybersecurity";
  if (/data scientist|data science|analytics|ml engineer/i.test(role)) return "data-science";
  return "agentic-ai";
}

function prioritizeTopics(topics, primarySkill, requestedDays, role) {
  const lowered = primarySkill.toLowerCase();
  const setup = topics[0];
  const body = topics.slice(1);
  const matching = body.filter(([title, concepts]) => `${title} ${concepts.join(" ")}`.toLowerCase().includes(lowered));
  const remaining = body.filter((topic) => !matching.includes(topic));
  const focusIntro = [
    `Primary skill focus: ${primarySkill}`,
    [primarySkill, "current trends", "practical proof"],
    `Build a first visible artifact for ${primarySkill} in the ${role} role.`
  ];
  const expanded = [setup, ...(matching.length ? matching : [focusIntro]), ...remaining];
  while (expanded.length < requestedDays) {
    expanded.push([
      `Next-skill adaptation day ${expanded.length + 1}`,
      [primarySkill, "trend adaptation", "portfolio evidence"],
      `Review current trends for ${primarySkill}, upgrade the capstone, and log evidence for what changed.`
    ]);
  }
  return { topics: expanded, matched: matching.length };
}

function difficultyFor(day) {
  if (day <= 7) return "foundation";
  if (day <= 15) return "applied";
  if (day <= 24) return "portfolio";
  if (day <= 30) return "release";
  return "next-skill-ramp";
}

export function createPhases(days) {
  const phases = [
    { from: 1, to: 7, key: "foundation", name: "Setup and first-skill foundations" },
    { from: 8, to: 15, key: "applied", name: "Applied practice and trend adaptation" },
    { from: 16, to: 24, key: "portfolio", name: "Portfolio build" },
    { from: 25, to: 30, key: "release", name: "Release and interview proof" }
  ];
  if (days > 30) phases.push({ from: 31, to: days, key: "next-skill-ramp", name: "Next-skill ramp and trend refresh" });
  return phases;
}

export function buildPlan(profile) {
  const role = profile.targetRole || "Agentic AI and LLM Engineer";
  const roleKey = inferRoleKey(role);
  const blueprint = BLUEPRINTS[roleKey];
  const requestedDays = Math.max(MIN_DAYS, Number.parseInt(profile.planDays, 10) || MIN_DAYS);
  const primarySkill = profile.focusSkill || blueprint.topics[0][0];
  const { topics, matched } = prioritizeTopics(blueprint.topics, primarySkill, requestedDays, role);
  const days = topics.slice(0, requestedDays).map(([title, concepts, task], index) => {
    const day = index + 1;
    return {
      day,
      title,
      difficulty: difficultyFor(day),
      concepts,
      task,
      timeBox: { learnMinutes: day <= 7 ? 35 : 25, buildMinutes: day <= 7 ? 45 : 70, reviewMinutes: 15 },
      portfolioArtifact: day >= 16 ? `Improve the ${blueprint.capstone}.` : "Add one small note or commit that can feed the capstone later."
    };
  });
  return { roleKey, label: blueprint.label, capstone: blueprint.capstone, primarySkill, requestedDays, matched, phases: createPhases(requestedDays), days };
}

export function weeklyLoadHours(plan) {
  const minutes = (entry) => entry.timeBox.learnMinutes + entry.timeBox.buildMinutes + entry.timeBox.reviewMinutes;
  const foundation = plan.days[0];
  const later = plan.days[7];
  return { firstWeek: (minutes(foundation) * 7) / 60, afterFirstWeek: (minutes(later) * 7) / 60 };
}

function localTimeToUtc(hour, minute, timezone) {
  try {
    const now = new Date();
    const candidate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute));
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    const parts = Object.fromEntries(formatter.formatToParts(candidate).map((part) => [part.type, part.value]));
    const seenMinutes = Number.parseInt(parts.hour, 10) * 60 + Number.parseInt(parts.minute, 10);
    const desiredMinutes = hour * 60 + minute;
    const corrected = new Date(candidate.getTime() + (desiredMinutes - seenMinutes) * 60 * 1000);
    return { hour: corrected.getUTCHours(), minute: corrected.getUTCMinutes() };
  } catch {
    return { hour, minute };
  }
}

export function cronFromTime(time, timezone = "UTC") {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time || "08:00");
  if (!match) return "0 8 * * *";
  const hour = Math.min(23, Math.max(0, Number.parseInt(match[1], 10)));
  const minute = Math.min(59, Math.max(0, Number.parseInt(match[2], 10)));
  if (!timezone || timezone.toUpperCase() === "UTC") return `${minute} ${hour} * * *`;
  const utc = localTimeToUtc(hour, minute, timezone);
  return `${utc.minute} ${utc.hour} * * *`;
}

export function shellQuote(value) {
  const text = String(value);
  if (/^[\w@%+=:,./ -]*$/.test(text)) return `"${text}"`;
  return `'${text.replace(/'/g, `'\\''`)}'`;
}
