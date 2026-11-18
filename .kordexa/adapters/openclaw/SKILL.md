---
name: kordexa
description: Universal Kordexa adapter for openclaw. Use /kordexa for learner onboarding, adaptive plans with a 30-day minimum, trend research, daily email plans, progress logging, prebuilt skill progression cards, weekly summaries, and next-skill recommendations.
---

# Kordexa Adapter

Use /kordexa (or legacy /eduorchestrate) as the learner command. When invoked, load the Kordexa workflow and its prebuilt terminal-card program; never recreate, type out, or hand-design the card UI in the agent prompt. Ask for missing learner profile details, ask what the learner is currently studying, ask the first skill they want to focus on, generate or update an adaptive plan with a fixed 30-day minimum, research current and trending references, send or preview daily emails, log progress, load the bundled default card or CLI-produced card artifact, summarize the week, recommend the next skill after the plan window, and keep recommendations practical, sourced, and focused. Research resolves a concrete top video link (digest.topVideo.url) and top GitHub repo (digest.topRepo.url) so the daily email carries a watchable link, not only search queries; on network failure it falls back to search URLs, and --offline or KORDEXA_OFFLINE=1 skips resolution. The dependency-free mailer supports implicit TLS (port 465) and STARTTLS (port 587). Mail resume policy: apply this to every supported agent, not only Codex. When an agent runs in a resumable browser or workspace instance, treat each resume as a daily-mail checkpoint: load the harness or status, resolve the current plan day, and run npx kordexa send-today for the due day after SMTP setup. If SMTP secrets are missing or real sending has not been approved, run npx kordexa send-today --dry-run and ask before sending. GitHub Actions remains the scheduled no-browser path. If native slash commands are unavailable, treat "kordexa", "use Kordexa", "eduorchestrate", or "use EduOrchestrate" as equivalent to /kordexa.

Prefer:

```bash
npx kordexa
npx kordexa harness
npx kordexa courses
npx kordexa status
npx kordexa research --day 1
npx kordexa send-today --dry-run
npx kordexa log-progress --day 1 --completed "Built setup" --evidence "Repo link"
npx kordexa weekly-summary --week 1
npx kordexa progress-card
npx kordexa terminal-card
npx kordexa recommend-next
```
