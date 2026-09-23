/**
 * ============================================================================
 * DOMINIO 5 · TASK STATEMENT 5.1 — Context Window Management
 * ----------------------------------------------------------------------------
 * Objetivo oficial:
 *   Manage conversation context to preserve critical information across long
 *   interactions.
 *
 * Qué evalúa el examen aquí:
 *   Lo que llega a la ventana de contexto decide si el sistema se sostiene. Y la
 *   trampa central es la **summarisation progresiva**: comprimir turnos viejos
 *   destruye justo las categorías de las que depende un sistema transaccional —
 *   importes, fechas, porcentajes y expectativas que el cliente dijo en voz alta.
 *   El fix es un **case facts block persistente** con los datos transaccionales,
 *   fuera de la historia resumida. Y el resto: la posición importa (lost in the
 *   middle), los tool results hay que recortarlos ANTES de que entren al
 *   historial, y la API no guarda estado.
 *
 * Build Exercise: Build a Persistent Case Facts Context Manager
 *                 (Intermediate · 45 min)
 * ============================================================================
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tipos del case facts block
// ─────────────────────────────────────────────────────────────────────────────

/** Un issue transaccional, con sus datos duros. */
interface CaseIssue {
  readonly orderId: string;
  readonly orderDate: string;
  readonly refundAmount: string;
  readonly status: string;
  readonly itemDescription: string;
}

/** El bloque persistente: nunca se resume, nunca se reescribe por compresión. */
interface CaseFacts {
  readonly customerId: string;
  readonly issues: readonly CaseIssue[];
}

/** Categoría de un dato, para saber qué sobrevive a la summarisation. */
type FactKind =
  | "monetary_amount"
  | "date"
  | "percentage"
  | "identifier"
  | "status"
  | "customer_expectation"
  | "narrative_description";

/** Un mensaje de la conversación. */
interface Message {
  readonly role: "user" | "assistant";
  readonly content: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 1 — El extractor de case facts
//
// Why: el bloque persistente es el patrón más importante del context management.
//      Extraer los hechos transaccionales a un bloque que nunca se resume evita
//      que la summarisation progresiva destruya importes e identificadores.
// You should see: una función que toma el output crudo de una tool y devuelve solo
//      los hechos transaccionales, sin narrativa.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ¿Este dato sobrevive a una summarisation?
 *
 * Resumir es lossy en esta dirección por construcción: los específicos son lo que
 * la compresión remueve. Solo la descripción narrativa sobrevive.
 *
 * @param kind - La categoría del dato.
 * @returns `true` solo para la narrativa.
 */
export function survivesSummarisation(kind: FactKind): boolean {
  switch (kind) {
    case "narrative_description":
      return true;
    case "monetary_amount":
    case "date":
    case "percentage":
    case "identifier":
    case "status":
    case "customer_expectation":
      return false;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/**
 * Extrae los hechos transaccionales de un tool result.
 *
 * @param raw - El resultado crudo de `lookup_order`.
 * @returns El bloque de hechos del issue.
 */
export function extractCaseFacts(raw: Readonly<Record<string, unknown>>): CaseFacts {
  const asString = (value: unknown): string => (typeof value === "string" ? value : "");
  return {
    customerId: asString(raw.customer_id),
    issues: [
      {
        orderId: asString(raw.order_id),
        orderDate: asString(raw.order_date),
        refundAmount: asString(raw.total_amount),
        status: asString(raw.status),
        itemDescription: asString(raw.item_description),
      },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 2 — El bloque persistente, prepuesto a cada prompt
//
// Why: el bloque debe persistir en cada turno pase lo que pase con la historia.
//      Vive fuera de la porción resumida, así que importes, fechas y números de
//      orden sobreviven aunque los turnos viejos se compriman.
// You should see: el bloque arriba de cada mensaje, delimitado con un header.
// ─────────────────────────────────────────────────────────────────────────────

/** El header que separa el bloque de la narrativa. */
export const CASE_FACTS_HEADER = "## Active Case Facts (DO NOT SUMMARISE)";

/**
 * Fusiona hechos nuevos en el bloque, un entry por issue.
 *
 * Re-ejecutar el extractor tras cada tool result reconstruye el bloque: el status
 * de un issue se actualiza y un issue nuevo entra como su propia entrada. Con
 * entradas separadas, el número de orden de un issue no puede migrar a otro
 * durante la compresión — que es como se ve la contaminación cruzada.
 *
 * @param existing - El bloque vigente.
 * @param incoming - Los hechos recién extraídos.
 * @returns El bloque fusionado, con un entry por `orderId`.
 */
export function mergeCaseFacts(existing: CaseFacts, incoming: CaseFacts): CaseFacts {
  const byOrder = new Map<string, CaseIssue>();
  for (const issue of [...existing.issues, ...incoming.issues]) {
    byOrder.set(issue.orderId, issue);
  }
  return { customerId: incoming.customerId, issues: [...byOrder.values()] };
}

/**
 * Construye los mensajes con el bloque de hechos prepuesto.
 *
 * @param caseFacts - El bloque persistente.
 * @param summarisedHistory - La narrativa ya resumida.
 * @param currentMessage - El turno actual.
 * @returns Los mensajes, con el bloque arriba y fuera de lo resumido.
 */
export function buildPrompt(
  caseFacts: CaseFacts,
  summarisedHistory: string,
  currentMessage: string,
): readonly Message[] {
  const block = `${CASE_FACTS_HEADER}\n${JSON.stringify(caseFacts, null, 2)}\n\n`;
  return [
    { role: "user", content: block + summarisedHistory },
    { role: "assistant", content: "I have the case facts and history." },
    { role: "user", content: currentMessage },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 3 — Recortar el tool result ANTES de que entre al historial
//
// Why: un lookup devuelve 40+ campos donde 5 importan. Los otros 35 no cuestan una
//      vez: se reenvían en cada turno siguiente. Hay que recortar antes de que el
//      resultado entre a la conversación, porque después ya no se puede quitar.
// You should see: un trimmer que deja solo los campos relevantes y reduce el
//      resultado un 80-90%.
// ─────────────────────────────────────────────────────────────────────────────

/** Los cinco campos relevantes del flujo de devolución. */
export const RELEVANT_ORDER_FIELDS: readonly string[] = [
  "order_id",
  "order_date",
  "total_amount",
  "return_eligible",
  "item_description",
];

/**
 * Recorta un tool result a los campos relevantes.
 *
 * El lugar correcto es un hook `PostToolUse` o el interior de la propia tool: el
 * requisito es solo que ocurra antes de que el resultado se una a la conversación.
 *
 * @param raw - El resultado crudo.
 * @param relevantFields - Los campos a conservar.
 * @returns El resultado recortado.
 */
export function trimToolResult(
  raw: Readonly<Record<string, unknown>>,
  relevantFields: readonly string[] = RELEVANT_ORDER_FIELDS,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(raw).filter(([key]) => relevantFields.includes(key)),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 4 — Verificar que los hechos sobreviven a la summarisation
//
// Why: valida que el patrón funciona. El examen testea que la summarisation
//      progresiva destruye importes y fechas exactos, y que el bloque es el fix.
// You should see: en un turno posterior a la summarisation, el agente sigue
//      citando $247.83, #8891 y March 3rd desde el bloque; sin él, los pierde.
// ─────────────────────────────────────────────────────────────────────────────

/** El bloque del ejercicio. */
export const DEMO_CASE_FACTS: CaseFacts = {
  customerId: "C-4421",
  issues: [
    {
      orderId: "#8891",
      orderDate: "2024-03-03",
      refundAmount: "$247.83",
      status: "pending_refund",
      itemDescription: "Wireless headphones — defective",
    },
  ],
};

/** La narrativa comprimida: lo que queda tras resumir. */
export const COMPRESSED_NARRATIVE = "Customer wants a refund for a recent order";

/**
 * ¿El bloque conserva un dato que la narrativa perdió?
 *
 * @param caseFacts - El bloque persistente.
 * @param needle - El dato exacto a buscar.
 * @returns `true` si el dato sigue en el bloque.
 */
export function survivesInBlock(caseFacts: CaseFacts, needle: string): boolean {
  return JSON.stringify(caseFacts).includes(needle);
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 5 — Posicionar los key findings al inicio del input agregado
//
// Why: el fix del lost in the middle es estructural, no de prompt. Una instrucción
//      de "atiende todo por igual" es solo más texto compitiendo con el resto.
// You should see: un resumen de key findings arriba, y el detalle bajo headers
//      explícitos, para que los tres sources pesen igual.
// ─────────────────────────────────────────────────────────────────────────────

/** El output de un subagente de investigación. */
interface SourceFinding {
  readonly name: string;
  readonly keyClaim: string;
  readonly fullContent: string;
}

/**
 * Agrega fuentes con los key findings al principio.
 *
 * @param sources - Las fuentes a agregar.
 * @returns El input estructurado.
 */
export function aggregateWithKeyFindings(sources: readonly SourceFinding[]): string {
  const keyFindings = sources.map((source) => `- ${source.name}: ${source.keyClaim}`);
  const detailed = sources.map((source) => `### ${source.name}\n${source.fullContent}`);
  return [
    "## Key Findings Summary",
    keyFindings.join("\n"),
    "",
    "## Detailed Findings",
    "",
    detailed.join("\n\n"),
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Extra — Optimizar el agente upstream: estructura, no prosa
//
// Why: en un pipeline multi-agente, lo que a un agente upstream le parece natural
//      devolver rara vez es lo que el downstream necesita. Las reasoning chains y
//      el contenido crudo llegan a un agente de síntesis cuyo presupuesto es finito,
//      y el razonamiento le es inusable: no puede actuar sobre CÓMO otro agente
//      llegó a una conclusión, solo sobre la conclusión.
// You should see: el upstream devuelve campos con nombre (claim, source,
//      relevanceScore, publicationDate) en vez de prosa y deliberación.
// ─────────────────────────────────────────────────────────────────────────────

/** Un finding estructurado que un agente upstream entrega al downstream. */
interface StructuredFinding {
  readonly claim: string;
  readonly source: string;
  readonly sourceUrl: string;
  readonly relevanceScore: number;
  readonly publicationDate: string;
}

/** La metadata que el downstream necesita para ser preciso, no solo fluido. */
export const REQUIRED_FINDING_METADATA: readonly (keyof StructuredFinding)[] = [
  "claim",
  "source",
  "sourceUrl",
  "relevanceScore",
  "publicationDate",
];

/**
 * ¿El finding trae lo que el downstream necesita?
 *
 * Faltan fechas, ubicaciones de fuente o contexto metodológico y la síntesis deja
 * de ser precisa para volverse solo fluida.
 *
 * @param finding - El finding a comprobar.
 * @returns `true` si están todos los campos requeridos.
 */
export function isDownstreamReady(finding: Partial<StructuredFinding>): boolean {
  return REQUIRED_FINDING_METADATA.every((field) => finding[field] !== undefined);
}

/**
 * Qué tiene que hacer el downstream según lo que le mande el upstream.
 *
 * El ahorro en tokens es el beneficio obvio y NO el mayor: al que le pasas
 * estructura lee campos; al que le pasas prosa los re-deriva, y cada re-derivación
 * es una ocasión de equivocarse.
 *
 * @param mode - Si el upstream manda prosa o estructura.
 * @returns Qué le toca hacer al downstream.
 */
export function downstreamWork(mode: "prose" | "structured"): string {
  return mode === "structured"
    ? "Reads the fields directly — nothing to re-derive."
    : "Re-derives the claim, the source and the figure from prose — each re-derivation risks getting one wrong.";
}

// ─────────────────────────────────────────────────────────────────────────────
// Extra — Economía del contexto: ventana, overflow, caching y compaction
//
// Why: el examen pregunta por el mecanismo, no solo por el patrón: qué cuenta
//      hacia la ventana, qué pasa al desbordarla, y cómo se cachea.
// You should see: la clasificación de overflow y el layout de cache correcto.
// ─────────────────────────────────────────────────────────────────────────────

/** Qué parte de un request cuenta hacia la ventana de contexto. */
type ContextPart =
  | "system_prompt"
  | "messages"
  | "tool_results"
  | "tool_definitions"
  | "output_and_thinking"
  | "cached_prefix";

/**
 * ¿Esta parte cuenta hacia la ventana?
 *
 * Todo cuenta, incluidos los prefijos cacheados: el caching cambia lo que PAGAS
 * por esos tokens, no si ocupan ventana.
 *
 * @param part - La parte del request.
 * @returns `true` para todas.
 */
export function countsTowardWindow(part: ContextPart): boolean {
  switch (part) {
    case "system_prompt":
    case "messages":
    case "tool_results":
    case "tool_definitions":
    case "output_and_thinking":
    case "cached_prefix":
      return true;
    default: {
      const exhaustive: never = part;
      return exhaustive;
    }
  }
}

/** Cómo termina un request que excede la ventana. */
type OverflowOutcome = "400_invalid_request" | "model_context_window_exceeded" | "ok";

/**
 * Clasifica el desbordamiento de la ventana.
 *
 * Si el INPUT solo ya excede la ventana, la API devuelve un 400
 * `invalid_request_error` ("prompt is too long") en todos los modelos, sin
 * truncamiento silencioso. En modelos 4.5+ donde input + `max_tokens` exceden, el
 * request se acepta y, si la generación llega al límite, para con
 * `stop_reason: "model_context_window_exceeded"`.
 *
 * @param input - Los tokens de input, el `max_tokens` y el tamaño de la ventana.
 * @returns El desenlace.
 */
export function classifyOverflow(input: {
  readonly inputTokens: number;
  readonly maxTokens: number;
  readonly windowTokens: number;
  readonly supportsExceededStopReason: boolean;
}): OverflowOutcome {
  if (input.inputTokens > input.windowTokens) return "400_invalid_request";
  if (input.inputTokens + input.maxTokens > input.windowTokens) {
    return input.supportsExceededStopReason ? "model_context_window_exceeded" : "400_invalid_request";
  }
  return "ok";
}

/**
 * Ordena bloques para el prompt caching.
 *
 * El matching corre desde el principio hacia adelante, prefijo a prefijo, así que
 * el layout es decisivo: lo constante primero, con el breakpoint cerrando el
 * bloque estable; lo volátil después. Al revés, un solo token variable delante del
 * bloque estático cambia el prefijo y el beneficio desaparece por completo.
 *
 * @param stableBlocks - Los bloques que no cambian entre requests.
 * @param volatileBlocks - Los que cambian.
 * @returns El orden correcto.
 */
export function cacheFriendlyOrder(
  stableBlocks: readonly string[],
  volatileBlocks: readonly string[],
): readonly string[] {
  return [...stableBlocks, ...volatileBlocks];
}

/** Cuánto dura un breakpoint `ephemeral` desde el último uso. */
export const EPHEMERAL_CACHE_TTL_MINUTES = 5;

/**
 * ============================================================================
 * ✗ ANTI-PATTERN — Los errores que el examen construye
 * ============================================================================
 */

/** ✗ ANTI-PATTERN 1 — Confiar en la summarisation para datos transaccionales.
 *
 * Resumir es lossy en la dirección de los específicos: importes, fechas y
 * identificadores son justo lo que un resumen pierde.
 */
// "refund of $247.83 for order #8891 on March 3rd" → "a refund for a recent order"

/** ✗ ANTI-PATTERN 2 — Arreglar el lost in the middle con una instrucción.
 *
 * "Pay attention to everything below" es solo más texto en el mismo input,
 * compitiendo con todo lo demás.
 */
// "pay attention to everything below"  // el source del medio igual se desvanece

/** ✗ ANTI-PATTERN 3 — Conservar los tool results completos "por si acaso".
 *
 * Un lookup de 40 campos no cuesta una vez: se reenvía en cada turno, así que los
 * 35 irrelevantes se pagan repetidamente.
 */
// messages.push({ role: "user", content: JSON.stringify(raw40FieldResult) });

/** ✗ ANTI-PATTERN 4 — Truncar el historial selectivamente.
 *
 * No hay sesión server-side a la que volver: lo que el request omite, el modelo
 * nunca lo vio. Tirar turnos rompe el hilo en vez de ahorrar barato.
 */
// messages = messages.slice(-4);  // el modelo pierde el hilo

/** ✗ ANTI-PATTERN 5 — Un solo bloque sin entradas por issue.
 *
 * Con un solo entry, el número de orden de un issue puede migrar a otro durante la
 * compresión.
 */
// caseFacts.issues = [singleMergedEntry];  // contaminación cruzada

/** ✗ ANTI-PATTERN 6 — Invertir el orden del prompt caching.
 *
 * Un solo token variable delante del bloque estático cambia el prefijo: nada
 * matchea y cada request paga completo.
 */
// [dynamicUserMessage, LONG_STATIC_REFERENCE]  // el beneficio se anula por completo

/** ✗ ANTI-PATTERN 7 — Mandar la reasoning chain al downstream.
 *
 * El downstream no puede actuar sobre CÓMO otro agente llegó a una conclusión, solo
 * sobre la conclusión — y cada re-derivación desde la prosa es una ocasión de
 * equivocarse.
 */
// findings = upstream.reasoningChain;  // "handed prose, it re-derives"

/**
 * ============================================================================
 * EXAM TRAPS — distractores recurrentes y criterio de rechazo
 * ============================================================================
 *
 * | Trampa                                             | Por qué se rechaza                                  |
 * |----------------------------------------------------|-----------------------------------------------------|
 * | Summarisation progresiva para datos transaccionales | Los específicos son lo que la compresión descarta    |
 * | "Pay attention to everything" para lost-in-middle  | Es más texto compitiendo; el fix es estructural      |
 * | Guardar tool results completos "por si acaso"      | 40 campos se reenvían en cada turno                  |
 * | Truncar el historial selectivamente                | No hay sesión server-side; se rompe el hilo          |
 *
 * QUICK REFERENCE — datos de la fuente
 *
 *   Ventana — Fable 5 / Opus 5 / Sonnet 5 ... 1.000.000 tokens (default, sin beta header)
 *   Ventana — Haiku 4.5 ....... 200.000 tokens
 *   Max output — Fable5/Opus5/Sonnet5 ... 128k tokens (300k vía Batches API beta)
 *   Qué cuenta hacia la ventana  system prompt + todos los mensajes (incl. tool results,
 *                               imágenes, docs) + tool definitions + output (incl. thinking)
 *   Tokens cacheados .......... siguen contando hacia la ventana; el caching cambia el
 *                               coste, no el uso de ventana
 *   Input solo > ventana ...... 400 `invalid_request_error` ("prompt is too long")
 *   Input + max_tokens > ventana (4.5+) ... request aceptado; para con
 *                               `stop_reason: "model_context_window_exceeded"`
 *   Tool para no pasarse ...... Token counting API, `POST /v1/messages/count_tokens`
 *                               (gratis, rate limit separado)
 *   Context rot ............... accuracy y recall degradan al crecer los tokens —
 *                               curar, no solo expandir
 *   Context awareness ......... Sonnet 5/4.6/4.5 y Haiku 4.5 trackean el budget restante
 *   Compaction ................ resumir una conversación cerca del límite y reiniciar;
 *                               riesgo = perder contexto sutil
 *   Compaction más suave ...... tool result clearing
 *   Server-side compaction .... beta, Claude 4.6+
 *   Upstream optimizado ...... devolver datos estructurados (claim, source,
 *                              relevanceScore, publicationDate) en vez de prosa y
 *                              reasoning chains
 *   Beneficio real del upstream  no es el ahorro de tokens: es que el downstream LEE
 *                              campos en vez de re-derivarlos — cada re-derivación es
 *                              una ocasión de equivocarse
 *   Cache ephemeral ........... ~5 minutos desde el último uso
 *
 * ============================================================================
 * FLUJO DE EJECUCIÓN ESPERADO  (trace ilustrativo — no se ejecuta)
 * ============================================================================
 *
 * [Paso 1] survivesSummarisation("monetary_amount") → false
 *          survivesSummarisation("narrative_description") → true
 *   extractCaseFacts(orderLookupResult)
 *   → { customerId: "C-4421", issues: [{ orderId: "#8891",
 *       orderDate: "2024-03-03", refundAmount: "$247.83",
 *       status: "pending_refund", itemDescription: "Wireless headphones — defective" }] }
 *
 * [Paso 2] buildPrompt(caseFacts, COMPRESSED_NARRATIVE, "Please confirm the refund details.")
 *   → [ { role: "user", content: "## Active Case Facts (DO NOT SUMMARISE)\n{…}\n\n" +
 *                                  "Customer wants a refund for a recent order" },
 *       { role: "assistant", content: "I have the case facts and history." },
 *       { role: "user", content: "Please confirm the refund details." } ]
 *   survivesInBlock(caseFacts, "$247.83") → true
 *   ✅ el agente sigue citando $247.83, #8891 y March 3rd tras la summarisation
 *   Sin el bloque: "your recent refund request" — sin específicos
 *
 *   Turno 6: entra un segundo order; turno 6: el status del primero pasa a
 *   refund_approved. mergeCaseFacts() reconstruye el bloque con un entry por issue
 *   ✅ sin contaminación cruzada entre orders
 *
 * [Paso 3] trimToolResult(raw40FieldResult) → 5 campos
 *   ~2000 tokens → ~200 tokens; el coste queda plano turno tras turno
 *
 * [Paso 5] aggregateWithKeyFindings(sources)
 *   → "## Key Findings Summary\n- Source A: …\n- Source B: …\n- Source C: …\n\n
 *      ## Detailed Findings\n\n### Source A\n…\n\n### Source B\n…\n\n### Source C\n…"
 *   ✅ los tres sources pesan igual: el material deja de depender de dónde cayó
 *
 * classifyOverflow({ inputTokens: 1_100_000, maxTokens: 4096, windowTokens: 1_000_000,
 *                    supportsExceededStopReason: true }) → "400_invalid_request"
 * classifyOverflow({ inputTokens: 999_000, maxTokens: 4096, windowTokens: 1_000_000,
 *                    supportsExceededStopReason: true }) → "model_context_window_exceeded"
 * cacheFriendlyOrder([system, referenceDoc], [userMessage]) → [system, referenceDoc, userMessage]
 *
 * ANTI-PATRÓN: el agente arma el bloque con el primer `lookup_order` del turno 2 y
 * nunca lo reconstruye. En el turno 9 sigue citando el status original y jamás
 * menciona el segundo order, aunque ambos cambios están en el transcript. El fix no
 * es añadir un bloque ni una reconciliation pass ni declarar el transcript
 * autoritativo: es re-ejecutar el extractor tras cada tool result para reconstruir
 * el bloque con un entry por issue.
 */
