/**
 * ============================================================================
 * DOMINIO 4 · TASK STATEMENT 4.6 — Multi-Instance & Multi-Pass Review
 * ----------------------------------------------------------------------------
 * Objetivo oficial:
 *   Design multi-instance and multi-pass review architectures.
 *
 * Qué evalúa el examen aquí:
 *   Un modelo al que se le pide revisar lo que acaba de escribir no se aproxima
 *   neutral: conserva el razonamiento que lo produjo, y el razonamiento que ya
 *   justificó está inclinado a defenderlo. Eso no es un defecto para promptear
 *   alrededor; es una propiedad para diseñar alrededor. La revisión va en una
 *   **instancia independiente**. Y las reviews grandes se parten en pasadas
 *   per-file más una pasada de integración cross-file, porque la atención se
 *   divide entre todo lo que comparte una pasada — una ventana más grande no lo
 *   arregla.
 *
 * Build Exercise: Build a Multi-Pass Code Review System  (Advanced · 60 min)
 * ============================================================================
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tipos de la arquitectura de review
// ─────────────────────────────────────────────────────────────────────────────

/** Un archivo del PR, con el bug plantado para medir la detección. */
interface PrFile {
  readonly name: string;
  readonly content: string;
  readonly plantedBug: string | null;
}

/** Un finding de review, con su confianza auto-reportada. */
interface Finding {
  readonly file: string;
  readonly finding: string;
  readonly severity: "critical" | "major" | "minor";
  readonly confidence: number;
  readonly reasoning: string;
}

/** Un finding con su decisión de ruteo. */
interface RoutedFinding extends Finding {
  readonly route: "direct_report" | "human_review";
}

/** Cómo se sintió el depth de cada archivo en una pasada. */
interface DepthObservation {
  readonly file: string;
  readonly depth: "detailed" | "superficial";
  readonly hadPlantedBug: boolean;
  readonly foundPlantedBug: boolean;
  readonly verdict: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 1 — Una sola pasada sobre un PR de 10 archivos
//
// Why: el baseline de una sola pasada demuestra los tres síntomas de la atención
//      diluida: depth inconsistente, bugs perdidos en el medio y findings
//      contradictorios.
// You should see: feedback detallado en algunos archivos (típicamente el primero y
//      el último) y superficial en otros, al menos un bug obvio perdido en el
//      medio, y el mismo patrón juzgado distinto en dos archivos.
// ─────────────────────────────────────────────────────────────────────────────

/** El mock PR del ejercicio: 10 archivos, con el bug plantado en el 6. */
export const MOCK_PR_FILES: readonly PrFile[] = [
  { name: "f1.ts", content: "export const parse = (s: string) => JSON.parse(s);", plantedBug: null },
  { name: "f2.ts", content: "export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);", plantedBug: null },
  { name: "f3.ts", content: "export const clamp = (n: number) => Math.min(1, Math.max(0, n));", plantedBug: null },
  { name: "f4.ts", content: "export const id = <T>(x: T): T => x;", plantedBug: null },
  { name: "f5.ts", content: "export const noop = () => undefined;", plantedBug: null },
  { name: "f6.ts", content: 'const q = `SELECT * FROM users WHERE id = ${userInput}`;', plantedBug: "SQL injection" },
  { name: "f7.ts", content: "const shadowed = 1; function f() { const shadowed = 2; return shadowed; }", plantedBug: null },
  { name: "f8.ts", content: "export const eq = (a: number, b: number) => a == b;", plantedBug: null },
  { name: "f9.ts", content: "export const now = () => new Date();", plantedBug: null },
  { name: "f10.ts", content: "export const log = console.log;", plantedBug: null },
];

/** El resultado de la pasada única del ejercicio. */
export const SINGLE_PASS_DEPTH: readonly DepthObservation[] = [
  { file: "f1.ts", depth: "detailed", hadPlantedBug: false, foundPlantedBug: false, verdict: "clean" },
  { file: "f2.ts", depth: "detailed", hadPlantedBug: false, foundPlantedBug: false, verdict: "clean" },
  { file: "f3.ts", depth: "superficial", hadPlantedBug: false, foundPlantedBug: false, verdict: "clean" },
  { file: "f4.ts", depth: "superficial", hadPlantedBug: false, foundPlantedBug: false, verdict: "clean" },
  { file: "f5.ts", depth: "superficial", hadPlantedBug: false, foundPlantedBug: false, verdict: "clean" },
  { file: "f6.ts", depth: "superficial", hadPlantedBug: true, foundPlantedBug: false, verdict: "clean" },
  { file: "f7.ts", depth: "superficial", hadPlantedBug: false, foundPlantedBug: false, verdict: "flagged" },
  { file: "f8.ts", depth: "superficial", hadPlantedBug: false, foundPlantedBug: false, verdict: "clean" },
  { file: "f9.ts", depth: "superficial", hadPlantedBug: false, foundPlantedBug: false, verdict: "clean" },
  { file: "f10.ts", depth: "detailed", hadPlantedBug: false, foundPlantedBug: false, verdict: "flagged" },
];

/**
 * Detecta los síntomas de atención diluida en una pasada.
 *
 * @param observations - El depth observado por archivo.
 * @returns Los síntomas presentes, en texto.
 */
export function detectDilution(observations: readonly DepthObservation[]): readonly string[] {
  const symptoms: string[] = [];

  const depths = new Set(observations.map((observation) => observation.depth));
  if (depths.size > 1) {
    symptoms.push("Inconsistent depth across files.");
  }

  const missedMiddle = observations.some(
    (observation) => observation.hadPlantedBug && !observation.foundPlantedBug,
  );
  if (missedMiddle) {
    symptoms.push("Planted bug missed in a middle file.");
  }

  // El mismo patrón juzgado distinto en dos archivos.
  const verdicts = new Set(observations.map((observation) => observation.verdict));
  if (verdicts.size > 1) {
    symptoms.push("Same construct judged differently in two files.");
  }

  return symptoms;
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 2 — Análisis local per-file
//
// Why: el análisis per-file asegura que cada archivo reciba atención constante y
//      enfocada. Cada invocación examina un solo archivo, eliminando la dilución
//      que causa el depth inconsistente y los bugs perdidos.
// You should see: depth consistente en los 10 archivos; los bugs antes perdidos
//      (sobre todo en los del medio) ahora se atrapan.
// ─────────────────────────────────────────────────────────────────────────────

/** Puerto de review: dado un prompt, devuelve el texto del review. */
export interface ReviewModel {
  review(prompt: string): Promise<string>;
}

/**
 * Corre una pasada de review por archivo, en paralelo.
 *
 * Cada llamada recibe SOLO su archivo: nada más compite por su presupuesto de
 * atención, así que el depth del décimo archivo iguala al del primero.
 *
 * @param files - Los archivos del PR.
 * @param model - El puerto de review.
 * @returns Un texto de review por archivo.
 */
export async function perFileReview(
  files: readonly PrFile[],
  model: ReviewModel,
): Promise<readonly string[]> {
  return Promise.all(
    files.map((file) =>
      model.review(
        `Review this file for bugs, security issues, and logic errors:\n\n${file.content}`,
      ),
    ),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 3 — La pasada de integración cross-file
//
// Why: el análisis per-file atrapa lo local y se pierde lo cross-file: data flow
//      entre módulos, uso de API consistente y contradicciones entre los propios
//      findings. La integración es una invocación separada que recibe todos los
//      findings.
// You should see: problemas que ningún review de un solo archivo podría atrapar:
//      datos pasados entre módulos en formatos incompatibles, findings
//      contradictorios, contratos de API violados entre servicios.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compone el prompt de la pasada de integración.
 *
 * @param perFileFindings - Los findings de la pasada per-file.
 * @returns El prompt de integración.
 */
export function integrationPrompt(perFileFindings: readonly Finding[]): string {
  return [
    "Given these per-file review findings, identify cross-file issues:",
    "- Data flow inconsistencies between modules",
    "- Contradictory patterns flagged differently in different files",
    "- API contract violations across service boundaries",
    "",
    `Per-file findings:\n${JSON.stringify(perFileFindings, null, 2)}`,
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 4 — Scoring de confianza y ruteo
//
// Why: el ruteo por confianza dirige la atención limitada de los reviewers humanos
//      a los findings que más la necesitan. El examen distingue la confianza cruda
//      sin calibrar de un umbral validado contra un set etiquetado.
// You should see: cada finding con su score, su reasoning y su decisión de ruteo.
// ─────────────────────────────────────────────────────────────────────────────

/** Umbral de ruteo de partida, antes de calibrar. */
export const BASELINE_ROUTING_THRESHOLD = 0.8;

/**
 * Rutea un finding según su confianza.
 *
 * Ojo: el umbral es un PLACEHOLDER hasta que la calibración (Paso 5) lo fije desde
 * datos etiquetados — un score auto-reportado no es una señal de ruteo por sí solo.
 *
 * @param finding - El finding.
 * @param threshold - El umbral calibrado.
 * @returns El finding con su ruta.
 */
export function routeFinding(finding: Finding, threshold: number): RoutedFinding {
  return {
    ...finding,
    route: finding.confidence >= threshold ? "direct_report" : "human_review",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 5 — Una instancia independiente calibra la confianza
//
// Why: las instancias independientes se acercan al output sin el sesgo de "elegí
//      esto porque…". Este paso calibra el umbral comparando la confianza
//      auto-reportada contra una evaluación independiente.
// You should see: un dataset de calibración que relaciona confianza reportada con
//      verificación independiente; algunos findings de alta confianza se caen.
// ─────────────────────────────────────────────────────────────────────────────

/** Una observación para la curva de calibración. */
interface CalibrationObservation {
  readonly reportedConfidence: number;
  readonly independentlyCorrect: boolean;
}

/** Una banda de la curva: confianza reportada vs accuracy real. */
interface CalibrationBand {
  readonly min: number;
  readonly max: number;
  readonly reported: number;
  readonly confirmed: number;
  readonly accuracy: number;
}

/** Las bandas del ejercicio. */
const CALIBRATION_BANDS: readonly { readonly min: number; readonly max: number }[] = [
  { min: 0.6, max: 0.7 },
  { min: 0.7, max: 0.8 },
  { min: 0.8, max: 0.9 },
  { min: 0.9, max: 1.01 },
];

/**
 * Construye la curva de calibración.
 *
 * Un score crudo reporta cuán seguro se siente el modelo, que no es lo mismo que
 * cuán a menudo acierta. Solo corriendo ejemplos etiquetados y observando cómo se
 * relacionan los dos se convierte el score en algo seguro contra lo que automatizar.
 *
 * @param observations - Las observaciones con su verificación independiente.
 * @returns Una banda por rango de confianza, con su accuracy real.
 */
export function buildCalibrationCurve(
  observations: readonly CalibrationObservation[],
): readonly CalibrationBand[] {
  return CALIBRATION_BANDS.map((band) => {
    const inBand = observations.filter(
      (observation) =>
        observation.reportedConfidence >= band.min &&
        observation.reportedConfidence < band.max,
    );
    const confirmed = inBand.filter((observation) => observation.independentlyCorrect).length;
    return {
      min: band.min,
      max: band.max,
      reported: inBand.length,
      confirmed,
      accuracy: inBand.length === 0 ? 0 : confirmed / inBand.length,
    };
  });
}

/**
 * Deriva el umbral desde la curva.
 *
 * Toma la banda MÁS BAJA cuya accuracy real supere el objetivo: ahí es donde la
 * confianza reportada empieza a seguir de verdad a la corrección.
 *
 * @param curve - La curva de calibración.
 * @param minAccuracy - La accuracy mínima para rutear directo.
 * @returns El umbral calibrado.
 */
export function calibratedThreshold(
  curve: readonly CalibrationBand[],
  minAccuracy: number,
): number {
  const band = curve.find((entry) => entry.reported > 0 && entry.accuracy >= minAccuracy);
  return band?.min ?? 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Extra — La arquitectura completa y por qué la independencia importa
//
// Why: las tres ideas se combinan en una arquitectura de producción, y la
//      independencia descansa en la misma propiedad de aislamiento que hace
//      útiles a los subagentes.
// You should see: cada etapa con su rol y si exige contexto fresco.
// ─────────────────────────────────────────────────────────────────────────────

/** Las etapas de la arquitectura de review. */
type ReviewStage =
  | "generation"
  | "per_file_review"
  | "integration_review"
  | "confidence_routing"
  | "calibration_loop";

/** Un renglón de la arquitectura. */
interface ArchitectureStage {
  readonly stage: ReviewStage;
  readonly role: string;
  readonly freshContext: boolean;
}

/** La arquitectura del ejercicio. */
export const REVIEW_ARCHITECTURE: readonly ArchitectureStage[] = [
  { stage: "generation", role: "The first instance produces the code, extraction or analysis.", freshContext: false },
  { stage: "per_file_review", role: "Each unit is examined by an instance holding nothing but that unit.", freshContext: true },
  { stage: "integration_review", role: "A further instance looks only for what sits between units.", freshContext: true },
  { stage: "confidence_routing", role: "Whatever falls below the threshold reaches a person.", freshContext: false },
  { stage: "calibration_loop", role: "Labelled data keeps that threshold honest as the system changes.", freshContext: false },
];

/**
 * ¿Esta etapa exige contexto fresco?
 *
 * La revisión pertenece a una sesión que no vio el razonamiento que produjo el
 * artefacto: "a fresh context improves code review since Claude won't be biased
 * toward code it just wrote."
 *
 * @param stage - La etapa.
 * @returns `true` si debe correr sin el contexto de generación.
 */
export function requiresFreshContext(stage: ReviewStage): boolean {
  switch (stage) {
    case "per_file_review":
    case "integration_review":
      return true;
    case "generation":
    case "confidence_routing":
    case "calibration_loop":
      return false;
    default: {
      const exhaustive: never = stage;
      return exhaustive;
    }
  }
}

/** Métodos de verificación, de más fuerte a más débil. */
type VerificationMethod =
  | "independent_instance_refutation"
  | "independent_instance_review"
  | "extended_thinking_same_session"
  | "llm_as_judge";

/**
 * Ranking de métodos de verificación.
 *
 * El más fuerte es un modelo fresco que intenta REFUTAR el resultado; el más débil,
 * LLM-as-judge: "generally not a very robust method, and can have heavy latency
 * tradeoffs."
 *
 * @param method - El método.
 * @returns El ranking, de 1 (mejor) a 4 (peor).
 */
export function verificationRank(method: VerificationMethod): number {
  switch (method) {
    case "independent_instance_refutation":
      return 1;
    case "independent_instance_review":
      return 2;
    case "extended_thinking_same_session":
      return 3;
    case "llm_as_judge":
      return 4;
    default: {
      const exhaustive: never = method;
      return exhaustive;
    }
  }
}

/**
 * ============================================================================
 * ✗ ANTI-PATTERN — Los errores que el examen construye
 * ============================================================================
 */

/** ✗ ANTI-PATTERN 1 — Auto-review en la misma sesión.
 *
 * La sesión conserva el razonamiento que produjo el output, así que cada decisión
 * llega pre-justificada y se defiende en vez de examinarse.
 */
// messages: [gen, asst, "now review your code"]  // pocos findings

/** ✗ ANTI-PATTERN 2 — Arreglar el self-review con más cuidado o más pensamiento.
 *
 * Ni instrucciones más firmes ni extended thinking remueven esa historia: solo una
 * invocación separada, que se encuentra con el artefacto sin nada que defender.
 */
// "Review your code very carefully. Think step by step."  // la justificación sigue ahí

/** ✗ ANTI-PATTERN 3 — Una sola pasada para reviews multi-archivo.
 *
 * La atención se divide entre todo lo que comparte la pasada: depth que decae con
 * la posición, defectos perdidos en el medio y el mismo constructo juzgado distinto
 * en dos archivos.
 */
// review(allTenFilesInOnePrompt);  // f6 sin revisar, f7/f10 con veredictos opuestos

/** ✗ ANTI-PATTERN 4 — Cambiar a un modelo de ventana más grande para la dilución.
 *
 * La capacidad nunca fue lo que falló: más sitio cambia cuánto cabe, no cuán
 * parejo se trata. El fall-off empieza más tarde y sigue llegando.
 */
// switchToBiggerContextWindowModel();  // el bug del f8 sigue perdido

/** ✗ ANTI-PATTERN 5 — Rutear con confianza sin calibrar.
 *
 * Un score crudo reporta cuán seguro se siente el modelo, no cuán a menudo acierta:
 * certeza en findings equivocados, titubeo en los correctos.
 */
// if (finding.confidence >= 0.8) autoMerge();  // número nunca contrastado con la realidad

/** ✗ ANTI-PATTERN 6 — LLM-as-judge como verificación fuerte.
 *
 * Queda cerca del fondo del ranking: "not a very robust method". Y un score de
 * confianza auto-reportado es una forma de que el modelo se juzgue a sí mismo.
 */
// const verdict = await secondModel.judge(finding);  // método débil

/** ✗ ANTI-PATTERN 7 — Per-file passes que reciben el diff completo.
 *
 * Cada llamada "por archivo" recibe todo el diff "para juzgar en contexto": los
 * síntomas no cambian, porque la atención sigue compitiendo con los otros 11
 * archivos.
 */
// for (file of files) review(file, withContext: entireDiff);  // dilución intacta

/**
 * ============================================================================
 * EXAM TRAPS — distractores recurrentes y criterio de rechazo
 * ============================================================================
 *
 * | Trampa                                             | Por qué se rechaza                                  |
 * |----------------------------------------------------|-----------------------------------------------------|
 * | Self-review en la misma sesión                      | El razonamiento pre-justificado se defiende          |
 * | Una sola pasada para reviews multi-archivo          | La atención se divide; depth y veredictos derivan    |
 * | Ventana de contexto más grande para la dilución     | Más sitio no cambia cuán parejo se trata             |
 * | Confianza sin calibrar para ruteo automático        | El score no se ha contrastado nunca con la realidad  |
 *
 * QUICK REFERENCE — datos de la fuente
 *
 *   Principio documentado ... "A fresh context improves code review since Claude won't be
 *                              biased toward code it just wrote"
 *   Patrón Writer/Reviewer .. A genera → B revisa (fresco) → A atiende el feedback
 *   Qué ve un reviewer adversario ... solo el diff y los criterios, nunca el razonamiento
 *   Verificación por refutación ... un modelo fresco intenta REFUTAR, no solo re-confirmar
 *   Base arquitectónica ...... aislamiento de contexto de subagentes (ventanas aisladas)
 *   Método más débil ......... LLM-as-judge — "not a very robust method"
 *   Síntomas de dilución ..... depth inconsistente, bugs perdidos en el medio, findings
 *                               contradictorios
 *   Fix de la dilución ....... per-file passes + una pasada de integración — NO una ventana mayor
 *   Por qué no lo arregla la ventana ... el problema es la calidad de la atención, no la capacidad
 *   Ruteo por confianza ...... alta → reporte directo; baja → revisión humana
 *   Confianza cruda .......... sin calibrar — una forma de que el modelo se juzgue solo
 *   Método de calibración .... comparar la confianza reportada contra sets validados etiquetados
 *   Principio de evaluación .. juzgar si se alcanzó el estado final correcto, no el proceso
 *   Rúbrica de LLM-judge ..... factual accuracy, citation accuracy, completeness,
 *                               source quality, tool efficiency
 *   Set de eval inicial ...... ~20 queries representativas
 *   Testing manual ........... sigue siendo esencial; atrapa edge cases que los evals no ven
 *
 * ============================================================================
 * FLUJO DE EJECUCIÓN ESPERADO  (trace ilustrativo — no se ejecuta)
 * ============================================================================
 *
 * [Paso 1] detectDilution(SINGLE_PASS_DEPTH)
 *   → ["Inconsistent depth across files.",
 *      "Planted bug missed in a middle file.",     ← SQL injection en f6
 *      "Same construct judged differently in two files."]
 *   Una sola pasada sobre 10 archivos: f1 y f10 detallados, f2–f9 superficiales
 *
 * [Paso 2] perFileReview(MOCK_PR_FILES, model)
 *   → 10 reviews en paralelo, cada uno con SOLO su archivo
 *   ✅ depth uniforme; el bug de f6 se atrapa
 *
 * [Paso 3] integrationPrompt(perFileFindings)
 *   → "Given these per-file findings, identify cross-file issues: …"
 *   ✅ data flow entre módulos, contradicciones entre findings, contratos de API
 *
 * [Paso 4] routeFinding({ confidence: 0.65, … }, 0.80)
 *   → { route: "human_review" }
 *   routeFinding({ confidence: 0.92, … }, 0.80)
 *   → { route: "direct_report" }
 *
 * [Paso 5] buildCalibrationCurve(observations)
 *   → [ { min: 0.6, max: 0.7, accuracy: 0.35 },
 *       { min: 0.7, max: 0.8, accuracy: 0.62 },
 *       { min: 0.8, max: 0.9, accuracy: 0.88 },
 *       { min: 0.9, max: 1.0, accuracy: 0.93 } ]
 *   calibratedThreshold(curve, 0.90) → 0.9   ← donde la confianza ya sigue a la accuracy
 *   ✅ algunos findings de 0.90 pueden caerse: la confianza cruda estaba mal calibrada
 *
 * requiresFreshContext("per_file_review") → true
 * verificationRank("independent_instance_refutation") → 1
 * verificationRank("llm_as_judge") → 4
 *
 * ANTI-PATRÓN: el reviewer se reconstruyó para hacer una llamada por archivo, pero
 * cada llamada recibe el diff COMPLETO "para juzgar en contexto". Los síntomas no
 * cambian: el depth decae tras los primeros archivos, el defecto del medio se
 * vuelve a perder y el mismo helper saca veredictos opuestos. El fix no es instruir
 * al reviewer a ponderar el archivo nombrado, ni subir `max_tokens`, ni ordenar por
 * tamaño: es darle a cada llamada SOLO su archivo y dejar lo cross-file a la pasada
 * de integración.
 */
