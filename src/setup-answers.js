import { hasRoleMatch, inferRoleKey } from "./research.js";

// Every setup answer goes through one of these parsers. A parser returns
// { ok: true, value, note? } or { ok: false, error }, and never throws.

export const MIN_PLAN_DAYS = 30;
export const MAX_PLAN_DAYS = 365;
export const MAX_WEEKLY_HOURS = 80;

export const ROLE_OPTIONS = [
  "Agentic AI and LLM Engineer",
  "Full-Stack Developer",
  "Cybersecurity Analyst",
  "Data Scientist"
];

const ROLE_LABELS = {
  "agentic-ai": "Agentic AI and LLM Engineer",
  "full-stack": "Full-Stack Developer",
  cybersecurity: "Cybersecurity Analyst",
  "data-science": "Data Scientist"
};

// Each suggestion matches real topics in that role's plan.
const SKILL_SUGGESTIONS = {
  "agentic-ai": ["RAG", "Prompt engineering", "Agent tools", "Evaluation"],
  "full-stack": ["React", "API design", "Auth", "Testing"],
  cybersecurity: ["SIEM", "Incident response", "Threat modeling", "Phishing"],
  "data-science": ["pandas", "SQL", "Statistics", "Classification"]
};

export const STAGE_OPTIONS = ["beginner", "intermediate", "advanced"];
export const NOT_STARTED = "not started yet";

const UNSURE_ANSWERS = new Set([
  "no", "n", "nope", "nah", "none", "nothing", "nothing yet", "na", "n/a", "nil", "null",
  "not yet", "not started", "not started yet", "yet to start", "no idea", "idk", "i dont know",
  "dont know", "not sure", "unsure", "skip", "-", "--", "."
]);

const EMAIL_TYPOS = {
  "gmial.com": "gmail.com",
  "gamil.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gmal.com": "gmail.com",
  "gmail.co": "gmail.com",
  "gmail.con": "gmail.com",
  "gmail.cm": "gmail.com",
  "yaho.com": "yahoo.com",
  "yahoo.con": "yahoo.com",
  "hotmal.com": "hotmail.com",
  "hotmail.con": "hotmail.com",
  "outlok.com": "outlook.com",
  "outlook.con": "outlook.com"
};

const TIMEZONE_ALIASES = {
  ist: "Asia/Kolkata", india: "Asia/Kolkata", "indian standard time": "Asia/Kolkata", kolkata: "Asia/Kolkata",
  calcutta: "Asia/Kolkata", "asia/calcutta": "Asia/Kolkata", chennai: "Asia/Kolkata", madras: "Asia/Kolkata",
  mumbai: "Asia/Kolkata", bombay: "Asia/Kolkata", delhi: "Asia/Kolkata", "new delhi": "Asia/Kolkata",
  bangalore: "Asia/Kolkata", bengaluru: "Asia/Kolkata", hyderabad: "Asia/Kolkata", pune: "Asia/Kolkata",
  coimbatore: "Asia/Kolkata", "utc+5:30": "Asia/Kolkata", "utc+05:30": "Asia/Kolkata", "gmt+5:30": "Asia/Kolkata",
  "gmt+05:30": "Asia/Kolkata", "+5:30": "Asia/Kolkata", "+05:30": "Asia/Kolkata",
  utc: "UTC", gmt: "UTC", z: "UTC", "etc/utc": "UTC",
  uk: "Europe/London", bst: "Europe/London", cet: "Europe/Paris", cest: "Europe/Paris",
  est: "America/New_York", edt: "America/New_York", et: "America/New_York",
  cst: "America/Chicago", cdt: "America/Chicago", ct: "America/Chicago",
  mst: "America/Denver", mdt: "America/Denver", mt: "America/Denver",
  pst: "America/Los_Angeles", pdt: "America/Los_Angeles", pt: "America/Los_Angeles",
  jst: "Asia/Tokyo", sgt: "Asia/Singapore", pkt: "Asia/Karachi", npt: "Asia/Kathmandu",
  "asia/katmandu": "Asia/Kathmandu", "asia/saigon": "Asia/Ho_Chi_Minh", "asia/rangoon": "Asia/Yangon",
  aest: "Australia/Sydney", aedt: "Australia/Sydney", uae: "Asia/Dubai"
};

const accept = (value, note) => ({ ok: true, value, ...(note ? { note } : {}) });
const reject = (error) => ({ ok: false, error });

// Removes arrow-key escape codes, control characters, wrapping quotes and extra spaces.
export function cleanText(value) {
  const text = String(value ?? "")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const quoted = /^(["'])(.*)\1$/.exec(text);
  return quoted ? quoted[2].trim() : text;
}

export function isUnsureAnswer(value) {
  const text = cleanText(value).toLowerCase().replace(/['’]/g, "");
  return UNSURE_ANSWERS.has(text.replace(/[.!]+$/, "") || text);
}

const hasLetter = (text) => /\p{L}/u.test(text);

export function parseName(raw) {
  const text = cleanText(raw);
  if (!text) return reject("Please enter your name.");
  if (isUnsureAnswer(text)) return reject("Please enter the name you'd like on your daily plan.");
  if (!hasLetter(text)) return reject("A name needs at least one letter.");
  if (text.length > 60) return reject("Please keep your name under 60 characters.");
  return accept(text);
}

export function parseEmail(raw, { allowPlaceholder = true } = {}) {
  const text = cleanText(raw);
  if (!text) return reject("Please enter your email address, like name@gmail.com.");
  if (text.length > 254 || !/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[^\s@.]{2,}$/.test(text)) {
    return reject("That doesn't look like an email address. Try the format name@gmail.com.");
  }
  const [local, domain] = text.split("@");
  const suggestion = EMAIL_TYPOS[domain.toLowerCase()];
  if (suggestion) return reject(`Did you mean ${local}@${suggestion}?`);
  if (!allowPlaceholder && /(^|\.)example\.(com|org|net)$/i.test(domain)) {
    return reject("Please enter your real email address so your daily plan can reach you.");
  }
  return accept(text);
}

export function parseRole(raw) {
  const text = cleanText(raw);
  if (!text || isUnsureAnswer(text)) {
    return accept(ROLE_OPTIONS[0], `Starting with ${ROLE_OPTIONS[0]}. You can change this later.`);
  }
  if (/^\d+$/.test(text)) {
    const choice = ROLE_OPTIONS[Number(text) - 1];
    return choice ? accept(choice) : reject(`Please choose a number from 1 to ${ROLE_OPTIONS.length}, or type a job title.`);
  }
  if (!hasLetter(text) || text.length < 2) return reject("Please choose a number or type a job title, like Backend Developer.");
  if (text.length > 80) return reject("Please keep the job title under 80 characters.");
  const exact = ROLE_OPTIONS.find((role) => role.toLowerCase() === text.toLowerCase());
  if (exact) return accept(exact);
  const planLabel = ROLE_LABELS[inferRoleKey(text)];
  if (!hasRoleMatch(text)) {
    return accept(text, `There's no dedicated plan for ${text} yet, so Kordexa will use the ${planLabel} plan.`);
  }
  return accept(text, `${text} will use the ${planLabel} plan.`);
}

export function parseCurrentLearning(raw) {
  const text = cleanText(raw);
  if (!text || isUnsureAnswer(text)) return accept(NOT_STARTED);
  if (!/[\p{L}\p{N}]/u.test(text)) return reject("Please type a topic, or press Enter if you haven't started.");
  if (text.length > 120) return reject("Please keep this under 120 characters.");
  return accept(text);
}

export function skillSuggestions(role) {
  return SKILL_SUGGESTIONS[inferRoleKey(role || "")];
}

export function recommendedSkill(role) {
  return skillSuggestions(role)[0];
}

export function parseSkill(raw, role) {
  const text = cleanText(raw);
  const suggestions = skillSuggestions(role);
  if (!text || isUnsureAnswer(text)) return accept(suggestions[0], `Starting with ${suggestions[0]}, the recommended first skill for this role.`);
  if (/^\d+$/.test(text)) {
    const choice = suggestions[Number(text) - 1];
    return choice ? accept(choice) : reject(`Please choose a number from 1 to ${suggestions.length}, or type a skill.`);
  }
  if (!hasLetter(text) || text.length < 2) return reject("Please choose a number or type a skill, like SQL.");
  if (text.length > 80) return reject("Please keep the skill under 80 characters.");
  return accept(text);
}

export function parseStage(raw) {
  const text = cleanText(raw).toLowerCase();
  if (!text || isUnsureAnswer(text)) return accept("beginner", "Starting at beginner level.");
  if (/^\d+$/.test(text)) {
    const choice = STAGE_OPTIONS[Number(text) - 1];
    return choice ? accept(choice) : reject("Please choose 1, 2 or 3.");
  }
  if (/^(b|beg|begin\w*|fresher|new|newbie|novice|student)$/.test(text)) return accept("beginner");
  if (/^(i|int|inter|intermediate|medium|mid)$/.test(text)) return accept("intermediate");
  if (/^(a|adv|advance|advanced|expert|senior)$/.test(text)) return accept("advanced");
  return reject("Please choose 1 for Beginner, 2 for Intermediate or 3 for Advanced.");
}

export function parseWeeklyHours(raw) {
  const text = cleanText(raw).toLowerCase();
  const match = /^(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)?(?:\s*(?:a|per|\/)\s*(?:week|wk))?$/.exec(text);
  if (!match) return reject("Please enter a number of hours, like 8.");
  const hours = Math.round(Number(match[1]));
  if (hours < 1) return reject("Please plan for at least 1 hour a week.");
  if (hours > MAX_WEEKLY_HOURS) return reject(`Please enter ${MAX_WEEKLY_HOURS} hours a week or fewer.`);
  return accept(hours);
}

export function parsePlanDays(raw) {
  const text = cleanText(raw).toLowerCase();
  const match = /^(\d+)\s*(d|day|days|w|wk|wks|week|weeks|m|mo|month|months)?$/.exec(text);
  if (!match) return reject(`Please enter a number of days from ${MIN_PLAN_DAYS} to ${MAX_PLAN_DAYS}.`);
  const unit = match[2] || "d";
  const size = unit.startsWith("w") ? 7 : unit.startsWith("m") ? 30 : 1;
  const days = Number(match[1]) * size;
  if (days > MAX_PLAN_DAYS) return reject(`Plans can be up to ${MAX_PLAN_DAYS} days long.`);
  if (days < MIN_PLAN_DAYS) return accept(MIN_PLAN_DAYS, `Plans start at ${MIN_PLAN_DAYS} days, so Kordexa will use ${MIN_PLAN_DAYS}.`);
  return accept(days);
}

export function parseEmailTime(raw) {
  const text = cleanText(raw).toLowerCase();
  const invalid = reject("Please enter a time like 20:00 or 8pm.");
  if (text === "noon") return accept("12:00");
  if (text === "midnight") return accept("00:00");
  const format = (hour, minute) => `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

  const meridiem = /^(\d{1,2})(?:[:.](\d{2}))?\s*([ap])\.?m?\.?$/.exec(text);
  if (meridiem) {
    const hour = Number(meridiem[1]);
    const minute = Number(meridiem[2] || 0);
    if (hour < 1 || hour > 12 || minute > 59) return invalid;
    return accept(format((hour % 12) + (meridiem[3] === "p" ? 12 : 0), minute));
  }
  const clock = /^(\d{1,2})(?:[:.](\d{2}))?$/.exec(text) || /^(\d{2})(\d{2})$/.exec(text);
  if (!clock) return invalid;
  const hour = Number(clock[1]);
  const minute = Number(clock[2] || 0);
  if (hour > 23 || minute > 59) return invalid;
  return accept(format(hour, minute));
}

function canonicalTimezone(zone) {
  return TIMEZONE_ALIASES[zone.toLowerCase()] || zone;
}

export function detectTimezone() {
  try {
    return canonicalTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  } catch {
    return "UTC";
  }
}

export function parseTimezone(raw) {
  const text = cleanText(raw);
  const invalid = reject("Kordexa doesn't recognize that timezone. Try a city or code, like Chennai, London or IST.");
  if (!text) return invalid;
  const lowered = text.toLowerCase();
  if (TIMEZONE_ALIASES[lowered]) return accept(TIMEZONE_ALIASES[lowered]);
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  const city = zones.find((zone) => zone.split("/").at(-1).replace(/_/g, " ").toLowerCase() === lowered);
  if (city) return accept(canonicalTimezone(city));
  if (!text.includes("/")) return invalid;
  try {
    return accept(canonicalTimezone(new Intl.DateTimeFormat("en-US", { timeZone: text }).resolvedOptions().timeZone));
  } catch {
    return invalid;
  }
}

export function parseSmtpHost(raw) {
  const text = cleanText(raw).toLowerCase().replace(/^smtps?:\/\//, "").replace(/\/$/, "");
  if (!/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(text)) {
    return reject("Please enter a mail server address, like smtp.zoho.com.");
  }
  return accept(text);
}

export function parseSmtpPort(raw) {
  const text = cleanText(raw);
  const port = Number(text);
  if (!/^\d+$/.test(text) || port < 1 || port > 65535) return reject("Please enter a port number, usually 587 or 465.");
  return accept(port);
}

export function parseSmtpUser(raw) {
  const text = cleanText(raw);
  if (!text || /\s/.test(text) || text.length > 254) return reject("Please enter your email login, usually your full email address.");
  return accept(text);
}

export function parseGmailAppPassword(raw) {
  const text = String(raw ?? "").replace(/\s/g, "");
  if (!/^[a-zA-Z]{16}$/.test(text)) {
    return reject("A Gmail app password has exactly 16 letters. Your normal Gmail password won't work here.");
  }
  return accept(text);
}
