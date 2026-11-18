import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeAgentAdapters } from "./adapters.js";
import { appendGitignore, loadConfig, loadEnvFile, readJson, resolveDataDir, saveConfig, writeJson, writeLocalEnv, validateConfig, CONFIG_FILE } from "./config.js";
import { createCoursePack, saveCoursePack } from "./courses.js";
import { dailyEmailKey, resendConfigFromEnv, sendMail, sendWithResend, smtpConfigFromEnv } from "./email.js";
import { createHarness, saveHarness } from "./harness.js";
import { generate30DayPlan, renderDailyEmail } from "./planner.js";
import { buildProgressionCard, copyDefaultTerminalCard, saveProgressionCard } from "./progression-card.js";
import { appendProgress, createWeeklySummary, planStatus, reviewProgress } from "./progress.js";
import { SetupCancelled, askEmailDelivery, collectOnboarding, createTerminalIO } from "./prompts.js";
import { appendResearchIndex, createResearchDigest, enrichDigestLinks, saveResearchDigest } from "./research.js";
import { parsePlanDays } from "./setup-answers.js";
import { renderView, terminalSupportsColor } from "./terminal-view.js";
import { workflowStatus, writeGithubWorkflow } from "./workflow.js";

const COMMANDS = ["plan", "status", "harness", "courses", "research", "links", "send-today", "log-progress", "weekly-summary", "recommend-next", "progress-card", "terminal-card", "setup-email", "setup-secrets", "doctor", "help"];
const SETUP_VALUE_FLAGS = {
  "--name": "name",
  "--email": "email",
  "--role": "targetRole",
  "--target-role": "targetRole",
  "--current-learning": "currentLearning",
  "--skill": "focusSkill",
  "--focus-skill": "focusSkill",
  "--stage": "currentStage",
  "--current-stage": "currentStage",
  "--weekly-hours": "weeklyHours",
  "--days": "planDays",
  "--time": "dailyEmailTime",
  "--timezone": "timezone",
  "--smtp-host": "smtpHost",
  "--smtp-port": "smtpPort",
  "--smtp-user": "smtpUser",
  "--smtp-pass": "smtpPass",
  "--smtp-from": "smtpFrom"
};
const SETUP_SWITCHES = ["--yes", "--non-interactive", "--offline", "--restart", "--allow-home", "--json"];

// People at a terminal get readable results. Agents, scripts and --json get JSON.
let jsonOutput = true;

export async function main(argv = []) {
  jsonOutput = argv.includes("--json") || !process.stdout.isTTY;
  const command = normalizeCommand(argv[0]);
  if (command === "send-today") return sendToday(argv.slice(1));
  if (command === "plan") return regeneratePlan(argv.slice(1));
  if (command === "status") return showStatus();
  if (command === "research") return research(argv.slice(1));
  if (command === "links") return links(argv.slice(1));
  if (command === "harness") return harness(argv.slice(1));
  if (command === "courses") return courses();
  if (command === "log-progress") return logProgress(argv.slice(1));
  if (command === "weekly-summary") return weeklySummary(argv.slice(1));
  if (command === "recommend-next") return recommendNext();
  if (command === "progress-card") return progressCard();
  if (command === "terminal-card") return terminalCard();
  if (command === "setup-email") return setupEmail();
  if (command === "setup-secrets") return setupSecrets();
  if (command === "doctor") return doctor();
  if (command === "help") return printHelp();
  if (command !== "init" && !command.startsWith("-")) throw new Error(unknownCommandMessage(command));
  return init(argv);
}

function normalizeCommand(value) {
  if (!value || value === "/kordexa" || value === "kordexa" || value === "/eduorchestrate" || value === "eduorchestrate" || value === "init") return "init";
  if (value === "--help" || value === "-h") return "help";
  return value;
}

function unknownCommandMessage(command) {
  const closest = COMMANDS.map((name) => [name, editDistance(command, name)]).sort((a, b) => a[1] - b[1])[0];
  const suggestion = closest[1] <= 3 ? ` Did you mean "${closest[0]}"?` : "";
  return `Unknown command "${command}".${suggestion} Run npx kordexa --help to see every command.`;
}

function editDistance(first, second) {
  let previous = Array.from({ length: second.length + 1 }, (_, index) => index);
  for (let row = 1; row <= first.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= second.length; column += 1) {
      const cost = first[row - 1] === second[column - 1] ? 0 : 1;
      current[column] = Math.min(previous[column] + 1, current[column - 1] + 1, previous[column - 1] + cost);
    }
    previous = current;
  }
  return previous[second.length];
}

function isHomeOrRootFolder() {
  const here = fs.realpathSync(process.cwd());
  return here === path.parse(here).root || here === fs.realpathSync(os.homedir());
}

// Setup writes several files, so a learner's home folder needs a clear yes.
async function confirmProjectFolder({ io, allowHome }) {
  if (allowHome || !isHomeOrRootFolder()) return;
  const advice = "Create a project folder first: mkdir my-learning && cd my-learning";
  if (!io) throw new Error(`Kordexa won't add files to your home folder. ${advice}`);
  io.say("");
  io.say("You're in your home folder, and Kordexa will add its files here.");
  io.say(`  ${advice}`);
  const answer = (await io.ask("Continue here anyway? [y/N] ")).trim().toLowerCase();
  if (answer !== "y" && answer !== "yes") throw new SetupCancelled("Setup stopped. Nothing was saved.");
}

function assertKnownSetupOptions(argv) {
  const start = argv[0] && !argv[0].startsWith("-") ? 1 : 0;
  for (let index = start; index < argv.length; index += 1) {
    const option = argv[index];
    if (SETUP_SWITCHES.includes(option)) continue;
    if (!SETUP_VALUE_FLAGS[option]) throw new Error(`Unknown option "${option}". Run npx kordexa --help to see the options.`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Please add a value after ${option}.`);
    index += 1;
  }
}

async function init(argv) {
  assertKnownSetupOptions(argv);
  const nonInteractive = argv.includes("--yes") || argv.includes("--non-interactive");
  const overrides = parseKeyValues(argv);
  const existing = existingSetup();
  const io = nonInteractive ? null : createTerminalIO();
  let answers;
  try {
    await confirmProjectFolder({ io, allowHome: argv.includes("--allow-home") });
    answers = await collectOnboarding({ defaults: existing.defaults, nonInteractive, overrides, io });
  } catch (error) {
    if (!(error instanceof SetupCancelled)) throw error;
    console.log(`\n${error.message}`);
    process.exitCode = 130;
    return;
  } finally {
    io?.close();
  }
  const config = {
    version: 1,
    command: "/kordexa",
    dataDir: "data",
    learner: answers.learner,
    schedule: answers.schedule,
    email: {
      provider: "smtp",
      to: answers.learner.email,
      fromEnv: ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"]
    },
    agents: ["claude", "codex", "gemini", "openclaw", "antigravity", "hermas", "generic"]
  };
  const keepStartDate = !argv.includes("--restart") && Number.isFinite(dateStringToUtc(existing.startDate).getTime());
  config.schedule.startDate = keepStartDate ? existing.startDate : localDateString(new Date(), config.schedule.timezone);
  saveConfig(config);
  appendGitignore(["__pycache__/", "*.py[cod]", ".pytest_cache/", "node_modules/", ".env.local", "data/"]);
  writeLocalEnv({
    SMTP_HOST: answers.smtp.host,
    SMTP_PORT: answers.smtp.port,
    SMTP_USER: answers.smtp.user,
    SMTP_PASS: answers.smtp.pass,
    SMTP_FROM: answers.smtp.from
  });
  const adapterFiles = writeAgentAdapters();
  const plan = generate30DayPlan(config.learner);
  writeDataJson(config, "30-day-plan.json", plan);
  const defaultTerminalCard = copyDefaultTerminalCard(config);
  const cardPaths = saveProgressionCard(config, buildProgressionCard(config, plan));
  const harnessPaths = saveHarness(config, createHarness(config, plan, "init"));
  const coursePaths = saveCoursePack(config, createCoursePack(config, plan));
  const digest = createResearchDigest({ config, topic: plan.days[0].title, day: 1, roleKey: plan.roleKey });
  await enrichDigestLinks(digest, { offline: argv.includes("--offline") });
  const digestPath = saveResearchDigest(config, digest);
  appendResearchIndex(config, digestPath, digest);
  const workflowPath = writeGithubWorkflow(config);
  const { warnings } = workflowStatus();
  if ((!nonInteractive || !jsonOutput) && !argv.includes("--json")) {
    printSetupComplete(config, plan, answers.emailConnected, warnings);
    return;
  }
  outputJson({
    status: "initialized",
    command: "/kordexa",
    adapters: adapterFiles,
    plan: "data/30-day-plan.json",
    defaultTerminalCard,
    progressionCard: cardPaths.markdownPath,
    harness: harnessPaths.jsonPath,
    learningSources: coursePaths.jsonPath,
    workflow: path.relative(process.cwd(), workflowPath),
    firstResearchDigest: digestPath,
    startDate: config.schedule.startDate,
    next: "Run npx kordexa send-today --dry-run to preview the first email.",
    ...(warnings.length ? { warnings } : {})
  });
}

function printSetupComplete(config, plan, emailConnected, warnings) {
  const { learner, schedule } = config;
  console.log("");
  console.log(`You're all set, ${learner.name}.`);
  console.log(`  Plan: ${plan.days.length} days toward ${learner.targetRole}`);
  console.log(`  First skill: ${learner.focusSkill}`);
  console.log(`  Daily email: ${schedule.dailyEmailTime} ${schedule.timezone}${emailConnected ? "" : " (not connected yet)"}`);
  console.log(`  Saved in: ${process.cwd()}`);
  console.log("");
  console.log("Next steps:");
  console.log("  npx kordexa send-today --dry-run   Preview today's plan");
  if (!emailConnected) console.log("  npx kordexa setup-email            Connect your email");
  console.log("  npx kordexa status                 See your progress");
  for (const warning of warnings) console.log(`\nWarning: ${warning}`);
}

async function setupEmail() {
  const config = loadConfig();
  const env = loadEnvFile(path.join(process.cwd(), ".env.local"));
  const io = createTerminalIO();
  try {
    const email = await askEmailDelivery(io, { email: config.learner.email, smtpUser: env.SMTP_USER, smtpPass: env.SMTP_PASS });
    writeLocalEnv({ SMTP_HOST: email.smtpHost, SMTP_PORT: email.smtpPort, SMTP_USER: email.smtpUser, SMTP_PASS: email.smtpPass, SMTP_FROM: email.smtpFrom });
    if (email.smtpUser) console.log("\nEmail settings saved. Preview your plan with: npx kordexa send-today --dry-run");
  } catch (error) {
    if (!(error instanceof SetupCancelled)) throw error;
    console.log("\nEmail setup stopped. Nothing was changed.");
    process.exitCode = 130;
  } finally {
    io.close();
  }
}

// Re-running setup must not reset a learner's profile, email login or schedule.
function existingSetup() {
  let config = null;
  try {
    config = loadConfig();
  } catch {
    config = null;
  }
  const env = loadEnvFile(path.join(process.cwd(), ".env.local"));
  const { learner = {}, schedule = {} } = config || {};
  const saved = {
    name: learner.name,
    email: learner.email,
    targetRole: learner.targetRole,
    currentLearning: learner.currentLearning,
    focusSkill: learner.focusSkill,
    currentStage: learner.currentStage,
    weeklyHours: learner.weeklyHours,
    planDays: learner.planDays,
    dailyEmailTime: schedule.dailyEmailTime,
    timezone: schedule.timezone,
    smtpHost: env.SMTP_HOST,
    smtpPort: env.SMTP_PORT,
    smtpUser: env.SMTP_USER,
    smtpPass: env.SMTP_PASS,
    smtpFrom: env.SMTP_FROM
  };
  return {
    startDate: schedule.startDate,
    defaults: Object.fromEntries(Object.entries(saved).filter(([, value]) => value !== undefined && value !== ""))
  };
}

function regeneratePlan(argv) {
  const config = loadConfig();
  const roleArg = valueAfter(argv, "--role");
  if (roleArg) config.learner.targetRole = roleArg;
  const focusSkill = valueAfter(argv, "--skill") || valueAfter(argv, "--focus-skill");
  if (focusSkill) config.learner.focusSkill = focusSkill;
  const currentLearning = valueAfter(argv, "--current-learning");
  if (currentLearning) config.learner.currentLearning = currentLearning;
  const daysArg = valueAfter(argv, "--days");
  if (daysArg !== undefined) {
    const days = parsePlanDays(daysArg);
    if (!days.ok) throw new Error(days.error);
    config.learner.planDays = days.value;
  }
  const plan = generate30DayPlan(config.learner);
  writeDataJson(config, "30-day-plan.json", plan);
  saveConfig(config);
  present("plan", { status: "saved", plan: "data/30-day-plan.json", days: plan.days.length }, { plan });
}

async function sendToday(argv) {
  const dryRun = argv.includes("--dry-run");
  const explicitDay = valueAfter(argv, "--day");
  const { config, plan } = loadRuntime();
  const day = explicitDay ? parsePositiveDay(explicitDay, plan) : resolveScheduledDay(config, plan);
  if (!explicitDay && day > plan.days.length) {
    const result = {
      skipped: true,
      reason: "plan-complete",
      day,
      planDays: plan.days.length,
      recommendation: plan.nextSkillRecommendation
    };
    writeDataJson(config, "latest-email.json", { generatedAt: new Date().toISOString(), ...result });
    present("skipped", result);
    return;
  }
  const progressReview = reviewProgress(config, plan);
  const progressionCard = buildProgressionCard(config, plan);
  saveProgressionCard(config, progressionCard);
  const coursePack = createCoursePack(config, plan);
  saveCoursePack(config, coursePack);
  const digest = createResearchDigest({
    config,
    topic: plan.days.find((entry) => entry.day === day)?.title || config.learner.targetRole,
    day,
    roleKey: plan.roleKey
  });
  await enrichDigestLinks(digest, { offline: argv.includes("--offline") });
  const digestPath = saveResearchDigest(config, digest);
  appendResearchIndex(config, digestPath, digest);
  const env = { ...process.env, ...loadEnvFile(path.join(process.cwd(), ".env.local")) };
  const smtp = smtpConfigFromEnv(env);
  const message = renderDailyEmail(config, plan, day, { progressReview, researchDigest: digest, progressionCard, coursePack });
  const resend = resendConfigFromEnv(env);
  const result = resend && !dryRun
    ? await sendWithResend({ resend, message, idempotencyKey: dailyEmailKey(message.to, config.schedule?.startDate, day) })
    : await sendMail({ smtp, message, dryRun });
  writeDataJson(config, "latest-email.json", { generatedAt: new Date().toISOString(), researchDigest: digestPath, ...result });
  const previewPath = path.join(config.dataDir || "data", "email-preview.html");
  if (dryRun) fs.writeFileSync(path.join(process.cwd(), previewPath), message.html, "utf8");
  present("email", result, {
    day: plan.days.find((entry) => entry.day === day) || plan.days[0],
    digest,
    review: progressReview,
    totalDays: plan.days.length,
    completedDays: progressReview.completedDays,
    previewPath,
    emailConnected: Boolean(resend || (smtp.host && smtp.user && smtp.pass))
  });
}

export function resolveScheduledDay(config, plan, now = new Date()) {
  const startDate = config.schedule?.startDate;
  if (!startDate) return 1;
  const today = localDateString(now, config.schedule?.timezone);
  const elapsedDays = daysBetweenDateStrings(startDate, today);
  const day = elapsedDays + 1;
  return Number.isFinite(day) ? Math.max(1, day) : 1;
}

function showStatus() {
  const { config, plan } = loadRuntime();
  present("status", planStatus(config, plan));
}

async function research(argv) {
  const { config, plan } = loadRuntime();
  const day = parsePositiveDay(valueAfter(argv, "--day") ?? "1", plan);
  const topic = valueAfter(argv, "--topic") || plan.days.find((entry) => entry.day === day)?.title || config.learner.targetRole;
  const digest = createResearchDigest({ config, topic, day, roleKey: plan.roleKey });
  await enrichDigestLinks(digest, { offline: argv.includes("--offline") });
  const digestPath = saveResearchDigest(config, digest);
  appendResearchIndex(config, digestPath, digest);
  present("research", { status: "saved", path: digestPath, digest });
}

async function links(argv) {
  const { config, plan } = loadRuntime();
  const day = parsePositiveDay(valueAfter(argv, "--day") ?? "1", plan);
  const topic = valueAfter(argv, "--topic") || plan.days.find((entry) => entry.day === day)?.title || config.learner.targetRole;
  const digest = createResearchDigest({ config, topic, day, roleKey: plan.roleKey });
  await enrichDigestLinks(digest, { offline: argv.includes("--offline"), limit: 3 });
  const payload = {
    generatedAt: new Date().toISOString(),
    day,
    topic,
    liveResolved: digest.liveResolved,
    topVideo: digest.topVideo,
    topRepo: digest.topRepo,
    topDoc: digest.topDoc,
    videos: digest.videos || [],
    repos: digest.repos || []
  };
  writeDataJson(config, "links.json", payload);
  present("links", { status: "resolved", path: "data/links.json", ...payload });
}

function harness(argv) {
  const { config, plan } = loadRuntime();
  const mode = valueAfter(argv, "--mode") || "daily";
  const payload = createHarness(config, plan, mode);
  const paths = saveHarness(config, payload);
  present("harness", { status: "saved", ...paths, harness: payload });
}

function courses() {
  const { config, plan } = loadRuntime();
  const pack = createCoursePack(config, plan);
  const paths = saveCoursePack(config, pack);
  present("courses", { status: "saved", ...paths, learningSources: pack });
}

function logProgress(argv) {
  const { config, plan } = loadRuntime();
  const completed = valueAfter(argv, "--completed")?.trim();
  const evidence = valueAfter(argv, "--evidence")?.trim();
  if (!completed || !evidence) {
    throw new Error('Please say what you finished and link your proof: npx kordexa log-progress --completed "Built the demo" --evidence "github.com/me/demo"');
  }
  const dayArg = valueAfter(argv, "--day");
  if (dayArg !== undefined) parsePositiveDay(dayArg, plan);
  assertWholeNumber(valueAfter(argv, "--minutes"), "--minutes", 0, 1440);
  assertWholeNumber(valueAfter(argv, "--confidence"), "--confidence", 1, 5);
  const entry = appendProgress(config, {
    day: dayArg,
    completed,
    evidence,
    minutes: valueAfter(argv, "--minutes"),
    confidence: valueAfter(argv, "--confidence"),
    blocker: valueAfter(argv, "--blocker")
  });
  const review = reviewProgress(config, plan);
  const cardPaths = saveProgressionCard(config, buildProgressionCard(config, plan));
  writeDataJson(config, "latest-review.json", review);
  present("logged", { status: "logged", entry, review, progressionCard: cardPaths.markdownPath });
}

function weeklySummary(argv) {
  const { config, plan } = loadRuntime();
  const totalWeeks = Math.ceil(plan.days.length / 7);
  const week = assertWholeNumber(valueAfter(argv, "--week") ?? "1", "--week", 1, totalWeeks);
  const summary = createWeeklySummary(config, plan, week);
  writeDataJson(config, `weekly-summary-${week}.json`, summary);
  present("weekly", summary);
}

function recommendNext() {
  const { config, plan } = loadRuntime();
  const review = reviewProgress(config, plan);
  const currentFocus = config.learner.focusSkill || plan.primarySkill;
  const recommendation = plan.nextSkillRecommendation || {
    afterDay: plan.days.length,
    currentFocus,
    recommendedNextSkill: "portfolio-level capstone improvement",
    reason: "Finish the current plan, then deepen the artifact with evaluation, deployment, and interview proof."
  };
  const payload = {
    generatedAt: new Date().toISOString(),
    canAdvance: review.completedDays >= plan.days.length,
    completedDays: review.completedDays,
    requiredDays: plan.days.length,
    currentFocus,
    ...recommendation
  };
  writeDataJson(config, "next-skill-recommendation.json", payload);
  present("recommendation", payload);
}

function progressCard() {
  const { config, plan } = loadRuntime();
  const card = buildProgressionCard(config, plan);
  const paths = saveProgressionCard(config, card);
  present("card", { status: "saved", ...paths, card });
}

function terminalCard() {
  const { config, plan } = loadRuntime();
  const card = buildProgressionCard(config, plan);
  const paths = saveProgressionCard(config, card);
  present("terminalCard", {
    status: "saved",
    terminalSvgPath: paths.terminalSvgPath,
    terminalLines: card.terminalLines
  });
}

function setupSecrets() {
  const config = loadConfig();
  const env = loadEnvFile(path.join(process.cwd(), ".env.local"));
  const commands = env.RESEND_API_KEY ? ["gh secret set RESEND_API_KEY"] : [
    secretCommand("SMTP_HOST", env.SMTP_HOST || "<smtp-host>"),
    secretCommand("SMTP_PORT", env.SMTP_PORT || "465"),
    secretCommand("SMTP_USER", env.SMTP_USER || "<smtp-user>"),
    "gh secret set SMTP_PASS",
    secretCommand("SMTP_FROM", env.SMTP_FROM || config.email.to)
  ];
  const payload = {
    status: "manual-secret-commands",
    note: "Run these after gh auth login. Secrets are not committed.",
    commands
  };
  present("secrets", payload);
  return payload;
}

function secretCommand(key, value) {
  return `gh secret set ${key} --body "${String(value).replace(/"/g, '\\"')}"`;
}

function doctor() {
  const configPath = path.join(process.cwd(), CONFIG_FILE);
  const configExists = fs.existsSync(configPath);
  const parsedConfig = configExists ? readJson(configPath) : null;
  const configValidation = parsedConfig ? validateConfig(parsedConfig) : { valid: false, errors: ["Missing configuration"] };

  const scheduled = workflowStatus();
  const localSettings = { ...process.env, ...loadEnvFile(path.join(process.cwd(), ".env.local")) };
  const missingEmailSettings = localSettings.RESEND_API_KEY ? [] : ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"].filter((key) => !localSettings[key]);

  const checks = {
    agentsMd: fs.existsSync(path.join(process.cwd(), "AGENTS.md")),
    geminiMd: fs.existsSync(path.join(process.cwd(), "GEMINI.md")),
    claudeSkill: fs.existsSync(path.join(process.cwd(), ".claude", "skills", "kordexa", "SKILL.md")) || fs.existsSync(path.join(process.cwd(), ".claude", "skills", "eduorchestrate", "SKILL.md")),
    mcpManifest: fs.existsSync(path.join(process.cwd(), ".kordexa", "mcp", "manifest.json")) || fs.existsSync(path.join(process.cwd(), ".eduorchestrate", "mcp", "manifest.json")),
    config: (configExists && configValidation.valid) || (fs.existsSync(path.join(process.cwd(), "eduorchestrate.config.json")) && validateConfig(readJson(path.join(process.cwd(), "eduorchestrate.config.json"))).valid),
    workflow: scheduled.current,
    localEnv: fs.existsSync(path.join(process.cwd(), ".env.local")),
    localEmail: missingEmailSettings.length === 0
  };
  const { workflow, localEnv, localEmail, ...setupChecks } = checks;
  const setupComplete = Object.values(setupChecks).every(Boolean);
  const needsUpgrade = setupComplete && scheduled.outdated;
  const nextSteps = [];
  if (!setupComplete || (!workflow && !scheduled.outdated)) nextSteps.push("Run npx kordexa to finish setup.");
  if (needsUpgrade) nextSteps.push("Run npx kordexa --yes to update the scheduled workflow. Your profile, email settings, progress and start date are kept.");
  if (!localEmail) nextSteps.push(`Add ${missingEmailSettings.join(", ")} to .env.local, or run npx kordexa setup-email to connect your email. For scheduled email, run npx kordexa setup-secrets.`);
  let status = "ready";
  if (!setupComplete || (!workflow && !scheduled.outdated)) status = "needs-setup";
  else if (needsUpgrade) status = "needs-upgrade";
  else if (!localEmail) status = "needs-email-setup";
  const result = {
    status,
    checks,
    ...(nextSteps.length ? { nextSteps } : {}),
    ...(scheduled.warnings.length ? { warnings: scheduled.warnings } : {}),
    ...(configValidation.errors.length > 0 && configExists ? { configErrors: configValidation.errors } : {})
  };
  present("doctor", result);
  return result;
}

function printHelp() {
  console.log(`Kordexa — AI-powered daily learning command center

Commands:
  npx kordexa                                Run one-command onboarding
  npx kordexa /kordexa                       Same as onboarding
  npx kordexa --yes --restart                Run setup again and restart the plan today
  npx kordexa plan --role "Agentic AI and LLM Engineer"
  npx kordexa plan --days 45 --skill "RAG evaluation"
  npx kordexa status
  npx kordexa harness
  npx kordexa courses
  npx kordexa research --day 1
  npx kordexa links --day 1
  npx kordexa send-today --dry-run
  npx kordexa log-progress --day 1 --completed "Built setup" --evidence "Repo link"
  npx kordexa weekly-summary --week 1
  npx kordexa recommend-next
  npx kordexa progress-card
  npx kordexa terminal-card
  npx kordexa setup-email
  npx kordexa setup-secrets
  npx kordexa doctor

Add --json to any command to get machine-readable output.
Note: /eduorchestrate stays available inside agents as a legacy alias for /kordexa.
`);
}

function parseKeyValues(argv) {
  const overrides = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = SETUP_VALUE_FLAGS[argv[index]];
    if (key && argv[index + 1]) overrides[key] = argv[index + 1];
  }
  return overrides;
}

function assertWholeNumber(value, flag, min, max) {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!/^\d+$/.test(String(value)) || number < min || number > max) {
    throw new Error(`${flag} must be a whole number from ${min} to ${max}.`);
  }
  return number;
}

function valueAfter(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

function parsePositiveDay(value, plan) {
  const lastDay = plan?.days?.length || 1;
  const day = Number.parseInt(value, 10);
  if (!/^\d+$/.test(String(value || "")) || day < 1) throw new Error(`--day must be a whole number from 1 to ${lastDay}.`);
  if (plan?.days?.length && day > lastDay) throw new Error(`Day ${day} is outside this ${lastDay}-day plan.`);
  return day;
}

function localDateString(date = new Date(), timezone = "UTC") {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function daysBetweenDateStrings(startDate, endDate) {
  const start = dateStringToUtc(startDate);
  const end = dateStringToUtc(endDate);
  return Math.floor((end.getTime() - start.getTime()) / 86400000);
}

function dateStringToUtc(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) return new Date(Number.NaN);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return new Date(Number.NaN);
  }
  return date;
}

function loadRuntime() {
  const config = loadConfig();
  return { config, plan: loadOrCreatePlan(config) };
}

function loadOrCreatePlan(config) {
  const planPath = path.join(resolveDataDir(config), "30-day-plan.json");
  const existing = readJson(planPath);
  if (hasPlanDays(existing)) return existing;
  const plan = generate30DayPlan(config.learner);
  writeJson(planPath, plan);
  return plan;
}

function hasPlanDays(plan) {
  return Array.isArray(plan?.days) && plan.days.length > 0;
}

function writeDataJson(config, fileName, payload) {
  writeJson(path.join(resolveDataDir(config), fileName), payload);
}

function present(view, payload, context) {
  if (jsonOutput) {
    outputJson(payload);
    return;
  }
  console.log(`\n${renderView(view, payload, context, { color: terminalSupportsColor(), width: process.stdout.columns })}\n`);
}

function outputJson(payload) {
  console.log(JSON.stringify(payload, null, 2));
}
