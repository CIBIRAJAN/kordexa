# Kordexa Documentation — Research Gaps & Novelty Analysis

**Document Status:** Complete  
**Date:** 2026-10-29  
**Related Inputs:** `PROJECT_AUDIT.md`, `RELATED_WORK.md`, `deep-research-report.md`

---

## 1. Executive Summary

While Kordexa offers an elegant engineering design and practical developer experience, preparing the project for peer-reviewed technical or academic publication requires identifying genuine open research questions, differentiating verified implementation from theoretical claims, and establishing rigorous evaluation methodologies.

This document identifies six core research gaps spanning intelligent tutoring, software engineering workflow automation, multi-agent decomposition, and developer habit formation.

---

## 2. Identified Research Gaps

```
+-----------------------------------------------------------------------------------+
|                           RESEARCH GAPS IDENTIFIED                                |
+-----------------------------------------------------------------------------------+
| RG-1: Efficacy of CLI/Agent-Native Learning vs. Dashboard-Based MOOCs             |
| RG-2: Pedagogical Impact of Daily Artifact Generation & Evidence Logging          |
| RG-3: Instruction-Level vs. Code-Level Multi-Agent Orchestration Decomposition     |
| RG-4: Heuristic Curriculum Adaptation vs. Dynamic Job-Market Trend Ingestion      |
| RG-5: Token Efficiency and Cognitive Load in Agent-Assisted Learning              |
| RG-6: Local-First Privacy vs. Centralized Telemetry in Educational Analytics      |
+-----------------------------------------------------------------------------------+
```

---

## 3. Detailed Gap Analysis

### Gap 1 (RG-1): Empirical Efficacy of In-Workflow Developer Learning

- **Current State in Kordexa:** The tool assumes that integrating the study routine directly into the coding terminal and agent chat improves consistency and completion rates.
- **Missing Scientific Evidence:** No controlled empirical study exists comparing developers learning via an in-terminal daily agent loop versus developers using traditional dashboard LMS platforms (e.g., Coursera, Udemy) or self-directed static checklists.
- **Formal Research Question (RQ1):** *Does an agent-integrated, terminal-based daily learning loop yield statistically significant improvements in milestone completion rates and knowledge retention compared to conventional web-based self-study?*
- **Hypothesis (H1):** Learners in the CLI/agent condition will achieve higher 30-day task completion rates ($>60\%$) than self-study control cohorts ($<25\%$) due to reduced context-switching overhead.

### Gap 2 (RG-2): Impact of Mandatory Proof Logging on Motivation and Attrition

- **Current State in Kordexa:** Kordexa requires logging concrete proof (commit link, PR, notes, screenshot) and assigns a momentum classification (`strong`, `steady`, `needs-support`, `blocked`).
- **Missing Scientific Evidence:** It is unknown whether requiring verifiable evidence increases completion through accountability or increases cognitive friction and dropout when tasks become challenging.
- **Formal Research Question (RQ2):** *How does requiring verifiable build evidence affect learner attrition, streak durability, and authentic skill acquisition over a 30-day window?*
- **Hypothesis (H2):** Verifiable evidence logging increases task fidelity and interview self-efficacy, but requires an adaptive difficulty governor to prevent early abandonment.

### Gap 3 (RG-3): Multi-Agent Role Specialization: Instruction-Level vs. Runtime-Level

- **Current State in Kordexa:** The architecture models six distinct roles (`GoalMapper`, `CurriculumPlanner`, `Researcher`, `BuildMentor`, `FocusCoach`, `Evaluator`). However, in practice, a single LLM prompt processes these sequential roles within the host agent.
- **Missing Scientific Evidence:** Literature (e.g., MetaGPT, AutoGen) indicates role specialization improves quality. However, it is unverified whether instruction-level sequential decomposition (prompting one model to act as 6 personas) delivers comparable output quality to programmatic multi-agent execution with independent context windows.
- **Formal Research Question (RQ3):** *Does sequential instruction-level role decomposition within a single model match the pedagogical accuracy and resource filtering quality of a multi-process, multi-agent architecture?*
- **Ablation Study Needed:** Compare a monolithic single-prompt curriculum generator against Kordexa's 6-role sequential pipeline and a discrete multi-agent system.

### Gap 4 (RG-4): Dynamic Market Trend Integration and Curriculum Reshaping

- **Current State in Kordexa:** The documentation states that "trend-aware research only reshapes the roadmap when a trend improves employability." In the verified codebase, `src/research.js` produces search queries and search URLs, but roadmap modification is an instructional directive left to the LLM.
- **Missing Scientific Evidence:** Can automated extraction of real-time signals (e.g., GitHub trending repositories, Hugging Face release notes, Hacker News discussions) dynamically and safely update a curriculum without causing roadmap thrashing?
- **Formal Research Question (RQ4):** *What algorithmic or heuristic safeguards are necessary to dynamically ingest fast-moving open-source trends into a learning syllabus without compromising foundational competency sequencing?*

### Gap 5 (RG-5): Token Conservation and Context Overload in Agentic Learning

- **Current State in Kordexa:** The system features a "token-conscious execution harness" (`src/harness.js`) designed to instruct the host agent on what files to read and what to exclude from chat context.
- **Missing Scientific Evidence:** The quantitative token savings and hallucination reduction resulting from the execution harness have not been empirically measured or benchmarked across major model families (Claude 3.5 Sonnet, GPT-4o, Gemini 1.5 Pro).
- **Formal Research Question (RQ5):** *To what extent does a structured local harness file reduce context token consumption and instruction-drift errors in long-horizon agent workflows?*

### Gap 6 (RG-6): Privacy-Preserving Learning Analytics

- **Current State in Kordexa:** All learner data remains in local JSON files (`data/`). There is zero telemetry or cloud syncing.
- **Missing Scientific Evidence:** Educational data mining and learning analytics traditionally require centralized data pooling to improve models and detect systemic curriculum stumbling blocks.
- **Formal Research Question (RQ6):** *Can a local-first, zero-telemetry architecture support meaningful pedagogical self-reflection and localized performance modeling without compromising learner privacy?*

---

## 4. Prioritization Matrix for Academic Investigation

| Gap ID | Dimension | Experimental Complexity | Publication Impact | Immediate Viability in Kordexa |
|---|---|---|---|---|
| **RG-1** | Workflow Efficacy | High (Human participants required) | High (ACM SIGCSE / IEEE TLT) | Requires user study protocol |
| **RG-2** | Evidence Logging | Medium (A/B testing) | High (Learning Analytics & Knowledge) | Feasible with CLI telemetry/log analysis |
| **RG-3** | Multi-Agent Decomposition | Low to Medium (Automated synthetic eval) | High (NeurIPS Workshop / ICLR / ASE) | **Immediately Viable (Synthetic Benchmark)** |
| **RG-4** | Dynamic Trend Ingestion | Medium (Algorithmic implementation) | Medium (AIED / CIKM) | Requires code enhancement |
| **RG-5** | Token & Context Harness | Low (Benchmarking token counters) | Medium (FSE / MSR Tools track) | **Immediately Viable (Quantitative Audit)** |
| **RG-6** | Local-First Analytics | Medium (Federated/Local metrics) | Medium (Privacy / EdTech) | Requires offline analytics module |

---

## 5. Conclusion

To position Kordexa for credible publication, research contributions should focus on **RG-3 (Multi-Agent Role Decomposition vs. Single Prompt)** and **RG-5 (Token-Conscious Harness and Local-First Developer Pedagogy)** as immediately defensible engineering contributions, while designing experimental frameworks for **RG-1** and **RG-2** as long-term pedagogical evaluations.

