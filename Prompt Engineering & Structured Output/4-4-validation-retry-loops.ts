/**
 * ============================================================================
 * DOMINIO 4 · TASK STATEMENT 4.4 — Validation, Retry & Feedback Loops
 * ----------------------------------------------------------------------------
 * Objetivo oficial:
 *   Implement validation, retry, and feedback loops for extraction quality.
 *
 * Qué evalúa el examen aquí:
 *   Un retry que vale la pena lleva TRES cosas de vuelta al modelo: el documento
 *   original, la extracción fallida y el error de validación específico — omitir
 *   el último y el modelo se repite. Pero el concepto que el examen aprieta más
 *   es la **frontera de efectividad**: un retry arregla una MALA LECTURA
 *   (convención de fecha, valor en el campo equivocado, suma que falló porque se
 *   saltó un line item) y no puede conjurar una AUSENCIA (un dato que la fuente
 *   nunca dijo). Ahí se enruta a revisión humana, o se devuelve `null`.
 *
 * Build Exercise: Build a Validation-Retry Loop for Document Extraction
 *                 (Advanced · 60 min)
 * ============================================================================
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tipos del contrato de validación
// ─────────────────────────────────────────────────────────────────────────────

/** Una línea de factura, con el patrón que la detectó. */
interface LineItem {
  readonly description: string;
  readonly amount: number;
  readonly detected_pattern: string;
}

/** La extracción completa, con sus campos de auto-corrección. */
interface InvoiceExtraction {
  readonly line_items: readonly LineItem[];
  /** La suma que el modelo deriva de los line items. */
  readonly calculated_total: number;
  /** El total que el documento afirma. */
  readonly stated_total: number;
  readonly total_discrepancy: boolean;
  readonly conflict_detected: boolean;
  readonly category: "invoice" | "receipt" | "contract" | "unclear" | "other";
  readonly document_date: string | null;
  readonly due_date: string | null;
}

/**
 * La naturaleza de un problema de validación.
 *
 * `absent_from_source` es la que NO se arregla reintentando: el dato no está en
 * lo que el modelo recibió.
 */
type ValidationErrorKind =
  | "format"
  | "structural"
  | "arithmetic"
  | "absent_from_source";

/** Un problema de validación, con su tipo y su mensaje específico. */
interface ValidationIssue {
  readonly kind: ValidationErrorKind;
  /** Nombra el esperado y el encontrado, no un "validation failed" genérico. */
  readonly message: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 1 — El schema con campos de auto-corrección
//
// Why: los campos de auto-corrección habilitan la detección automática de
//      discrepancias sin lógica externa. `conflict_detected` y `detected_pattern`
//      crean la base de datos para mejorar el prompt sistemáticamente.
// You should see: `calculated_total` y `stated_total` separados, un
//      `total_discrepancy` y un `conflict_detected` booleanos.
// ─────────────────────────────────────────────────────────────────────────────

/** Los campos de auto-corrección, listados para el schema. */
export const SELF_CORRECTION_FIELDS: readonly string[] = [
  "line_items[]",
  "calculated_total",
  "stated_total",
  "total_discrepancy",
  "conflict_detected",
  "line_items[].detected_pattern",
];

/**
 * La discrepancia declarada vs la real.
 *
 * Extraer ambos totales pone los dos números en la extracción, así que un
 * desacuerdo es visible sin aritmética externa.
 *
 * @param calculated - La suma derivada de los line items.
 * @param stated - El total que dice el documento.
 * @returns `true` si difieren.
 */
export function hasDiscrepancy(calculated: number, stated: number): boolean {
  return Math.abs(calculated - stated) > 0.01;
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 2 — Validación semántica que devuelve errores específicos
//
// Why: la validación semántica atrapa errores que `tool_use` no puede. El examen
//      distingue los errores de sintaxis de schema (eliminados por tool_use) de
//      los semánticos (suma, field placement) que necesitan lógica y retry loops.
// You should see: strings específicos y accionables que digan qué se esperaba vs
//      qué se encontró, no un "validation failed".
// ─────────────────────────────────────────────────────────────────────────────

/** Las categorías válidas de `category`. */
const VALID_CATEGORIES: readonly InvoiceExtraction["category"][] = [
  "invoice",
  "receipt",
  "contract",
  "unclear",
  "other",
];

/**
 * Valida una extracción y devuelve todos los problemas encontrados.
 *
 * Cubre completitud, consistencia numérica, validez de enum y orden de fechas —
 * todo lo que el schema deja pasar.
 *
 * @param result - La extracción a validar.
 * @returns Los problemas, cada uno con su tipo y su mensaje específico.
 */
export function validateExtraction(result: InvoiceExtraction): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const calculatedSum = result.line_items.reduce((sum, item) => sum + item.amount, 0);
  if (hasDiscrepancy(calculatedSum, result.stated_total)) {
    issues.push({
      kind: "arithmetic",
      message: `Line items sum to ${calculatedSum} but stated_total is ${result.stated_total}`,
    });
  }

  if (result.total_discrepancy !== hasDiscrepancy(calculatedSum, result.stated_total)) {
    issues.push({
      kind: "structural",
      message: "total_discrepancy flag does not match the actual discrepancy state",
    });
  }

  if (!VALID_CATEGORIES.includes(result.category)) {
    issues.push({
      kind: "structural",
      message: `category "${result.category}" is not one of ${VALID_CATEGORIES.join(", ")}`,
    });
  }

  if (
    result.document_date !== null &&
    result.due_date !== null &&
    result.due_date < result.document_date
  ) {
    issues.push({
      kind: "format",
      message: `due_date ${result.due_date} precedes document_date ${result.document_date}`,
    });
  }

  return issues;
}

/**
 * ¿Puede un retry arreglar este problema?
 *
 * La prueba es si la respuesta estaba presente en lo que el modelo recibió. Una
 * mala lectura se corrige releyendo; una ausencia no.
 *
 * @param issue - El problema.
 * @returns `true` si reintentar puede resolverlo.
 */
export function isFixable(issue: ValidationIssue): boolean {
  return issue.kind !== "absent_from_source";
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 3 — El retry loop con los tres elementos
//
// Why: retry-with-error-feedback es dramáticamente más efectivo que el naive.
//      Sin el error específico el modelo no tiene guía y reproduce el mismo
//      fallo; con él, dirige su auto-corrección.
// You should see: un mensaje con el documento original, el JSON fallido y el error
//      específico; el modelo produce una extracción corregida.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compone el mensaje de retry.
 *
 * @param originalDocument - El documento original.
 * @param failedExtraction - La extracción fallida del modelo.
 * @param issues - Los problemas de validación.
 * @returns El mensaje con los tres elementos.
 */
export function buildRetryMessage(
  originalDocument: string,
  failedExtraction: InvoiceExtraction,
  issues: readonly ValidationIssue[],
): string {
  return [
    `Original document:\n${originalDocument}`,
    `Your extraction:\n${JSON.stringify(failedExtraction, null, 2)}`,
    `Validation errors:\n${issues.map((issue) => issue.message).join("\n")}`,
    "Please re-extract, fixing the identified errors.",
  ].join("\n\n");
}

/** El desenlace de un retry loop. */
interface RetryOutcome {
  readonly final: InvoiceExtraction;
  readonly issues: readonly ValidationIssue[];
  readonly attempts: number;
  readonly routeToHumanReview: boolean;
}

/**
 * Corre el retry loop, reintentando solo lo que puede arreglarse.
 *
 * Si todos los problemas son de información ausente, no gasta reintentos: enruta a
 * revisión humana de inmediato. Un cap de intentos evita loops infinitos sobre
 * errores genuinamente irrecuperables.
 *
 * @param extract - El puerto al modelo: dado un prompt, devuelve una extracción.
 * @param originalDocument - El documento original.
 * @param initial - La primera extracción (fallida).
 * @param maxRetries - Cap de reintentos.
 * @returns El desenlace completo.
 */
export async function retryExtraction(
  extract: (prompt: string) => Promise<InvoiceExtraction>,
  originalDocument: string,
  initial: InvoiceExtraction,
  maxRetries = 3,
): Promise<RetryOutcome> {
  let current = initial;
  let issues = validateExtraction(initial);
  let attempts = 0;

  while (issues.length > 0 && attempts < maxRetries) {
    // Nada que reintentar puede tocar una ausencia: va a revisión.
    if (issues.every((issue) => !isFixable(issue))) {
      return { final: current, issues, attempts, routeToHumanReview: true };
    }
    current = await extract(buildRetryMessage(originalDocument, current, issues));
    issues = validateExtraction(current);
    attempts += 1;
  }

  return { final: current, issues, attempts, routeToHumanReview: issues.length > 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 4 — 5 documentos: 2 arreglables, 3 con información ausente
//
// Why: la frontera de efectividad es el concepto más agresivamente testeado de
//      esta task statement. El examen presenta ambos escenarios y espera que
//      identifiques cuál es arreglable.
// You should see: los 2 arreglables se corrigen tras 1-2 intentos; los 3 con
//      ausencia se enrutan a revisión en vez de reintentarse.
// ─────────────────────────────────────────────────────────────────────────────

/** El desenlace esperado de un documento de prueba. */
interface RetryTestResult {
  readonly documentId: string;
  readonly issueKind: ValidationErrorKind;
  readonly attempts: number;
  readonly outcome: "corrected" | "human_review";
}

/** El desenlace de los 5 documentos del ejercicio. */
export const RETRY_TEST_RESULTS: readonly RetryTestResult[] = [
  { documentId: "doc-1", issueKind: "arithmetic", attempts: 1, outcome: "corrected" },
  { documentId: "doc-2", issueKind: "structural", attempts: 2, outcome: "corrected" },
  { documentId: "doc-3", issueKind: "absent_from_source", attempts: 0, outcome: "human_review" },
  { documentId: "doc-4", issueKind: "absent_from_source", attempts: 0, outcome: "human_review" },
  { documentId: "doc-5", issueKind: "absent_from_source", attempts: 0, outcome: "human_review" },
];

/**
 * ¿El loop reintentó solo lo arreglable?
 *
 * @param results - Los desenlaces.
 * @returns `true` si ningún caso de ausencia consumió reintentos.
 */
export function respectedRetryBoundary(results: readonly RetryTestResult[]): boolean {
  return results.every(
    (result) =>
      result.issueKind !== "absent_from_source" ||
      (result.attempts === 0 && result.outcome === "human_review"),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 5 — `detected_pattern`: convertir los descartes en prioridades
//
// Why: registrar qué disparó cada finding convierte los descartes en datos. Si
//      todo lo disparado por un patrón se descarta, ese patrón necesita trabajo en
//      el prompt en vez de convencer a los reviewers.
// You should see: el dismissal rate por patrón, con los más descartados arriba.
// ─────────────────────────────────────────────────────────────────────────────

/** Un finding de review, con el patrón que lo disparó. */
interface ReviewFinding {
  readonly finding: string;
  readonly severity: string;
  readonly detected_pattern: string;
  readonly file: string;
  readonly line: number;
  readonly wasDismissed: boolean;
}

/** Estadísticas de un patrón. */
interface PatternPriority {
  readonly pattern: string;
  readonly total: number;
  readonly dismissalRate: number;
  /** Frecuencia × dismissal rate: qué arreglar primero. */
  readonly impact: number;
}

/**
 * Prioriza los patrones por impacto de sus descartes.
 *
 * Un patrón raro con alto descarte no vale la pena; uno frecuente con alto
 * descarte es prioridad.
 *
 * @param findings - Los findings con su `detected_pattern`.
 * @returns Los patrones ordenados por impacto descendente.
 */
export function dismissalPriorities(
  findings: readonly ReviewFinding[],
): readonly PatternPriority[] {
  const stats = new Map<string, { total: number; dismissed: number }>();
  for (const finding of findings) {
    const entry = stats.get(finding.detected_pattern) ?? { total: 0, dismissed: 0 };
    entry.total += 1;
    if (finding.wasDismissed) entry.dismissed += 1;
    stats.set(finding.detected_pattern, entry);
  }

  return [...stats.entries()]
    .map(([pattern, entry]) => ({
      pattern,
      total: entry.total,
      dismissalRate: entry.dismissed / entry.total,
      impact: entry.total * (entry.dismissed / entry.total),
    }))
    .sort((a, b) => b.impact - a.impact);
}

// ─────────────────────────────────────────────────────────────────────────────
// Extra — Frontera con 4.3, y la jerarquía del feedback
//
// Why: `tool_use` cierra por completo la categoría de errores de sintaxis y no
//      toca la semántica. Y el feedback por reglas supera al vago o al de un juez.
// You should see: la clasificación y el ranking documentado.
// ─────────────────────────────────────────────────────────────────────────────

/** De dónde viene el problema, en la frontera 4.3 / 4.4. */
type ErrorOrigin = "schema_syntax" | "semantic_validation";

/**
 * Quién cierra cada categoría de error.
 *
 * @param origin - El origen del error.
 * @returns Quién lo detecta.
 */
export function closedBy(origin: ErrorOrigin): string {
  switch (origin) {
    case "schema_syntax":
      return "Eliminated entirely by tool_use with JSON schemas (Task 4.3).";
    case "semantic_validation":
      return "Requires validation logic written separately plus a retry loop (this task).";
    default: {
      const exhaustive: never = origin;
      return exhaustive;
    }
  }
}

/** Formas de feedback, de mejor a peor según la doc. */
type FeedbackForm = "rules_based" | "vague" | "llm_as_judge";

/**
 * Ranking del feedback.
 *
 * "The best form of feedback is providing clearly defined rules for an output,
 * then explaining which rules failed and why." El juicio con un segundo LLM call
 * queda cerca del fondo: "generally not a very robust method, and can have heavy
 * latency tradeoffs".
 *
 * @param form - La forma de feedback.
 * @returns El ranking, de 1 (mejor) a 3 (peor).
 */
export function feedbackRank(form: FeedbackForm): number {
  switch (form) {
    case "rules_based":
      return 1;
    case "vague":
      return 2;
    case "llm_as_judge":
      return 3;
    default: {
      const exhaustive: never = form;
      return exhaustive;
    }
  }
}

/** Cuántas veces reintenta la API un tool call malformado, por su cuenta. */
export const API_INTERNAL_TOOL_RETRIES = "2-3";

/**
 * ============================================================================
 * ✗ ANTI-PATTERN — Los errores que el examen construye
 * ============================================================================
 */

/** ✗ ANTI-PATTERN 1 — Reintentar sin el error específico.
 *
 * Reenviar el mismo documento con "try again" invita la misma lectura, así que
 * vuelve el mismo output.
 */
// extract(originalDocument);  // otra vez el mismo 450 vs 500

/** ✗ ANTI-PATTERN 2 — Reintentar información que la fuente no contiene.
 *
 * No hay número de intentos que conjure un nombre de departamento de un documento
 * que nunca lo mencionó; solo produce una invención más confiada.
 */
// while (missing) retry();  // el tercer intento devuelve un valor seguro de sí mismo

/** ✗ ANTI-PATTERN 3 — Confiar solo en la validación de schema.
 *
 * Cada fallo semántico que el schema no ve está perfectamente bien formado.
 */
// if (schemaValid) ship();  // sumas que no cuadran, valores mal ubicados

/** ✗ ANTI-PATTERN 4 — Validar con un LLM juez.
 *
 * "Generally not a very robust method, and can have heavy latency tradeoffs."
 * Preferir el feedback por reglas — un lint de código es forma excelente.
 */
// const ok = await secondModel.judge(extraction);  // peor ranking

/** ✗ ANTI-PATTERN 5 — Insistir con el retry ante un patrón que falla siempre.
 *
 * El fix documentado es arquitectónico: "add a formal rule in your tool calls to
 * identify and fix the failure?" — no otro intento.
 */
// retry(again); retry(again);  // un patrón que falla siempre pide una regla formal

/** ✗ ANTI-PATTERN 6 — No registrar `detected_pattern`.
 *
 * Sin ese campo, los descartes no se pueden agrupar y el patrón débil nunca se
 * identifica solo.
 */
// { finding, severity, file, line }  // falta detected_pattern

/**
 * ============================================================================
 * EXAM TRAPS — distractores recurrentes y criterio de rechazo
 * ============================================================================
 *
 * | Trampa                                             | Por qué se rechaza                                  |
 * |----------------------------------------------------|-----------------------------------------------------|
 * | Asumir que los retries siempre funcionan            | El test es si la respuesta estaba en lo recibido     |
 * | Reintentar sin incluir el error de validación       | Invita la misma lectura; vuelve el mismo output      |
 * | Confiar solo en el schema, sin checks semánticos    | Los fallos semánticos están bien formados            |
 *
 * QUICK REFERENCE — datos de la fuente
 *
 *   Mensaje de retry debe incluir ... documento original + extracción fallida + error específico
 *   Retry interno de la API .......... reintenta tool calls inválidos 2-3 veces con correcciones
 *   Contrato `is_error` .............. devolver content + `"is_error": true`; Claude lo incorpora
 *   Mejor feedback (ranking) ......... reglas claras + cuál falló y por qué (p. ej. un lint)
 *   Peor feedback (ranking) .......... LLM-as-judge — "not a very robust method"
 *   Retries SÍ sirven para ............ formato, estructura, valores mal ubicados, line items saltados
 *   Retries NO sirven para ........... información genuinamente ausente de la fuente
 *   Extracción irrecuperable .......... marcar para revisión humana o devolver `null`; NO reintentar
 *   Campos de auto-corrección ......... `calculated_total` vs `stated_total`, `total_discrepancy`,
 *                                       `conflict_detected`
 *   Señal de mejora sistemática ....... campo `detected_pattern` + análisis de dismissal rate
 *   Fallo repetido de un patrón ....... añadir regla formal / refinar el prompt, no otro retry
 *   Errores de sintaxis de schema ..... eliminados por `tool_use` (Task 4.3)
 *   Errores de validación semántica ... requieren lógica y retry loops (esta task)
 *
 * ============================================================================
 * FLUJO DE EJECUCIÓN ESPERADO  (trace ilustrativo — no se ejecuta)
 * ============================================================================
 *
 * [Paso 1] SELF_CORRECTION_FIELDS → calculated_total, stated_total, total_discrepancy,
 *          conflict_detected, line_items[].detected_pattern
 *   "payment due: 30 days" + "payment terms: net 60" ⇒ conflict_detected: true
 *   (sin el campo, el modelo elige una lectura en silencio)
 *
 * [Paso 2] validateExtraction(result)
 *   → [{ kind: "arithmetic",
 *        message: "Line items sum to 450 but stated_total is 500" }]
 *   ✅ nombra el esperado y el encontrado, no "validation failed"
 *   isFixable(arithmetic)          → true
 *   isFixable(absent_from_source)  → false
 *
 * [Paso 3] retryExtraction(extract, doc, initial)
 *   intento 0 → issues = [arithmetic] → re-extract con:
 *     "Original document: …\n\nYour extraction: {…}\n\n
 *      Validation errors: Line items sum to 450 but stated_total is 500\n\n
 *      Please re-extract, fixing the identified errors."
 *   → corrected en 1 intento
 *   Con un bare retry: el mismo 450 vs 500 vuelve
 *
 * [Paso 4] RETRY_TEST_RESULTS
 *   doc-1 arithmetic         → 1 intento → corrected
 *   doc-2 structural         → 2 intentos → corrected
 *   doc-3..5 absent_from_source → 0 intentos → human_review
 *   respectedRetryBoundary(results) → true
 *   ✅ ninguna ausencia consumió reintentos
 *
 * [Paso 5] dismissalPriorities(findings)
 *   "variable shadowing in nested scope" → dismissalRate 0.62, impact alto  ← primero
 *   "string concat in SQL query"         → dismissalRate 0.04
 *   ✅ el patrón débil se identifica solo; se refina su criterio, no se convence al reviewer
 *
 * closedBy("schema_syntax")        → "Eliminated entirely by tool_use…"
 * closedBy("semantic_validation")  → "Requires validation logic… plus a retry loop"
 * feedbackRank("rules_based") → 1 · feedbackRank("llm_as_judge") → 3
 * API_INTERNAL_TOOL_RETRIES → "2-3"
 *
 * ANTI-PATRÓN: reintentar 3 veces cada documento que falla validación. El 60% de
 * los fallos son campos que la fuente nunca declaró, y en esos el tercer intento
 * devuelve un valor seguro que el documento no respalda. El fix no es bajar el cap
 * a 1 ni añadir un check de fabricación: es clasificar cada error antes de
 * reintentar y enrutar a revisión los que nombran datos ausentes.
 */
