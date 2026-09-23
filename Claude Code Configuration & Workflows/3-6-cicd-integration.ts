/**
 * ============================================================================
 * DOMINIO 3 · TASK STATEMENT 3.6 — CI/CD Integration
 * ----------------------------------------------------------------------------
 * Objetivo oficial:
 *   Integrate Claude Code into CI/CD pipelines.
 *
 * Qué evalúa el examen aquí:
 *   Correr Claude Code dentro de un pipeline cambia lo que es: no hay operador,
 *   no hay conversación, y nada que pueda pausarse a decidir. El fact más
 *   directamente testeable del dominio es `-p` (equivale a `--print`): sin él, el
 *   job se queda esperando input y muere por timeout — sin error, sin output, sin
 *   terminar. Aparte: el output lo consume software, así que `--output-format
 *   json` + `--json-schema` y el dato validado bajo `structured_output`; la
 *   revisión independiente le gana a la auto-revisión de la misma sesión; y el
 *   review sin memoria repite los mismos comentarios hasta que nadie los lee.
 *
 * Build Exercise: Set Up a CI/CD Pipeline with Claude Code  (Advanced · 45 min)
 * ============================================================================
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tipos del pipeline
// ─────────────────────────────────────────────────────────────────────────────

/** Severidad de un finding de review. */
type Severity = "critical" | "major" | "minor";

/** Un hallazgo con su ubicación exacta, listo para un comentario inline. */
interface Finding {
  readonly file: string;
  readonly line: number;
  readonly severity: Severity;
  readonly message: string;
}

/**
 * El envelope que devuelve `--output-format json`.
 *
 * Lleva el texto del resultado junto al session ID y las cifras de coste. Con
 * `--json-schema`, el dato que conforma al schema vive bajo `structured_output`,
 * NO en el top level: leer `.findings` de la raíz no encuentra nada.
 */
interface JsonEnvelope {
  readonly session_id: string;
  readonly total_cost_usd: number;
  readonly result: string;
  readonly structured_output?: { readonly findings: readonly Finding[] };
}

/** Los modos de permiso, otra vez aquí porque el pipeline los elige. */
type PermissionMode =
  | "default"
  | "acceptEdits"
  | "plan"
  | "auto"
  | "dontAsk"
  | "bypassPermissions";

// ─────────────────────────────────────────────────────────────────────────────
// Paso 1 — El script de CI corre con `-p`
//
// Why: el `-p` es el fact más testeable del Dominio 3 (es la pregunta 10 del set
//      de muestra). Sin él, el job se cuelga indefinidamente esperando input
//      interactivo.
// You should see: un script (GitHub Actions, GitLab CI) que invoca `claude -p`
//      con el prompt de review; el job completa sin colgarse.
// ─────────────────────────────────────────────────────────────────────────────

/** La config de una invocación de CI. */
interface CiInvocation {
  readonly prompt: string;
  readonly outputFormat: "text" | "json" | "stream-json";
  readonly jsonSchema?: string;
  readonly maxTurns?: number;
  readonly permissionMode?: PermissionMode;
}

/**
 * Construye los argumentos de la línea de comandos.
 *
 * `-p` va siempre. `--json-schema` solo aplica en print mode y se empareja con
 * `--output-format json`.
 *
 * @param invocation - La config de la corrida.
 * @returns Los argumentos, en orden.
 */
export function buildCliArgs(invocation: CiInvocation): readonly string[] {
  const args = ["-p", "--output-format", invocation.outputFormat];
  if (invocation.jsonSchema !== undefined) {
    args.push("--json-schema", invocation.jsonSchema);
  }
  if (invocation.maxTurns !== undefined) {
    args.push("--max-turns", String(invocation.maxTurns));
  }
  if (invocation.permissionMode !== undefined) {
    args.push("--permission-mode", invocation.permissionMode);
  }
  args.push(invocation.prompt);
  return args;
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 2 — `--output-format json` + `--json-schema`
//
// Why: el output en un pipeline lo consume software, no una persona, así que
//      tiene que parsear. El schema valida el output final y el dato queda listo
//      para actuar: postear comentarios, filtrar por severidad, trackear.
// You should see: un envelope cuyo `structured_output` conforma al schema, con
//      `file`, `line`, `severity` y `message` por finding.
// ─────────────────────────────────────────────────────────────────────────────

/** El schema de findings del ejercicio, como string para `--json-schema`. */
export const FINDINGS_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: { type: "string" },
          line: { type: "integer" },
          severity: { type: "string" },
          message: { type: "string" },
        },
      },
    },
  },
});

/**
 * Extrae los findings del envelope.
 *
 * El path correcto es `.structured_output.findings`; leer `.findings` del top
 * level devuelve nada, y ese detalle cuesta marcas.
 *
 * @param envelope - El envelope parseado.
 * @returns Los findings validados, o vacío si no hubo schema.
 */
export function extractFindings(envelope: JsonEnvelope): readonly Finding[] {
  return envelope.structured_output?.findings ?? [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 3 — Parsear el JSON y postear comentarios inline
//
// Why: un comentario inline en el archivo y la línea exactos es feedback
//      accionable; un comentario genérico a nivel de PR se ignora.
// You should see: cada finding como comentario inline en su file:line, con su
//      severidad visible.
// ─────────────────────────────────────────────────────────────────────────────

/** Un comentario de review anclado a una ubicación. */
export interface InlineComment {
  readonly path: string;
  readonly line: number;
  readonly body: string;
}

/**
 * Convierte findings en comentarios inline.
 *
 * @param findings - Los findings extraídos.
 * @returns Un comentario por finding, con la severidad en el cuerpo.
 */
export function toInlineComments(findings: readonly Finding[]): readonly InlineComment[] {
  return findings.map((finding) => ({
    path: finding.file,
    line: finding.line,
    body: `[${finding.severity}] ${finding.message}`,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 4 — La sección de CLAUDE.md para el contexto de CI
//
// Why: una corrida de CI lee los CLAUDE.md del proyecto igual que una
//      interactiva. Sin contexto, los tests generados son plausibles e inútiles:
//      asserts sobre comportamiento que a nadie preocupaba, duplicando cobertura
//      que ya existe.
// You should see: una sección marcada con testing standards, fixtures
//      disponibles y criterios de review.
// ─────────────────────────────────────────────────────────────────────────────

/** La sección que da contexto al run automatizado. */
export const CI_CLAUDE_MD_SECTION: readonly string[] = [
  "Testing standards: build data through the factories in test/factories/, never inline literals",
  "Integration tests reach the database through test/setup/db.ts",
  "Assert against public API contracts; private internals are not a test surface",
  "Coverage target: 80% branch coverage for new code",
  "Fixtures on hand: test/fixtures/users.json, test/fixtures/orders.json",
  "Review criteria — critical: security, data loss, auth bypass; major: missing error handling; minor: style",
];

// ─────────────────────────────────────────────────────────────────────────────
// Paso 5 — Dos invocaciones: generación y review independiente
//
// Why: pedirle a la sesión que escribió el código que lo revise es más débil, y
//      no marginalmente. Generar deja a la sesión con su propio razonamiento: el
//      enfoque elegido, las alternativas descartadas. Revisar ahí hace que cada
//      decisión llegue ya justificada, y una decisión justificada es una que el
//      reviewer no tiene ganas de reabrir.
// You should see: dos `claude -p` distintos, sin contexto de sesión compartido.
// ─────────────────────────────────────────────────────────────────────────────

/** Cómo se organiza la revisión. */
type ReviewArchitecture = "same_session_self_review" | "independent_session";

/**
 * Elige la arquitectura de revisión.
 *
 * La revisión independiente conoce el código COMO código, sin apego a por qué se
 * ve así; ahí es donde aparecen los auth bypasses, los fallos no manejados y los
 * edge cases.
 *
 * @param input - Si el review comparte la sesión que generó el código.
 * @returns La arquitectura correcta.
 */
export function chooseReviewArchitecture(input: {
  readonly sharesGenerationSession: boolean;
}): ReviewArchitecture {
  return input.sharesGenerationSession
    ? "same_session_self_review"
    : "independent_session";
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 6 — Review incremental: solo lo nuevo o lo que sigue pendiente
//
// Why: un review sin memoria re-deriva todo en cada push. Los issues realmente
//      arreglados caen solos, pero los que el desarrollador leyó y decidió no
//      atender vuelven a levantarse cada vez — indistinguibles de un problema
//      nuevo. Cinco comentarios idénticos enseñan al equipo que no llevan
//      información, y entonces se salta también el que importaba.
// You should see: la primera corrida guarda sus findings; las siguientes reciben
//      esa lista y devuelven solo lo nuevo o lo que sigue sin resolver.
// ─────────────────────────────────────────────────────────────────────────────

/** El plan de una corrida de review con memoria. */
interface IncrementalReviewPlan {
  readonly previousCount: number;
  readonly instruction: string;
}

/**
 * Compone la instrucción de un review incremental.
 *
 * @param previousFindings - Los findings de la corrida anterior.
 * @returns El plan con la instrucción de reportar solo lo nuevo o pendiente.
 */
export function planIncrementalReview(
  previousFindings: readonly Finding[],
): IncrementalReviewPlan {
  return {
    previousCount: previousFindings.length,
    instruction:
      "Return only two categories: (1) anything not present in that list, (2) anything from " +
      "that list still unresolved in the current diff. Say nothing about items the developer " +
      "has evidently seen and chosen to leave.",
  };
}

/**
 * Clasifica los findings actuales contra los previos.
 *
 * @param previous - Los findings de la corrida anterior.
 * @param current - Los findings de esta corrida.
 * @returns Lo nuevo o pendiente, y lo que quedó resuelto.
 */
export function classifyFindings(
  previous: readonly Finding[],
  current: readonly Finding[],
): { readonly newOrOutstanding: readonly Finding[]; readonly resolved: readonly Finding[] } {
  const key = (finding: Finding): string => `${finding.file}:${finding.line}:${finding.message}`;
  const currentKeys = new Set(current.map(key));
  return {
    newOrOutstanding: current,
    resolved: previous.filter((finding) => !currentKeys.has(key(finding))),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Extra — Elecciones de API y flags que el examen pregunta
//
// Why: el pipeline también decide entre Batch API y tiempo real, y entre varios
//      flags de contexto, permisos y arranque.
// You should see: la línea entre lo que bloquea a alguien y lo que no.
// ─────────────────────────────────────────────────────────────────────────────

/** Tipo de workload de CI. */
type CiWorkloadKind =
  | "pre_merge_check"
  | "overnight_debt_report"
  | "weekly_code_audit"
  | "nightly_test_generation";

/**
 * Elige entre tiempo real y Batch API.
 *
 * La pregunta que decide es si alguien está bloqueado. Un check pre-merge detiene
 * a un desarrollador y un merge, así que necesita tiempo real; "hasta 24 horas,
 * sin garantía" no es una espera que un gate de review pueda absorber. El trabajo
 * que corre a horario y se lee cuando alguien llega es justo para lo que sirve el
 * 50% de descuento.
 *
 * @param workload - El tipo de trabajo.
 * @returns La API adecuada.
 */
export function chooseCiApi(workload: CiWorkloadKind): "real_time" | "batch" {
  switch (workload) {
    case "pre_merge_check":
      return "real_time";
    case "overnight_debt_report":
    case "weekly_code_audit":
    case "nightly_test_generation":
      return "batch";
    default: {
      const exhaustive: never = workload;
      return exhaustive;
    }
  }
}

/**
 * Elige el flag de system prompt.
 *
 * Append cuando Claude debe seguir siendo un asistente de código que además sigue
 * tus reglas — la guía de tools, las instrucciones de seguridad y las
 * convenciones sobreviven. Replace cuando el rol NO es el de Claude Code: un
 * agente no-código en un pipeline que nadie mira. Reemplazar descarta el prompt
 * por defecto entero, así que lo que la tarea aún necesite pasa a ser tu
 * responsabilidad.
 *
 * @param mode - Sustituir o añadir.
 * @param fromFile - Si el texto se lee de un archivo.
 * @returns El flag correspondiente.
 */
export function systemPromptFlag(
  mode: "substitute" | "append",
  fromFile: boolean,
): string {
  if (mode === "substitute") {
    return fromFile ? "--system-prompt-file" : "--system-prompt";
  }
  return fromFile ? "--append-system-prompt-file" : "--append-system-prompt";
}

/** El evento `system/init` del formato `stream-json`. */
interface SystemInitEvent {
  /** Las claves se OMITEN por completo cuando no hay errores. */
  readonly plugin_errors?: readonly string[];
  readonly mcp_server_errors?: readonly string[];
}

/**
 * Gate de CI sobre errores de carga de MCP/plugins.
 *
 * Como las claves se omiten cuando no hay errores, un gate puede fallar el job
 * cuando cualquiera de los dos arrays es no vacío, sin distinguir "sin errores"
 * de "array vacío".
 *
 * @param event - El evento `system/init`.
 * @returns Si el job debe pasar, con el detalle.
 */
export function ciGate(event: SystemInitEvent): { readonly ok: boolean; readonly detail: string } {
  const pluginErrors = event.plugin_errors ?? [];
  const mcpErrors = event.mcp_server_errors ?? [];
  const total = pluginErrors.length + mcpErrors.length;
  return total === 0
    ? { ok: true, detail: "No plugin or MCP server load errors." }
    : { ok: false, detail: `${total} load error(s) — fail the job.` };
}

/** Hechos operativos del modo headless, para el pipeline. */
export const CI_OPERATIONAL_FACTS = {
  /** stdin por pipe hacia `claude -p` está capado; pasarse da error y exit ≠ 0. */
  stdinCapBytes: 10 * 1024 * 1024,
  /** SIGTERM aborta el turno, corre hooks SessionEnd y sale con este código. */
  sigtermExitCode: 143,
  /** En `stream-json`, la última línea es siempre un mensaje `result`. */
  streamJsonLastLine: "result",
} as const;

/**
 * Qué se pierde con `--bare`.
 *
 * `--bare` reduce el arranque saltando auto-discovery de hooks, skills, plugins,
 * MCP servers, auto memory y CLAUDE.md — mismo resultado en cada máquina,
 * independiente de lo que haya instalado en local. La doc lo llama el modo
 * recomendado para llamadas scripted/SDK y futuro default de `-p`. El trade-off
 * es exactamente el contexto de CLAUDE.md del que depende este lesson.
 *
 * @returns El trade-off en una frase.
 */
export function bareModeTradeoff(): string {
  return (
    "Skipping auto-discovery (hooks, skills, plugins, MCP, auto memory, CLAUDE.md) buys " +
    "reproducibility and speed at the cost of exactly the project context the pipeline relies on."
  );
}

/**
 * ============================================================================
 * ✗ ANTI-PATTERN — Los errores que el examen construye
 * ============================================================================
 */

/** ✗ ANTI-PATTERN 1 — Correr sin `-p` en CI.
 *
 * Sin print mode el proceso abre la interfaz conversacional y espera a que alguien
 * escriba. El runner no tiene a nadie: el job se queda hasta el timeout, sin
 * error y sin output.
 */
// claude "Analyse this pull request"  // cuelga en CI

/** ✗ ANTI-PATTERN 2 — Leer `.findings` del top level del envelope.
 *
 * El dato validado por el schema vive bajo `structured_output`. `jq '.findings'`
 * no encuentra nada.
 */
// jq '.findings'  // nada; es jq '.structured_output.findings'

/** ✗ ANTI-PATTERN 3 — Auto-revisión en la misma sesión.
 *
 * La sesión que generó mantiene su razonamiento: cada decisión llega ya
 * justificada y es poco probable que se reabra. Los findings escasean.
 */
// claude -p "Implement X. Now audit X."  // un solo turno, sesión compartida

/** ✗ ANTI-PATTERN 4 — Batch API para checks pre-merge.
 *
 * Hasta 24 horas y sin garantía de latencia, cuando alguien está esperando el
 * gate. Batch es para lo que corre a horario y nadie está mirando.
 */
// batchSubmit(preMergeReview)  // el developer espera hasta 24h

/** ✗ ANTI-PATTERN 5 — Review sin memoria de corridas anteriores.
 *
 * Cada push re-deriva todo y vuelve a levantar sugerencias que el desarrollador ya
 * consideró y descartó. Eventualmente nadie lee los comentarios.
 */
// claude -p "Review this PR"  // los mismos 5 findings en cada push

/** ✗ ANTI-PATTERN 6 — Los distractores inventados del cuelgue.
 *
 * No existe la variable `CLAUDE_HEADLESS`, no existe el flag `--batch`, y
 * redirigir stdin desde `/dev/null` deja el proceso en modo interactivo sin nada
 * que leer.
 */
// CLAUDE_HEADLESS=true claude "…"   // no existe
// claude --batch "…"                // no existe
// claude "…" < /dev/null            // sigue interactivo

/**
 * ============================================================================
 * EXAM TRAPS — distractores recurrentes y criterio de rechazo
 * ============================================================================
 *
 * | Trampa                                             | Por qué se rechaza                                  |
 * |----------------------------------------------------|-----------------------------------------------------|
 * | Pipeline colgado esperando input interactivo        | La respuesta es `-p`; el resto son invenciones      |
 * | Asumir que la auto-revisión vale como la independiente | El razonamiento llega pre-justificado            |
 * | Batch API para checks pre-merge                     | Hasta 24h sin SLA; alguien está bloqueado           |
 * | No incluir los findings previos en el review        | Duplicados hasta que el equipo deja de leer         |
 *
 * QUICK REFERENCE — datos de la fuente
 *
 *   Modo no interactivo ..... `-p` / `--print` — el fact más testeado del Dominio 3
 *   --output-format ......... `text` (default), `json` (estructurado, con coste),
 *                             `stream-json` (NDJSON, tiempo real)
 *   --json-schema ........... valida el output final, solo en print mode; con
 *                             `--output-format json` cae en `structured_output`
 *   Tracking de coste ....... `--output-format json` incluye `total_cost_usd` y
 *                             desglose por modelo
 *   --bare .................. salta hooks/skills/plugins/MCP/auto-memory/CLAUDE.md;
 *                             reproducible; futuro default de `-p`
 *   Modo `dontAsk` .......... deniega todo lo no pre-aprobado — para CI cerrado
 *   Modo `auto` en `-p` ..... aborta la sesión si el classifier bloquea repetido
 *                             (no hay usuario a quien preguntar)
 *   Cap de stdin ............ 10MB por pipe a `claude -p`; pasarse = error y exit ≠ 0
 *   SIGTERM en `-p` ......... aborta el turno, corre hooks SessionEnd, sale 143
 *   Última línea stream-json  siempre un mensaje `result`
 *   GitHub Actions .......... trigger `@claude` (default `trigger_phrase`);
 *                             permisos Contents, Issues, Pull requests (read & write);
 *                             `--max-turns` default 10 en `claude_args`
 *   Gate de CI .............. `plugin_errors` / `mcp_server_errors` no vacíos en
 *                             `system/init` (claves omitidas si no hay errores)
 *   Session isolation ....... review independiente > auto-review de la misma sesión
 *   Batch API para CI ....... solo workloads no bloqueantes (hasta 24h, sin SLA);
 *                             NUNCA checks pre-merge
 *   CLAUDE.md en CI ......... se lee igual que en interactivo — la vía para dar
 *                             estándares de testing y review
 *   Flags de system prompt .. `--system-prompt[-file]` sustituye; `--append-system-prompt[-file]` añade
 *   Permisos y tools ........ `--permission-mode`, `--allowedTools`, `--disallowedTools`,
 *                             `--tools "Bash,Edit,Read"`, `--add-dir <path>`, `--model`
 *   Sesión y arranque ....... `-c`/`--continue`, `-r`/`--resume <id|name>`
 *   Schema inválido ......... desde v2.1.205, `claude` falla con error explícito
 *                             en vez de caer a texto no estructurado
 *
 * ============================================================================
 * FLUJO DE EJECUCIÓN ESPERADO  (trace ilustrativo — no se ejecuta)
 * ============================================================================
 *
 * [Paso 1] buildCliArgs({ prompt: "Review this PR", outputFormat: "json",
 *                         jsonSchema: FINDINGS_SCHEMA, maxTurns: 10,
 *                         permissionMode: "dontAsk" })
 *   → ["-p", "--output-format", "json", "--json-schema", "{…}", "--max-turns", "10",
 *      "--permission-mode", "dontAsk", "Review this PR"]
 *   ✅ el proceso imprime a stdout y sale; sin `-p` el job se cuelga
 *
 * [Paso 2] envelope = { session_id, total_cost_usd, result, structured_output: { findings } }
 *   extractFindings(envelope) → [ …findings con file/line/severity/message… ]
 *   jq '.findings' → nada   ✗
 *   jq '.structured_output.findings' → los findings   ✓
 *
 * [Paso 3] toInlineComments(findings)
 *   → [{ path: "auth.ts", line: 42, body: "[critical] missing null check on session token" }]
 *   ✅ comentario inline en el file:line exacto
 *
 * [Paso 4] CI_CLAUDE_MD_SECTION  → el run lee factories, fixtures y criterios
 *
 * [Paso 5] chooseReviewArchitecture({ sharesGenerationSession: true })
 *   → "same_session_self_review"    ✗ decisiones pre-justificadas, pocos findings
 *   Dos `claude -p` separados       ✓ findings reales
 *
 * [Paso 6] planIncrementalReview(previous)
 *   push 1 → 5 findings  (se guardan como artefacto)
 *   push 2 → planIncrementalReview([5]) → 2 outstanding
 *   push 3 → 1 outstanding
 *   ✅ cada push se estrecha a lo que sigue pendiente; el developer sigue leyendo
 *
 * chooseCiApi("pre_merge_check")       → "real_time"
 * chooseCiApi("weekly_code_audit")     → "batch"
 * ciGate({ plugin_errors: ["bad manifest"] })
 *   → { ok: false, detail: "1 load error(s) — fail the job." }
 * CI_OPERATIONAL_FACTS.sigtermExitCode → 143
 *
 * ANTI-PATRÓN: encadenar generación y review en un solo `claude -p`. El audit
 * aprueba cada corrida durante seis semanas y un review externo encuentra dos
 * auth gaps que ese audit había pasado. Subir `--max-turns` o el modelo no arregla
 * nada: el problema es que el auditor comparte el razonamiento del generador. El
 * fix es partir en dos invocaciones sin contexto compartido.
 */
