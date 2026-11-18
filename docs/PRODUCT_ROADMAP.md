# Kordexa Documentation — Product & Technical Roadmap

**Document Status:** Complete  
**Date:** 2026-10-29  
**Version:** 1.0.0  
**Scope:** Engineering, Reliability, Research, and Publication Preparation

---

## 1. Overview and Engineering Principles

Kordexa's core value proposition is a **local-first, dependency-free learning command center** embedded within developer AI coding agents. This roadmap guides the technical evolution of the project from its current working prototype into an empirically verified, robust system suitable for academic publication and production developer adoption.

### Core Principles
1. **Preserve Zero-Dependency Runtime:** Keep the Node.js runtime strictly zero-dependency (`node:fs`, `node:net`, `node:tls`, `node:crypto`). No extraneous npm packages.
2. **Prioritize Correctness and Defensibility:** Fix verified bugs, eliminate edge-case crashes, validate schemas, and write regression tests before adding features.
3. **Transparent Separation of Concerns:** Distinguish clearly between code-level mechanics (CLI, SMTP, JSON persistence) and prompt-level agent instructions (SOP contracts).

---

## 2. Roadmap Summary

```
+-----------------------------------------------------------------------------------------+
|                                    PRODUCT ROADMAP                                      |
+-----------------------------------------------------------------------------------------+
| P0: Correctness & Reproducibility                                                       |
|   - P0-1: Robust JSON Parser with Corruption Recovery (`src/config.js`)                 |
|   - P0-2: Config Schema Validation & Error Reporting (`src/config.js`)                  |
|   - P0-3: Test Coverage for Untested Public CLI Commands (`doctor`, `setup-secrets`)    |
|   - P0-4: Safe Input Bounds & Dynamic Year Handling in Prompts                          |
+-----------------------------------------------------------------------------------------+
| P1: Core Engineering & Modularity                                                       |
|   - P1-1: Enhanced Health-Check & Diagnostic Verification in `doctor`                   |
|   - P1-2: Decouple Email HTML Rendering from Core Curriculum Planner                    |
|   - P1-3: Circular Dependency Elimination & Pure Helper Modules                         |
|   - P1-4: SMTP Socket Timeout & Network Guardrails                                      |
+-----------------------------------------------------------------------------------------+
| P2: Meaningful Differentiators                                                          |
|   - P2-1: Local Study Progress Analytics & Momentum Velocity Computation                |
|   - P2-2: Dynamic Trend Ingestion Heuristics (Extensible Source Seed Provider)          |
|   - P2-3: Exportable Evidence Portfolio (`portfolio-export` command)                    |
+-----------------------------------------------------------------------------------------+
| P3: Research, Benchmarking & Publication                                                |
|   - P3-1: Multi-Agent Role Decomposition Ablation Benchmark                             |
|   - P3-2: Token Consumption & Context Harness Optimization Study                        |
|   - P3-3: Empirical Evaluation Dataset ("EduBlueprints-120") Publication                |
|   - P3-4: Peer-Reviewed Conference Manuscript Completion                                |
+-----------------------------------------------------------------------------------------+
```

---

## 3. P0 — Correctness and Reproducibility

### P0-1: Robust JSON Parser with Safe Fallback and Recovery
- **Problem:** `readJson` in `src/config.js` does a direct `JSON.parse(fs.readFileSync(...))`. If a data file (e.g., `30-day-plan.json` or `progress-log.json`) is empty, truncated mid-write, or corrupted, the entire CLI crashes with an unhandled `SyntaxError`.
- **Evidence:** `src/config.js` lines 11–14:
  ```javascript
  export function readJson(filePath, fallback = null) {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }
  ```
- **Proposed Solution:** Wrap `JSON.parse` in a `try/catch` block. Return the fallback value on parse errors, and optionally log a recoverable warning to stderr without halting unaffected commands.
- **Expected Benefit:** Complete immunity to data corruption crashes during routine runs.
- **Implementation Effort:** Low (10 lines).
- **Dependencies:** None.
- **Risks:** Returning fallback might mask a corrupt file; solution should preserve the corrupted file as `.corrupt` if needed.
- **Acceptance Criteria:** A test corrupting a JSON file with invalid syntax does not throw an uncaught exception; command safely recovers or reports fallback.
- **Relevant Tests:** `tests/node/eduorchestrate.test.js` new test case.

### P0-2: Strict Configuration Validation (`validateConfig`)
- **Problem:** `loadConfig` accepts any JSON file as long as it exists. Missing required keys (such as `learner.targetRole`, `schedule.startDate`, or `schedule.dailyEmailTime`) causes downstream TypeError crashes (e.g., in `cli.js` date arithmetic).
- **Evidence:** `src/config.js` lines 25–32.
- **Proposed Solution:** Add `validateConfig(config)` function in `src/config.js`. Check for required top-level keys (`learner`, `schedule`, `email`), ensure `planDays >= 30`, validate timezone string if possible, and return a structured `{ valid: boolean, errors: string[] }`.
- **Expected Benefit:** Actionable, human-friendly error messages when configuration is damaged or manually edited improperly.
- **Implementation Effort:** Low-Medium (30 lines).
- **Dependencies:** None.
- **Risks:** Backwards compatibility if users have custom config formats; mitigated by allowing extra optional fields.
- **Acceptance Criteria:** Invalid config returns clear descriptive error message advising user how to fix it or re-run setup.
- **Relevant Tests:** Unit test verifying invalid config rejection and valid config acceptance.

### P0-3: Test Coverage for Public Commands (`doctor`, `setup-secrets`, `help`)
- **Problem:** Public commands `doctor`, `setup-secrets`, and `help` are documented in the README and CLI help text, but are not explicitly exercised in unit or regression tests.
- **Evidence:** `tests/node/eduorchestrate.test.js` tests 1–17 don't assert specific outputs for `doctor` and `setup-secrets` standalone invocations.
- **Proposed Solution:** Add automated regression tests for `doctor` and `setup-secrets` in `tests/node/eduorchestrate.test.js`.
- **Expected Benefit:** Guarantees zero regressions in diagnostics and onboarding setup commands.
- **Implementation Effort:** Low.
- **Dependencies:** Test harness `inTempDir`.
- **Risks:** None.
- **Acceptance Criteria:** `npm test` executes tests validating output structures of `doctor` and `setup-secrets`.
- **Relevant Tests:** `doctor reports ready on complete setup`, `setup-secrets outputs valid gh command list`.

### P0-4: Safe Input Bounds & Dynamic Current Year Handling
- **Problem:** Search queries in `src/planner.js` line 177 and `src/research.js` line 40 hardcode the year `"2026"`. While accurate for the project's contemporary horizon, hardcoded years become obsolete and brittle.
- **Evidence:** `planner.js` line 177: `trending tools 2026`. `research.js` line 40: `trending tools best practices 2026`.
- **Proposed Solution:** Dynamically inject `new Date().getFullYear()` into search query templates.
- **Expected Benefit:** Search queries automatically maintain currency without requiring annual maintenance.
- **Implementation Effort:** Low.
- **Dependencies:** None.
- **Risks:** None.
- **Acceptance Criteria:** Queries reflect current calendar year dynamically.
- **Relevant Tests:** Unit tests for search query generation.

---

## 4. P1 — Core Engineering & Modularity

### P1-1: Enhanced Diagnostic Verification in `doctor`
- **Problem:** `doctor` currently only checks `fs.existsSync` for files. It does not verify whether JSON files parse, whether `.env.local` contains valid SMTP variables, or whether the plan contains days.
- **Evidence:** `src/cli.js` lines 296–308.
- **Proposed Solution:** Expand `doctor()` to validate: (1) `kordexa.config.json` schema validity, (2) `.env.local` required keys, (3) `30-day-plan.json` integrity and day count, (4) Node.js version compatibility (`>= 18`).
- **Expected Benefit:** Learners and agents can diagnose faulty environments in a single command.
- **Implementation Effort:** Low-Medium.
- **Dependencies:** `validateConfig` (P0-2).
- **Risks:** None.
- **Acceptance Criteria:** `doctor` reports fine-grained status (`healthy`, `warnings`, `critical`) with actionable instructions.

### P1-2: Circular Dependency Clean-Up between `planner.js` and `research.js`
- **Problem:** `planner.js` imports `inferRoleKey` from `research.js`, while `research.js` imports utilities from `config.js`. If modules are extended, circular references between planner, research, and courses risk runtime import hoisting failures.
- **Evidence:** `src/planner.js` line 1: `import { inferRoleKey } from "./research.js";`.
- **Proposed Solution:** Keep role normalization utility cleanly defined or exported without mutual cross-dependencies.
- **Expected Benefit:** Cleaner dependency graph, simplifying bundling and static analysis.
- **Implementation Effort:** Low.
- **Dependencies:** None.
- **Risks:** None.
- **Acceptance Criteria:** Zero circular imports verified by static check.

### P1-3: SMTP Socket Timeout and Fail-Safe Connection Handling
- **Problem:** `src/email.js` creates raw TCP and TLS sockets via `net.connect` and `tls.connect` without setting socket timeouts (`socket.setTimeout`). If an SMTP server hangs or a firewall drops packets silently, the CLI or GitHub Action will hang until runner timeout.
- **Evidence:** `src/email.js` lines 23–26.
- **Proposed Solution:** Attach a 15-second socket timeout (`socket.setTimeout(15000)`) with an error handler that destroys the socket and rejects with an informative error: `SMTP connection timed out after 15s`.
- **Expected Benefit:** Prevents hanging CI jobs and unresponsive CLI processes.
- **Implementation Effort:** Low (15 lines).
- **Dependencies:** None.
- **Risks:** Slow satellite connections might trigger false timeouts (mitigated by reasonable 15–20s window).
- **Acceptance Criteria:** Unit test or mock socket test verifies timeout emits handled error.

---

## 5. P2 — Meaningful Differentiators

### P2-1: Local Study Progress Analytics & Velocity
- **Problem:** `status` and `progression-card` provide point-in-time progress, but lack velocity metrics (e.g., average completion time per artifact, streak consistency index, blocker recurrence rate).
- **Evidence:** `src/progress.js` computes simple momentum based on the last 3 entries.
- **Proposed Solution:** Implement `computeProgressMetrics(entries)` providing:
  - Total minutes invested
  - Daily completion consistency ($R = \frac{\text{completed}}{\text{elapsed}}$)
  - Blocker categorization
- **Expected Benefit:** Deeper learner self-reflection and rich data for educational research.
- **Implementation Effort:** Medium.
- **Dependencies:** `progress.js`.
- **Acceptance Criteria:** `status` command includes summary analytics.

### P2-2: Portfolio Export Command (`portfolio-export`)
- **Problem:** Learners build artifacts across 30+ days, but their evidence is scattered in `progress-log.json`. Creating an interview-ready showcase requires manual collation.
- **Proposed Solution:** Provide `npx kordexa export-portfolio` producing a clean, recruiter-ready Markdown document `data/PORTFOLIO.md` summarizing the role, 30 built artifacts, code links, and capstone architecture.
- **Expected Benefit:** Closes the loop from learning to job employability.
- **Implementation Effort:** Medium.
- **Dependencies:** `progress.js`, `planner.js`.

---

## 6. P3 — Research and Evaluation

### P3-1: Multi-Agent Role Decomposition Ablation Benchmark
- **Objective:** Evaluate whether Kordexa's 6-role sequential pipeline yields higher curriculum relevance and specificity than a monolithic single-prompt baseline.
- **Deliverables:** Synthetic evaluation script testing 50 role specifications against defined rubrics.
- **Timeline:** Milestone for research paper Section 6.

### P3-2: Token Consumption & Context Harness Optimization Study
- **Objective:** Quantify context token reduction achieved by `src/harness.js` compared to naive repository loading in coding agents.
- **Deliverables:** Benchmark script measuring prompt tokens and cost per day across major model contexts.

### P3-3: Publication Preparation
- **Objective:** Complete full academic paper manuscript (`paper/manuscript.md`), reference bibliography (`paper/references.bib`), and methodology documentation.
- **Deliverables:** Submission-ready paper package targeting ACM SIGCSE / IEEE TLT / FSE Tools.

