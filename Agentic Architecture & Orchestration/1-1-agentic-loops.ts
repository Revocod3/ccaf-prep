/**
 * ============================================================================
 * DOMINIO 1 · TASK STATEMENT 1.1 — Agentic Loops
 * ----------------------------------------------------------------------------
 * Objetivo oficial:
 *   Design and implement agentic loops for autonomous task execution.
 *
 * Qué evalúa el examen aquí:
 *   Un agentic loop es control flow determinista que escribes TÚ. Claude nunca
 *   corre el loop: responde una pregunta por pasada y tu código decide qué pasa
 *   después. La señal de control es `stop_reason` y nada más — `"tool_use"`
 *   continúa, `"end_turn"` termina. Cualquier intento de inferir la
 *   terminación (parsear lenguaje natural, mirar `content[0].type`, usar un
 *   iteration cap como mecanismo principal) es un anti-patrón.
 *
 * Build Exercise: Build a Multi-Tool Agent Loop  (Intermediate · 45 min)
 * ============================================================================
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tipos del contrato Messages API (fieles al SDK real)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Valor completo de `stop_reason` documentado por la API.
 *
 * El examen solo llavea dos (`tool_use`, `end_turn`), pero un loop de
 * producción tiene que ramificar sobre los siete: todos llegan en un 200 con
 * contenido válido, no son errores.
 */
type StopReason =
  | "end_turn"
  | "max_tokens"
  | "stop_sequence"
  | "tool_use"
  | "pause_turn"
  | "refusal"
  | "model_context_window_exceeded";

/** Bloque de texto generado por el modelo. */
interface TextBlock {
  readonly type: "text";
  readonly text: string;
}

/**
 * Petición de ejecución de una herramienta.
 *
 * `id` es único y se usa después para emparejar el `tool_result`; `input`
 * cumple el `input_schema` declarado por la tool.
 */
interface ToolUseBlock {
  readonly type: "tool_use";
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

/** Unión etiquetada por `type`: permite narrowing real, sin casts. */
type ContentBlock = TextBlock | ToolUseBlock;

/**
 * Resultado de una tool, siempre dentro de un mensaje `user`.
 *
 * No existe un rol `tool` ni `function` en esta API.
 */
interface ToolResultBlock {
  readonly type: "tool_result";
  readonly tool_use_id: string;
  readonly content: string;
  readonly is_error?: boolean;
}

/** Contenido válido para un mensaje de rol `user`. */
type UserContent = string | readonly (ContentBlock | ToolResultBlock)[];

interface UserMessage {
  readonly role: "user";
  readonly content: UserContent;
}

interface AssistantMessage {
  readonly role: "assistant";
  readonly content: readonly ContentBlock[];
}

/** Una entrada de la historia de conversación enviada en cada pasada. */
type MessageParam = UserMessage | AssistantMessage;

/** Respuesta de la Messages API. */
interface Message {
  readonly id: string;
  readonly stop_reason: StopReason | null;
  readonly content: readonly ContentBlock[];
  readonly stop_sequence?: string | null;
}

/** Subconjunto de JSON Schema que usamos en los `input_schema`. */
interface JsonSchema {
  readonly type: "object";
  readonly properties: Readonly<Record<string, { readonly type: "string" }>>;
  readonly required: readonly string[];
}

/** Declaración de una herramienta expuesta al modelo. */
interface Tool {
  readonly name: string;
  readonly description: string;
  readonly input_schema: JsonSchema;
}

interface CreateMessageParams {
  readonly model: string;
  readonly max_tokens: number;
  readonly system?: string;
  readonly tools?: readonly Tool[];
  readonly messages: readonly MessageParam[];
}

/**
 * Puerto hacia la Messages API.
 *
 * En producción esto es `new Anthropic().messages`; tiparlo como interfaz deja
 * el loop testeable y deja claro que la API es stateless — solo existe lo que
 * viaja en `messages`.
 */
interface MessagesClient {
  readonly messages: {
    create(params: CreateMessageParams): Promise<Message>;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 1 — Registrar dos tools con `input_schema` correcto
//
// Why: un setup multi-tool expone el model-driven decision-making — Claude debe
//      elegir la tool correcta según el contexto.
// You should see: dos definiciones con name, description e input_schema, cada
//      una declarando tipo y obligatoriedad del parámetro.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ejecuta una expresión matemática y devuelve el resultado numérico.
 *
 * @param expression - Expresión aritmética, p. ej. `"3.5 * 64200"`.
 * @returns El resultado formateado como string.
 */
function calculator(expression: string): string {
  // Ilustrativo: en producción usarías un parser seguro, nunca `eval`.
  return String(eval(expression)); // eslint-disable-line no-eval
}

/**
 * Stub de búsqueda web que devuelve resultados simulados.
 *
 * @param query - Consulta en lenguaje natural.
 * @returns Un fragmento de texto con el resultado más relevante.
 */
function webSearch(query: string): string {
  const mockIndex: Readonly<Record<string, string>> = {
    "bitcoin price": "Bitcoin trades at $64,200 USD.",
    "population of france": "France has a population of 68,400,000.",
  };
  return mockIndex[query.toLowerCase()] ?? `No results for "${query}".`;
}

/**
 * Definiciones de tools enviadas en cada request.
 *
 * `description` es lo que usa Claude para elegir, así que declara qué hace la
 * tool y cuándo usarla. El `input_schema` es lo que evita llamadas malformadas.
 */
const tools = [
  {
    name: "calculator",
    description:
      "Evaluates a mathematical expression. Use it for any arithmetic, " +
      "including percentages and multiplications.",
    input_schema: {
      type: "object",
      properties: { expression: { type: "string" } },
      required: ["expression"],
    },
  },
  {
    name: "web_search",
    description:
      "Searches the web for current facts. Use it when you need a value " +
      "you do not already know, such as a price or a population.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
] as const satisfies readonly Tool[];

/** Registry que mapea el nombre declarado al handler real. */
const toolHandlers: Readonly<
  Record<string, (input: Record<string, string>) => string>
> = {
  calculator: (input) => calculator(input.expression ?? ""),
  web_search: (input) => webSearch(input.query ?? ""),
};

// ─────────────────────────────────────────────────────────────────────────────
// Paso 3 (soporte) — Extraer y ejecutar los bloques `tool_use`
//
// Why: es el handoff crítico del loop. El examen evalúa si extraes las llamadas,
//      las ejecutas y devuelves los resultados en el formato de mensaje correcto.
// You should see: un `tool_result` por cada `tool_use`, todos juntos en el
//      siguiente mensaje `user`, emparejados por `tool_use_id`.
// ─────────────────────────────────────────────────────────────────────────────

/** Type predicate: único narrowing válido sobre la unión de bloques. */
const isToolUseBlock = (block: ContentBlock): block is ToolUseBlock =>
  block.type === "tool_use";

/**
 * Ejecuta una tool y devuelve su `tool_result`.
 *
 * Un fallo de ejecución NO lanza: se devuelve como texto con `is_error: true`
 * para que Claude pueda incorporarlo a su razonamiento.
 *
 * @param block - Bloque `tool_use` solicitado por el modelo.
 * @returns El bloque `tool_result` correspondiente, emparejado por id.
 */
function runToolUse(block: ToolUseBlock): ToolResultBlock {
  const handler = toolHandlers[block.name];

  if (handler === undefined) {
    return {
      type: "tool_result",
      tool_use_id: block.id,
      content: `Unknown tool: ${block.name}`,
      is_error: true,
    };
  }

  try {
    const input = (block.input ?? {}) as Record<string, string>;
    return {
      type: "tool_result",
      tool_use_id: block.id,
      content: handler(input),
    };
  } catch (error) {
    return {
      type: "tool_result",
      tool_use_id: block.id,
      content: error instanceof Error ? error.message : String(error),
      is_error: true,
    };
  }
}

/**
 * Ejecuta todos los `tool_use` de una respuesta.
 *
 * Claude puede pedir varias tools en una misma respuesta: devolvemos un
 * `tool_result` por cada uno, siempre en un único mensaje `user` y con los
 * `tool_result` antes de cualquier texto.
 *
 * @param response - Respuesta cuyo `stop_reason` es `"tool_use"`.
 * @returns Los bloques `tool_result`, en orden de aparición.
 */
function executeToolUseBlocks(response: Message): readonly ToolResultBlock[] {
  return response.content.filter(isToolUseBlock).map(runToolUse);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pasos 2, 4 y 6 — El loop, su salida y la red de seguridad
//
// Why: el examen distingue cap de seguridad (aceptable como fallback) de cap
//      como mecanismo principal (anti-patrón). El cap no debe alcanzarse nunca.
// You should see: un `while` que llama a `messages.create()`, ramifica de forma
//      exhaustiva sobre `stop_reason`, y sale con el texto final en `end_turn`.
// ─────────────────────────────────────────────────────────────────────────────

/** Cota superior de seguridad. No decide la terminación; acota el runaway. */
const MAX_ITERATIONS = 20;

/**
 * Extrae el texto final de una respuesta.
 *
 * @param response - Respuesta terminada en `"end_turn"`.
 * @returns El texto concatenado de todos los bloques `text`.
 */
function extractFinalText(response: Message): string {
  return response.content
    .filter((block): block is TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

/** Resultado observable de una corrida del agente. */
interface AgentRun {
  readonly answer: string;
  readonly iterations: number;
  readonly hitSafetyCap: boolean;
  /** `true` si la generación se cortó (max_tokens / stop_sequence / context window). */
  readonly truncated: boolean;
}

/**
 * Corre el agentic loop hasta `end_turn`.
 *
 * Ciclo documentado: (1) enviar el request con toda la historia, (2) ramificar
 * sobre `stop_reason`, (3) en `tool_use` ejecutar las tools y appender los
 * resultados, (4) en `end_turn` devolver la respuesta final.
 *
 * @param client - Puerto a la Messages API.
 * @param userPrompt - La tarea del usuario que abre la conversación.
 * @returns La respuesta final más métricas de la corrida.
 */
async function runAgentLoop(
  client: MessagesClient,
  userPrompt: string,
): Promise<AgentRun> {
  // La API es stateless: la historia completa vive aquí, en nuestro código.
  const messages: MessageParam[] = [{ role: "user", content: userPrompt }];
  let iterations = 0;

  while (true) {
    if (iterations >= MAX_ITERATIONS) {
      console.warn(
        `[safety-cap] Se alcanzaron ${MAX_ITERATIONS} iteraciones sin end_turn.`,
      );
      return { answer: "(cut off by safety cap)", iterations, hitSafetyCap: true, truncated: false };
    }
    iterations += 1;

    const response = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      tools,
      messages,
    });

    switch (response.stop_reason) {
      case "end_turn":
        // Paso 4: trabajo completo. Cerramos el loop y devolvemos el resultado.
        return {
          answer: extractFinalText(response),
          iterations,
          hitSafetyCap: false,
          truncated: false,
        };

      case "tool_use": {
        // Paso 3: appender el turno del assistant y, acto seguido, los
        // resultados. El orden y la adyacencia son obligatorios: un
        // `tool_result` debe seguir inmediatamente a su `tool_use`.
        messages.push({ role: "assistant", content: response.content });
        messages.push({
          role: "user",
          content: executeToolUseBlocks(response),
        });
        break; // vuelve a iterar
      }

      case "pause_turn":
        // Turno largo pausado: se reenvía la respuesta tal cual para continuar.
        messages.push({ role: "assistant", content: response.content });
        break;

      case "max_tokens":
      case "model_context_window_exceeded":
        // Generación truncada: NO es un final válido, es un fragmento. Se marca
        // como truncada para que el caller no la confunda con una respuesta
        // completa.
        return {
          answer: extractFinalText(response),
          iterations,
          hitSafetyCap: false,
          truncated: true,
        };

      case "stop_sequence":
        // Un stop_sequence propio cortó la generación: mismo caso que max_tokens.
        return {
          answer: extractFinalText(response),
          iterations,
          hitSafetyCap: false,
          truncated: true,
        };

      case "refusal":
        return {
          answer: "(refused by policy classifier)",
          iterations,
          hitSafetyCap: false,
          truncated: false,
        };

      case null:
        throw new Error("La respuesta no trae stop_reason; no se puede continuar.");

      default: {
        // Comprobación de exhaustividad: si la unión crece, esto no compila.
        const unexpected: never = response.stop_reason;
        throw new Error(`stop_reason no manejado: ${String(unexpected)}`);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 5 — Escenario que exige tool calls secuenciales
//
// Why: fuerza el ciclo completo — primera tool, razonar sobre su resultado, y
//      decidir una segunda tool antes del `end_turn`.
// You should see: al menos dos iteraciones con tool_use antes de terminar.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Escenario de demostración: búsqueda y luego cálculo sobre el resultado.
 *
 * @param client - Puerto a la Messages API.
 */
export async function runScenario(client: MessagesClient): Promise<void> {
  const run = await runAgentLoop(
    client,
    "Search for the current price of Bitcoin and calculate what 3.5 coins would cost.",
  );
  console.log(`Iterations: ${run.iterations}`);
  console.log(`Result: ${run.answer}`);
}

/**
 * ============================================================================
 * ✗ ANTI-PATTERN — Inferir la terminación en vez de leer `stop_reason`
 * ============================================================================
 *
 * Los tres aparecen en el examen como código que "parece razonable". Ninguno
 * detecta la terminación de forma fiable.
 */

/** ✗ ANTI-PATTERN 1 — Mirar `content[0].type`.
 *
 * `content` es un array y una misma respuesta puede traer un bloque `text`
 * ("Let me search for that price.") junto a un bloque `tool_use`. El índice
 * `[0]` registra qué dijo el modelo primero, no si queda trabajo. Mover la
 * comprobación a `[1]` tampoco arregla nada: el orden de los bloques es un
 * detalle de presentación, no una garantía de interfaz.
 */
// if (response.content[0]?.type === "text") {
//   return extractFinalText(response); // el tool_use de [1] nunca corre
// }

/** ✗ ANTI-PATTERN 2 — Iteration cap como mecanismo principal.
 *
 * Trunca la tarea que necesitaba 12 iteraciones y sigue girando en la que
 * terminó en 3. Peor: la corrida truncada devuelve una respuesta parcial que
 * no se distingue de una completa.
 */
// for (let i = 0; i < 10; i += 1) { /* ... */ return partialAnswer; }

/** ✗ ANTI-PATTERN 3 — Parsear frases de finalización.
 *
 * Nada constriñe al modelo a un vocabulario de cierre, así que la lista de
 * frases nunca converge. "I've finished analysing the first file" es una frase
 * de cierre sobre una tarea sin terminar.
 */
// if (/\b(i'?m done|task complete|finished)\b/i.test(text)) return text;

/** ✗ ANTI-PATTERN 4 — Forzar `tool_choice: "any"`.
 *
 * Obligar a una tool call en cada respuesta elimina la única salida del loop
 * (el `end_turn` del propio modelo), así que corre hasta que algo externo lo
 * detenga. Efectos secundarios documentados: la API prefigura el mensaje del
 * assistant y se invalida el prompt caching.
 */
// { tool_choice: { type: "any" } }  // ← elimina end_turn

/**
 * ============================================================================
 * EXAM TRAPS — distractores recurrentes y criterio de rechazo
 * ============================================================================
 *
 * | Trampa                                        | Por qué se rechaza                                    |
 * |-----------------------------------------------|-------------------------------------------------------|
 * | `content[0].type == "text"` como fin           | Un solo reply lleva text + tool_use juntos            |
 * | Iteration cap como mecanismo principal         | Un cap solo puede parar antes; no reinicia nada       |
 * | Parsear "I'm done" / "task complete"           | El espacio de frases no es enumerable                 |
 * | `tool_choice: "any"` para evitar texto         | Quita la señal de finalización del propio modelo      |
 *
 * Distractor frecuente: el examen presenta un cap como fix de un premature
 * termination. Recházalo — el cap es una cota superior, no puede hacer que un
 * loop que ya decidió salir vuelva a entrar.
 *
 * QUICK REFERENCE — hechos de la API (datos de la fuente)
 *
 *   stop_reason enum ...... end_turn, max_tokens, stop_sequence, tool_use,
 *                           pause_turn, refusal, model_context_window_exceeded
 *   Loop sale en .......... cualquier stop reason distinto de tool_use
 *   pause_turn ............ add el assistant response y re-request (no es fin)
 *   refusal ............... leer stop_details y reintentar en modelo fallback
 *   truncado .............. max_tokens y stop_sequence son fragmentos
 *   tool_result va en ..... rol `user` (no hay rol tool/function)
 *   Reglas de placement ... el tool_result sigue inmediatamente al tool_use, y
 *                           todos los tool_result van antes de cualquier texto
 *   Paralelo .............. un tool_result por tool_use, en un solo user message;
 *                           las llamadas omitidas llevan is_error: true
 *   Desactivar paralelo ... `disable_parallel_tool_use: true` va DENTRO de
 *                           tool_choice, no a nivel top
 *   tool_choice default ... `auto` (el modelo puede devolver texto, tool call, o ambos)
 *   Cap en el SDK ......... `max_turns` (tool-use round trips); acota, no completa
 *
 * ============================================================================
 * FLUJO DE EJECUCIÓN ESPERADO  (trace ilustrativo — no se ejecuta)
 * ============================================================================
 *
 * [iter 1] request  → messages: [user] "Search the price of Bitcoin and
 *                                   calculate what 3.5 coins would cost"
 *          response → stop_reason: "tool_use"
 *                     content[0] {text}      "Let me search for that price."
 *                     content[1] {tool_use}  web_search("bitcoin price")  id=toolu_01
 * [iter 1] execute  → web_search() → "Bitcoin trades at $64,200 USD."
 * [iter 1] append   → messages: [assistant {text, tool_use},
 *                                user {tool_result, tool_use_id: "toolu_01"}]
 *
 * [iter 2] request  → messages: [... + tool_result]
 *          response → stop_reason: "tool_use"
 *                     content[1] {tool_use}  calculator("3.5 * 64200")  id=toolu_02
 * [iter 2] execute  → calculator() → "224700"
 * [iter 2] append   → messages: [assistant {tool_use},
 *                                user {tool_result, tool_use_id: "toolu_02"}]
 *
 * [iter 3] request  → messages: [... + tool_result]
 *          response → stop_reason: "end_turn"
 *                     content[0] {text} "3.5 BTC ≈ $224,700 USD."
 *          → LOOP EXIT  (iterations used: 3 of MAX_ITERATIONS = 20 → cap NEVER hit)
 *
 * ANTI-PATRÓN (mismo escenario, código roto con content[0].type === "text"):
 *   [iter 1] response → stop_reason: "tool_use"
 *                      content[0] {text} "Let me search for that price."
 *            → LOOP EXIT  ← salida prematura
 *   Result: "Let me search for that price."      ← la tool nunca corrió
 *   Iterations: 1                                 ← sin error, sin warning
 */

export {};
