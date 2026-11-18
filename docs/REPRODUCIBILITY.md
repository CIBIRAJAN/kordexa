# Kordexa Documentation — Reproducibility & Replication Guide

**Document Status:** Complete  
**Date:** 2026-10-29  
**Version:** 1.0.0  
**Target Audience:** Independent Evaluators, Peer Reviewers, Research Replicators

---

## 1. System Requirements & Runtime Environment

Kordexa is engineered with zero external runtime dependencies. Replication requires only standard Node.js on any POSIX or Windows machine.

| Component | Verified Specification | Compatibility Notes |
|---|---|---|
| **Operating System** | macOS (Darwin 24+), Linux (Ubuntu 22.04+), Windows 11 (WSL2/PowerShell) | Architecture agnostic (x86_64, arm64) |
| **Node.js Runtime** | Node.js `>= 18.0.0` (Tested on `v22.16.0` and `v18.20.0`) | Built-in ES modules support required |
| **npm** | npm `>= 9.0.0` | Used solely for running the built-in test script |
| **Runtime Dependencies** | **0** | No `node_modules` directory required at runtime |
| **Network Access** | Optional (Full offline support supported) | Only needed for real SMTP sending or live link scraping |

---

## 2. Step-by-Step Installation & Setup

### Step 1: Clone the Repository
```bash
git clone https://github.com/kordexa/kordexa.git
cd Kordexa
```

### Step 2: Verify Node.js Environment
```bash
node --version
# Expected: v18.0.0 or higher (e.g. v22.16.0)
```

No `npm install` is required for production usage because the project has zero external dependencies.

---

## 3. Running Automated Tests & Verification

The test suite exercises unit functions, integration CLI flows, error handling, date arithmetic, and offline link resolutions.

Execute the built-in test runner:
```bash
npm test
```
Or run directly via Node.js:
```bash
node --test tests/node/*.test.js
```

### Expected Output:
```
✔ one-command setup writes universal agent adapters and plan (38ms)
✔ agentic ai day one contains required setup surfaces
✔ full-stack role uses full-stack blueprint
✔ daily email dry-run payload contains slash command and references
✔ cron is generated from requested time
✔ scheduled send resolves the plan day from the configured start date
✔ scheduled send handles missing or invalid start dates safely
✔ scheduled send skips after the plan window instead of sending forever
✔ explicit send-today day overrides plan-complete scheduled skip
✔ commands recover when the saved plan has no days
✔ expanded CLI commands create research, progress, status, and weekly summary
✔ plan command honors requested days above the 30 day minimum
✔ offline link resolution falls back to verifiable search URLs
✔ link resolution returns concrete video and repo links (stubbed fetch)
✔ daily email embeds the resolved top video and repo links
✔ daily email renders clickable html with the resolved video link
✔ links command resolves and persists data/links.json
✔ validateConfig properly identifies valid and invalid configurations
✔ readJson safely recovers from corrupt or malformed JSON files
✔ doctor reports detailed checks and config status
✔ setup-secrets prints valid gh secret set commands
✔ trend queries dynamically reflect current year

ℹ tests 22
ℹ suites 0
ℹ pass 22
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms ~240ms
```

---

## 4. Reproducing Documented Workflow Examples

### 4.1 Non-Interactive Onboarding & Plan Generation
To initialize a complete workspace deterministically without terminal prompts:
```bash
node bin/kordexa.js --yes \
  --name "Alice" \
  --email "alice@example.com" \
  --role "Agentic AI and LLM Engineer" \
  --skill "RAG evaluation" \
  --stage "beginner" \
  --days 30 \
  --time "08:00" \
  --timezone "UTC"
```

Verify that the following files are produced:
- `kordexa.config.json` — Learner configuration.
- `.env.local` — Local SMTP secrets file (populated with defaults).
- `.github/workflows/kordexa-daily.yml` — Scheduled runner workflow.
- `data/30-day-plan.json` — 30-day curriculum JSON.
- `data/kordexa-harness.json` — Execution harness.
- `data/learning-sources.json` — Role-specific course & source pack.
- `data/progression-card.md` — Initial skill progression card.
- `data/default-terminal-card.svg` — Visual status card.

### 4.2 Verifying Workspace Health (`doctor`)
```bash
node bin/kordexa.js doctor
```
Expected output:
```json
{
  "status": "ready",
  "checks": {
    "packageJson": true,
    "skill": true,
    "agentsMd": true,
    "geminiMd": true,
    "claudeSkill": true,
    "mcpManifest": true,
    "config": true,
    "localEnv": true
  }
}
```

### 4.3 Generating Daily Research Digest
```bash
node bin/kordexa.js research --day 1 --offline
```
Inspect the output file generated in `data/research-digests/`:
- Verifies that curated official docs, search URLs, and practice tasks are generated without network dependencies.

### 4.4 Simulating Email Dispatch (`send-today --dry-run`)
```bash
node bin/kordexa.js send-today --dry-run --day 1
```
Expected output:
- Returns `{ dryRun: true, message: { to: "alice@example.com", subject: "Kordexa Day 1: ...", text: "...", html: "..." } }`.
- Zero network traffic is emitted.

### 4.5 Logging Daily Proof & Viewing Updated Progression Card
```bash
node bin/kordexa.js log-progress \
  --day 1 \
  --completed "Set up local ChromaDB and indexed 5 technical documents" \
  --evidence "https://github.com/alice/rag-demo/commit/1a2b3c4" \
  --minutes 60 \
  --confidence 4
```
View status:
```bash
node bin/kordexa.js status
```
Generate updated terminal card:
```bash
node bin/kordexa.js terminal-card
```

---

## 5. Environment Variables & Secret Configuration

To test live email transmission over SMTP (optional):
1. Copy `.env.example` to `.env.local`:
   ```bash
   cp .env.example .env.local
   ```
2. Edit `.env.local` with real credentials:
   ```env
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_USER=alice@gmail.com
   SMTP_PASS=abcd-efgh-ijkl-mnop
   SMTP_FROM=alice@gmail.com
   ```
3. Run live dispatch:
   ```bash
   node bin/kordexa.js send-today --day 1
   ```

---

## 6. Execution Parameters and Determinism Controls

- **Deterministic Date Resolution:** The scheduled day calculation relies on `schedule.startDate` in `kordexa.config.json`. To test specific days deterministically, set `startDate` to a fixed past date (e.g., `"2026-01-01"`).
- **Network Isolation:** Set `process.env.KORDEXA_OFFLINE = "1"` or pass the `--offline` flag to any research or links command.
- **Random Seeds:** Kordexa uses deterministic sequencing for topics based on blueprint order. Randomness is limited to UUID generation for email Message-IDs and MIME boundaries, which does not affect curriculum content.

