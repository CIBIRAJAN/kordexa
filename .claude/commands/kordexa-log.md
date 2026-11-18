---
description: Kordexa: log today's progress with evidence
argument-hint: <what you did> | <evidence link>
allowed-tools: Bash(npx kordexa log-progress:*), Bash(npx kordexa status:*)
---
Log the learner's progress. Read what they completed and an evidence link/path from "$ARGUMENTS". If either is missing, ASK for it — never log a placeholder entry. Read the current day from `npx kordexa status`, then run `npx kordexa log-progress --day <day> --completed "<note>" --evidence "<link>"` (optionally --confidence <1-5>) and confirm the updated momentum.
