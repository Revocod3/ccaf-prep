# CCAF Prep — Notas de estudio

Recurso de estudio para el **Claude Certified Architect – Foundations (CCAR-F)**:
una nota de código por cada uno de los 30 task statements de la guía, repartidos
en los 5 dominios con su peso real en el examen.

## Qué hay aquí

Cada lección es **un archivo TypeScript ilustrativo** (seudocódigo tipado, no
ejecutable) construido sobre el *Build Exercise* de la lección correspondiente.
La estructura es siempre la misma:

1. **Header docstring** — el task statement y qué evalúa el examen ahí.
2. **Tipos inline** — sin imports entre archivos; contratos reales del SDK/API.
3. **Una función por paso** del Build Exercise, con JSDoc *Propósito · Why · You should see*.
4. **`✗ ANTI-PATTERN`** — los distractores que el examen rechaza.
5. **`EXAM TRAPS` + `QUICK REFERENCE`** — tabla de rechazo y datos de la fuente.
6. **`FLUJO DE EJECUCIÓN ESPERADO`** — trace ASCII, con contraste contra el anti-patrón.

Convenciones: comentarios en **español**, términos de examen en **inglés**
(`stop_reason`, `tool_use`, `PreToolUse`, `allowedTools`, `fork_session`, …).
Sin `any`; uniones discriminadas; switch exhaustivo con chequeo `never`;
`Promise.all(map(...))` en vez de `forEach` con `await`.

## Mapa de dominios

| Dominio | Peso | Lecciones |
|---|---|---|
| [1 · Agentic Architecture & Orchestration](#1--agentic-architecture--orchestration) | 27% | 7 |
| [2 · Tool Design & MCP Integration](#2--tool-design--mcp-integration) | 18% | 5 |
| [3 · Claude Code Configuration & Workflows](#3--claude-code-configuration--workflows) | 20% | 6 |
| [4 · Prompt Engineering & Structured Output](#4--prompt-engineering--structured-output) | 20% | 6 |
| [5 · Context Management & Reliability](#5--context-management--reliability) | 15% | 6 |

---

## 1 · Agentic Architecture & Orchestration

*Agentic loops, coordinator-subagent orchestration, context passing, workflow enforcement, hooks, task decomposition, and session state.*

| # | Lección | Archivo |
|---|---|---|
| 1.1 | Agentic Loops | [`1-1-agentic-loops.ts`](<Agentic Architecture & Orchestration/1-1-agentic-loops.ts>) |
| 1.2 | Multi-Agent Orchestration | [`1-2-orchestration-patterns.ts`](<Agentic Architecture & Orchestration/1-2-orchestration-patterns.ts>) |
| 1.3 | Subagent Invocation and Context Passing | [`1-3-subagent-invocation-context.ts`](<Agentic Architecture & Orchestration/1-3-subagent-invocation-context.ts>) |
| 1.4 | Workflow Enforcement and Handoff | [`1-4-workflow-enforcement-handoff.ts`](<Agentic Architecture & Orchestration/1-4-workflow-enforcement-handoff.ts>) |
| 1.5 | Agent SDK Hooks | [`1-5-agent-sdk-hooks.ts`](<Agentic Architecture & Orchestration/1-5-agent-sdk-hooks.ts>) |
| 1.6 | Task Decomposition Strategies | [`1-6-task-decomposition.ts`](<Agentic Architecture & Orchestration/1-6-task-decomposition.ts>) |
| 1.7 | Session State and Resumption | [`1-7-session-state-resumption.ts`](<Agentic Architecture & Orchestration/1-7-session-state-resumption.ts>) |

## 2 · Tool Design & MCP Integration

*Tool interface design, structured error responses, tool distribution and tool_choice, MCP server integration, and built-in tool selection.*

| # | Lección | Archivo |
|---|---|---|
| 2.1 | Tool Interface Design | [`2-1-tool-schema-design.ts`](<Tool Design & MCP Integration/2-1-tool-schema-design.ts>) |
| 2.2 | Structured Error Responses | [`2-2-structured-error-responses.ts`](<Tool Design & MCP Integration/2-2-structured-error-responses.ts>) |
| 2.3 | Tool Distribution & Tool Choice | [`2-3-tool-distribution-choice.ts`](<Tool Design & MCP Integration/2-3-tool-distribution-choice.ts>) |
| 2.4 | MCP Server Integration | [`2-4-mcp-server-integration.ts`](<Tool Design & MCP Integration/2-4-mcp-server-integration.ts>) |
| 2.5 | Built-in Tools | [`2-5-built-in-tools.ts`](<Tool Design & MCP Integration/2-5-built-in-tools.ts>) |

## 3 · Claude Code Configuration & Workflows

*CLAUDE.md hierarchy, slash commands and skills, path-specific rules, plan mode, iterative refinement, and CI/CD integration.*

| # | Lección | Archivo |
|---|---|---|
| 3.1 | CLAUDE.md Hierarchy, Scoping, and Modular Organisation | [`3-1-claude-md-hierarchy.ts`](<Claude Code Configuration & Workflows/3-1-claude-md-hierarchy.ts>) |
| 3.2 | Custom Slash Commands and Skills | [`3-2-slash-commands-skills.ts`](<Claude Code Configuration & Workflows/3-2-slash-commands-skills.ts>) |
| 3.3 | Path-Specific Rules for Conditional Convention Loading | [`3-3-path-specific-rules.ts`](<Claude Code Configuration & Workflows/3-3-path-specific-rules.ts>) |
| 3.4 | Plan Mode vs Direct Execution | [`3-4-plan-mode-execution.ts`](<Claude Code Configuration & Workflows/3-4-plan-mode-execution.ts>) |
| 3.5 | Iterative Refinement Techniques | [`3-5-iterative-refinement.ts`](<Claude Code Configuration & Workflows/3-5-iterative-refinement.ts>) |
| 3.6 | CI/CD Integration | [`3-6-cicd-integration.ts`](<Claude Code Configuration & Workflows/3-6-cicd-integration.ts>) |

## 4 · Prompt Engineering & Structured Output

*Explicit criteria, few-shot prompting, structured output via tool use, validation and retry loops, batch processing, and multi-pass review.*

| # | Lección | Archivo |
|---|---|---|
| 4.1 | System Prompts with Explicit Criteria | [`4-1-system-prompts.ts`](<Prompt Engineering & Structured Output/4-1-system-prompts.ts>) |
| 4.2 | Few-Shot Prompting | [`4-2-few-shot-prompting.ts`](<Prompt Engineering & Structured Output/4-2-few-shot-prompting.ts>) |
| 4.3 | Structured Output with Tool Use | [`4-3-structured-output.ts`](<Prompt Engineering & Structured Output/4-3-structured-output.ts>) |
| 4.4 | Validation, Retry, and Feedback Loops | [`4-4-validation-retry-loops.ts`](<Prompt Engineering & Structured Output/4-4-validation-retry-loops.ts>) |
| 4.5 | Batch Processing Strategies | [`4-5-batch-processing.ts`](<Prompt Engineering & Structured Output/4-5-batch-processing.ts>) |
| 4.6 | Multi-Instance and Multi-Pass Review | [`4-6-multi-pass-review.ts`](<Prompt Engineering & Structured Output/4-6-multi-pass-review.ts>) |

## 5 · Context Management & Reliability

*Context window management, escalation and ambiguity, error propagation, codebase exploration, human review calibration, and provenance.*

| # | Lección | Archivo |
|---|---|---|
| 5.1 | Context Window Management | [`5-1-context-window-management.ts`](<Context Management & Reliability/5-1-context-window-management.ts>) |
| 5.2 | Escalation & Ambiguity Resolution | [`5-2-escalation-ambiguity.ts`](<Context Management & Reliability/5-2-escalation-ambiguity.ts>) |
| 5.3 | Error Propagation in Multi-Agent Systems | [`5-3-error-propagation.ts`](<Context Management & Reliability/5-3-error-propagation.ts>) |
| 5.4 | Codebase Exploration & Context Degradation | [`5-4-codebase-exploration.ts`](<Context Management & Reliability/5-4-codebase-exploration.ts>) |
| 5.5 | Human Review & Confidence Calibration | [`5-5-human-review-calibration.ts`](<Context Management & Reliability/5-5-human-review-calibration.ts>) |
| 5.6 | Information Provenance & Multi-Source Synthesis | [`5-6-information-provenance.ts`](<Context Management & Reliability/5-6-information-provenance.ts>) |

---

## Compilar

Los 30 archivos son autocontenidos (sin imports entre sí). Se pueden compilar con
los flags más estrictos:

```sh
npx -y -p typescript@5 -- tsc --noEmit --strict --noUnusedLocals \
  --noUnusedParameters --noUncheckedIndexedAccess --exactOptionalPropertyTypes \
  --target es2022 --module esnext --moduleResolution bundler --lib es2022,dom \
  */*.ts
```

## Fuente

Las notas se construyen a partir de
[ccafpreparation.com/learn](https://www.ccafpreparation.com/learn) — una lección
por task statement, con sus *What You Need to Know*, *Deep Dive*, *Quick
Reference*, *Exam Traps* y *Build Exercise*. Los hechos de cada `QUICK REFERENCE`
salen de ahí y de la documentación pública de Anthropic.
