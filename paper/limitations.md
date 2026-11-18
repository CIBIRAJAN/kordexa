# The Kordexa Framework — Research Limitations and Threats to Validity

**Document Status:** Complete  
**Date:** 2026-10-29  
**Accompanying File:** `paper/manuscript.md`

---

## 1. Scope and Maturity Assessment

Kordexa is an active open-source project (v0.4.2) demonstrating the feasibility of an in-terminal, local-first learning loop. While the underlying CLI, SMTP engine, and adaptive file scaffolding are mechanically verified through automated regression suites, prospective readers and peer reviewers must consider specific architectural and empirical boundaries.

---

## 2. Technical and Architectural Limitations

1. **Instructional vs. Programmatic Multi-Agent Separation:**
   - *Limitation:* The six specialized agent roles (`GoalMapper`, `CurriculumPlanner`, `Researcher`, `BuildMentor`, `FocusCoach`, `Evaluator`) are defined as prompt contracts in `skills/kordexa/references/agent-contracts.md` rather than isolated microservice processes with independent memory heaps.
   - *Impact:* The fidelity of role execution depends directly on the reasoning capabilities and context window size of the host coding assistant (e.g., Claude 3.5 Sonnet vs. smaller open-weight models).

2. **Heuristic Curriculum Blueprints:**
   - *Limitation:* The system provides four comprehensive, hardcoded role blueprints (Agentic AI, Full-Stack, Cybersecurity, Data Science). For non-matching roles, it maps to the nearest blueprint via keyword heuristics.
   - *Impact:* Specialized roles (e.g., Quantum Computing, Embedded Firmware, Bio-informatics) currently receive an approximated rather than an organically synthesized curriculum.

3. **Link Resolution Robustness:**
   - *Limitation:* In the absence of a `YOUTUBE_API_KEY` or `GITHUB_TOKEN`, the research module parses public search HTML. While protected by regex parsing and automatic soft-fail fallbacks, web layout changes can degrade direct video resolution to search query URLs.

4. **CLI/Terminal UX Boundary:**
   - *Limitation:* Kordexa has no graphical browser dashboard. It relies strictly on terminal SVG cards, Markdown summaries, and daily HTML emails.
   - *Impact:* Non-technical learners or developers who prefer visual drag-and-drop course managers may experience cognitive friction.

---

## 3. Empirical and Methodological Threats to Validity

1. **Absence of Longitudinal Clinical Trials:**
   - *Status:* Controlled human subject trials comparing The Kordexa Framework to static curricula across 30 consecutive days are planned but not yet completed.
   - *Caution:* Performance claims regarding completion rates, knowledge retention, or career placement are scientific hypotheses ($H_1, H_2$), not validated empirical findings.

2. **Self-Reported Evidence Bias:**
   - *Threat:* Learners log their own time spent, confidence level, and evidence links.
   - *Mitigation in Evaluation:* Future user trials require automated Git commit verification and external expert code reviews rather than relying solely on self-reported minutes.

3. **Model Non-Determinism and Version Drift:**
   - *Threat:* LLM provider updates can subtly alter agent response quality or adherence to execution harness rules over time.
   - *Mitigation:* Benchmarking requires pinned model snapshots and temperature controls ($\tau = 0.0$).

