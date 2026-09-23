/**
 * ============================================================================
 * DOMINIO 4 · TASK STATEMENT 4.2 — Few-Shot Prompting
 * ----------------------------------------------------------------------------
 * Objetivo oficial:
 *   Apply few-shot prompting to improve output consistency and quality.
 *
 * Qué evalúa el examen aquí:
 *   Para output consistente y bien formateado, nada supera a los few-shot
 *   examples. Ni instrucciones más largas, ni umbrales de confianza, ni ajustes de
 *   temperature. Donde la queja es inconsistencia, los ejemplos son lo primero a
 *   lo que se recurre, no lo último. Y la regla que casi todos pasan por alto:
 *   cada ejemplo lleva input, output **y reasoning** — un par input-output enseña
 *   la instancia; el reasoning enseña la regla, que es lo que permite generalizar a
 *   un caso que los ejemplos nunca cubrieron.
 *
 * Build Exercise: Build a Few-Shot Enhanced Extraction Prompt
 *                 (Intermediate · 45 min)
 * ============================================================================
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tipos del few-shot
// ─────────────────────────────────────────────────────────────────────────────

/** Un few-shot example: la unidad que enseña. */
interface FewShotExample {
  readonly structure: "table" | "narrative" | "mixed";
  readonly input: string;
  readonly output: Readonly<Record<string, unknown>>;
  /** Sin esto, el ejemplo enseña la instancia y no la regla. */
  readonly reasoning: string;
}

/**
 * La técnica que corresponde a cada problema.
 *
 * Few-shot arregla CONSISTENCIA — formato variable, judgement ambiguo, variedad
 * estructural — no todo problema que parece inconsistencia.
 */
type Technique =
  | "few_shot_examples"
  | "tool_use_json_schema"
  | "nullable_schema_fields"
  | "better_tool_descriptions"
  | "validation_retry_loop";

/** Problemas que el examen ofrece como distractores de "usar few-shot". */
type ExtractionProblem =
  | "output_shape_changes_between_runs"
  | "json_will_not_parse"
  | "missing_values_filled_with_inventions"
  | "wrong_tool_keeps_being_chosen"
  | "data_in_prose_returned_empty"
  | "line_items_do_not_add_up_to_total";

// ─────────────────────────────────────────────────────────────────────────────
// Paso 1 — Prompt base con instrucciones detalladas, sin ejemplos
//
// Why: establecer el baseline demuestra el problema de consistencia. Las
//      instrucciones detalladas solas producen output inconsistente en estructuras
//      variadas, que es exactamente el trigger para desplegar few-shot.
// You should see: campos extraídos bien de tablas pero vacíos o mal de párrafos
//      narrativos, formatos distintos entre corridas, manejo desigual de edge cases.
// ─────────────────────────────────────────────────────────────────────────────

/** El prompt base del ejercicio: instrucciones detalladas, cero ejemplos. */
export const BASE_EXTRACTION_PROMPT = [
  "Extract the following fields from the document:",
  "- vendor_name: The company or person issuing the document",
  "- document_date: Date in ISO 8601 format",
  "- total_amount: Numeric value without currency symbols",
  "- line_items: Array of {description, amount} objects",
  "",
  "Return as JSON. Ensure all fields are populated.",
].join("\n");

/** Los tres triggers documentados para desplegar few-shot. */
type FewShotTrigger =
  | "inconsistent_formatting_from_detailed_instructions"
  | "ambiguous_judgement_calls"
  | "empty_or_null_fields_for_present_data";

/**
 * ¿Este síntoma es un trigger de few-shot?
 *
 * @param trigger - El síntoma observado.
 * @returns Siempre `true` para los tres triggers documentados.
 */
export function isFewShotTrigger(trigger: FewShotTrigger): boolean {
  switch (trigger) {
    case "inconsistent_formatting_from_detailed_instructions":
    case "ambiguous_judgement_calls":
    case "empty_or_null_fields_for_present_data":
      return true;
    default: {
      const exhaustive: never = trigger;
      return exhaustive;
    }
  }
}

/**
 * Cuántos ejemplos usar.
 *
 * La guía del examen dice 2-4 y esa es la respuesta en el examen. La doc actual de
 * prompting dice "3-5 examples for best results". Los dos rangos se solapan en 3-4
 * y el principio subyacente es idéntico: un puñado de ejemplos afilados y
 * diversos, no un set exhaustivo. Responde 2-4 en el examen; usa 3-5 como default
 * de producción.
 */
export const EXAM_EXAMPLE_RANGE = { min: 2, max: 4 } as const;

/** Rango de la doc actual de producción. */
export const PRODUCTION_EXAMPLE_RANGE = { min: 3, max: 5 } as const;

/**
 * ¿El número de ejemplos establece un patrón sin desperdiciar contexto?
 *
 * Uno es una instancia, no un patrón. Pasado el techo, los casos extra reafirman
 * lo que los anteriores ya establecieron mientras siguen costando contexto — y
 * aplica el "context rot": más tokens en la ventana reduce la capacidad del modelo
 * de recordar con precisión lo que hay en ella.
 *
 * @param count - Número de ejemplos.
 * @param context - Si es para el examen o para producción.
 * @returns `true` si está en el rango.
 */
export function isValidExampleCount(
  count: number,
  context: "exam" | "production",
): boolean {
  const range = context === "exam" ? EXAM_EXAMPLE_RANGE : PRODUCTION_EXAMPLE_RANGE;
  return count >= range.min && count <= range.max;
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 2 — Registrar qué campos fallan en cada estructura
//
// Why: identificar los patrones de fallo concretos dice exactamente qué deben
//      demostrar los ejemplos. El examen testea que diagnostiques antes de
//      prescribir.
// You should see: una tabla de qué campo falla en qué tipo de documento —
//      fechas bien en tablas y mal en narrativa, montos inconsistentes en palabras,
//      line items vacíos cuando van embebidos en párrafos.
// ─────────────────────────────────────────────────────────────────────────────

/** Resultado de extraer un documento. */
interface ExtractionResult {
  readonly documentType: "table" | "narrative" | "mixed";
  readonly fieldStates: Readonly<Record<string, "extracted" | "EMPTY">>;
  readonly formatConsistent: boolean;
}

/**
 * Agrupa los fallos por campo, para ver el patrón estructural.
 *
 * @param results - Los resultados del baseline.
 * @returns Qué documentos fallan en cada campo.
 */
export function failuresByField(
  results: readonly ExtractionResult[],
): Readonly<Record<string, readonly string[]>> {
  const byField: Record<string, string[]> = {};
  for (const result of results) {
    for (const [field, state] of Object.entries(result.fieldStates)) {
      if (state === "EMPTY") {
        byField[field] = [...(byField[field] ?? []), result.documentType];
      }
    }
  }
  return byField;
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 3 — Tres ejemplos que atacan los fallos, con reasoning
//
// Why: los ejemplos con reasoning enseñan a generalizar a patrones nuevos, no solo
//      a matchear casos. Sin reasoning, el modelo aprende pattern-matching de
//      superficie. El examen testea específicamente que los ejemplos con reasoning
//      superan a los pares input-output.
// You should see: tres ejemplos, cada uno con una estructura distinta, la
//      extracción correcta Y el reasoning de cómo se localizó el dato.
// ─────────────────────────────────────────────────────────────────────────────

/** Los tres ejemplos del ejercicio: tabla, narrativa y mixta. */
export const FEW_SHOT_EXAMPLES: readonly FewShotExample[] = [
  {
    structure: "table",
    input: "| Item | Amount |\n| Widget | 50.00 |",
    output: {
      vendor_name: null,
      document_date: null,
      total_amount: 50.0,
      line_items: [{ description: "Widget", amount: 50.0 }],
    },
    reasoning:
      "Amounts sit in an Amount column, one row per line item. The total is the sum of the rows. No vendor name or date appears in the table, so both are null rather than guessed.",
  },
  {
    structure: "narrative",
    input: "We ordered fifty units at ten pounds each on the third of March.",
    output: {
      vendor_name: null,
      document_date: "2024-03-03",
      total_amount: 500.0,
      line_items: [{ description: "units", amount: 500.0 }],
    },
    reasoning:
      "The date is written in natural language (third of March) and converted to ISO 8601. The amount is calculated from quantity (50) times unit price (10). No vendor name is present, so it returns null rather than fabricating one.",
  },
  {
    structure: "mixed",
    input: "We purchased widgets for fifty pounds on March 3rd.\n| Widget | 50.00 |",
    output: {
      vendor_name: null,
      document_date: "2024-03-03",
      total_amount: 50.0,
      line_items: [{ description: "Widget", amount: 50.0 }],
    },
    reasoning:
      "The prose and the table describe the same purchase, so they are not summed. The date is read from the sentence; the amount is taken from the table because it is already numeric.",
  },
];

/**
 * ¿El ejemplo enseña la regla o solo la instancia?
 *
 * Un par input-output registra una decisión; no transmite por qué esa decisión le
 * ganó a las alternativas. El reasoning es lo que deja al modelo aplicar el mismo
 * principio a un caso que los ejemplos nunca cubrieron.
 *
 * @param example - El ejemplo.
 * @returns `true` si lleva reasoning.
 */
export function teachesPrinciple(example: FewShotExample): boolean {
  return example.reasoning.trim().length > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 4 — Re-correr y comparar
//
// Why: cuantificar la mejora demuestra que few-shot es la técnica de primera
//      elección para problemas de consistencia. El examen espera que sepas que
//      few-shot supera a instrucciones adicionales en esta clase de problema.
// You should see: menos campos vacíos (sobre todo en narrativa), mejor consistencia
//      de formato, y mayor accuracy — con la mejora más marcada en los tipos que
//      antes fallaban.
// ─────────────────────────────────────────────────────────────────────────────

/** Métricas de una corrida de extracción. */
interface ExtractionRun {
  readonly emptyFieldRate: number;
  readonly formatConsistency: number;
  readonly accuracy: number;
}

/** La comparación baseline vs few-shot del ejercicio. */
export const EXTRACTION_COMPARISON: { readonly baseline: ExtractionRun; readonly fewShot: ExtractionRun } = {
  baseline: { emptyFieldRate: 0.35, formatConsistency: 0.6, accuracy: 0.72 },
  fewShot: { emptyFieldRate: 0.08, formatConsistency: 0.92, accuracy: 0.91 },
};

/**
 * Delta de mejora entre dos corridas.
 *
 * La tasa de campos vacíos baja; consistencia y accuracy suben.
 *
 * @param baseline - La corrida sin ejemplos.
 * @param fewShot - La corrida con ejemplos.
 * @returns Los tres deltas, en puntos.
 */
export function extractionImprovement(
  baseline: ExtractionRun,
  fewShot: ExtractionRun,
): { readonly emptyFieldDelta: number; readonly consistencyDelta: number; readonly accuracyDelta: number } {
  return {
    emptyFieldDelta: baseline.emptyFieldRate - fewShot.emptyFieldRate,
    consistencyDelta: fewShot.formatConsistency - baseline.formatConsistency,
    accuracyDelta: fewShot.accuracy - baseline.accuracy,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 5 — Qué patrón se arregla con few-shot y qué necesita otra técnica
//
// Why: el examen testea que emparejes la técnica correcta con el problema. Few-shot
//      arregla consistencia y variedad estructural, pero el JSON malformado necesita
//      `tool_use`, los valores fabricados necesitan campos nullable, y las sumas que
//      no cuadran necesitan un validation-retry loop.
// You should see: una matriz de decisión que separa lo que few-shot arregla de lo
//      que necesita otra intervención.
// ─────────────────────────────────────────────────────────────────────────────

/** Un renglón de la matriz de decisión. */
interface TechniqueMapping {
  readonly problem: ExtractionProblem;
  readonly technique: Technique;
  readonly fewShotHelps: boolean;
}

/** La matriz del ejercicio. */
export const TECHNIQUE_MATRIX: readonly TechniqueMapping[] = [
  { problem: "output_shape_changes_between_runs", technique: "few_shot_examples", fewShotHelps: true },
  { problem: "data_in_prose_returned_empty", technique: "few_shot_examples", fewShotHelps: true },
  { problem: "missing_values_filled_with_inventions", technique: "nullable_schema_fields", fewShotHelps: false },
  { problem: "json_will_not_parse", technique: "tool_use_json_schema", fewShotHelps: false },
  { problem: "wrong_tool_keeps_being_chosen", technique: "better_tool_descriptions", fewShotHelps: false },
  { problem: "line_items_do_not_add_up_to_total", technique: "validation_retry_loop", fewShotHelps: false },
];

/**
 * La técnica correcta para cada problema.
 *
 * Ojo con el orden en "wrong_tool_keeps_being_chosen": primero mejores
 * descripciones de tool, y solo después few-shot.
 *
 * @param problem - El problema observado.
 * @returns La técnica correcta.
 */
export function techniqueFor(problem: ExtractionProblem): Technique {
  const mapping = TECHNIQUE_MATRIX.find((entry) => entry.problem === problem);
  return mapping?.technique ?? "few_shot_examples";
}

/**
 * Para tareas de clasificación, empareja los ejemplos con un enum.
 *
 * "For classification tasks, use either tools with an enum field containing your
 * valid labels or structured outputs." Los few-shot enseñan qué etiqueta es
 * correcta en casos ambiguos; el enum garantiza que el modelo solo pueda emitir una
 * de tus etiquetas definidas. Las dos técnicas resuelven mitades distintas del
 * mismo problema: judgement y estructura.
 *
 * @param labels - Las etiquetas válidas.
 * @returns El enum que va en el `input_schema` de la tool.
 */
export function classificationEnum(labels: readonly string[]): readonly string[] {
  return labels;
}

/**
 * ============================================================================
 * ✗ ANTI-PATTERN — Los errores que el examen construye
 * ============================================================================
 */

/** ✗ ANTI-PATTERN 1 — "Add more detailed instructions" ante formato inconsistente.
 *
 * Si ya hay instrucciones exhaustivas y la forma sigue variando, la especificación
 * nunca fue la restricción: agregar más no cambia nada.
 */
// prompt += "\nReturn a markdown table with columns…"  // sigue variando

/** ✗ ANTI-PATTERN 2 — Ejemplos sin reasoning.
 *
 * Un par input-output enseña la instancia y nada más: aplicado a un caso nuevo, el
 * modelo no tiene principio que extender y la decisión es una apuesta.
 */
// { input: "…order #48802?", output: "lookup_order" }  // sin por qué

/** ✗ ANTI-PATTERN 3 — Ocho o diez ejemplos "para ser exhaustivo".
 *
 * No solo desperdicia tokens: el context rot dice que más tokens en la ventana
 * reducen la capacidad de recordar con precisión, así que diluye la atención sobre
 * el patrón que de verdad necesitas que aprenda.
 */
// examples.push(...tenExamples);  // fewer, sharper, more diverse beats more

/** ✗ ANTI-PATTERN 4 — Ejemplos estrechos (todos tablas).
 *
 * Un set de ejemplos casi idénticos enseña un patrón estrecho; cuando llega un
 * documento narrativo, el modelo trata el layout desconocido como ausencia de dato
 * y devuelve el campo vacío — o se inventa una cifra plausible.
 */
// examples = [tableExample, tableExample, tableExample];  // narrative ⇒ null

/** ✗ ANTI-PATTERN 5 — Few-shot para JSON malformado o valores fabricados.
 *
 * El JSON que no parsea necesita `tool_use` con schema; los valores inventados para
 * campos ausentes necesitan campos nullable; las sumas que no cuadran necesitan un
 * validation-retry loop. Few-shot no arregla ninguno.
 */
// jsonBroken → addFewShotExamples();   // técnica equivocada

/** ✗ ANTI-PATTERN 6 — Umbrales de confianza para judgement inconsistente.
 *
 * Un umbral filtra output sin atacar por qué el juicio varió, y la confianza
 * auto-reportada está mal calibrada para filtrar con ella.
 */
// if (confidence > 0.8) keepVerdict();  // no arregla la variación

/**
 * ============================================================================
 * EXAM TRAPS — distractores recurrentes y criterio de rechazo
 * ============================================================================
 *
 * | Trampa                                             | Por qué se rechaza                                  |
 * |----------------------------------------------------|-----------------------------------------------------|
 * | "Add more detailed instructions"                   | La spec no era la restricción; ejemplos sí          |
 * | Creer que few-shot solo enseña pattern-matching    | Cierto de pares pelados; el reasoning generaliza     |
 * | Umbrales de confianza para judgement inconsistente | Filtran sin atacar la causa; mal calibrados         |
 *
 * QUICK REFERENCE — datos de la fuente
 *
 *   Mejor técnica para formato inconsistente ... few-shot examples (no más instrucciones)
 *   Cantidad de ejemplos ....................... 2-4 targeted (examen); 3-5 (docs actuales)
 *   Menos de 2 ................................. no establece un patrón
 *   Más de 4 ................................... desperdicia tokens; riesgo de context rot
 *   Cada ejemplo incluye ....................... input, output Y reasoning
 *   Ejemplos sin reasoning ..................... enseñan pattern-matching literal
 *   Ejemplos con reasoning ..................... enseñan principios generalizables
 *   Framing de Anthropic ....................... "pictures worth a thousand words" — diversos, canónicos
 *   No recomendado ............................. meter una laundry list de edge cases
 *   Clasificación .............................. emparejar few-shot con enum de tool / structured outputs
 *   JSON malformado ............................ `tool_use` con JSON schemas (no few-shot)
 *   Valores fabricados ......................... campos optional/nullable (no few-shot)
 *   Suma no cuadra ............................. validation-retry loop (no few-shot)
 *   Paralelo de delegación ..................... descripciones vagas causan trabajo duplicado
 *   Reducción de hallucination ................. ejemplos de estructuras variadas reducen fabricación
 *
 * ============================================================================
 * FLUJO DE EJECUCIÓN ESPERADO  (trace ilustrativo — no se ejecuta)
 * ============================================================================
 *
 * [Paso 1] BASE_EXTRACTION_PROMPT (instrucciones detalladas, 0 ejemplos)
 *   10 documentos: 3 tablas, 3 narrativos, 4 mixtos
 *   isFewShotTrigger("inconsistent_formatting_from_detailed_instructions") → true
 *   ✗ formato distinto entre corridas; narrativa devuelve campos vacíos
 *
 * [Paso 2] failuresByField(results)
 *   → { total_amount: ["narrative"], document_date: ["narrative"], line_items: ["narrative","mixed"] }
 *   ✅ el patrón es estructural, no aleatorio
 *
 * [Paso 3] FEW_SHOT_EXAMPLES → 3 ejemplos (table, narrative, mixed), cada uno con reasoning
 *   isValidExampleCount(3, "exam")       → true
 *   isValidExampleCount(1, "exam")       → false
 *   isValidExampleCount(8, "exam")       → false
 *   teachesPrinciple(example)            → true
 *   Con el reasoning: "an order number scopes the request…" ⇒ generaliza a un caso nuevo
 *   Sin él: el par pelado enseña solo la instancia
 *
 * [Paso 4] extractionImprovement(baseline, fewShot)
 *   → { emptyFieldDelta: 0.27, consistencyDelta: 0.32, accuracyDelta: 0.19 }
 *   por tipo: table 0.95→0.97 · narrative 0.45→0.85 · mixed 0.60→0.88
 *   ✅ la mejora más marcada cae justo donde antes fallaba
 *
 * [Paso 5] techniqueFor("data_in_prose_returned_empty")        → "few_shot_examples"
 *          techniqueFor("json_will_not_parse")                  → "tool_use_json_schema"
 *          techniqueFor("missing_values_filled_with_inventions") → "nullable_schema_fields"
 *          techniqueFor("line_items_do_not_add_up_to_total")     → "validation_retry_loop"
 *          classificationEnum(["minor","major","critical"])
 *
 * ANTI-PATRÓN: los tres ejemplos están todos sacados de las facturas tabulares que
 * ya extraen al 97%, y los fallos se concentran en enmiendas manuscritas y montos
 * escritos en palabras. El fix no es subir de tres a ocho ejemplos ni añadir un
 * párrafo de instrucciones: es redibujar los tres ejemplos desde los casos que
 * fallan, con reasoning en cada uno.
 */
