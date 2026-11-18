# Kordexa Documentation — System Architecture Specification

**Document Status:** Complete  
**Date:** 2026-10-29  
**Version:** 1.0.0  
**Specification Model:** Aligned with `spec.c4` (LikeC4 v1.59.2 verified model)

---

## 1. System Context (C4 Level 1)

Kordexa provides a local-first learning command center that transforms a target professional engineering role into a 30+ day adaptive curriculum. It operates directly within the developer's workstation and connects to external coding agents, public knowledge sources, and personal SMTP servers without requiring any hosted SaaS infrastructure.

```mermaid
flowchart TD
    subgraph "Workstation Environment"
        Learner["Learner / Developer<br/>(Person)"]
        CodingAgent["AI Coding Agent<br/>(Claude Code, Codex, Gemini, OpenClaw)"]
        Kordexa["Kordexa CLI & Skill Pack<br/>(System in Scope)"]
    end

    subgraph "External Systems"
        WebSources["Public Learning Sources<br/>(MDN, HuggingFace, GitHub, YouTube)"]
        MailServer["Personal Mail Provider<br/>(SMTP: Gmail, Fastmail, Postmark)"]
        GitHubActions["GitHub Actions Runner<br/>(Scheduled Unattended Cron)"]
    end

    Learner -->|"1. Runs npx kordexa (or npx eduorchestrate)"| Kordexa
    Learner -->|"2. Interacts with /kordexa (or /eduorchestrate)"| CodingAgent
    CodingAgent -->|"3. Loads skill contracts & harness"| Kordexa
    Kordexa -->|"4. Fetches docs, video & repo links"| WebSources
    Kordexa -->|"5. Dispatches daily HTML/text email"| MailServer
    MailServer -->|"6. Delivers daily brief"| Learner
    GitHubActions -->|"7. Executes send-today on schedule"| Kordexa
```

---

## 2. Container Architecture (C4 Level 2)

Kordexa enforces a strict local ownership boundary. All state is backed by local disk files and owned completely by the learner.

```mermaid
flowchart TD
    subgraph "Kordexa Boundary (Learner Workstation)"
        CLI["1. Command-Line Interface (Container)<br/>Node 18+ CLI router, zero npm dependencies"]
        SkillPack["2. Universal Skill Pack (Container Doc)<br/>Canonical SKILL.md, agent contracts, 7 runtime adapters"]
        StateStore["3. Learning State Store (Container Store)<br/>data/ — plans, digests, progress logs, SVG cards (Git-ignored)"]
        ConfigStore["4. Project Config Store (Container Store)<br/>kordexa.config.json (Committed, no secrets)"]
        SecretStore["5. Local Secret Store (Container Store)<br/>.env.local (Git-ignored, SMTP credentials)"]
    end

    subgraph "Deployment Node: GitHub Actions"
        WorkflowRunner["6. Daily Delivery Workflow (Container)<br/>.github/workflows/kordexa-daily.yml (Committed)"]
        ActionsSecrets["Actions Secrets Store<br/>SMTP_HOST, SMTP_PASS (Cloud-secured)"]
    end

    CLI -->|"writes / reads"| StateStore
    CLI -->|"generates"| SkillPack
    CLI -->|"manages"| ConfigStore
    CLI -->|"reads SMTP creds"| SecretStore
    WorkflowRunner -->|"invokes node bin/kordexa.js"| CLI
    ActionsSecrets -->|"injects environment"| WorkflowRunner
```

---

## 3. CLI Component Architecture (C4 Level 3)

The CLI container (`src/`) is designed as a set of decoupled, single-responsibility modules:

```mermaid
classDiagram
    class CLI_Router {
        +main(argv)
        +resolveScheduledDay(config, plan, now)
        -init(argv)
        -sendToday(argv)
        -regeneratePlan(argv)
        -showStatus()
        -doctor()
    }

    class Config_Manager {
        +readJson(filePath, fallback)
        +writeJson(filePath, payload)
        +validateConfig(config)
        +loadConfig(rootDir)
        +saveConfig(config, rootDir)
        +loadEnvFile(filePath)
    }

    class Curriculum_Planner {
        +generate30DayPlan(profile)
        +renderDailyEmail(config, plan, day, options)
        -prioritizeTopics()
        -buildDay()
    }

    class Research_Engine {
        +createResearchDigest(options)
        +enrichDigestLinks(digest, options)
        +resolveVideos(query, limit)
        +resolveRepos(query, limit)
        +isLinkResolutionOffline(options)
    }

    class Progress_Tracker {
        +appendProgress(config, entry)
        +reviewProgress(config, plan)
        +createWeeklySummary(config, plan, week)
        +planStatus(config, plan)
    }

    class Card_Renderer {
        +buildProgressionCard(config, plan)
        +saveProgressionCard(config, card)
        +copyDefaultTerminalCard(config)
        +TerminalCardSvg(options)
    }

    class Email_Mailer {
        +smtpConfigFromEnv(env)
        +sendMail(options)
        -upgradeToTls(socket, host)
        -renderSmtpMessage(from, message)
    }

    class Harness_Generator {
        +createHarness(config, plan, mode)
        +saveHarness(config, harness)
    }

    class Course_Curator {
        +createCoursePack(config, plan)
        +saveCoursePack(config, pack)
    }

    class Adapter_Writer {
        +writeAgentAdapters(rootDir)
    }

    class Workflow_Writer {
        +cronFromTime(time, tz)
        +writeGithubWorkflow(config, rootDir)
    }

    CLI_Router --> Config_Manager
    CLI_Router --> Curriculum_Planner
    CLI_Router --> Research_Engine
    CLI_Router --> Progress_Tracker
    CLI_Router --> Card_Renderer
    CLI_Router --> Email_Mailer
    CLI_Router --> Harness_Generator
    CLI_Router --> Course_Curator
    CLI_Router --> Adapter_Writer
    CLI_Router --> Workflow_Writer
```

---

## 4. Multi-Agent Sequential SOP Pipeline

The skill pack instructs the host agent to execute a sequential six-stage Standard Operating Procedure (SOP):

```mermaid
sequenceDiagram
    autonumber
    actor Learner
    participant Agent as AI Coding Agent
    participant GM as GoalMapper
    participant CP as CurriculumPlanner
    participant RS as Researcher
    participant BM as BuildMentor
    participant FC as FocusCoach
    participant EV as Evaluator
    participant CLI as Kordexa CLI

    Learner->>Agent: /eduorchestrate
    Agent->>CLI: npx eduorchestrate harness
    CLI-->>Agent: Loaded harness policies & state context
    
    Agent->>GM: Translate role + current stage to core competency
    GM-->>CP: Priority skills and foundational boundaries
    
    Agent->>CP: Retrieve active day milestone
    CP->>RS: Focus concept for today
    
    RS->>CLI: npx eduorchestrate research --day N
    CLI-->>RS: Sourced documentation, video search & repo samples
    RS-->>BM: Validated technical references
    
    BM->>FC: Draft build project deliverable
    FC->>FC: Constrain scope to 1-hour timebox (prune extras)
    FC-->>Learner: Prescribed daily build task & proof checklist
    
    Learner->>Learner: Develops daily code artifact
    Learner->>Agent: Logs evidence link & notes
    
    Agent->>EV: Review proof against objective
    EV->>CLI: npx eduorchestrate log-progress --day N --evidence ...
    CLI-->>EV: Recorded in data/progress-log.json
    EV-->>CP: Bridge to tomorrow's milestone
    Agent-->>Learner: Progression card updated & next step clear
```

---

## 5. Security & Isolation Boundaries

1. **Network Boundary:** The CLI runs exclusively offline unless:
   - `enrichDigestLinks` is invoked without `--offline`, fetching search results with a 7-second timeout.
   - `send-today` is invoked without `--dry-run`, initiating an encrypted SMTP socket (TLS 1.2+).
2. **Secrets Boundary:** SMTP passwords (`SMTP_PASS`) are:
   - Read from `.env.local` for local execution (strictly Git-ignored).
   - Read from GitHub Actions Secrets for scheduled cron execution.
   - Never echoed in JSON logs, progress files, progression cards, or Git commits.
3. **Execution Sandbox:** The CLI performs purely deterministic file operations. It executes zero `eval()`, zero `exec()`, and zero untrusted child processes.

