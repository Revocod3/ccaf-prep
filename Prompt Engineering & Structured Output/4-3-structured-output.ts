/**
 * ============================================================================
 * DOMINIO 4 · TASK STATEMENT 4.3 — Structured Output with Tool Use
 * ----------------------------------------------------------------------------
 * Objetivo oficial:
 *   Enforce structured output using tool use and JSON schemas.
 *
 * Qué evalúa el examen aquí:
 *   Donde el requisito es output que conforma a un schema, hay dos enfoques y no
 *   están cerca: `tool_use` con JSON schemas elimina los errores de SINTAXIS JSON
 *   por completo; el JSON pedido por prompt puede venir malformado. Pero cuidado
 *   con la mitad que el examen aprieta: el schema es una afirmación sobre la FORMA,
 *   y la forma calla sobre si los valores son correctos. Sumas que no cuadran,
 *   valores en el campo equivocado y datos inventados producen JSON que valida
 *   perfecto.
 *
 * Build Exercise: Build a Structured Extraction Tool with JSON Schema
 *                 (Intermediate · 45 min)
 * ============================================================================
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tipos del contrato de extracción
// ─────────────────────────────────────────────────────────────────────────────

/** Tipo de una propiedad: un tipo simple o una unión con null (nullable). */
type PropertyType = string | readonly string[];

interface JsonSchemaProperty {
  readonly type: PropertyType;
  readonly description?: string;
  readonly enum?: readonly (string | number | boolean | null)[];
}

/** El `input_schema` de una tool de extracción. */
interface ExtractionSchema {
  readonly type: "object";
  readonly properties: Readonly<Record<string, JsonSchemaProperty>>;
  /**
   * Solo campos SIEMPRE presentes. Un campo requerido es una exigencia que el
   * modelo satisfará inventando si no hay dato; uno nullable permite un null
   * honesto.
   */
  readonly required: readonly string[];
  /** En structured outputs debe ser `false`; cualquier otro valor se rechaza. */
  readonly additionalProperties: false;
}

interface ExtractionTool {
  readonly name: string;
  readonly description: string;
  readonly input_schema: ExtractionSchema;
}

/** Los cuatro valores de `tool_choice`. */
type StructuralToolChoice =
  | { readonly type: "auto" }
  | { readonly type: "any" }
  | { readonly type: "tool"; readonly name: string }
  | { readonly type: "none" };

// ─────────────────────────────────────────────────────────────────────────────
// Paso 1 — Definir la tool con 3 requeridos, 3 nullable, enum + detail
//
// Why: el diseño del schema previene la fabricación directamente. Los campos
//      requeridos presionan al modelo a inventar cuando falta información; los
//      optional/nullable permiten un null honesto. Es el fix de causa raíz.
// You should see: `required` solo con los 3 siempre presentes, tipos nullable para
//      los opcionales, y el enum con `unclear` y `other` junto a las categorías.
// ─────────────────────────────────────────────────────────────────────────────

/** La tool de extracción del ejercicio. */
export const EXTRACT_DOCUMENT_TOOL: ExtractionTool = {
  name: "extract_document",
  description: "Extract structured data from a document.",
  input_schema: {
    type: "object",
    properties: {
      invoice_number: { type: "string" },
      vendor_name: { type: "string" },
      document_date: { type: "string", description: "ISO 8601 format" },
      // Nullable, no requeridos: un campo requerido presiona al modelo a
      // inventar un valor que no puede encontrar.
      payment_terms: { type: ["string", "null"] },
      purchase_order: { type: ["string", "null"] },
      tax_id: { type: ["string", "null"] },
      category: {
        type: "string",
        // `unclear` da a un caso genuinamente ambiguo dónde ir; sin él, el modelo
        // debe elegir una categoría definida, convirtiendo incertidumbre en una
        // respuesta de aspecto seguro.
        enum: ["invoice", "receipt", "contract", "unclear", "other"],
      },
      category_detail: {
        type: ["string", "null"],
        // `other` + detail: los casos fuera de la taxonomía se registran en vez
        // de forzarse a la aproximación más cercana.
        description: "Freeform detail when category is 'other'",
      },
    },
    required: ["invoice_number", "vendor_name", "document_date"],
    additionalProperties: false,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Paso 2 — `tool_choice: "auto"` deja que devuelva texto
//
// Why: el examen testea la distinción entre auto, any y forced. Auto permite al
//      modelo responder conversacionalmente en vez de llamar a la tool, así que no
//      hay output estructurado garantizado. Hay que verlo en primera persona.
// You should see: al menos una respuesta donde el modelo describe el documento en
//      texto en vez de llamar a la tool: `stop_reason` = `end_turn`.
// ─────────────────────────────────────────────────────────────────────────────

/** Resultado observable de una corrida de extracción. */
type ExtractionStopReason = "tool_use" | "end_turn";

/** Qué garantiza cada `tool_choice`. */
export function guaranteeOf(choice: StructuralToolChoice): string {
  switch (choice.type) {
    case "auto":
      return "Model may call a tool or answer in text — structured output NOT guaranteed.";
    case "any":
      return "A tool call is compulsory; which tool stays open.";
    case "tool":
      return `Exactly ${choice.name} is called — no selection, maximum control.`;
    case "none":
      return "No tool calls allowed.";
    default: {
      const exhaustive: never = choice;
      return exhaustive;
    }
  }
}

/** Si el modelo devolvió texto tras un `auto`. */
export function autoReturnedText(choice: StructuralToolChoice, stopReason: ExtractionStopReason): boolean {
  return choice.type === "auto" && stopReason === "end_turn";
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 3 — `tool_choice: "any"` garantiza una llamada a tool
//
// Why: `any` garantiza una tool call mientras deja al modelo elegir cuál. Es el
//      setting correcto para output estructurado garantizado cuando el tipo de
//      documento es desconocido — una distinción clave respecto de `auto`.
// You should see: cada respuesta con `stop_reason` = `tool_use` y un tool call que
//      conforma al schema; ninguna respuesta solo-texto.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Elige la `tool_choice` para extracción.
 *
 * - Paso obligatorio (p. ej. `extract_metadata` antes del enriquecimiento) ⇒ forced.
 * - Output estructurado obligatorio y tipo de documento desconocido ⇒ `any`, que
 *   garantiza la llamada y deja la selección flexible.
 * - Nada obligatorio ⇒ `auto`, donde responder en texto es un resultado legítimo.
 *
 * @param input - Las condiciones de la corrida.
 * @returns La `tool_choice` adecuada.
 */
export function chooseExtractionToolChoice(input: {
  readonly structuredOutputMandatory: boolean;
  readonly documentTypeKnown: boolean;
  readonly mandatoryFirstStep: string | null;
}): StructuralToolChoice {
  if (input.mandatoryFirstStep !== null) {
    return { type: "tool", name: input.mandatoryFirstStep };
  }
  if (!input.structuredOutputMandatory) return { type: "auto" };
  return input.documentTypeKnown
    ? { type: "tool", name: "extract_document" }
    : { type: "any" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 4 — Forzar una tool concreta
//
// Why: la selección forzada asegura que un primer paso obligatorio corra
//      independientemente de la decisión del modelo. El examen lo testea para
//      pasos como extracción de metadata que debe correr antes del enriquecimiento.
// You should see: la respuesta llama siempre exactamente a la tool especificada,
//      aunque el contenido sugiera otra; el modelo no tiene flexibilidad.
// ─────────────────────────────────────────────────────────────────────────────

/** El paso obligatorio del ejercicio. */
export const MANDATORY_FIRST_STEP = "extract_metadata";

// ─────────────────────────────────────────────────────────────────────────────
// Paso 5 — Nullable devuelve null, no valores fabricados
//
// Why: valida el principio de diseño más importante. El examen testea el escenario
//      donde los campos requeridos presionan al modelo a inventar datos de aspecto
//      plausible para información ausente.
// You should see: en los 3 documentos completos, todos los campos correctos; en
//      los 2 con información ausente, los nullable devuelven null.
// ─────────────────────────────────────────────────────────────────────────────

/** Extracción de un documento, con sus campos nullable. */
interface DocumentExtraction {
  readonly documentId: string;
  readonly values: Readonly<Record<string, string | null>>;
}

/** Un documento de prueba: completo o con campos ausentes. */
interface TestDocument {
  readonly documentId: string;
  readonly text: string;
  readonly missingFields: readonly string[];
}

/** Los 5 documentos del ejercicio: 3 completos y 2 con campos ausentes. */
export const EXTRACTION_TEST_DOCUMENTS: readonly TestDocument[] = [
  { documentId: "doc-1", text: "Invoice #1234 from Acme Corp, dated 2024-03-15. PO 8891. Tax GB123. Terms net 30.", missingFields: [] },
  { documentId: "doc-2", text: "Receipt #99 from Bolt Ltd, dated 2024-04-02. PO 7712. Tax GB456. Terms due on receipt.", missingFields: [] },
  { documentId: "doc-3", text: "Contract #7 with Vertex, dated 2024-05-11. PO 3001. Tax GB789. Terms net 60.", missingFields: [] },
  { documentId: "doc-4", text: "Invoice #1234 from Acme Corp, dated 2024-03-15. Total: $500.00", missingFields: ["payment_terms", "tax_id"] },
  { documentId: "doc-5", text: "Receipt #42 from Bolt Ltd, dated 2024-04-02. Total: $20.00", missingFields: ["purchase_order", "tax_id"] },
];

/** El modelo de extracción, como puerto. */
export interface ExtractionModel {
  extract(
    document: TestDocument,
    schema: "nullable" | "all_required",
  ): DocumentExtraction;
}

/**
 * ¿Volvió null un campo que el documento no traía?
 *
 * Con el schema nullable, `null` está disponible y el modelo lo devuelve; con
 * todo requerido, la misma ausencia produce un valor que parece real.
 *
 * @param extraction - El resultado.
 * @param field - El campo a comprobar.
 * @returns `true` si devolvió null.
 */
export function returnedNull(extraction: DocumentExtraction, field: string): boolean {
  return extraction.values[field] === null;
}

/**
 * Cuenta cuántos campos ausentes se devolvieron como null (no inventados).
 *
 * @param extractions - Los resultados.
 * @param documents - Los documentos, con sus campos ausentes.
 * @returns Cuántos campos ausentes volvieron null.
 */
export function honestNullCount(
  extractions: readonly DocumentExtraction[],
  documents: readonly TestDocument[],
): number {
  return extractions.reduce((total, extraction) => {
    const document = documents.find((candidate) => candidate.documentId === extraction.documentId);
    if (document === undefined) return total;
    return (
      total + document.missingFields.filter((field) => returnedNull(extraction, field)).length
    );
  }, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Extra — Lo que el schema NO previene, y las reglas de forma vs convención
//
// Why: el schema remueve fallos de sintaxis y deja intactos los semánticos. Y la
//      normalización de formato va en el PROMPT, porque el schema restringe tipos,
//      no convenciones.
// You should see: la clasificación entre error de sintaxis y error semántico.
// ─────────────────────────────────────────────────────────────────────────────

/** Un error de extracción, sintáctico o semántico. */
type ExtractionError =
  | "unclosed_bracket"
  | "trailing_comma"
  | "unquoted_key"
  | "sum_discrepancy"
  | "field_placement"
  | "fabrication";

/**
 * Clasifica un error de extracción.
 *
 * El schema elimina los tres sintácticos por completo; los tres semánticos pasan
 * la validación sin problema.
 *
 * @param error - El error.
 * @returns Si es de sintaxis o semántico.
 */
export function errorClass(error: ExtractionError): "syntax" | "semantic" {
  switch (error) {
    case "unclosed_bracket":
    case "trailing_comma":
    case "unquoted_key":
      return "syntax";
    case "sum_discrepancy":
    case "field_placement":
    case "fabrication":
      return "semantic";
    default: {
      const exhaustive: never = error;
      return exhaustive;
    }
  }
}

/**
 * ¿El schema previene este error?
 *
 * @param error - El error.
 * @returns `true` solo para los de sintaxis.
 */
export function preventedBySchema(error: ExtractionError): boolean {
  return errorClass(error) === "syntax";
}

/** Lo que un schema de structured outputs NO puede expresar. */
export const UNSUPPORTED_SCHEMA_FEATURES: readonly string[] = [
  "Recursive schemas",
  "External $ref",
  "Numerical constraints (minimum, maximum, multipleOf)",
  "String constraints (minLength, maxLength)",
];

/**
 * Valida las restricciones del schema de structured outputs.
 *
 * `additionalProperties` debe ser `false` para objetos: cualquier otro valor se
 * rechaza.
 *
 * @param input - Las condiciones a comprobar.
 * @returns Si el schema es aceptable y qué problemas tiene.
 */
export function structuredOutputsSchemaOk(input: {
  readonly additionalProperties: boolean | undefined;
  readonly usesUnsupportedFeature: boolean;
}): { readonly ok: boolean; readonly issues: readonly string[] } {
  const issues: string[] = [];
  if (input.additionalProperties !== false) {
    issues.push("additionalProperties must be false for objects.");
  }
  if (input.usesUnsupportedFeature) {
    issues.push(...UNSUPPORTED_SCHEMA_FEATURES);
  }
  return { ok: issues.length === 0, issues };
}

/**
 * ¿Hace falta `strict: true` para la garantía doble?
 *
 * `tool_choice: "any"` solo fuerza una tool call; sin `strict: true` el input JSON
 * puede satisfacer técnicamente un schema no validado. Combinar `any` con
 * `strict: true` garantiza ambas cosas: que se llama una tool Y que su input sigue
 * estrictamente el schema.
 *
 * @param choice - La `tool_choice`.
 * @returns `true` si conviene añadir `strict: true`.
 */
export function needsStrictForDoubleGuarantee(choice: StructuralToolChoice): boolean {
  return choice.type === "any" || choice.type === "tool";
}

/**
 * ============================================================================
 * ✗ ANTI-PATTERN — Los errores que el examen construye
 * ============================================================================
 */

/** ✗ ANTI-PATTERN 1 — "Please respond in JSON format".
 *
 * No ofrece ninguna garantía estructural: a volumen de producción, devuelve
 * periódicamente algo que no parsea.
 */
// "Please respond in JSON format."  // unclosed bracket, trailing comma…

/** ✗ ANTI-PATTERN 2 — Marcar todos los campos como requeridos.
 *
 * No hace que la fuente contenga más; le quita al modelo la capacidad de decir que
 * no está. Ante un campo obligatorio y sin evidencia, se produce algo plausible.
 */
// required: ["invoice_number", "vendor_name", "payment_terms", "tax_id"]  // inventa

/** ✗ ANTI-PATTERN 3 — `tool_choice: "auto"` cuando el structured output es obligatorio.
 *
 * Bajo `auto` el modelo puede responder en texto, así que el item no tiene garantía.
 */
// tool_choice: { type: "auto" }  // puede devolver end_turn con prosa

/** ✗ ANTI-PATTERN 4 — Confundir `auto` con `any`.
 *
 * `any` fuerza una tool call dejando abierta la elección de tool — justo lo que
 * necesita un tipo de documento desconocido.
 */
// "any means the model can skip the tool"  // no: lo obliga

/** ✗ ANTI-PATTERN 5 — Creer que el schema previene todo error de extracción.
 *
 * Sumas que no reconcilian, valores en el campo equivocado y cifras inventadas
 * producen JSON perfectamente válido.
 */
// if (validJson) return "data is correct";  // needs validation logic of its own

/** ✗ ANTI-PATTERN 6 — Meter las reglas de formato en el schema.
 *
 * La consistencia de formato va en el prompt: el schema restringe tipos, no
 * convenciones.
 */
// { "type": "string", "format": "ISO 8601 with no time component" }  // no es asunto del schema

/** ✗ ANTI-PATTERN 7 — Prefill del turno del assistant para forzar JSON.
 *
 * Descrito como técnica histórica, con sucesor claro (Structured Outputs). Y ya no
 * solo se desaconseja: en modelos Claude 4.6+ y Mythos Preview, un mensaje
 * assistant prefijado en el último turno devuelve un 400.
 */
// messages.push({ role: "assistant", content: "{" });  // 400 en modelos nuevos

/**
 * ============================================================================
 * EXAM TRAPS — distractores recurrentes y criterio de rechazo
 * ============================================================================
 *
 * | Trampa                                             | Por qué se rechaza                                  |
 * |----------------------------------------------------|-----------------------------------------------------|
 * | Creer que el schema previene todo error             | Actúa sobre la forma; lo semántico queda intacto    |
 * | Confundir `auto` con `any`                          | `auto` puede responder en texto; `any` obliga       |
 * | Marcar todo `required` para asegurar completitud    | No añade datos; solo quita el null honesto          |
 *
 * QUICK REFERENCE — datos de la fuente
 *
 *   Valores de tool_choice .... `auto` (default con tools), `any`, `tool` (forzado),
 *                               `none` (default sin tools)
 *   Garantía de `any` solo .... se llama una tool, NO que su input siga el schema
 *   Garantía de `any` + strict  se llama una tool Y su input sigue estrictamente el schema
 *   Structured Outputs ........ `output_config.format` — JSON plano por constrained
 *                               decoding, sin tool call; GA en Claude 4.5+
 *   additionalProperties ...... debe ser `false` para objetos; otro valor se rechaza
 *   No soportado .............. recursive schemas, external `$ref`,
 *                               minimum/maximum/multipleOf, minLength/maxLength
 *   enum permitido ............ strings, numbers, booleans, nulls — sin tipos complejos
 *   Primer uso de un schema ... latencia extra mientras compila la grammar
 *   Caché de grammar .......... 24h desde el último uso; se invalida al cambiar schema o tools
 *   Coste de structured out ... añade un system prompt oculto: input tokens algo más altos siempre
 *   Prefill (4.6+/Mythos) ..... 400 error en el último turno assistant; sucesor: Structured Outputs
 *   Prefill del lado API ...... bajo `tool_choice` any/tool sigue activo — suprime el preámbulo
 *   Qué elimina tool_use ...... errores de SINTAXIS JSON (brackets, comas, keys sin comillas)
 *   Qué NO elimina ............ errores semánticos: suma, field placement, fabricación
 *
 * ============================================================================
 * FLUJO DE EJECUCIÓN ESPERADO  (trace ilustrativo — no se ejecuta)
 * ============================================================================
 *
 * [Paso 1] EXTRACT_DOCUMENT_TOOL
 *   required: [invoice_number, vendor_name, document_date]   ← solo los 3 siempre presentes
 *   nullable: [payment_terms, purchase_order, tax_id, category_detail]
 *   category enum: [invoice, receipt, contract, unclear, other]
 *
 * [Paso 2] chooseExtractionToolChoice({ structuredOutputMandatory: false,
 *                                       documentTypeKnown: true, mandatoryFirstStep: null })
 *   → { type: "auto" }
 *   autoReturnedText({ type: "auto" }, "end_turn") → true
 *   ✅ el modelo describe el documento en texto: structured output NO garantizado
 *
 * [Paso 3] chooseExtractionToolChoice({ structuredOutputMandatory: true,
 *                                       documentTypeKnown: false, mandatoryFirstStep: null })
 *   → { type: "any" }        ← tipo desconocido: garantiza la llamada, elección abierta
 *   guaranteeOf({ type: "any" }) → "A tool call is compulsory; which tool stays open."
 *   stop_reason siempre "tool_use"
 *
 * [Paso 4] chooseExtractionToolChoice({ …, mandatoryFirstStep: "extract_metadata" })
 *   → { type: "tool", name: "extract_metadata" }
 *   needsStrictForDoubleGuarantee({ type: "tool", name: "extract_metadata" }) → true
 *   ✅ paso obligatorio; el modelo no puede elegir otra tool
 *
 * [Paso 5] 5 documentos (3 completos, 2 con campos ausentes)
 *   doc-4 "Invoice #1234 … Total: $500.00"  (sin terms ni tax)
 *     schema nullable      → payment_terms: null, tax_id: null      ✓ honesto
 *     schema all_required  → payment_terms: "net 30", tax_id: "GB000" ✗ inventado
 *   honestNullCount(nullableResults, docs) → 4
 *   honestNullCount(allRequiredResults, docs) → 0
 *
 * errorClass("trailing_comma")  → "syntax"    ← eliminado por el schema
 * errorClass("sum_discrepancy") → "semantic"  ← pasa el schema; necesita validación propia
 * preventedBySchema("fabrication") → false
 *
 * ANTI-PATTERN: pedir JSON en el prompt y parsear el texto directamente. Uno de
 * cada cuarenta documentos falla: una coma final, una comilla sin escapar dentro de
 * un vendor name, un code fence alrededor del objeto. Endurecer la instrucción de
 * formato no elimina la clase de fallo; definir la extracción como una tool y leer
 * del bloque `tool_use` sí.
 */
