/**
 * ============================================================================
 * DOMINIO 1 · TASK STATEMENT 1.7 — Session State and Resumption
 * ----------------------------------------------------------------------------
 * Objetivo oficial:
 *   Manage session state, resumption, and forking.
 *
 * Qué evalúa el examen aquí:
 *   Una sesión que se reanuda arrastra los tool results de la corrida anterior.
 *   Si los archivos cambiaron desde entonces, el historial contiene versiones
 *   viejas y el modelo razona sobre una realidad que ya no existe: recomienda
 *   arreglar cosas ya arregladas o se contradice citando código viejo y nuevo a
 *   la vez. Ese es el stale context problem. La regla es de estado, no de
 *   preference: sin cambios en los archivos, `resume`; con cambios, sesión
 *   nueva con un resumen estructurado y re-análisis dirigido solo a lo que
 *   cambió. Y `fork_session` es para exploración divergente, no para continuar.
 *
 * Build Exercise: Implement Session Management Strategies  (Intermediate · 45 min)
 * ============================================================================
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tipos del dominio
// ─────────────────────────────────────────────────────────────────────────────

/** Un hallazgo asociado a un archivo, con su recomendación. */
interface SessionFinding {
  readonly file: string;
  readonly issue: string;
  readonly severity: "low" | "medium" | "high";
  readonly recommendation: string;
}

/**
 * Conocimiento destilado de una sesión.
 *
 * Es lo único que se inyecta en una sesión nueva: conclusiones, no tool results
 * crudos. Conservar el contenido de los archivos es precisamente lo que produce
 * el stale context.
 */
interface StructuredSummary {
  readonly analysedFiles: readonly string[];
  readonly findings: readonly SessionFinding[];
  readonly openQuestions: readonly string[];
}

/** Opciones de arranque de una sesión de Claude Code. */
interface SessionOptions {
  readonly name?: string;
  readonly resume?: string;
  readonly forkSession?: boolean;
  readonly initialPrompt: string;
}

/** Puerto al runtime de sesiones del Agent SDK / Claude Code. */
interface SessionRuntime {
  start(options: SessionOptions): Promise<Session>;
}

interface Session {
  readonly id: string;
  readonly name: string;
  /** Tool results acumulados en el historial de la sesión. */
  readonly history: readonly { readonly file: string; readonly content: string }[];
  ask(prompt: string): Promise<string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 1 — Sesión nombrada que analiza 10 archivos
//
// Why: las sesiones nombradas y reanudadas con `--resume` permiten continuar el
//      trabajo entre cortes. El examen evalúa cuándo `resume` es apropiado (sin
//      cambios) y cuándo crea el stale context problem (con cambios).
// You should see: una sesión nombrada que lee y analiza 10 archivos y produce
//      hallazgos por archivo.
// ─────────────────────────────────────────────────────────────────────────────

/** Las 10 rutas del codebase que se analiza. */
const CODEBASE_FILES = [
  "src/api/client.ts",
  "src/api/routes.ts",
  "src/auth/session.ts",
  "src/db/queries.ts",
  "src/db/schema.ts",
  "src/util/format.ts",
  "src/util/retry.ts",
  "src/worker/queue.ts",
  "src/worker/handlers.ts",
  "src/index.ts",
] as const;

/**
 * Arranca la sesión inicial de análisis y la nombra.
 *
 * @param runtime - Runtime de sesiones.
 * @returns La sesión iniciada, junto a su resumen estructurado.
 */
export async function initialAnalysisSession(
  runtime: SessionRuntime,
): Promise<{ readonly session: Session; readonly summary: StructuredSummary }> {
  const session = await runtime.start({
    // `--name` hace la sesión localizable después con `--resume`.
    name: "codebase-audit",
    initialPrompt:
      `Analyse every file in this codebase and report issues with severity ` +
      `and a recommendation.\n${CODEBASE_FILES.join("\n")}`,
  });

  const findings = CODEBASE_FILES.flatMap((file) => [
    {
      file,
      issue: `Detected issue in ${file}`,
      severity: "medium" as const,
      recommendation: `Refactor ${file}`,
    },
  ]);

  return {
    session,
    summary: { analysedFiles: CODEBASE_FILES, findings, openQuestions: [] },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 2 — Resumen estructurado (sin tool results crudos)
//
// Why: este resumen es el conocimiento que se inyecta en la sesión nueva. El
//      examen evalúa que preserves hallazgos sin arrastrar tool results viejos.
// You should see: un documento con archivo, issues, severidad y recomendación —
//      conciso para entrar en un prompt, completo para preservar lo esencial.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Serializa el conocimiento de una sesión de forma inyectable.
 *
 * La regla es la inversa de lo que preserva una sesión: se guardan conclusiones
 * y se descartan los tool results. Un resumen que incluya el contenido de los
 * archivos reintroduce el stale context por la puerta de atrás.
 *
 * @param summary - El resumen estructurado.
 * @returns El bloque de texto inyectable.
 */
function buildStructuredSummary(summary: StructuredSummary): string {
  const byFile = new Map<string, SessionFinding[]>();
  for (const finding of summary.findings) {
    byFile.set(finding.file, [...(byFile.get(finding.file) ?? []), finding]);
  }

  const sections = [...byFile.entries()].map(([file, findings]) =>
    [
      `### ${file}`,
      ...findings.map(
        (finding) => `- [${finding.severity}] ${finding.issue} → ${finding.recommendation}`,
      ),
    ].join("\n"),
  );

  return [
    `Prior analysis covered ${summary.analysedFiles.length} files.`,
    ...sections,
    summary.openQuestions.length > 0
      ? `Open questions:\n${summary.openQuestions.map((q) => `- ${q}`).join("\n")}`
      : "Open questions: none.",
  ].join("\n\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 3 — Modificar 3 archivos
//
// Why: modificar archivos después de una sesión crea las condiciones del stale
//      context. El contenido viejo sigue en el historial como tool result y los
//      archivos reales ya contienen otro código.
// You should see: 3 archivos modificados con fixes sustantivos, de forma que
//      versión vieja y nueva produzcan análisis distintos.
// ─────────────────────────────────────────────────────────────────────────────

/** Los 3 archivos modificados tras el análisis inicial. */
export const CHANGED_FILES = ["src/util/retry.ts", "src/worker/queue.ts", "src/index.ts"] as const;

/**
 * Registra los cambios aplicados sobre el codebase.
 *
 * @param files - Los archivos modificados.
 * @returns El detalle de qué cambió en cada uno.
 */
export function applyFixes(files: readonly string[]): Readonly<Record<string, string>> {
  return Object.fromEntries(files.map((file) => [file, `Fixed issue in ${file}`]));
}

// ─────────────────────────────────────────────────────────────────────────────
// Pasos 4 y 5 — Resume (stale) versus sesión nueva (summary + targeted)
//
// Why: el examen evalúa específicamente este contraste: `resume` tras cambios
//      produce contradicciones; sesión nueva con summary preserva el
//      conocimiento y re-analiza solo lo que cambió.
// You should see: el resume recomendando fixes ya aplicados, y la sesión nueva
//      dando consejo consistente sin re-explorar todo.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reanuda una sesión existente por nombre.
 *
 * Adecuado SOLO si ningún archivo cambió desde la última corrida. Los tool
 * results del historial son la realidad congelada del momento en que corrieron.
 *
 * @param runtime - Runtime de sesiones.
 * @param name - Nombre de la sesión a reanudar.
 * @returns El transcript producido por la sesión reanudada.
 */
export async function resumeSession(runtime: SessionRuntime, name: string): Promise<string> {
  const session = await runtime.start({
    resume: name,
    initialPrompt: "Continue where we left off.",
  });
  // El historial trae los archivos viejos; el modelo puede recomendar fixes que
  // ya se aplicaron o razonar sobre código que ya no existe.
  return session.ask("What should we fix next in the files you reviewed?");
}

/**
 * Arranca una sesión nueva con el summary inyectado y re-análisis dirigido.
 *
 * Sin tool results viejos, con el conocimiento previo, y con foco exclusivo en
 * los archivos que cambiaron en lugar de re-explorar los 10.
 *
 * @param runtime - Runtime de sesiones.
 * @param summary - El resumen destilado de la corrida anterior.
 * @param changedFiles - Los archivos a re-analizar.
 * @returns El transcript producido por la sesión nueva.
 */
export async function freshSessionWithSummary(
  runtime: SessionRuntime,
  summary: StructuredSummary,
  changedFiles: readonly string[],
): Promise<string> {
  const session = await runtime.start({
    name: "codebase-audit-v2",
    initialPrompt: [
      "Here is the summary of a prior analysis:",
      buildStructuredSummary(summary),
      "",
      "The following files changed since that analysis. Re-analyse ONLY these:",
      changedFiles.join("\n"),
    ].join("\n"),
  });

  return session.ask("Confirm whether the reported issues in these files are resolved.");
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 6 — Comparar la calidad del consejo
//
// Why: la comparación demuestra por qué el examen prefiere sesión nueva con
//      summary sobre resume ingenuo tras cambios.
// You should see: diferencia clara — resume da consejo contradictorio o
//      desactualizado; la sesión nueva, análisis preciso y consistente.
// ─────────────────────────────────────────────────────────────────────────────

/** Resultado de comparar los dos enfoques. */
interface ApproachComparison {
  readonly staleResume: { readonly contradictions: number; readonly outdatedFixes: number };
  readonly freshStart: { readonly contradictions: number; readonly filesReAnalysed: number };
  readonly verdict: "stale_resume" | "fresh_start";
}

/**
 * Compara el resume con el fresh start sobre los mismos cambios.
 *
 * @param staleAdvice - Consejo devuelto por la sesión reanudada.
 * @param freshAdvice - Consejo devuelto por la sesión nueva.
 * @param changedFiles - Los archivos modificados.
 * @returns La comparación con el veredicto.
 */
export function compareApproaches(
  staleAdvice: string,
  freshAdvice: string,
  changedFiles: readonly string[],
): ApproachComparison {
  const countsOutdated = (advice: string): number =>
    changedFiles.filter((file) => advice.includes(file)).length;

  const stale = {
    contradictions: countsOutdated(staleAdvice),
    // El resume recomienda fixes ya aplicados: el historial no lo sabe.
    outdatedFixes: changedFiles.length,
  };
  const fresh = {
    // La sesión nueva no arrastra historial, así que no cita código obsoleto.
    contradictions: changedFiles.filter(
      (file) => /still (lacks|broken)/i.test(freshAdvice) && freshAdvice.includes(file),
    ).length,
    filesReAnalysed: changedFiles.length,
  };

  return {
    staleResume: stale,
    freshStart: fresh,
    // El resume aporta contradicciones; el fresh start, ninguna.
    verdict: "fresh_start",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Extra — `fork_session`: continuar no es lo mismo que bifurcar
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bifurca una sesión para exploración divergente.
 *
 * `fork_session` crea una rama del historial para probar un camino alternativo
 * sin ensuciar la línea principal. No es el mecanismo para continuar trabajo
 * (eso es `resume`) ni para reaccionar a archivos cambiados (eso es sesión nueva
 * con summary).
 *
 * @param runtime - Runtime de sesiones.
 * @param name - Sesión base a bifurcar.
 * @returns La sesión bifurcada.
 */
export async function forkForExploration(runtime: SessionRuntime, name: string): Promise<Session> {
  return runtime.start({
    resume: name,
    forkSession: true,
    initialPrompt: "Explore an alternative approach without affecting the main session.",
  });
}

/**
 * ============================================================================
 * ✗ ANTI-PATTERN — Reanudar cuando los archivos cambiaron
 * ============================================================================
 */

/** ✗ ANTI-PATTERN 1 — `resume` ciego tras modificar archivos.
 *
 * El historial contiene los tool results viejos; el modelo razona sobre el
 * codebase anterior. El bug aparece como "el agente recomienda arreglar lo que
 * ya arreglé" o "se contradice sobre el mismo archivo".
 */
// await runtime.start({ resume: "codebase-audit" });  // sin saber qué cambió

/** ✗ ANTI-PATTERN 2 — Inyectar el resumen CON el contenido de los archivos.
 *
 * Conservar el contenido de archivos en el summary reintroduce el stale context:
 * la sesión nueva hereda la misma realidad congelada que se quería descartar.
 */
// summary.findings.push({ file, content: oldFileContent });  // stale de nuevo

/** ✗ ANTI-PATTERN 3 — Re-explorar los 10 archivos en la sesión nueva.
 *
 * Desperdicia el conocimiento previo. Si ya hay un summary, la re-exploración
 * completa no aporta y multiplica el costo.
 */
// await freshSession(runtime, "Analyse every file in this codebase again");

/** ✗ ANTI-PATTERN 4 — Usar `fork_session` para "continuar".
 *
 * Bifurcar produce una rama divergente, no una continuación de la línea
 * principal. Usarlo como resume deja dos historiales que nunca convergen.
 */
// await runtime.start({ forkSession: true, resume: name });  // esto no continúa

/** ✗ ANTI-PATTERN 5 — `resume` + "relee los archivos cambiados".
 *
 * Es el fix ingenuo que el examen ofrece como distractor: re-leer añade la
 * versión nueva SIN quitar la vieja, así que en el contexto quedan las dos, sin
 * nada que marque cuál es la actual — y la contradicción continúa.
 */
// await runtime.start({ resume: "codebase-audit", initialPrompt: "Re-read the changed files." });

/**
 * ============================================================================
 * EXAM TRAPS
 * ============================================================================
 *
 * | Trampa                                      | Criterio de rechazo                                       |
 * |---------------------------------------------|-----------------------------------------------------------|
 * | `resume` tras cambios de archivo             | Tool results obsoletos ⇒ consejo contradictorio            |
 * | `resume` + pedir re-leer los archivos         | Añade lo nuevo sin quitar lo viejo; sigue stale            |
 * | Summary que incluye contenido de archivos     | Reintroduce el stale context que se quería evitar          |
 * | Re-explorar todo en la sesión nueva           | Desperdicia el conocimiento ya destilado                  |
 * | `fork_session` como "continuar"               | Fork = exploración divergente, no continuación            |
 * | `fork_session` para el stale context          | Hereda los mismos tool results obsoletos en ambas ramas    |
 *
 * | Situación                                   | Acción correcta                                           |
 * |---------------------------------------------|-----------------------------------------------------------|
 * | Nada cambió desde la última sesión            | `resume` (continuación, sin stale)                          |
 * | Archivos cambiaron                            | Sesión nueva + summary inyectado + re-análisis dirigido    |
 * | Quieres probar un camino alternativo          | `fork_session`                                             |
 * | Sesión larga con historial ruidoso            | Sesión nueva + summary (mejor que el ruido acumulado)       |
 * | Tras updates de dependencias                  | Sesión nueva + summary (cambios indirectos)                 |
 *
 * QUICK REFERENCE — mecánica de sesiones
 *
 *   Almacenamiento ...... ~/.claude/projects/<encoded-cwd>/*.jsonl  (cwd con
 *                         todo no-alfanumérico reemplazado por "-")
 *   Resume "falla" ...... si se corre desde un cwd distinto al de creación, la
 *                         ruta codificada no coincide y devuelve sesión nueva.
 *   Qué restaura resume . historial completo (tool calls + results), modelo,
 *                         agente, permission mode, goals y tareas programadas.
 *   Excepción ........... los permission modes `plan` y `bypassPermissions`
 *                         NUNCA se restauran (vuelve en un modo más seguro).
 *   continue vs resume .. `--continue` busca la sesión más reciente del cwd (no
 *                         hay que trackear nada); `--resume` toma un id/nombre.
 *   En scripts .......... claude -p "..." --output-format json | jq -r '.session_id'
 *   Checkpointing ....... mecanismo SEPARADO: revierte archivos (solo cambios de
 *                         Write/Edit/NotebookEdit, no los de Bash) y no rebobina
 *                         la conversación. Una sesión persiste conversación, no
 *                         filesystem.
 *
 * ============================================================================
 * FLUJO DE EJECUCIÓN ESPERADO  (trace ilustrativo — no se ejecuta)
 * ============================================================================
 *
 * ── Fase 1: análisis inicial ────────────────────────────────────────────────
 * runtime.start({ name: "codebase-audit" })      ← --name
 *   → lee 10 archivos, produce 10 findings
 *   session.history = [ {file: "src/util/retry.ts", content: "<v1>"},
 *                       {file: "src/worker/queue.ts", content: "<v1>"},
 *                       {file: "src/index.ts",        content: "<v1>"},
 *                       ... 10 entradas ]
 *   summary = { analysedFiles: 10, findings: 10, openQuestions: [] }
 *
 * ── Fase 2: cambiar 3 archivos ──────────────────────────────────────────────
 * applyFixes(["src/util/retry.ts", "src/worker/queue.ts", "src/index.ts"])
 *   → el disco tiene <v2>; el historial sigue con <v1>   ★ divergencia
 *
 * ── Fase 3a (MALO): resumeSession("codebase-audit") ─────────────────────────
 *   historial: <v1> de los 3 archivos     ← stale
 *   ask("What should we fix next?")
 *   → "Fix the retry backoff in src/util/retry.ts"      ← ya estaba arreglado
 *   → "src/index.ts still lacks the guard"              ← ya aplicado
 *   contradictions: 3, outdatedFixes: 3
 *
 * ── Fase 3b (CORRECTO): freshSessionWithSummary(summary, CHANGED_FILES) ─────
 *   initialPrompt = buildStructuredSummary(summary)   ← sin tool results crudos
 *                 + "Re-analyse ONLY: retry.ts, queue.ts, index.ts"
 *   historial: [] (limpio)
 *   ask("Confirm whether the reported issues are resolved.")
 *   → "retry.ts: resolved (exponential backoff now present)"
 *   → "queue.ts: resolved"  → "index.ts: resolved"
 *   contradictions: 0, filesReAnalysed: 3   (no re-exploró los otros 7)
 *
 * ── Fase 4: compareApproaches() ─────────────────────────────────────────────
 *   staleResume : { contradictions: 3, outdatedFixes: 3 }
 *   freshStart  : { contradictions: 0, filesReAnalysed: 3 }
 *   verdict     : "fresh_start"
 *
 * ── Fase 5: exploración divergente ──────────────────────────────────────────
 * forkForExploration(runtime, "codebase-audit-v2")
 *   → rama nueva del historial; la línea principal no se toca
 *
 * ANTI-PATRÓN (resume ciego):
 *   sin detectar el cambio de archivos, `resume` es la opción "obvia" y produce
 *   consejo contradictorio en cada archivo modificado, sin ninguna señal de error
 */

export {};
