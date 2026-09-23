/**
 * ============================================================================
 * DOMINIO 2 · TASK STATEMENT 2.1 — Tool Interface Design
 * ----------------------------------------------------------------------------
 * Objetivo oficial:
 *   Design effective tool interfaces with clear descriptions and boundaries.
 *
 * Qué evalúa el examen aquí:
 *   La descripción de una tool NO es documentación: es el mecanismo por el que
 *   el modelo la selecciona. Si dos tools se describen con términos que podrían
 *   aplicar a cualquiera de las dos, no hay nada más de donde el modelo pueda
 *   tirar y la elección se vuelve una apuesta. Un "gets customer info" al lado
 *   de un "gets order info" no distingue nada; la frase de frontera — "esto NO
 *   es para órdenes" — es la que hace el trabajo. Y el arreglo correcto es el
 *   más barato que alcanza la causa: reescribir las descripciones, no meter
 *   few-shot, ni un routing classifier, ni consolidar las tools.
 *
 * Build Exercise: Design Tool Descriptions That Eliminate Misrouting
 *                 (Beginner · 30 min)
 * ============================================================================
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tipos del contrato real de tools (Messages API y MCP)
// ─────────────────────────────────────────────────────────────────────────────

/** Regla de nombre de una client tool en la Messages API. */
const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/** Subconjunto de JSON Schema suficiente para describir inputs. */
interface JsonSchemaProperty {
  readonly type: "string" | "number" | "boolean";
  readonly description?: string;
}

/** `input_schema` de una tool: un JSON Schema de tipo objeto. */
interface JsonSchema {
  readonly type: "object";
  readonly properties: Readonly<Record<string, JsonSchemaProperty>>;
  readonly required?: readonly string[];
}

/**
 * Una client tool tal como viaja en el array `tools` de la Messages API.
 *
 * Campos requeridos: `name`, `description`, `input_schema`.
 * `input_examples` es opcional.
 */
interface ClientToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly input_schema: JsonSchema;
  readonly input_examples?: readonly Readonly<Record<string, unknown>>[];
}

/**
 * Una tool MCP: cambia el nombre del schema (`inputSchema`) y añade contrato de
 * salida.
 *
 * Campos: `name`, `description`, `inputSchema`; opcionales `title`,
 * `outputSchema` y `annotations`. Las `annotations` son advisory: el spec dice
 * que un cliente DEBE tratarlas como no confiables salvo que vengan de un
 * servidor de confianza. Descubrimiento con `tools/list`, ejecución con
 * `tools/call`.
 */
export interface McpToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly title?: string;
  readonly outputSchema?: JsonSchema;
  readonly annotations?: {
    readonly readOnlyHint?: boolean;
    readonly destructiveHint?: boolean;
    readonly openWorldHint?: boolean;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tipos de la corrida de selección
// ─────────────────────────────────────────────────────────────────────────────

/** Un caso de prueba: la query y la tool que debería elegir el modelo. */
interface QueryCase {
  readonly query: string;
  readonly expected: string;
}

/** Qué tool eligió el modelo para una query (o ninguna). */
interface SelectionResult {
  readonly query: string;
  readonly expected: string;
  readonly selected: string | null;
}

type ContentBlock =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "tool_use";
      readonly id: string;
      readonly name: string;
      readonly input: Readonly<Record<string, unknown>>;
    };

type ToolChoice =
  | { readonly type: "auto" }
  | { readonly type: "any" }
  | { readonly type: "tool"; readonly name: string }
  | { readonly type: "none" };

interface MessageParam {
  readonly role: "user" | "assistant";
  readonly content: string | readonly ContentBlock[];
}

interface MessageResponse {
  readonly content: readonly ContentBlock[];
  readonly stop_reason:
    | "end_turn"
    | "max_tokens"
    | "stop_sequence"
    | "tool_use"
    | "pause_turn"
    | "refusal"
    | "model_context_window_exceeded";
}

/** Puerto mínimo a `client.messages.create`. */
interface MessagesClient {
  create(request: {
    readonly model: string;
    readonly max_tokens: number;
    readonly system?: string;
    readonly tools?: readonly ClientToolDefinition[];
    readonly tool_choice?: ToolChoice;
    readonly messages: readonly MessageParam[];
  }): Promise<MessageResponse>;
}

/**
 * Los cinco elementos de una descripción production-grade.
 *
 * Escribirla es responder estas cinco preguntas; renderizarlas es el texto que
 * el modelo lee antes de decidir.
 */
interface ToolDescriptionSpec {
  /** 1. Qué hace, dicho de forma que no se confunda con otra tool. */
  readonly purpose: string;
  /** 2. Qué inputs acepta: tipos, formatos, rangos y cuáles son requeridos. */
  readonly inputs: string;
  /** 3. Ejemplos de queries que maneja bien. */
  readonly exampleQueries: readonly string[];
  /** 4. Edge cases y límites: qué NO hace y cómo se comporta fuera de rango. */
  readonly edgeCases: string;
  /** 5. Frontera explícita: cuándo la tool vecina es la correcta. */
  readonly boundaries: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 1 — Registrar dos tools con descripciones deliberadamente ambiguas
//
// Why: reproducir el misrouting primero da la línea base. El examen evalúa que
//      identifiques descripciones ambiguas como la causa raíz de los errores de
//      selección, y eso solo se ve comparando contra un baseline.
// You should see: dos definiciones registradas, cada una con UNA frase genérica
//      que no menciona formatos de input, ejemplos ni fronteras.
// ─────────────────────────────────────────────────────────────────────────────

/** `input_schema` compartido: un identificador de texto libre. */
const IDENTIFIER_SCHEMA: JsonSchema = {
  type: "object",
  properties: { identifier: { type: "string", description: "Customer email, phone, or ID" } },
  required: ["identifier"],
};

/** Nombre válido para una tool: `^[a-zA-Z0-9_-]{1,64}$`. */
export function isValidToolName(name: string): boolean {
  return TOOL_NAME_PATTERN.test(name);
}

/**
 * Registra las dos tools con descripciones de una sola frase.
 *
 * Es el baseline del ejercicio: "Retrieves customer information" al lado de
 * "Retrieves order details" — dos descripciones intercambiables para una query
 * que habla de una orden.
 *
 * @returns Las dos definiciones ambiguas, listas para el primer run.
 */
export function registerAmbiguousTools(): readonly ClientToolDefinition[] {
  return [
    {
      name: "get_customer",
      description: "Retrieves customer information",
      input_schema: IDENTIFIER_SCHEMA,
    },
    {
      name: "lookup_order",
      description: "Retrieves order details",
      input_schema: IDENTIFIER_SCHEMA,
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 2 — Correr 10 queries y registrar qué tool elige el modelo
//
// Why: cuantificar la accuracy antes y después da evidencia concreta de que la
//      calidad de la descripción manda sobre la selección. Sin números, el
//      arreglo del Paso 3 no se puede validar.
// You should see: un log con 2-3 queries misrouted — el modelo eligiendo
//      get_customer para queries de órdenes o al revés.
// ─────────────────────────────────────────────────────────────────────────────

/** Los 10 casos del ejercicio, con la tool esperada para cada uno. */
export const QUERY_SET: readonly QueryCase[] = [
  { query: "What is the status of order #12345?", expected: "lookup_order" },
  { query: "Look up customer john@example.com", expected: "get_customer" },
  { query: "Check my order tracking", expected: "lookup_order" },
  { query: "Find the account for phone 555-0123", expected: "get_customer" },
  { query: "Where is my package?", expected: "lookup_order" },
  { query: "Is order #67890 eligible for a refund?", expected: "lookup_order" },
  { query: "What loyalty tier is this customer?", expected: "get_customer" },
  { query: "I need details on order #11111", expected: "lookup_order" },
  { query: "Verify the customer account status", expected: "get_customer" },
  { query: "When will order #99999 arrive?", expected: "lookup_order" },
];

/**
 * Corre el set de queries y devuelve la tool elegida en cada una.
 *
 * `tool_choice: "auto"` deja que el modelo decida — que es exactamente lo que
 * estamos midiendo. Las queries son independientes, así que van en paralelo.
 *
 * @param client - Puerto a la Messages API.
 * @param tools - El toolkit a evaluar (ambiguo o production-grade).
 * @param cases - Los casos; por defecto, los 10 del ejercicio.
 * @param system - System prompt opcional (el Paso 5 lo usa para probar conflictos).
 * @returns Un resultado por query, con lo elegido y lo esperado.
 */
export async function measureSelection(
  client: MessagesClient,
  tools: readonly ClientToolDefinition[],
  cases: readonly QueryCase[] = QUERY_SET,
  system?: string,
): Promise<readonly SelectionResult[]> {
  return Promise.all(
    cases.map(async (testCase): Promise<SelectionResult> => {
      const response = await client.create({
        model: "claude-sonnet-5",
        max_tokens: 1024,
        tools,
        tool_choice: { type: "auto" },
        messages: [{ role: "user", content: testCase.query }],
        ...(system === undefined ? {} : { system }),
      });

      const toolUse = response.content.find(
        (block): block is Extract<ContentBlock, { type: "tool_use" }> =>
          block.type === "tool_use",
      );

      return {
        query: testCase.query,
        expected: testCase.expected,
        selected: toolUse?.name ?? null,
      };
    }),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 3 — Reescribir las descripciones con los cinco elementos
//
// Why: es la skill central del examen — el arreglo de menor esfuerzo y mayor
//      apalancamiento para el misrouting. Las descripciones production-grade
//      llevan propósito, inputs con formato, ejemplos, edge cases y fronteras.
// You should see: descripciones de 3-5 frases que declaran los identificadores
//      aceptados, dan queries de ejemplo y cierran con una frase de frontera.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Renderiza los cinco elementos en el texto que lee el modelo.
 *
 * @param spec - Los cinco elementos ya redactados.
 * @returns La descripción final, con las fronteras al final y cerca del inicio.
 */
export function renderDescription(spec: ToolDescriptionSpec): string {
  return [
    spec.purpose,
    spec.inputs,
    `Example queries: ${spec.exampleQueries.join(" · ")}.`,
    spec.edgeCases,
    spec.boundaries,
  ].join(" ");
}

/**
 * Las dos descripciones production-grade del ejercicio.
 *
 * La frase que hace el trabajo real es la última de cada una: la que nombra la
 * tool vecina y dice cuándo usarla en su lugar. Así no queda ningún caso en el
 * que ambas parezcan igual de aplicables.
 */
export const PRODUCTION_SPECS: Readonly<Record<string, ToolDescriptionSpec>> = {
  get_customer: {
    purpose:
      "Finds one customer account and returns the profile: name, contact details, account status and loyalty tier.",
    inputs:
      "Takes a single `identifier`: an email address, a phone number or a customer ID. Required.",
    exampleQueries: [
      "Look up customer john@example.com",
      "Find the account for phone 555-0123",
      "What loyalty tier is this customer?",
    ],
    edgeCases:
      "Returns not-found if no account matches. Never returns order data.",
    boundaries:
      "Reach for this when the question is who you are dealing with. Anything about a particular order belongs to lookup_order, not here.",
  },
  lookup_order: {
    purpose:
      "Returns one order and everything on it: current status, line items, shipping detail and refund eligibility.",
    inputs:
      "Takes a single `identifier`: an order number (format #NNNNN) or a tracking ID. Required.",
    exampleQueries: [
      "What is the status of order #12345?",
      "Check my order tracking",
      "Is order #67890 eligible for a refund?",
    ],
    edgeCases:
      "Returns not-found for an unknown order number. Never resolves a customer identity.",
    boundaries:
      "Reach for this when the customer names an order. Establishing who the customer is belongs to get_customer, not here.",
  },
};

/**
 * Registra las tools con las descripciones reescritas.
 *
 * Mismo nombre, mismo schema, distinto texto: el ejercicio demuestra que la
 * mejora viene de la descripción y de nada más.
 *
 * @returns Las dos definiciones production-grade.
 */
export function registerProductionTools(): readonly ClientToolDefinition[] {
  const customerSpec = PRODUCTION_SPECS.get_customer;
  const orderSpec = PRODUCTION_SPECS.lookup_order;
  if (customerSpec === undefined || orderSpec === undefined) {
    throw new Error("Production specs are missing");
  }
  return [
    {
      name: "get_customer",
      description: renderDescription(customerSpec),
      input_schema: IDENTIFIER_SCHEMA,
      input_examples: [{ identifier: "john@example.com" }, { identifier: "555-0123" }],
    },
    {
      name: "lookup_order",
      description: renderDescription(orderSpec),
      input_schema: IDENTIFIER_SCHEMA,
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 4 — Re-correr las mismas 10 queries y comparar accuracy
//
// Why: medir la mejora valida que la calidad de la descripción era la causa
//      raíz. El examen espera que entiendas que mejores descripciones producen
//      mejor selección SIN ningún cambio arquitectónico.
// You should see: accuracy de 9/10 o 10/10, con las queries antes misrouted
//      cayendo ahora en la tool correcta.
// ─────────────────────────────────────────────────────────────────────────────

/** Accuracy de una corrida, con los casos que fallaron. */
interface AccuracyReport {
  readonly total: number;
  readonly correct: number;
  readonly accuracy: string;
  readonly misrouted: readonly SelectionResult[];
}

/**
 * Resume una corrida de selección.
 *
 * @param results - Salida de `measureSelection`.
 * @returns Total, aciertos, porcentaje y lista de misrouted.
 */
export function compareAccuracy(results: readonly SelectionResult[]): AccuracyReport {
  const misrouted = results.filter((result) => result.selected !== result.expected);
  const correct = results.length - misrouted.length;
  return {
    total: results.length,
    correct,
    accuracy: `${correct}/${results.length}`,
    misrouted,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 5 — Auditar el system prompt por instrucciones keyword-sensitive
//
// Why: un system prompt puede anular en silencio las descripciones recién
//      escritas. "always check customer details before proceeding" planta una
//      asociación por keyword lo bastante fuerte como para arrastrar queries de
//      órdenes hacia get_customer, diga lo que diga la descripción.
// You should see: una lista de frases sensibles con la tool hacia la que
//      arrastran y una reescritura que describe el objetivo sin repetir el
//      keyword sesgado.
// ─────────────────────────────────────────────────────────────────────────────

/** Un conflicto detectado entre el prompt y la frontera de una tool. */
interface PromptConflict {
  readonly phrase: string;
  readonly pullsToward: string;
  readonly rewrite: string;
}

/** Asociaciones keyword → tool que la fuente advierte que hay que vigilar. */
const KEYWORD_CONFLICTS: readonly {
  readonly pattern: RegExp;
  readonly pullsToward: string;
  readonly rewrite: string;
}[] = [
  {
    pattern: /always (check|verify) customer (details|info(rmation)?)/i,
    pullsToward: "get_customer",
    rewrite: "Look up the record the customer names.",
  },
  {
    pattern: /always (look up|check) the order/i,
    pullsToward: "lookup_order",
    rewrite: "Resolve the record the request refers to.",
  },
  {
    pattern: /check (the )?account first/i,
    pullsToward: "get_customer",
    rewrite: "Establish the record the request is about before acting.",
  },
];

/**
 * Busca en el system prompt frases que compitan con las descripciones.
 *
 * @param systemPrompt - El system prompt a auditar.
 * @returns Los conflictos encontrados, cada uno con su reescritura sugerida.
 */
export function auditSystemPrompt(systemPrompt: string): readonly PromptConflict[] {
  return KEYWORD_CONFLICTS.flatMap(({ pattern, pullsToward, rewrite }) => {
    const match = pattern.exec(systemPrompt);
    return match === null ? [] : [{ phrase: match[0], pullsToward, rewrite }];
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Extra — Cuando la descripción no basta: splitting y renaming
//
// Why: una tool con un remitente amplio no se puede describir con precisión,
//      porque no hace una sola cosa. Y dos nombres que invitan a la confusión
//      compiten por peticiones que nunca fueron suyas. Las dos son intervenciones
//      en la INTERFAZ, no en la implementación de debajo.
// You should see: cada tool nueva mapea a una petición que un usuario haría de
//      verdad, y el renaming elimina el solapamiento sin tocar nada más.
// ─────────────────────────────────────────────────────────────────────────────

/** El remitente amplio que no admite una descripción precisa. */
export const GENERIC_DOCUMENT_TOOL = {
  name: "analyze_document",
  description: "Runs analysis over a document and returns what it finds",
} as const;

/**
 * Las tres tools purpose-specific que lo reemplazan.
 *
 * Cada una hace un solo trabajo bajo un contrato definido, y por eso cada una
 * admite una descripción exacta — que es lo que permite elegir entre ellas por lo
 * que se pidió.
 */
export const SPLIT_DOCUMENT_TOOLS: readonly {
  readonly name: string;
  readonly description: string;
}[] = [
  {
    name: "extract_data_points",
    description: "Extracts structured data fields (dates, amounts, names) from a document",
  },
  {
    name: "summarize_content",
    description: "Produces a concise summary of a document's key arguments and conclusions",
  },
  {
    name: "verify_claim_against_source",
    description:
      "Checks whether a specific claim is supported by the source document, returning supporting/contradicting evidence",
  },
];

/**
 * Renombra una tool para eliminar el solapamiento funcional.
 *
 * `analyze_content` compite por peticiones que nunca fueron suyas; con un nombre y
 * un encuadre específicos de web deja de hacerlo. No cambia nada por debajo.
 *
 * @param name - El nombre nuevo.
 * @param description - La descripción con el encuadre específico.
 * @returns La tool renombrada.
 */
export function renameTool(
  name: string,
  description: string,
): { readonly name: string; readonly description: string } {
  return { name, description };
}

/** El renaming del ejercicio: `analyze_content` → `extract_web_results`. */
export const RENAMED_WEB_TOOL = renameTool(
  "extract_web_results",
  "Extracts the results of a web search, returning the matching pages with their URLs",
);

/** Marcadores de una frontera explícita dentro de una descripción. */
const BOUNDARY_MARKERS: readonly string[] = [
  "not for",
  "instead",
  "belongs to",
  "rather than",
  "do not use",
];

/**
 * ¿La descripción declara su frontera contra la tool vecina?
 *
 * La frase de frontera es la que hace el trabajo: sin ella, dos descripciones
 * pueden parecer igual de aplicables a la misma query. Cuando falta, toca dividir
 * o renombrar — no añadir few-shot ni un routing classifier.
 *
 * @param description - La descripción de la tool.
 * @returns `true` si nombra cuándo la tool vecina es la correcta.
 */
export function declaresBoundary(description: string): boolean {
  const low = description.toLowerCase();
  return BOUNDARY_MARKERS.some((marker) => low.includes(marker));
}

/**
 * ============================================================================
 * ✗ ANTI-PATTERN — Los arreglos que el examen rechaza para el misrouting
 * ============================================================================
 */

/** ✗ ANTI-PATTERN 1 — Dejar la descripción en una frase.
 *
 * "Gets customer info" / "Gets order info" son intercambiables para una query
 * que habla de una orden. El modelo no tiene nada más de donde tirar, así que
 * la selección es una apuesta.
 */
// { name: "get_customer", description: "Gets customer info" }

/** ✗ ANTI-PATTERN 2 — Arreglar el misrouting con few-shot.
 *
 * Los ejemplos demuestran la elección correcta caso por caso y dejan las
 * descripciones exactamente igual de ambiguas: el misrouting continúa en toda
 * query que los ejemplos no cubran, con un coste de tokens en cada llamada.
 */
// systemPrompt += "\n\nEjemplos:\n'check my order #12345' -> lookup_order";

/** ✗ ANTI-PATTERN 3 — Un routing classifier como primer paso.
 *
 * Es infraestructura para tomar una decisión que el modelo ya toma leyendo las
 * descripciones. Desperdicia el entendimiento del lenguaje que ya estás pagando
 * y añade un componente que mantener.
 */
// const tool = await classifier.route(userMessage);  // antes de que el modelo vea el toolkit

/** ✗ ANTI-PATTERN 4 — Consolidar las dos tools como primer paso.
 *
 * Fusionar es una decisión de arquitectura legítima y es un rediseño: nuevas
 * interfaces, nuevos call sites, nuevos modos de fallo. Desproporcionado para
 * dos descripciones a las que les faltaban dos frases.
 */
// { name: "lookup_entity", description: "Looks up a customer or an order" }

/** ✗ ANTI-PATTERN 5 — Reescribir las descripciones y no releer el prompt.
 *
 * El prompt "always check customer details before proceeding" sigue tirando
 * hacia get_customer aunque la descripción diga lo contrario. Las dos mitades
 * parecen correctas por separado, y por eso el fallo se escapa.
 */
// descriptions = productionGrade; systemPrompt = "always check customer details first";

/**
 * ============================================================================
 * EXAM TRAPS — distractores recurrentes y criterio de rechazo
 * ============================================================================
 *
 * | Trampa                                            | Por qué se rechaza                                  |
 * |---------------------------------------------------|-----------------------------------------------------|
 * | Few-shot para arreglar misrouting                 | Deja la ambigüedad intacta y cuesta tokens siempre  |
 * | Routing classifier como primer paso               | Infraestructura para una decisión ya disponible     |
 * | Consolidar tools como primer paso                 | Es un rediseño, no la respuesta proporcionada       |
 * | Ignorar el prompt tras reescribir descripciones   | El keyword sesgado anula la descripción nueva       |
 *
 * Regla que se repite en todo el examen: **el arreglo más barato que alcanza la
 * causa**. Mejores descripciones antes que un classifier; acceso scoped antes
 * que acceso total; servidores de la comunidad antes que builds propios.
 *
 * QUICK REFERENCE — datos de la fuente
 *
 *   name (Messages API) ..... regex `^[a-zA-Z0-9_-]{1,64}$`
 *   Campos requeridos ........ name, description, input_schema (JSON Schema);
 *                             input_examples opcional
 *   Campos MCP ............... name, description, inputSchema; opcionales title,
 *                             outputSchema, annotations
 *   Descubrir / ejecutar MCP . `tools/list` / `tools/call`
 *   Factor nº1 de performance  descripciones extremadamente detalladas
 *   Límite en Claude Code .... descripciones e instrucciones de servidor se
 *                             truncan a 2KB cada una; lo crítico, al principio
 *   Tool search .............. activado por defecto: las tools MCP se difieren y
 *                             solo entran en contexto las que Claude usa
 *   Cinco elementos .......... propósito · inputs con formato · ejemplos ·
 *                             edge cases/límites · fronteras con la vecina
 *   Checklist de Anthropic ... example usage, edge cases, input format
 *                             requirements, clear boundaries
 *   Regla de diseño .......... workflow tools, no wrappers de endpoints
 *                             (`schedule_event`, `get_customer_context`, `search_logs`)
 *   Namespacing .............. por servicio (`asana_search`) y por recurso
 *                             (`asana_projects_search`)
 *   Tool splitting ........... `analyze_document` → `extract_data_points`,
 *                             `summarize_content`, `verify_claim_against_source`
 *   Tool renaming ............ `analyze_content` → `extract_web_results` (encuadre
 *                             web; sin cambio de implementación)
 *   Naming de parámetros ..... `user_id`, no `user`; el schema previene el error
 *                             (requerir rutas absolutas eliminó el fallo)
 *   Evidencia ................ SOTA en SWE-bench Verified tras refinar
 *                             descripciones; -40% de tiempo de tarea tras reescribirlas
 *   Diagnóstico .............. muchos errores de parámetro inválido ⇒ la
 *                             descripción o los ejemplos son poco claros
 *   Annotations MCP .......... advisory; el cliente debe tratarlas como no
 *                             confiables salvo servidor de confianza
 *
 * ============================================================================
 * FLUJO DE EJECUCIÓN ESPERADO  (trace ilustrativo — no se ejecuta)
 * ============================================================================
 *
 * [Paso 1] registerAmbiguousTools()
 *   get_customer  → "Retrieves customer information"
 *   lookup_order  → "Retrieves order details"
 *
 * [Paso 2] measureSelection(client, ambiguousTools, QUERY_SET)
 *   "What is the status of order #12345?"  → get_customer   ✗ esperado lookup_order
 *   "Check my order tracking"              → get_customer   ✗ esperado lookup_order
 *   "Where is my package?"                 → get_customer   ✗ esperado lookup_order
 *   ... (resto correctas)
 *   compareAccuracy() → 7/10   ← baseline con misrouting
 *
 * [Paso 3] registerProductionTools()
 *   get_customer  → "Finds one customer account… Anything about a particular
 *                    order belongs to lookup_order, not here."
 *   lookup_order  → "Returns one order… Establishing who the customer is
 *                    belongs to get_customer, not here."
 *
 * [Paso 4] measureSelection(client, productionTools, QUERY_SET)
 *   "What is the status of order #12345?"  → lookup_order   ✓
 *   "Check my order tracking"              → lookup_order   ✓
 *   "Where is my package?"                 → lookup_order   ✓
 *   compareAccuracy() → 10/10   ← mismo toolkit, mismo modelo, solo cambió el texto
 *
 * [Paso 5] auditSystemPrompt("Always check customer details before proceeding.")
 *   → [{ phrase: "Always check customer details",
 *        pullsToward: "get_customer",
 *        rewrite: "Look up the record the customer names." }]
 *   Con el prompt sesgado: "…order #12345" → get_customer  ✗ (la frontera fue ignorada)
 *   Con el rewrite:        "…order #12345" → lookup_order  ✓ (la frontera se sostiene)
 *
 * ANTI-PATRÓN: con las descripciones production-grade pero SIN auditar el prompt,
 * el Paso 4 vuelve a 7/10 en las queries de órdenes — y el equipo concluye, mal,
 * que "las descripciones no funcionan".
 */
