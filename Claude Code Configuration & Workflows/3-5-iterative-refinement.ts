/**
 * ============================================================================
 * DOMINIO 3 · TASK STATEMENT 3.5 — Iterative Refinement Techniques
 * ----------------------------------------------------------------------------
 * Objetivo oficial:
 *   Apply iterative refinement techniques for progressive improvement.
 *
 * Qué evalúa el examen aquí:
 *   Nadie obtiene el output que quería al primer intento, y al examen le importa
 *   menos ese hecho que lo que haces después. Hay técnicas con nombre para
 *   dirigir a Claude Code, sirven a fallos distintos, y la skill testeable es
 *   elegir la correcta en vez de probar las tres. El orden: **ejemplos de
 *   input/output** para interpretación inconsistente, **test-driven iteration**
 *   para transformaciones complejas, **interview pattern** para dominios
 *   desconocidos. Y la entrega: batchear lo que interactúa, secuenciar lo que no.
 *
 * Build Exercise: Practice Iterative Refinement Techniques  (Beginner · 30 min)
 * ============================================================================
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tipos de las técnicas
// ─────────────────────────────────────────────────────────────────────────────

/** Las tres técnicas, en orden de alcance. */
type RefinementTechnique =
  | "concrete_examples"
  | "test_driven_iteration"
  | "interview_pattern";

/** El fallo observado que determina qué técnica toca. */
type FailureMode =
  | "inconsistent_interpretation"
  | "complex_transformation_many_edge_cases"
  | "unfamiliar_domain";

/**
 * Qué clase de hueco repara cada cosa.
 *
 * Los ejemplos reparan un hueco de TRANSMISIÓN: sabes exactamente lo que quieres
 * y la prosa sigue llegando como algo ligeramente distinto. El interview pattern
 * repara un hueco de CONOCIMIENTO: no puedes especificar lo que no sabías que
 * había que considerar.
 */
type GapKind = "transmission" | "knowledge";

/** Un par antes/después que fija la transformación. */
interface TransformationExample {
  readonly input: string;
  readonly output: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 1 — La descripción en prosa, corrida tres veces
//
// Why: demuestra el problema que resuelven los ejemplos. La prosa depende de la
//      interpretación, y la interpretación varía entre corridas. Verlo en primera
//      persona hace el caso por los ejemplos.
// You should see: tres outputs distintos del MISMO prompt; las variaciones suelen
//      ser de naming, de manejo de edge cases o de estructura.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Elige la técnica según el fallo.
 *
 * @param failure - Lo observado.
 * @returns La técnica que corresponde.
 */
export function chooseTechnique(failure: FailureMode): RefinementTechnique {
  switch (failure) {
    case "inconsistent_interpretation":
      return "concrete_examples";
    case "complex_transformation_many_edge_cases":
      return "test_driven_iteration";
    case "unfamiliar_domain":
      return "interview_pattern";
    default: {
      const exhaustive: never = failure;
      return exhaustive;
    }
  }
}

/**
 * Qué hueco repara una técnica.
 *
 * Confundir estas dos es el error que el examen castiga: correr el interview
 * pattern sobre una transformación que ya sabes especificar exactamente
 * desperdicia la ronda, porque no hay nada que descubrir.
 *
 * @param technique - La técnica.
 * @returns El hueco que cubre.
 */
export function gapRepairedBy(technique: RefinementTechnique): GapKind {
  switch (technique) {
    case "concrete_examples":
    case "test_driven_iteration":
      return "transmission";
    case "interview_pattern":
      return "knowledge";
    default: {
      const exhaustive: never = technique;
      return exhaustive;
    }
  }
}

/**
 * Resume la consistencia de una tanda de corridas.
 *
 * @param outputs - Los outputs de correr el mismo prompt N veces.
 * @returns Cuántas formas distintas salieron y si fueron consistentes.
 */
export function consistencyOf(
  outputs: readonly string[],
): { readonly runs: number; readonly distinct: number; readonly consistent: boolean } {
  const distinct = new Set(outputs).size;
  return { runs: outputs.length, distinct, consistent: distinct === 1 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 2 — Dos o tres ejemplos de input/output, corridos tres veces
//
// Why: los ejemplos son la técnica de primera línea para interpretación
//      inconsistente. Un patrón demostrado dos veces generaliza más fiablemente
//      que un patrón descrito a cualquier longitud, porque no queda nada que
//      inferir sobre la intención.
// You should see: tres outputs consistentes entre sí y con el patrón de los
//      ejemplos; la variación del paso 1 desaparece.
// ─────────────────────────────────────────────────────────────────────────────

/** Los dos pares del ejercicio: `T` → `Result<T, ApiError>`. */
export const RESULT_WRAPPER_EXAMPLES: readonly TransformationExample[] = [
  {
    input: "getUserData(userId: string): Promise<UserData>",
    output: "getUserData(userId: string): Promise<Result<UserData, ApiError>>",
  },
  {
    input: "fetchOrders(customerId: string): Promise<Order[]>",
    output: "fetchOrders(customerId: string): Promise<Result<Order[], ApiError>>",
  },
];

/**
 * Cuántos ejemplos hacen falta.
 *
 * El volumen no añade nada: un par del caso normal más uno que fije una variante
 * genuinamente incómoda basta. Más allá de eso, se re-demuestra un patrón ya
 * establecido al coste del contexto que ocupa.
 *
 * @param needsAwkwardVariant - Si hay una variante incómoda que fijar.
 * @returns El número de pares recomendado.
 */
export function exampleCount(needsAwkwardVariant: boolean): number {
  return needsAwkwardVariant ? 3 : 2;
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 3 — Test-driven iteration: escribe la suite, comparte los fallos
//
// Why: es la técnica más efectiva para transformaciones complejas. Un assert que
//      falla es feedback sin superficie interpretativa: nombra lo que se esperaba
//      y lo que llegó, y nada de eso se puede leer de dos maneras.
// You should see: tras compartir los fallos, fixes dirigidos a los asserts
//      concretos; cada iteración reduce el número de tests rojos.
// ─────────────────────────────────────────────────────────────────────────────

/** Categoría de un caso de test. */
type TestCategory = "happy_path" | "edge_case" | "performance";

/** Un caso con su esperado y su actual. */
interface TestCase {
  readonly name: string;
  readonly category: TestCategory;
  readonly expected: string;
  readonly actual: string;
}

/** La suite del ejercicio: happy path, nulls/boundaries y el target de tiempo. */
export const MIGRATION_TESTS: readonly TestCase[] = [
  { name: "transformsOrdinaryRow", category: "happy_path", expected: '{"fullName":"Ada Lovelace"}', actual: '{"fullName":"Ada Lovelace"}' },
  { name: "preservesNullsThroughMigration", category: "edge_case", expected: '{"middleName":null}', actual: '{"middleName":""}' },
  { name: "handlesEmptyCollection", category: "edge_case", expected: "[]", actual: "[]" },
  { name: "keepsRowOnCutoffDate", category: "edge_case", expected: '{"kept":true}', actual: '{"kept":false}' },
  { name: "completesWithinTwentyMinutes", category: "performance", expected: "<= 20m", actual: "24m" },
];

/**
 * Los tests que fallan.
 *
 * @param tests - La suite.
 * @returns Los casos que no pasan.
 */
export function failingTests(tests: readonly TestCase[]): readonly TestCase[] {
  return tests.filter((test) => test.expected !== test.actual);
}

/**
 * Formatea un fallo como el feedback que no deja nada que interpretar.
 *
 * @param test - El caso que falla.
 * @returns El reporte en formato `Expected / Actual`.
 */
export function formatFailure(test: TestCase): string {
  return `FAIL: ${test.name}\n  Expected: ${test.expected}\n  Actual:   ${test.actual}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 4 — Interview pattern para un dominio desconocido
//
// Why: cuando el dominio es desconocido, el riesgo no es que Claude te
//      malinterprete: es que olvides pedir algo que no sabías que importaba.
//      Invertir quién pregunta lo saca a la superficie.
// You should see: entre 5 y 10 preguntas dirigidas sobre requisitos, edge cases y
//      constraints que no habías considerado.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compone el prompt del interview pattern.
 *
 * En lugar de prescribir una solución, se pide a Claude que pregunte primero.
 *
 * @param subject - Qué se quiere construir.
 * @returns El prompt para pegar.
 */
export function interviewPrompt(subject: string): string {
  return (
    `I want to ${subject}. Before you write anything, ask me what you need to know — ` +
    `requirements, edge cases, constraints I may not have thought about.`
  );
}

/** Las preguntas que este patrón suele sacar, en el ejemplo del cache. */
export const TYPICAL_INTERVIEW_QUESTIONS: readonly string[] = [
  "What is the cache invalidation strategy?",
  "What consistency model is required?",
  "What happens when the cache is unavailable — fail open or fail closed?",
  "What TTL suits the data, and how much staleness is tolerable?",
];

// ─────────────────────────────────────────────────────────────────────────────
// Paso 5 — Batch vs secuencial: la prueba es si los fixes se tocan
//
// Why: la entrega importa tanto como el contenido. La pregunta que decide es si
//      los fixes se tocan entre sí, no cuántos son.
// You should see: un fix coherente que cubre los tres issues que interactúan, con
//      el shape de error, el formato de log y los tipos alineados.
// ─────────────────────────────────────────────────────────────────────────────

/** Cómo entregar un conjunto de issues. */
type FeedbackDelivery = "single_message" | "sequential";

/**
 * Decide la entrega según si los fixes interactúan.
 *
 * Interactúan ⇒ un solo mensaje: enviados por separado, cada fix se hace sin ver
 * los otros, así que el segundo contradice al primero y el tercero deshace ambos.
 * Independientes ⇒ secuencial: batcheados compiten por atención y se vuelve
 * ambiguo qué instrucción gobierna qué parte del archivo.
 *
 * @param issues - Los issues y si se tocan entre sí.
 * @returns La forma de entrega.
 */
export function chooseFeedbackDelivery(issues: {
  readonly interact: boolean;
}): FeedbackDelivery {
  return issues.interact ? "single_message" : "sequential";
}

/** Los tres issues que interactúan en el ejercicio. */
export const INTERACTING_ISSUES: readonly string[] = [
  "Error responses must include an errorCode field",
  "Logging must include the errorCode in structured format",
  "The client SDK type definitions must reflect the new errorCode field",
];

/** Dos issues que no se tocan: van secuencialmente. */
export const INDEPENDENT_ISSUES: readonly string[] = [
  "Rename the exported functions to camelCase",
  "Switch indentation to two spaces",
];

// ─────────────────────────────────────────────────────────────────────────────
// Extra — Mecánicas de sesión que apoyan el mismo loop iterativo
//
// Why: la jerarquía de técnicas es sobre QUÉ decir; Claude Code tiene además
//      mecánicas de sesión para enfocar contexto, bifurcar y deshacer.
// You should see: el mecanismo correcto para cada necesidad.
// ─────────────────────────────────────────────────────────────────────────────

/** Una mecánica de sesión al servicio de la iteración. */
export type IterationMechanic =
  | "compact"
  | "fork_session"
  | "rewind"
  | "writer_reviewer";

/**
 * Elige la mecánica de sesión para una necesidad.
 *
 * @param need - Lo que hace falta.
 * @returns La mecánica correspondiente.
 */
export function mechanicFor(
  need:
    | "long_session_losing_focus"
    | "compare_divergent_fixes"
    | "bad_iteration"
    | "unbiased_second_opinion",
): IterationMechanic {
  switch (need) {
    case "long_session_losing_focus":
      return "compact";
    case "compare_divergent_fixes":
      return "fork_session";
    case "bad_iteration":
      return "rewind";
    case "unbiased_second_opinion":
      return "writer_reviewer";
    default: {
      const exhaustive: never = need;
      return exhaustive;
    }
  }
}

/** Qué se restaura desde el menú de `/rewind`. */
type RewindScope = "code_and_conversation" | "conversation_only" | "code_only";

/**
 * Cómo se revierte una iteración que fue mal.
 *
 * Cada prompt del usuario crea un checkpoint automáticamente. `/rewind` (o Esc
 * dos veces sobre un prompt vacío) abre el menú, que ofrece restaurar código y
 * conversación juntos, solo conversación, o solo código. Es un "local undo" que
 * complementa a git, y NO rastrea cambios hechos por comandos Bash: solo las
 * ediciones de las tools de edición de Claude.
 *
 * @param scope - Qué se quiere revertir.
 * @returns El comando y su efecto.
 */
export function rewindPlan(scope: RewindScope): string {
  const restore: Readonly<Record<RewindScope, string>> = {
    code_and_conversation: "restore both the files and the conversation",
    conversation_only: "restore the conversation, keep the files",
    code_only: "restore the files, keep the conversation",
  };
  return `/rewind → ${restore[scope]}`;
}

/**
 * ============================================================================
 * ✗ ANTI-PATTERN — Los errores que el examen construye
 * ============================================================================
 */

/** ✗ ANTI-PATTERN 1 — Refinar la prosa cuando la interpretación es inconsistente.
 *
 * Afinar la redacción sigue dejando algo que interpretar, que es la fuente real
 * de la inconsistencia. Dos o tres pares input/output eliminan el paso
 * interpretativo por completo.
 */
// prompt += " (be precise about the Result shape)"  // sigue habiendo interpretación

/** ✗ ANTI-PATTERN 2 — Secuenciar issues que interactúan.
 *
 * El segundo fix se hace sin ver el primero, así que lo contradice; el tercero
 * tiene que deshacer ambos.
 */
// fix(errorCode); then fix(logging); then fix(types);  // cada uno a ciegas

/** ✗ ANTI-PATTERN 3 — Batchear issues independientes.
 *
 * Compiten por atención y se vuelve ambiguo qué instrucción gobierna qué parte
 * del archivo.
 */
// "Rename to camelCase AND switch to two-space indent"  // cuál gobierna qué

/** ✗ ANTI-PATTERN 4 — Confundir el interview pattern con los ejemplos.
 *
 * Reparan huecos opuestos. Entrevistar cubre lo que no sabías que pedir (dominios
 * desconocidos); los ejemplos cubren una spec que tienes precisa pero no logras
 * transmitir.
 */
// interviewPattern("wrap the return in a Result type")  // nada que descubrir

/** ✗ ANTI-PATTERN 5 — Añadir un par de ejemplos por cada caso que falla.
 *
 * El volumen no añade nada: dos o tres bien elegidos generalizan; re-demostrar el
 * mismo patrón ocupa contexto sin mejorar la transmisión.
 */
// examples.push(...oneForEachOfTheTwentyVariants);  // re-demostración

/** ✗ ANTI-PATTERN 6 — Reescribir la prosa enumerando todos los edge cases.
 *
 * Una spec en prosa sobre nulls, colecciones vacías y boundaries sigue dejando
 * superficie interpretativa; la suite de tests nombra expected y actual y no deja
 * ninguna.
 */
// "handle nulls, empties, boundaries, and the 20-minute window precisely"  // prosa otra vez

/**
 * ============================================================================
 * EXAM TRAPS — distractores recurrentes y criterio de rechazo
 * ============================================================================
 *
 * | Trampa                                             | Por qué se rechaza                                  |
 * |----------------------------------------------------|-----------------------------------------------------|
 * | Refinar la prosa ante interpretación inconsistente  | Deja el paso interpretativo intacto                 |
 * | No reconocer cuándo batchear vs secuenciar          | La prueba es si los fixes se tocan, no cuántos son  |
 * | Confundir interview con examples                    | Reparan huecos opuestos (conocimiento vs transmisión)|
 *
 * QUICK REFERENCE — datos de la fuente
 *
 *   Prosa interpretada distinto cada corrida ... ejemplos input/output (2-3 pares)
 *   Transformación compleja con edge cases ..... test-driven iteration — comparte fallos
 *   Dominio desconocido ........................ interview pattern — que Claude pregunte
 *   Fixes que interactúan ...................... batch en un solo mensaje
 *   Fixes independientes ....................... feedback secuencial, uno a uno
 *   Sesión larga perdiendo foco ................ `/compact <instructions>` — resumen dirigido
 *   Comparar dos fixes divergentes ............. `--fork-session` (con `--continue`/`--resume`)
 *   Iteración que fue mal ...................... `/rewind` o Esc-Esc — código, conversación, o ambos
 *   Segunda opinión sin sesgo .................. Writer/Reviewer — sesión fresca revisa
 *   Scaffold del ciclo completo ................ Explore → Plan → Implement → Commit
 *   Secuencia de comunicación con ejemplos ..... observar inconsistencia → ejemplos →
 *                                                verificar generalización → añadir edge case
 *   Checkpoints ................................ cada prompt del usuario crea uno; no
 *                                                rastrean cambios de Bash
 *
 * ============================================================================
 * FLUJO DE EJECUCIÓN ESPERADO  (trace ilustrativo — no se ejecuta)
 * ============================================================================
 *
 * [Paso 1] Mismo prompt en prosa, 3 corridas
 *   → ["Promise<Result<UserData, Error>>",
 *      "Promise<Result<UserData, string>>",
 *      "Promise<{ok, data, error}>"]
 *   consistencyOf(runs) → { runs: 3, distinct: 3, consistent: false }
 *
 * [Paso 2] RESULT_WRAPPER_EXAMPLES (2 pares), 3 corridas sobre deleteAccount
 *   → ["Promise<Result<void, ApiError>>" ×3]
 *   consistencyOf(runs) → { runs: 3, distinct: 1, consistent: true }
 *   ✅ un patrón demostrado dos veces generaliza; la prosa descrita no
 *
 * [Paso 3] failingTests(MIGRATION_TESTS)
 *   → [preservesNullsThroughMigration, keepsRowOnCutoffDate, completesWithinTwentyMinutes]
 *   formatFailure(preservesNullsThroughMigration)
 *   → "FAIL: preservesNullsThroughMigration
 *        Expected: {\"middleName\":null}
 *        Actual:   {\"middleName\":\"\"}"
 *   ✅ un solo camino al fix, sin interpretación
 *
 * [Paso 4] interviewPrompt("put a caching layer in front of the orders API")
 *   → "I want to… Before you write anything, ask me what you need to know…"
 *   Preguntas: invalidación, TTL, staleness tolerable, qué pasa si la cache cae
 *   ✅ cubre el hueco de CONOCIMIENTO, no el de transmisión
 *
 * [Paso 5] chooseFeedbackDelivery({ interact: true })  → "single_message"
 *          chooseFeedbackDelivery({ interact: false }) → "sequential"
 *   Interactúan (errorCode + logging + tipos) ⇒ un mensaje, un shape coherente
 *   Independientes (rename + indent) ⇒ mensajes separados
 *
 * mechanicFor("bad_iteration") → "rewind"
 * rewindPlan("code_only")      → "/rewind → restore the files, keep the conversation"
 *
 * ANTI-PATRÓN: seguir añadiendo pares de ejemplos por cada caso que falla, cuando
 * el problema ya es una transformación compleja con muchos edge cases y un target
 * de tiempo. Ahí la técnica correcta es test-driven iteration: escribir la suite
 * (ordinary, null, boundary, timing) y compartir cada fallo.
 */
