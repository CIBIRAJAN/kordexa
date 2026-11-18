import readline from "node:readline";
import { Writable } from "node:stream";
import {
  ROLE_OPTIONS,
  STAGE_OPTIONS,
  cleanText,
  detectTimezone,
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
  parseSmtpUser,
  parseStage,
  parseTimezone,
  parseWeeklyHours,
  recommendedSkill,
  skillSuggestions
} from "./setup-answers.js";

const FALLBACK = {
  name: "Learner",
  email: "learner@example.com",
  targetRole: ROLE_OPTIONS[0],
  currentLearning: "not started yet",
  currentStage: "beginner",
  weeklyHours: 8,
  planDays: 30,
  dailyEmailTime: "08:00",
  timezone: "UTC",
  smtpHost: "smtp.gmail.com",
  smtpPort: 465,
  smtpUser: "",
  smtpPass: "",
  smtpFrom: ""
};

const FLAG_CHECKS = {
  name: ["--name", parseName],
  email: ["--email", parseEmail],
  targetRole: ["--role", parseRole],
  currentLearning: ["--current-learning", parseCurrentLearning],
  currentStage: ["--stage", parseStage],
  weeklyHours: ["--weekly-hours", parseWeeklyHours],
  planDays: ["--days", parsePlanDays],
  dailyEmailTime: ["--time", parseEmailTime],
  timezone: ["--timezone", parseTimezone],
  smtpHost: ["--smtp-host", parseSmtpHost],
  smtpPort: ["--smtp-port", parseSmtpPort],
  smtpUser: ["--smtp-user", parseSmtpUser],
  smtpFrom: ["--smtp-from", parseEmail]
};

export class SetupCancelled extends Error {
  constructor(message = "Setup stopped. Nothing was saved.") {
    super(message);
    this.name = "SetupCancelled";
  }
}

// Reads one answer at a time. Piped answers are queued so none are lost, and
// closing the input stops setup instead of leaving it waiting forever.
export function createTerminalIO({ input = process.stdin, output = process.stdout } = {}) {
  let muted = false;
  let closed = false;
  let waiting = null;
  const queued = [];
  const visible = new Writable({
    write(chunk, encoding, done) {
      if (!muted) output.write(chunk, encoding);
      done();
    }
  });
  const rl = readline.createInterface({ input, output: visible, terminal: Boolean(input.isTTY && output.isTTY), historySize: 0 });

  rl.on("line", (line) => {
    if (!waiting) {
      queued.push(line);
      return;
    }
    const { resolve } = waiting;
    waiting = null;
    resolve(line);
  });
  rl.on("SIGINT", () => rl.close());
  rl.on("close", () => {
    closed = true;
    if (!waiting) return;
    const { reject } = waiting;
    waiting = null;
    reject(new SetupCancelled());
  });

  const nextLine = () => {
    if (queued.length) return Promise.resolve(queued.shift());
    if (closed) return Promise.reject(new SetupCancelled());
    return new Promise((resolve, reject) => {
      waiting = { resolve, reject };
    });
  };

  return {
    say: (text = "") => output.write(`${text}\n`),
    ask(label) {
      if (closed && !queued.length) return Promise.reject(new SetupCancelled());
      if (closed) {
        output.write(`${label}\n`);
        return nextLine();
      }
      rl.setPrompt(label);
      rl.prompt();
      return nextLine();
    },
    async askHidden(label) {
      output.write(label);
      muted = true;
      try {
        return await nextLine();
      } finally {
        muted = false;
        output.write("\n");
      }
    },
    close: () => rl.close()
  };
}

export async function collectOnboarding({ defaults = {}, nonInteractive = false, overrides = {}, io } = {}) {
  const flags = checkFlags(overrides);
  const saved = usableSavedAnswers(defaults);
  const known = { ...saved, ...flags };
  if (nonInteractive) {
    const targetRole = known.targetRole || FALLBACK.targetRole;
    return normalizeAnswers({ ...FALLBACK, focusSkill: recommendedSkill(targetRole), ...known });
  }
  const terminal = io || createTerminalIO();
  try {
    return normalizeAnswers(await guidedSetup(terminal, { saved, flags }));
  } finally {
    if (!io) terminal.close();
  }
}

function checkFlags(overrides) {
  const checked = {};
  const problems = [];
  for (const [key, value] of Object.entries(overrides)) {
    if (key === "smtpPass") {
      checked.smtpPass = value;
    } else if (key === "focusSkill") {
      const result = parseSkill(value, overrides.targetRole);
      if (result.ok) checked.focusSkill = result.value;
      else problems.push(`--skill: ${result.error}`);
    } else if (FLAG_CHECKS[key]) {
      const [flag, parse] = FLAG_CHECKS[key];
      const result = parse(value);
      if (result.ok) checked[key] = result.value;
      else problems.push(`${flag}: ${result.error}`);
    }
  }
  if (problems.length) throw new Error(`Please fix these setup options:\n- ${problems.join("\n- ")}`);
  return checked;
}

// Older projects may hold values that are no longer valid, so those are asked again.
function usableSavedAnswers(defaults) {
  const usable = {};
  for (const [key, value] of Object.entries(defaults)) {
    if (key === "focusSkill" || key === "smtpPass") {
      usable[key] = value;
    } else if (FLAG_CHECKS[key]) {
      const result = FLAG_CHECKS[key][1](value);
      if (result.ok) usable[key] = result.value;
    }
  }
  return usable;
}

function buildFields(saved) {
  const savedEmail = saved.email && parseEmail(saved.email, { allowPlaceholder: false }).ok ? saved.email : undefined;
  return [
    {
      key: "name",
      summary: "Name",
      title: "What's your name?",
      fallback: () => (saved.name && saved.name !== FALLBACK.name ? saved.name : undefined),
      parse: parseName
    },
    {
      key: "email",
      summary: "Email",
      title: "Which email should receive your daily plan?",
      hint: "Example: name@gmail.com",
      fallback: () => savedEmail,
      parse: (raw) => parseEmail(raw, { allowPlaceholder: false })
    },
    {
      key: "targetRole",
      summary: "Target role",
      title: "Which job are you preparing for?",
      hint: "Choose a number, or type another job title.",
      options: () => ROLE_OPTIONS,
      fallback: () => saved.targetRole || ROLE_OPTIONS[0],
      parse: parseRole
    },
    {
      key: "currentLearning",
      summary: "Learning now",
      title: "What are you learning right now?",
      hint: "Press Enter if you haven't started yet.",
      fallback: () => saved.currentLearning || FALLBACK.currentLearning,
      parse: parseCurrentLearning
    },
    {
      key: "focusSkill",
      summary: "First skill",
      title: "Which skill should your plan start with?",
      hint: "Not sure? Press Enter and Kordexa will use the recommended skill.",
      options: (values) => skillSuggestions(values.targetRole),
      fallback: (values) => (values.targetRole === saved.targetRole && saved.focusSkill) || recommendedSkill(values.targetRole),
      parse: (raw, values) => parseSkill(raw, values.targetRole)
    },
    {
      key: "currentStage",
      summary: "Level",
      title: "What's your current level?",
      options: () => STAGE_OPTIONS.map((stage) => stage[0].toUpperCase() + stage.slice(1)),
      fallback: () => saved.currentStage || FALLBACK.currentStage,
      parse: parseStage
    },
    {
      key: "weeklyHours",
      summary: "Hours per week",
      title: "How many hours can you study each week?",
      fallback: () => saved.weeklyHours || FALLBACK.weeklyHours,
      parse: parseWeeklyHours
    },
    {
      key: "planDays",
      summary: "Plan length",
      title: "How many days should your plan last?",
      hint: "The shortest plan is 30 days.",
      fallback: () => saved.planDays || FALLBACK.planDays,
      parse: parsePlanDays
    },
    {
      key: "dailyEmailTime",
      summary: "Email time",
      title: "What time should your daily plan arrive?",
      hint: "Examples: 20:00 or 8pm",
      fallback: () => saved.dailyEmailTime || FALLBACK.dailyEmailTime,
      parse: parseEmailTime
    },
    {
      key: "timezone",
      summary: "Timezone",
      title: "What's your timezone?",
      hint: "Type a city or code, like Chennai, London or IST.",
      fallback: () => saved.timezone || detectTimezone(),
      parse: parseTimezone
    }
  ];
}

async function guidedSetup(io, { saved, flags }) {
  const values = { ...FALLBACK, ...saved, ...flags };
  const fields = buildFields(saved).filter((field) => flags[field.key] === undefined);
  const totalSteps = fields.length + 1;

  io.say("");
  io.say("Welcome to Kordexa. This takes about a minute.");
  io.say("Press Enter to use the answer in [brackets]. Nothing is saved until the final step.");

  for (const [index, field] of fields.entries()) {
    values[field.key] = await askField(io, field, values, `${index + 1}/${totalSteps}`);
  }
  Object.assign(values, await askEmailDelivery(io, values, `${totalSteps}/${totalSteps}`));

  for (;;) {
    printReview(io, fields, values);
    const answer = cleanText(await io.ask("Press Enter to save, or type a number to change that answer: ")).toLowerCase();
    if (!answer || ["y", "yes", "save", "ok"].includes(answer)) return values;
    throwIfCancelled(answer);
    const choice = Number(answer);
    if (Number.isInteger(choice) && choice === fields.length + 1) {
      Object.assign(values, await askEmailDelivery(io, values));
    } else if (Number.isInteger(choice) && fields[choice - 1]) {
      const field = fields[choice - 1];
      const previousRole = values.targetRole;
      values[field.key] = await askField(io, field, values);
      const skillField = fields.find((item) => item.key === "focusSkill");
      if (field.key === "targetRole" && values.targetRole !== previousRole && skillField) {
        values.focusSkill = await askField(io, skillField, values);
      }
    } else {
      io.say(`  ! Please choose a number from 1 to ${fields.length + 1}, or press Enter to save.`);
    }
  }
}

function throwIfCancelled(answer) {
  if (["quit", "exit", "cancel"].includes(answer.toLowerCase())) throw new SetupCancelled();
}

async function askField(io, field, values, step) {
  const fallback = field.fallback?.(values);
  const options = field.options?.(values) || [];
  io.say("");
  io.say(step ? `[${step}] ${field.title}` : field.title);
  if (field.hint) io.say(`  ${field.hint}`);
  options.forEach((option, index) => io.say(`  ${index + 1}. ${option}`));
  const prompt = fallback === undefined ? "> " : `> [${fallback}] `;

  for (;;) {
    const answer = cleanText(await io.ask(prompt));
    throwIfCancelled(answer);
    if (answer === "?" || answer.toLowerCase() === "help") {
      io.say(`  ${field.hint || "Type your answer and press Enter."}`);
      continue;
    }
    if (!answer && fallback !== undefined) return fallback;
    const result = field.parse(answer, values);
    if (result.ok) {
      if (result.note) io.say(`  ${result.note}`);
      return result.value;
    }
    io.say(`  ! ${result.error}`);
  }
}

// Asks in plain language, so learners never need to know what SMTP means.
export async function askEmailDelivery(io, values, step) {
  const hasSavedLogin = Boolean(values.smtpUser && values.smtpPass);
  const choices = [
    ...(hasSavedLogin ? [["keep", `Keep my current email login (${values.smtpUser})`]] : []),
    ["gmail", "Connect Gmail"],
    ["other", "Connect another email provider"],
    ...(hasSavedLogin ? [] : [["skip", "Skip for now (you can preview plans and connect email later)"]])
  ];
  const defaultChoice = hasSavedLogin ? 1 : choices.length;

  io.say("");
  io.say(`${step ? `[${step}] ` : ""}How should Kordexa send your daily plan?`);
  io.say("  Plans are sent from your own email account. Your login stays on this computer.");
  choices.forEach(([, label], index) => io.say(`  ${index + 1}. ${label}`));

  for (;;) {
    const answer = cleanText(await io.ask(`> [${defaultChoice}] `)).toLowerCase();
    throwIfCancelled(answer);
    const number = answer ? Number(answer) : defaultChoice;
    const selected = choices[number - 1]?.[0] || choices.find(([id]) => id === answer)?.[0];
    if (!selected) {
      io.say(`  ! Please choose a number from 1 to ${choices.length}.`);
      continue;
    }
    if (selected === "keep") return {};
    if (selected === "skip") return skipEmail(io);
    return selected === "gmail" ? connectGmail(io, values) : connectOtherProvider(io, values);
  }
}

function skipEmail(io) {
  io.say("  No problem. Connect email any time with: npx kordexa setup-email");
  return {};
}

async function askUntilValid(io, label, parse, fallback) {
  for (;;) {
    const answer = cleanText(await io.ask(label));
    throwIfCancelled(answer);
    if (!answer && fallback !== undefined) return fallback;
    const result = parse(answer);
    if (result.ok) return result.value;
    io.say(`  ! ${result.error}`);
  }
}

async function connectGmail(io, values) {
  const isGmail = /@(gmail|googlemail)\.com$/i.test(values.email || "");
  const account = isGmail
    ? values.email
    : await askUntilValid(io, "Gmail address: ", (raw) => parseEmail(raw, { allowPlaceholder: false }));

  io.say("");
  io.say("  Gmail needs an app password, which is different from your normal password:");
  io.say("  1. Turn on 2-Step Verification for your Google account.");
  io.say("  2. Open https://myaccount.google.com/apppasswords");
  io.say("  3. Create an app password named Kordexa and paste it below.");
  for (;;) {
    const answer = await io.askHidden("App password (hidden as you type, press Enter to skip): ");
    if (!answer.trim()) return skipEmail(io);
    const result = parseGmailAppPassword(answer);
    if (result.ok) {
      io.say("  Gmail connected.");
      return { smtpHost: "smtp.gmail.com", smtpPort: 465, smtpUser: account, smtpPass: result.value, smtpFrom: account };
    }
    io.say(`  ! ${result.error}`);
  }
}

async function connectOtherProvider(io, values) {
  io.say("");
  io.say("  Your email provider's help pages list these settings. Search for its \"SMTP settings\".");
  const hostLabel = "Mail server address (press Enter to skip): ";
  let host;
  for (;;) {
    const answer = cleanText(await io.ask(hostLabel));
    throwIfCancelled(answer);
    if (!answer) return skipEmail(io);
    host = parseSmtpHost(answer);
    if (host.ok) break;
    io.say(`  ! ${host.error}`);
  }
  const port = await askUntilValid(io, "Port [587]: ", parseSmtpPort, 587);
  const user = await askUntilValid(io, `Email login [${values.email}]: `, parseSmtpUser, values.email);
  const password = await io.askHidden("Password (hidden as you type, press Enter to skip): ");
  if (!password.trim()) return skipEmail(io);
  io.say("  Email provider connected.");
  return { smtpHost: host.value, smtpPort: port, smtpUser: user, smtpPass: password.trim(), smtpFrom: user };
}

function printReview(io, fields, values) {
  io.say("");
  io.say("Review your answers");
  fields.forEach((field, index) => io.say(`  ${index + 1}. ${field.summary}: ${values[field.key]}`));
  const delivery = values.smtpUser && values.smtpPass ? `Connected (${values.smtpUser})` : "Not connected yet";
  io.say(`  ${fields.length + 1}. Email sending: ${delivery}`);
  io.say("");
}

export function normalizeAnswers(values) {
  return {
    learner: {
      name: values.name,
      email: values.email,
      targetRole: values.targetRole,
      currentLearning: values.currentLearning,
      focusSkill: values.focusSkill,
      currentStage: values.currentStage,
      weeklyHours: Number.parseInt(values.weeklyHours, 10) || FALLBACK.weeklyHours,
      planDays: Math.max(30, Number.parseInt(values.planDays, 10) || FALLBACK.planDays)
    },
    schedule: {
      dailyEmailTime: values.dailyEmailTime,
      timezone: values.timezone
    },
    smtp: {
      host: values.smtpHost,
      port: Number.parseInt(values.smtpPort, 10) || FALLBACK.smtpPort,
      user: values.smtpUser,
      pass: values.smtpPass,
      from: values.smtpFrom || values.smtpUser || values.email
    },
    emailConnected: Boolean(values.smtpUser && values.smtpPass)
  };
}
