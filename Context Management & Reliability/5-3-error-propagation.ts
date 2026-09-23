/**
 * ============================================================================
 * DOMINIO 5 · TASK STATEMENT 5.3 — Error Propagation in Multi-Agent Systems
 * ----------------------------------------------------------------------------
 * Objetivo oficial:
 *   Implement error propagation strategies across multi-agent systems.
 *
 * Qué evalúa el examen aquí:
 *   Cómo viaja la información de fallo decide si el sistema degrada con gracia o
 *   falla sin que nadie lo note. Un subagente tiene un timeout, una negativa de
 *   permiso, una query malformada — y lo que manda hacia arriba determina todas
 *   las opciones que el coordinator tiene después. El examen testea tres cosas:
 *   qué lleva el contexto estructurado de error, los DOS anti-patrones, y una
 *   distinción que casi todos confunden: **access failure vs valid empty result**.
 *
 * Build Exercise: Build a Structured Error Propagation System  (Advanced · 50 min)
 * ============================================================================
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tipos del reporte estructurado
// ─────────────────────────────────────────────────────────────────────────────

/** Las cuatro categorías de fallo, cada una con su recuperación. */
type FailureType = "transient" | "validation" | "business" | "permission";

/** Qué se intentó: la query, los parámetros, el sistema al que fue. */
interface AttemptedAction {
  readonly tool: string;
  readonly query: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

/** Un resultado parcial recogido antes del fallo. */
interface PartialResult {
  readonly title: string;
  readonly source: string;
  readonly retrieved: boolean;
}

/** Un fallo con los cuatro elementos que el coordinator necesita para decidir. */
interface SubagentFailure {
  readonly status: "partial_failure" | "error";
  readonly failureType: FailureType;
  readonly attemptedAction: AttemptedAction;
  /** Los tres sources recogidos antes del timeout son tres sources. */
  readonly partialResults: readonly PartialResult[];
  /** El subagente conoce su dominio; el coordinator no. */
  readonly alternativeApproaches: readonly string[];
  readonly message: string;
  readonly shouldRetry: boolean;
}

/** Un éxito: la query corrió, con o sin matches. */
interface SubagentSuccess {
  readonly status: "success";
  readonly results: readonly PartialResult[];
  readonly shouldRetry: false;
}

/** Lo que un subagente devuelve hacia arriba. */
type SubagentReport = SubagentSuccess | SubagentFailure;

/** Un outcome con su tema, para poder anotar cobertura. */
interface SubagentOutcome {
  readonly topic: string;
  readonly report: SubagentReport;
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 1 — El schema de error estructurado
//
// Why: el contexto estructurado habilita la recuperación inteligente del
//      coordinator. Los cuatro elementos le dan todo para decidir: reintentar,
//      probar una alternativa, seguir con parciales, o escalar.
// You should see: `failureType` como enum de cuatro, `attemptedAction` con
//      tool/query/parámetros, `partialResults` como array y `alternativeApproaches`
//      como lista de strings.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Construye un fallo estructurado.
 *
 * @param input - Los cuatro elementos del reporte.
 * @returns El reporte de fallo.
 */
export function buildFailure(input: {
  readonly failureType: FailureType;
  readonly attemptedAction: AttemptedAction;
  readonly partialResults: readonly PartialResult[];
  readonly alternativeApproaches: readonly string[];
  readonly message: string;
  readonly shouldRetry: boolean;
}): SubagentFailure {
  return { status: input.partialResults.length > 0 ? "partial_failure" : "error", ...input };
}

/**
 * ¿Qué recuperación pide cada tipo de fallo?
 *
 * @param failureType - La categoría.
 * @returns La estrategia por defecto.
 */
export function defaultRecoveryFor(failureType: FailureType): string {
  switch (failureType) {
    case "transient":
      return "Retry — a timeout or rate limit may clear on another attempt.";
    case "validation":
      return "Fix the input — the request itself was wrong.";
    case "business":
      return "Find another route or escalate — the rule will refuse again.";
    case "permission":
      return "Escalate or change authorisation — no retry helps until access changes.";
    default: {
      const exhaustive: never = failureType;
      return exhaustive;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 2 — Access failure vs valid empty result
//
// Why: confundirlos es un error crítico que el examen testea directamente. Un
//      access failure significa que la query NO corrió y conviene reintentar; un
//      valid empty significa que corrió y no encontró nada, que ES la respuesta.
// You should see: los timeouts reportados como access failures con
//      `shouldRetry: true`, y las queries exitosas sin matches con `shouldRetry: false`.
// ─────────────────────────────────────────────────────────────────────────────

/** Un timeout o error de conexión: la fuente nunca se alcanzó. */
export function accessFailure(
  attemptedAction: AttemptedAction,
  message: string,
  partialResults: readonly PartialResult[] = [],
): SubagentFailure {
  return buildFailure({
    failureType: "transient",
    attemptedAction,
    partialResults,
    alternativeApproaches: [
      "Retry with a narrower date range (2023-2024)",
      "Search alternative database: government_publications",
      "Use cached results from a previous research session",
    ],
    message,
    shouldRetry: true,
  });
}

/** La query corrió y no encontró nada: eso ES la respuesta. */
export function validEmptyResult(): SubagentSuccess {
  return { status: "success", results: [], shouldRetry: false };
}

/**
 * ¿Vale la pena reintentar este reporte?
 *
 * Un access failure es candidato a retry; un valid empty no lo es nunca.
 *
 * @param report - El reporte.
 * @returns `true` solo para fallos reintentables.
 */
export function isRetryCandidate(report: SubagentReport): boolean {
  return report.status !== "success" && report.shouldRetry;
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 3 — Recuperación local antes de propagar
//
// Why: los fallos transitorios pertenecen al subagente que los encontró.
//      Reintentos, fuentes de fallback, respuestas degradadas — todo pasa local, y
//      solo lo que sobrevive viaja hacia arriba, con lo intentado y los parciales.
// You should see: un wrapper con backoff exponencial (1s, 2s, 4s) que intenta hasta
//      3 veces antes de propagar, preservando los parciales entre intentos.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Los delays de backoff por intento.
 *
 * @param maxRetries - El número de intentos.
 * @returns Los delays en ms (1s, 2s, 4s…).
 */
export function retryDelaysMs(maxRetries: number): readonly number[] {
  return Array.from({ length: maxRetries }, (_unused, index) => 2 ** index * 1000);
}

/**
 * Reintenta localmente y propaga solo lo que sobrevive.
 *
 * Un fallo no transitorio corta el loop de inmediato: reintentar un business error
 * solo gasta llamadas que llegan al mismo rechazo.
 *
 * @param attempt - Un intento; devuelve un reporte (nunca lanza).
 * @param maxRetries - El cap de intentos.
 * @returns El éxito, o el fallo con los parciales acumulados.
 */
export async function withLocalRetry(
  attempt: () => Promise<SubagentReport>,
  maxRetries = 3,
): Promise<SubagentReport> {
  let last: SubagentFailure | null = null;
  const accumulated: PartialResult[] = [];

  for (let index = 0; index < maxRetries; index += 1) {
    const report = await attempt();
    if (report.status === "success") return report;

    accumulated.push(...report.partialResults);
    last = report;
    if (report.failureType !== "transient") break;
    // El delay real sería retryDelaysMs(...)[index]; aquí se omite el sleep.
  }

  if (last === null) {
    return buildFailure({
      failureType: "transient",
      attemptedAction: { tool: "unknown", query: "", parameters: {} },
      partialResults: [],
      alternativeApproaches: [],
      message: "No attempt ran.",
      shouldRetry: false,
    });
  }
  return { ...last, partialResults: accumulated };
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 4 — El coordinator decide con el contexto estructurado
//
// Why: el coordinator es el que decide la recuperación inteligente. Con contexto
//      estructurado elige informado en vez de aplicar una política ciega — el
//      punto medio entre la supresión silenciosa y la terminación del workflow.
// You should see: los cuatro tipos de fallo tratados distinto, sin suprimir nunca.
// ─────────────────────────────────────────────────────────────────────────────

/** La decisión de recuperación del coordinator. */
type RecoveryAction =
  | { readonly action: "proceed_partial"; readonly data: readonly PartialResult[] }
  | { readonly action: "try_alternative"; readonly approach: string }
  | { readonly action: "retry_modified"; readonly modification: string }
  | { readonly action: "fix_query"; readonly details: string }
  | { readonly action: "alert_admin"; readonly details: AttemptedAction }
  | { readonly action: "escalate_human"; readonly message: string };

/**
 * Elige la recuperación a partir del reporte estructurado.
 *
 * Los parciales ganan a un retry ciego: el trabajo ya hecho se conserva.
 *
 * @param report - El reporte del subagente.
 * @returns La acción del coordinator.
 */
export function coordinatorRecovery(report: SubagentReport): RecoveryAction {
  if (report.status === "success") {
    return { action: "proceed_partial", data: report.results };
  }

  switch (report.failureType) {
    case "transient": {
      if (report.partialResults.length >= 3) {
        return { action: "proceed_partial", data: report.partialResults };
      }
      const alternative = report.alternativeApproaches[0];
      if (alternative !== undefined) {
        return { action: "try_alternative", approach: alternative };
      }
      return { action: "retry_modified", modification: "narrower query" };
    }
    case "validation":
      return { action: "fix_query", details: report.message };
    case "permission":
      return { action: "alert_admin", details: report.attemptedAction };
    case "business":
      return { action: "escalate_human", message: report.message };
    default: {
      const exhaustive: never = report.failureType;
      return exhaustive;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 5 — Anotaciones de cobertura en la síntesis
//
// Why: sin anotaciones, un gap parece que el tema no era relevante en vez de que
//      la fuente estaba caída. La transparencia es mejor que omitir en silencio.
// You should see: una sección de cobertura con cada tema y su calidad de dato.
// ─────────────────────────────────────────────────────────────────────────────

/** El estado de cobertura de un tema. */
type CoverageStatus = "well-supported" | "limited" | "unavailable";

/** La anotación de cobertura de un tema. */
interface CoverageAnnotation {
  readonly topic: string;
  readonly status: CoverageStatus;
  readonly reason: string;
  readonly sources: number;
}

/**
 * Deriva la anotación de cobertura de un outcome.
 *
 * @param outcome - El tema y su reporte.
 * @returns La anotación correspondiente.
 */
export function coverageFor(outcome: SubagentOutcome): CoverageAnnotation {
  const { report } = outcome;
  if (report.status === "success") {
    return {
      topic: outcome.topic,
      status: "well-supported",
      reason: `${report.results.length} source(s) retrieved.`,
      sources: report.results.length,
    };
  }
  return {
    topic: outcome.topic,
    status: report.partialResults.length > 0 ? "limited" : "unavailable",
    reason: report.message,
    sources: report.partialResults.length,
  };
}

/**
 * Añade la sección de cobertura a la síntesis.
 *
 * Un gap anotado ("Section on geothermal energy is limited due to unavailable
 * journal access during research") es una limitación conocida; uno silencioso se
 * lee como un juicio sobre la importancia del tema.
 *
 * @param synthesis - La síntesis.
 * @param outcomes - Los outcomes de los subagentes.
 * @returns La síntesis con su cobertura y su caveat.
 */
export function addCoverageAnnotations(
  synthesis: string,
  outcomes: readonly SubagentOutcome[],
): { readonly synthesis: string; readonly coverage: readonly CoverageAnnotation[]; readonly caveat: string } {
  const coverage = outcomes.map(coverageFor);
  const caveat = coverage
    .filter((annotation) => annotation.status !== "well-supported")
    .map((annotation) => `Section on ${annotation.topic} is ${annotation.status}: ${annotation.reason}`)
    .join("\n");
  return { synthesis, coverage, caveat };
}

// ─────────────────────────────────────────────────────────────────────────────
// Extra — De quién es la responsabilidad del error
//
// Why: no todo fallo necesita tu `is_error`: las server tools las maneja la
//      infraestructura de Anthropic. Saber en qué categoría cae una tool decide si
//      tu coordinator es responsable de atrapar el error.
// You should see: la frontera client vs server.
// ─────────────────────────────────────────────────────────────────────────────

/** De quién es la tool que falló. */
type ToolOwner = "client" | "server";

/**
 * ¿Tu código es responsable de manejar el `is_error` de esta tool?
 *
 * Las client tools (definidas por el usuario, y las de schema Anthropic como
 * `bash`/`text_editor`) corren en tu aplicación: tu código devuelve el
 * `tool_result` con `is_error: true`. Las server tools (`web_search`, `web_fetch`,
 * `code_execution`, `tool_search`) corren en la infraestructura de Anthropic:
 * "you do not need to handle is_error results for server tools".
 *
 * @param owner - De quién es la tool.
 * @returns `true` solo para client tools.
 */
export function isErrorYourResponsibility(owner: ToolOwner): boolean {
  switch (owner) {
    case "client":
      return true;
    case "server":
      return false;
    default: {
      const exhaustive: never = owner;
      return exhaustive;
    }
  }
}

/** Cuántas veces reintenta Claude un tool call inválido, por su cuenta. */
export const INVALID_TOOL_CALL_RETRIES = "2-3 with corrections";

/**
 * ============================================================================
 * ✗ ANTI-PATTERN — Los errores que el examen construye
 * ============================================================================
 */

/** ✗ ANTI-PATTERN 1 — Supresión silenciosa.
 *
 * Un timeout reportado como `{ results: [], status: "success" }`: el coordinator
 * lee un tema buscado-y-vacío y sintetiza un reporte al que le falta un área
 * entera. Es el peor de los dos porque es INVISIBLE.
 */
// catch { return { status: "success", results: [] }; }  // el reporte "se lee completo"

/** ✗ ANTI-PATTERN 2 — Terminación del workflow.
 *
 * Un subagente da timeout y todo se detiene: cuatro subagentes más terminaron bien
 * y su trabajo se tira junto con el fallo.
 */
// if (anySubagentFailed) throw new Error("Pipeline halted");  // tira 4 éxitos

/** ✗ ANTI-PATTERN 3 — Un status genérico tras agotar los reintentos.
 *
 * "Search unavailable" despoja la query, lo recuperado y las alternativas. El
 * coordinator sabe que algo salió mal y nada sobre qué hacer.
 */
// return { status: "search unavailable" };  // apenas mejor que el silencio

/** ✗ ANTI-PATTERN 4 — Reintentar un valid empty result.
 *
 * La query corrió y devolvió la respuesta correcta, que resulta ser nada. Repetirla
 * produce esa misma respuesta, al mismo coste, las veces que sea.
 */
// if (results.length === 0) retry();  // la respuesta ya era correcta

/** ✗ ANTI-PATTERN 5 — Tratar todos los fallos igual.
 *
 * Reintentar un business error gasta llamadas que llegan al mismo rechazo; un
 * permission error no se arregla con otro intento.
 */
// catch { retryThreeTimes(); }  // sin mirar failureType

/** ✗ ANTI-PATTERN 6 — Manejar el `is_error` de server tools.
 *
 * Las server tools fallan de forma transparente: Anthropic las maneja. Tu código
 * no es responsable.
 */
// if (webSearchFailed) { myRetryLogic(); }  // no es tu responsabilidad

/** ✗ ANTI-PATTERN 7 — Omitir un tema en silencio en la síntesis.
 *
 * Una sección más corta sin anotar se lee como un juicio sobre la importancia del
 * tema, no como un gap de la investigación.
 */
// report.omit("geothermal");  // "reads as a judgement about the topic's importance"

/**
 * ============================================================================
 * EXAM TRAPS — distractores recurrentes y criterio de rechazo
 * ============================================================================
 *
 * | Trampa                                             | Por qué se rechaza                                  |
 * |----------------------------------------------------|-----------------------------------------------------|
 * | Capturar un timeout y devolver vacío como éxito     | Invisible: el coordinator no reintenta ni compensa   |
 * | Terminar el pipeline por un subagente               | Tira el trabajo de los que sí terminaron             |
 * | Devolver "search unavailable" genérico              | Pierde query, parciales y alternativas               |
 * | Reintentar un valid empty result                    | La respuesta ya era correcta; se repite igual        |
 *
 * QUICK REFERENCE — datos de la fuente
 *
 *   Cuatro elementos ......... tipo de fallo · qué se intentó · resultados parciales ·
 *                              enfoques alternativos
 *   Cuatro tipos de fallo .... transient · validation · business · permission
 *   Access failure vs empty .. access = candidato a retry; valid empty = la respuesta,
 *                              sin retry
 *   `is_error: true` ......... señal de fallo de client tool, en el content del tool_result
 *   Server tools ............. no es tu responsabilidad; Anthropic maneja sus errores
 *   Tool call inválido ....... Claude reintenta 2-3 veces con correcciones antes de disculparse
 *   Anti-patrón 1 ............ supresión silenciosa — vacío como éxito (el peor)
 *   Anti-patrón 2 ............ terminación del workflow por un fallo
 *   Recuperación correcta .... retry local primero; propagar solo lo irresoluble con
 *                              contexto; resumir desde el último estado bueno
 *   Por qué fallan los genéricos  ocultan la query, los parciales y las alternativas
 *   Coverage annotations ..... marcar los gaps explícitamente ("limited due to X")
 *   Errores que se componen .. en sistemas stateful, un fallo no manejado puede
 *                              propagarse a una trayectoria multi-paso desperdiciada
 *
 * ============================================================================
 * FLUJO DE EJECUCIÓN ESPERADO  (trace ilustrativo — no se ejecuta)
 * ============================================================================
 *
 * [Paso 1] buildFailure({ failureType: "transient",
 *                         attemptedAction: { tool: "search_academic_db",
 *                                            query: "renewable energy policy",
 *                                            parameters: { dateRange: "2022-2024" } },
 *                         partialResults: [EU Renewable Energy Directive 2023],
 *                         alternativeApproaches: [3], message: "…", shouldRetry: true })
 *   → status: "partial_failure"
 *   ✅ el coordinator tiene cuatro opciones: retry, alternativa, parciales, escalar
 *
 * [Paso 2] accessFailure(action, "Connection timeout after 30s")
 *   → { status: "error", failureType: "transient", shouldRetry: true }
 *   validEmptyResult()
 *   → { status: "success", results: [], shouldRetry: false }
 *   isRetryCandidate(accessFailure) → true
 *   isRetryCandidate(validEmptyResult) → false   ← la respuesta ya es correcta
 *
 * [Paso 3] retryDelaysMs(3) → [1000, 2000, 4000]
 *   withLocalRetry(attempt) → intentos hasta 3, acumulando parciales
 *   ✅ solo lo que sobrevive viaja al coordinator
 *
 * [Paso 4] coordinatorRecovery(report)
 *   transient + 3 parciales   → { action: "proceed_partial" }
 *   transient + 1 parcial     → { action: "try_alternative", approach: "…" }
 *   validation                → { action: "fix_query" }
 *   permission                → { action: "alert_admin" }
 *   business                  → { action: "escalate_human" }
 *
 * [Paso 5] addCoverageAnnotations(synthesis, outcomes)
 *   → coverage: [ { topic: "Solar", status: "well-supported", sources: 3 },
 *                 { topic: "Geothermal", status: "unavailable",
 *                   reason: "journal access unavailable during research" } ]
 *   caveat: "Section on Geothermal is unavailable: journal access unavailable…"
 *   ✅ el gap es una limitación conocida, no una omisión invisible
 *
 * isErrorYourResponsibility("client") → true
 * isErrorYourResponsibility("server") → false
 * INVALID_TOOL_CALL_RETRIES → "2-3 with corrections"
 *
 * ANTI-PATRÓN: `process_refund` por £180 lo rechaza la tool porque el plan capea los
 * self-serve en £100. El handler trata todo no-success igual: reintenta 3 veces con
 * backoff durante 9 segundos y luego levanta "refund failed after retries" a un
 * humano, que tiene que deducir por qué falló. El fix no es acortar el backoff ni
 * subir el cap: es ramificar por `failureType` y enrutar el business refusal directo
 * a `escalate_to_human` con el cap adjunto.
 */
