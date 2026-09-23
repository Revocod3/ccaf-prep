/**
 * ============================================================================
 * DOMINIO 4 · TASK STATEMENT 4.1 — System Prompts with Explicit Criteria
 * ----------------------------------------------------------------------------
 * Objetivo oficial:
 *   Design prompts with explicit criteria to improve precision and reduce false
 *   positives.
 *
 * Qué evalúa el examen aquí:
 *   La instrucción vaga es el hábito más caro del prompt engineering en
 *   producción. "Be conservative", "only report high-confidence findings", "use
 *   your best judgement" — cada una suena a dirección sensata y ninguna le da al
 *   modelo una frontera que pueda aplicar. Lo que funciona es un criterio
 *   categórico explícito: qué se reporta y qué no. Y el orden importa: **criterios
 *   primero, confianza después**. Un umbral de confianza sin criterios filtra un
 *   conjunto indefinido.
 *
 * Build Exercise: Build an Explicit Criteria Code Review Prompt
 *                 (Intermediate · 45 min)
 * ============================================================================
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tipos del criterio de review
// ─────────────────────────────────────────────────────────────────────────────

/** Niveles de severidad, calibrados con ejemplos de código y no con prosa. */
type Severity = "critical" | "major" | "minor";

/** Categorías de finding que un reviewer puede emitir. */
type ReviewCategory =
  | "bug"
  | "security"
  | "logic_error"
  | "documentation_mismatch"
  | "style"
  | "local_pattern";

/** Un criterio categórico explícito: la frontera que el modelo sí puede aplicar. */
interface ReviewCriteria {
  readonly report: readonly ReviewCategory[];
  readonly skip: readonly ReviewCategory[];
  /** El disparador preciso para findings de comentarios. */
  readonly commentRule: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 1 — Baseline con instrucciones vagas
//
// Why: establecer el baseline demuestra el problema de falsos positivos que el
//      examen testea. Hace falta evidencia empírica de que "be conservative" no
//      da al modelo ninguna frontera accionable.
// You should see: clasificación inconsistente entre los 5 snippets, y resultados
//      distintos si corres los mismos snippets dos veces.
// ─────────────────────────────────────────────────────────────────────────────

/** El prompt vago del baseline. */
export const VAGUE_CRITERIA =
  "Review this code. Be conservative. Only report high-confidence findings.";

/** Resumen de consistencia de una tanda de corridas. */
interface Consistency {
  readonly runs: number;
  readonly distinct: number;
  readonly consistent: boolean;
}

/**
 * Mide la consistencia de clasificar el mismo snippet varias veces.
 *
 * "Conservative" se resuelve distinto según lo que el modelo asuma que te
 * importa: el mismo snippet (userName vs user_name) sale `critical` en una corrida
 * y sin flag en la siguiente.
 *
 * @param verdicts - El veredicto de cada corrida sobre el MISMO snippet.
 * @returns Cuántos veredictos distintos salieron.
 */
export function consistencyOf(verdicts: readonly string[]): Consistency {
  const distinct = new Set(verdicts).size;
  return { runs: verdicts.length, distinct, consistent: distinct === 1 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 2 — Reescribir con criterios categóricos explícitos
//
// Why: los criterios categóricos explícitos son el enfoque correcto que testea el
//      examen. Categorías concretas eliminan la ambigüedad que causa los falsos
//      positivos.
// You should see: report / skip declarados, y la regla precisa para comentarios.
// ─────────────────────────────────────────────────────────────────────────────

/** El criterio explícito del ejercicio. */
export const EXPLICIT_CRITERIA: ReviewCriteria = {
  report: ["bug", "security", "logic_error"],
  skip: ["style", "local_pattern"],
  commentRule:
    "Flag comments only when claimed behaviour contradicts actual code behaviour.",
};

/**
 * Renderiza el criterio explícito como system prompt.
 *
 * Nombra las categorías a reportar y las que se dejan, más el disparador preciso
 * para los comentarios: una contradicción entre lo que un comentario afirma y lo
 * que el código hace.
 *
 * @param criteria - El criterio.
 * @returns El texto del system prompt.
 */
export function renderCriteria(criteria: ReviewCriteria): string {
  return [
    criteria.commentRule,
    `Report: ${criteria.report.join(", ")}.`,
    `Skip: ${criteria.skip.join(", ")}.`,
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 3 — Calibrar severidad con ejemplos de código
//
// Why: el examen testea específicamente que los ejemplos de código superan a las
//      descripciones en prosa. "Could cause system failures" es un juicio que el
//      modelo hace de nuevo en cada finding, y no lo hará idéntico dos veces. Un
//      ejemplo fija la frontera en un patrón concreto.
// You should see: al menos un snippet por nivel, mostrando el patrón real.
// ─────────────────────────────────────────────────────────────────────────────

/** Un nivel de severidad anclado a un patrón de código concreto. */
interface SeverityExample {
  readonly severity: Severity;
  readonly pattern: string;
  readonly code: string;
}

/** Los tres ejemplos ancla del ejercicio. */
export const SEVERITY_EXAMPLES: readonly SeverityExample[] = [
  {
    severity: "critical",
    pattern: "Unsanitised user input in SQL query",
    code: 'query = f"SELECT * FROM users WHERE id = {user_input}"',
  },
  {
    severity: "major",
    pattern: "Missing null check before property access",
    code: "const name = response.data.user.name; // no null guard",
  },
  {
    severity: "minor",
    pattern: "Inconsistent variable naming",
    code: "userName vs user_name in the same module",
  },
];

/**
 * El enum que hace el criterio verificable por schema.
 *
 * Un criterio de severidad expresado como `enum: ["critical","major","minor"]` en
 * una tool de extracción lo aplica el schema; el mismo criterio en prosa lo aplica
 * solo la interpretación del modelo.
 *
 * @returns El enum de severidades.
 */
export function severityEnum(): readonly Severity[] {
  return ["critical", "major", "minor"];
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 4 — Comparar tasas de falsos positivos
//
// Why: cuantificar la mejora valida el enfoque y construye la skill de evaluación
//      que el examen espera. Debes poder articular por qué un enfoque rinde mejor
//      con datos, no con intuición.
// You should see: reducción clara de FP con el criterio explícito; el vago produce
//      30-50% de inconsistencia, el explícito queda por debajo del 15%.
// ─────────────────────────────────────────────────────────────────────────────

/** Conteos de una corrida de clasificación. */
interface CategoryMetrics {
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
}

/**
 * Precision = TP / (TP + FP).
 *
 * @param metrics - Los conteos.
 * @returns La precision, o 1 si no hubo nada que reportar.
 */
export function precision(metrics: CategoryMetrics): number {
  const reported = metrics.truePositives + metrics.falsePositives;
  return reported === 0 ? 1 : metrics.truePositives / reported;
}

/**
 * Tasa de falsos positivos = FP / (TP + FP).
 *
 * @param metrics - Los conteos.
 * @returns La tasa de FP.
 */
export function falsePositiveRate(metrics: CategoryMetrics): number {
  const reported = metrics.truePositives + metrics.falsePositives;
  return reported === 0 ? 0 : metrics.falsePositives / reported;
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 5 — Desactivar temporalmente la categoría con más de 25% de FP
//
// Why: la credibilidad no se evalúa por categoría. Una categoría equivocada el
//      40% de las veces le cuesta al lector la confianza en una que acierta el 98%.
//      Dejarla corriendo mientras la arreglas mantiene todo el output descontado.
// You should see: la lista de categorías sobre el umbral, los refinamientos que
//      necesitan y un plan de reactivación con su tasa objetivo.
// ─────────────────────────────────────────────────────────────────────────────

/** Umbral de FP a partir del cual se desactiva la categoría. */
export const FP_DISABLE_THRESHOLD = 0.25;

/**
 * Decide si una categoría se mantiene o se desactiva mientras se refina.
 *
 * @param fpRate - La tasa de falsos positivos de la categoría.
 * @returns La acción correspondiente.
 */
export function decideCategoryAction(fpRate: number): "disable" | "keep" {
  return fpRate > FP_DISABLE_THRESHOLD ? "disable" : "keep";
}

/**
 * La credibilidad que el lector atribuye al output completo.
 *
 * La confianza se adhiere al output COMO UN TODO, así que la categoría más débil
 * fija la credibilidad de la más fuerte: 40% de FP en `documentation_mismatch`
 * hunde la confianza en `security_vulnerability` aunque su 98% no haya cambiado.
 *
 * @param categories - Nombre y precisión de cada categoría activa.
 * @returns La credibilidad del conjunto (el mínimo de las activas).
 */
export function outputCredibility(
  categories: readonly { readonly name: string; readonly accuracy: number }[],
): number {
  return categories.reduce((weakest, category) => Math.min(weakest, category.accuracy), 1);
}

/** El plan de refinamiento de una categoría desactivada. */
interface RefinementPlan {
  readonly category: string;
  readonly issue: string;
  readonly fix: string;
  readonly targetFpRate: number;
}

/** El plan del ejercicio. */
export const DOC_MISMATCH_REFINEMENT: RefinementPlan = {
  category: "documentation_mismatch",
  issue: "Flagging outdated comments as mismatches when the code is correct",
  fix: "Add examples distinguishing stale comments from genuine contradictions",
  targetFpRate: 0.15,
};

// ─────────────────────────────────────────────────────────────────────────────
// Extra — Dónde viven los criterios y el orden criterios → confianza
//
// Why: los criterios de un reviewer viven en el parámetro top-level `system`, no
//      como primer mensaje `user`. Y la confianza no puede establecer qué
//      califica como finding: ese juicio tiene que existir antes.
// You should see: el routing correcto, con criterios primero.
// ─────────────────────────────────────────────────────────────────────────────

/** Puerto mínimo a la Messages API: nota que `system` es top-level. */
interface ReviewRequest {
  readonly model: string;
  readonly max_tokens: number;
  readonly system: string;
  readonly messages: readonly { readonly role: "user" | "assistant"; readonly content: string }[];
}

/**
 * Compone el request de review.
 *
 * `system` es un parámetro top-level: la Messages API NO tiene un rol "system"
 * para mensajes. Además, mensajes consecutivos del mismo rol se combinan en un
 * solo turno, así que añadir los criterios como un mensaje `user` extra no produce
 * la separación que esperarías.
 *
 * @param criteria - El system prompt con los criterios.
 * @param diff - El diff a revisar.
 * @returns El request listo para enviar.
 */
export function reviewRequest(criteria: string, diff: string): ReviewRequest {
  return {
    model: "claude-sonnet-5",
    max_tokens: 4096,
    system: criteria,
    messages: [{ role: "user", content: diff }],
  };
}

/** Umbral de confianza a partir del cual se reporta directo. */
export const CONFIDENCE_REPORT_THRESHOLD = 0.8;

/**
 * Rutea un finding: criterios primero, confianza después.
 *
 * Una confianza auto-reportada está mal calibrada: hay certeza en findings
 * equivocados y titubeo en los correctos. Por eso el primer corte es el criterio
 * —¿es un finding definido?— y solo después la confianza decide entre reportar
 * directo y mandar a revisión humana.
 *
 * @param input - Si el finding está definido por el criterio, y su confianza.
 * @returns El destino del finding.
 */
export function routeFinding(input: {
  readonly isDefinedFinding: boolean;
  readonly confidence: number;
}): "report" | "human_review" | "discard" {
  if (!input.isDefinedFinding) return "discard";
  return input.confidence >= CONFIDENCE_REPORT_THRESHOLD ? "report" : "human_review";
}

/**
 * ¿Bajar la temperature arregla la precision?
 *
 * `temperature` default 1.0, rango 0.0–1.0, y la guía es acercarse a 0.0 para
 * trabajo analítico. Pero "even with temperature of 0.0, the results will not be
 * fully deterministic": puede apretar la varianza, no inventar una frontera de
 * decisión que el prompt nunca definió.
 *
 * @returns `false` — no es un control de precision.
 */
export function temperatureIsPrecisionControl(): boolean {
  return false;
}

/**
 * ============================================================================
 * ✗ ANTI-PATTERN — Los errores que el examen construye
 * ============================================================================
 */

/** ✗ ANTI-PATTERN 1 — "Be conservative".
 *
 * Se resuelve distinto según lo que el modelo asuma que te importa; no declara
 * ninguna frontera aplicable.
 */
// "Review this code. Be conservative."  // mismo snippet, veredictos distintos

/** ✗ ANTI-PATTERN 2 — "Only report high-confidence findings".
 *
 * Pide un umbral contra una escala que el modelo no puede calibrar, y la
 * confianza auto-reportada está mal calibrada.
 */
// "Only report high-confidence findings."  // descarta buenos, conserva malos

/** ✗ ANTI-PATTERN 3 — Filtrar por confianza antes de definir criterios.
 *
 * Filtra un conjunto indefinido: un finding equivocado al 90% se queda, uno
 * correcto al 60% se descarta.
 */
// if (confidence >= 0.8) report();   // sin criterios definidos primero

/** ✗ ANTI-PATTERN 4 — Mantener activa la categoría ruidosa mientras la arreglas.
 *
 * La credibilidad no se evalúa por categoría: el ruido hace que todo el output
 * quede descontado.
 */
// keepEnabled(documentation_mismatch)  // arrastra la confianza de las demás

/** ✗ ANTI-PATTERN 5 — Definir la severidad en prosa.
 *
 * "Critical: issues that could cause system failures or data loss" es un juicio
 * que se hace de nuevo en cada finding y que no se repite idéntico.
 */
// "Critical: could cause system failures"  // la clasificación deriva

/** ✗ ANTI-PATTERN 6 — Poner los criterios como primer mensaje `user`.
 *
 * No hay rol "system" en `messages`, y los mensajes consecutivos del mismo rol se
 * combinan; el reviewer termina citando las líneas de los criterios como si fueran
 * código cambiado.
 */
// messages: [{ role: "user", content: criteria }, { role: "user", content: diff }]

/** ✗ ANTI-PATTERN 7 — Bajar la temperature para reducir falsos positivos.
 *
 * Puede apretar la varianza, no definir la frontera que el prompt nunca definió.
 */
// { temperature: 0.0 }  // "still not fully deterministic"

/**
 * ============================================================================
 * EXAM TRAPS — distractores recurrentes y criterio de rechazo
 * ============================================================================
 *
 * | Trampa                                             | Por qué se rechaza                                  |
 * |----------------------------------------------------|-----------------------------------------------------|
 * | "Be conservative" / "high-confidence only"          | Ninguna declara una frontera aplicable               |
 * | Umbrales de confianza como fix de FP                | Confianza mal calibrada; filtra un set indefinido    |
 * | Seguir con la categoría ruidosa activa              | La credibilidad se descuenta para todo el output     |
 *
 * QUICK REFERENCE — datos de la fuente
 *
 *   Dónde viven los criterios  parámetro top-level `system` — no hay rol "system" en messages
 *   Mensajes mismo rol ........ se COMBINAN en un solo turno, no se rechazan
 *   max_tokens ................ techo absoluto; el modelo puede parar antes
 *   temperature ............... default 1.0; rango 0.0–1.0; más cerca de 0.0 para
 *                               trabajo analítico; 0.0 NO es totalmente determinista
 *   Failure mode A ............ lógica if/else rígida hardcodeada → fragilidad
 *   Failure mode B ............ guía vaga de alto nivel → sin señal concreta
 *   Altitud objetivo .......... el set MÍNIMO de información que delinea el comportamiento
 *   No recomendado ............ meter una laundry list de edge cases en el prompt
 *   Estilo preferido .......... buenos heuristics + guardrails explícitos, no reglas rígidas
 *   Criterios categóricos ..... codificar como enum de tool o structured output, no prosa
 *   Set de eval para empezar .. ~20 queries representativas
 *   LLM-judge que funcionó .... un call, un prompt, score 0.0–1.0 + pass/fail contra rúbrica
 *   Mejor forma de feedback ... reglas definidas + cuál falló y por qué
 *   Leverage temprano ......... un tweak de prompt movió el éxito de 30% a 80%
 *   Regla de confianza ........ FP alto en una categoría destruye la confianza en TODAS
 *   Recuperar confianza ....... desactivar la categoría ruidosa, refinar, reactivar
 *   Severidad ................. ejemplos de código concretos por nivel, nunca prosa
 *
 * ============================================================================
 * FLUJO DE EJECUCIÓN ESPERADO  (trace ilustrativo — no se ejecuta)
 * ============================================================================
 *
 * [Paso 1] VAGUE_CRITERIA corrido 2× sobre "userName vs user_name"
 *   → consistencyOf(["critical", "skipped"])
 *   → { runs: 2, distinct: 2, consistent: false }   ✗ nada que aplicar
 *
 * [Paso 2] renderCriteria(EXPLICIT_CRITERIA)
 *   → "Flag comments only when claimed behaviour contradicts actual code behaviour.
 *      Report: bug, security, logic_error.
 *      Skip: style, local_pattern."
 *   Corrido 2× sobre el mismo snippet → consistencyOf(["minor","minor"])
 *   → { runs: 2, distinct: 1, consistent: true }    ✓ nada que interpretar
 *
 * [Paso 3] SEVERITY_EXAMPLES ancla cada nivel a un patrón:
 *   critical → `f"…WHERE id={user_input}"`   (dos snippets similares ⇒ misma severidad)
 *   (con prosa: "could cause system failures" ⇒ crítico y menor en dos corridas)
 *
 * [Paso 4] precision({tp: 9, fp: 1, fn: 2}) → 0.9
 *          falsePositiveRate({tp: 8, fp: 2, fn: 0}) → 0.2
 *
 * [Paso 5] decideCategoryAction(0.40) → "disable"   ← documentation_mismatch
 *          decideCategoryAction(0.12) → "keep"
 *          outputCredibility([
 *            { name: "documentation_mismatch", accuracy: 0.60 },
 *            { name: "security_vulnerability", accuracy: 0.98 }]) → 0.60
 *          ← la débil fija la credibilidad del conjunto
 *          Con la ruidosa desactivada:
 *          outputCredibility([{ name: "security_vulnerability", accuracy: 0.98 }]) → 0.98
 *          ✅ la confianza en las categorías que ya funcionaban se recupera
 *
 * routeFinding({ isDefinedFinding: false, confidence: 0.95 }) → "discard"
 *   ← criterios primero: ni siquiera un 95% de confianza lo salva
 * routeFinding({ isDefinedFinding: true, confidence: 0.55 })  → "human_review"
 * temperatureIsPrecisionControl() → false
 *
 * ANTI-PATRÓN: mandar los criterios como primer mensaje `user` seguido del diff.
 * El reviewer cita líneas de los criterios como si fueran código cambiado y aplica
 * el skip list de forma inconsistente. El fix no es XML tags ni repetirlos al
 * final: es moverlos al parámetro top-level `system`.
 */
