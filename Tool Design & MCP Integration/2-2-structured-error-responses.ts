/**
 * ============================================================================
 * DOMINIO 2 · TASK STATEMENT 2.2 — Structured Error Responses
 * ----------------------------------------------------------------------------
 * Objetivo oficial:
 *   Implement structured error responses for MCP tools.
 *
 * Qué evalúa el examen aquí:
 *   Lo que una tool que falla devuelve determina si el agente puede hacer algo
 *   sensato con el fallo. "Operation failed" no dice nada accionable: ni qué se
 *   rompió, ni si reintentar ayudaría, ni qué probar en su lugar. El protocolo
 *   ofrece `isError` justo para eso, y la categoría del error decide la
 *   recuperación: transient se reenvía, validation se corrige, business y
 *   permission se escalan. Y la distinción que más se testea: un **access
 *   failure** (la query nunca corrió) y un **valid empty result** (corrió y no
 *   encontró nada) son resultados opuestos que se ven iguales si la respuesta no
 *   los separa.
 *
 * Build Exercise: Build Structured Error Responses for All Four Categories
 *                 (Intermediate · 45 min)
 * ============================================================================
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tipos del contrato de resultado MCP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Las cuatro categorías de fallo de una tool.
 *
 * - `transient`  timeout, rate limit, servicio caído. Reintentar igual.
 * - `validation` input malformado. Corregir el input y reenviar.
 * - `business`   violación de política. NUNCA reintentar; escalar.
 * - `permission` acceso denegado. Escalar o usar otras credenciales.
 */
type ErrorCategory = "transient" | "validation" | "business" | "permission";

/** Escenarios simulables del ejercicio (enum del `inputSchema`). */
type FailureMode =
  | "success"
  | "not_found"
  | "timeout"
  | "invalid"
  | "business"
  | "permission";

interface TextContent {
  readonly type: "text";
  readonly text: string;
}

/** Los tres campos que hacen recuperable un fallo. */
interface ToolErrorPayload {
  readonly errorCategory: ErrorCategory;
  readonly isRetryable: boolean;
  readonly description: string;
}

/** Payload de un éxito: `resultCount: 0` es una respuesta, no un fallo. */
interface LookupSuccessPayload {
  readonly resultCount: number;
  readonly customers: readonly Customer[];
}

/**
 * Resultado de una tool MCP, discriminado por `isError`.
 *
 * `isError: false` = la tool corrió (aunque no encuentre nada). `isError: true`
 * = la tool falló. Es la diferencia entre razonar sobre la recuperación y
 * tratar el texto del error como la respuesta que se pidió.
 *
 * Nota de mecanismo: un **tool execution error** (esta unión) viaja dentro de un
 * resultado JSON-RPC exitoso. Los **protocol errors** (tool desconocida,
 * argumentos inválidos, error de servidor) son otra cosa y el modelo no los ve.
 * Las cuatro categorías son siempre tool execution errors.
 */
export type McpToolResult =
  | {
      readonly isError: false;
      readonly content: readonly TextContent[];
      /**
       * `structuredContent` es el campo de primera clase para output
       * estructurado; por back-compat se serializa el mismo JSON en un bloque
       * `text`. Declarar `outputSchema` garantiza que cada fallo traiga
       * `errorCategory`, `isRetryable` y `description`.
       */
      readonly structuredContent?: LookupSuccessPayload;
    }
  | {
      readonly isError: true;
      readonly content: readonly TextContent[];
      readonly structuredContent?: ToolErrorPayload;
    };

interface Customer {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly tier: "basic" | "gold";
}

/** Base mock: la clave es el identificador tal como llega. */
const MOCK_DB: Readonly<Record<string, Customer>> = {
  "john@example.com": { id: "CUST-00001", name: "John Doe", email: "john@example.com", tier: "gold" },
  "555-0123": { id: "CUST-00002", name: "Ana Lopez", email: "ana@example.com", tier: "basic" },
};

/** Petición de la tool `customer_lookup`. */
interface LookupRequest {
  readonly identifier: string;
  /** El `mode` hace reproducible cada fallo en vez de esperar una caída real. */
  readonly mode: FailureMode;
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 1 — Una tool MCP con modos de fallo simulados
//
// Why: simular los fallos en un entorno controlado deja observar cómo se
//      comporta el agente cuando el error no tiene estructura. El examen evalúa
//      que reconozcas cómo una mala respuesta de error causa reintentos
//      desperdiciados y escalaciones incorrectas.
// You should see: un `customer_lookup` que acepta un identificador y un
//      `failure_mode` que dispara cada condición a demanda.
// ─────────────────────────────────────────────────────────────────────────────

/** El `inputSchema` del ejercicio: identificador + modo acotado a un enum. */
export const CUSTOMER_LOOKUP_INPUT_SCHEMA = {
  type: "object",
  properties: {
    identifier: { type: "string" },
    mode: {
      type: "string",
      enum: ["success", "not_found", "timeout", "invalid", "business", "permission"],
    },
  },
  required: ["identifier"],
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Paso 2 y 3 — Los cuatro errores con metadata estructurada
//
// Why: cada categoría exige una estrategia de recuperación distinta, y sin
//      `errorCategory` + `isRetryable` + `description` el agente no puede
//      distinguir un timeout transitorio de una violación de política
//      permanente. `isRetryable: false` significa camino alternativo, no
//      reintento.
// You should see: cuatro respuestas con `isError: true`, su categoría, el
//      booleano correcto y una descripción que explica qué pasó y qué hacer.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ¿Puede algún reintento llegar a funcionar alguna vez?
 *
 * La pregunta es estrecha: NO promete que la llamada idéntica vaya a funcionar.
 * Transient y validation son retryable por vías distintas (reenviar sin cambios
 * vs corregir el input); business y permission no lo son porque una regla que
 * bloquea bloquea siempre y un problema de credenciales se resuelve con otro
 * principal, no con otras palabras.
 *
 * @param category - La categoría del fallo.
 * @returns `true` si un reintento (posiblemente corregido) podría tener éxito.
 */
export function isCategoryRetryable(category: ErrorCategory): boolean {
  switch (category) {
    case "transient":
    case "validation":
      return true;
    case "business":
    case "permission":
      return false;
  }
}

/**
 * Construye una respuesta de error estructurada.
 *
 * `isRetryable` se deriva de la categoría para que sea imposible publicar un
 * business error como reintentable.
 *
 * @param category - Una de las cuatro categorías.
 * @param description - Frase que explica el fallo y sugiere la recuperación,
 *      redactada en términos que un cliente podría escuchar.
 * @returns El resultado MCP con `isError: true` y su payload estructurado.
 */
export function buildErrorResponse(category: ErrorCategory, description: string): McpToolResult {
  const payload: ToolErrorPayload = {
    errorCategory: category,
    isRetryable: isCategoryRetryable(category),
    description,
  };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

/** Las cuatro descripciones del ejercicio, una por categoría. */
export const ERROR_DESCRIPTIONS: Readonly<Record<ErrorCategory, string>> = {
  transient:
    "The order database is under load and refused the connection. Nothing is wrong with this request; sending it again shortly should work.",
  validation:
    "Order IDs take the form #NNNNN, for example #12345. Reformat the identifier and send it again.",
  business:
    "£750 is above the £500 ceiling for automatic refunds, so this one needs a manager to approve it. Hand the refund details to a human agent.",
  permission:
    "Financial records are outside what this service account may read. Pass the request to a senior agent whose access covers the financial system.",
};

// ─────────────────────────────────────────────────────────────────────────────
// Paso 4 — Valid empty result, estructuralmente distinto de un access failure
//
// Why: es la distinción más crítica del Dominio 2. Confundir un access failure
//      con un empty result válido causa reintentos desperdiciados y
//      escalaciones incorrectas: el agente aplica su manejo de fallos a un
//      éxito.
// You should see: dos respuestas estructuralmente distintas — empty con
//      `isError: false` y `resultCount: 0`, frente a access failure con
//      `isError: true`, `errorCategory: "transient"` e `isRetryable: true`.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Construye un resultado vacío VÁLIDO.
 *
 * La query corrió y la respuesta es que no hay match. Reintentar repetiría una
 * operación exitosa para obtener la misma respuesta correcta.
 *
 * @param identifier - El identificador buscado.
 * @returns Un éxito con `resultCount: 0`.
 */
export function buildEmptyResult(identifier: string): McpToolResult {
  const payload: LookupSuccessPayload = {
    resultCount: 0,
    customers: [],
  };
  return {
    isError: false,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          resultCount: 0,
          message: `No customer found matching ${identifier}. The query executed successfully but returned no matches.`,
        }),
      },
    ],
    structuredContent: payload,
  };
}

/**
 * La tool del ejercicio: enruta cada `mode` a su resultado.
 *
 * @param request - Identificador y modo de fallo a simular.
 * @returns El resultado MCP correspondiente.
 */
export function customerLookup(request: LookupRequest): McpToolResult {
  switch (request.mode) {
    case "success": {
      const customer = MOCK_DB[request.identifier];
      if (customer === undefined) return buildEmptyResult(request.identifier);
      const payload: LookupSuccessPayload = { resultCount: 1, customers: [customer] };
      return {
        isError: false,
        content: [{ type: "text", text: JSON.stringify(payload) }],
        structuredContent: payload,
      };
    }
    case "not_found":
      // Éxito: la búsqueda corrió y no encontró nada. NO es un error.
      return buildEmptyResult(request.identifier);
    case "timeout":
      return buildErrorResponse("transient", ERROR_DESCRIPTIONS.transient);
    case "invalid":
      return buildErrorResponse("validation", ERROR_DESCRIPTIONS.validation);
    case "business":
      return buildErrorResponse("business", ERROR_DESCRIPTIONS.business);
    case "permission":
      return buildErrorResponse("permission", ERROR_DESCRIPTIONS.permission);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 5 — El agent loop que lee la metadata y actúa
//
// Why: es el resultado práctico de la metadata estructurada. Cada categoría
//      mapea a una acción concreta y el loop debe ramificar correctamente.
// You should see: reintentos de transient hasta 3 veces con backoff, corrección
//      de input para validation, escalación para business y petición de
//      credenciales para permission.
// ─────────────────────────────────────────────────────────────────────────────

/** Cota de reintentos para fallos transitorios. */
const MAX_TRANSIENT_RETRIES = 3;

/** La decisión de recuperación que el agente toma con la metadata. */
export type RecoveryAction =
  | { readonly kind: "accept_empty" }
  | { readonly kind: "proceed"; readonly resultCount: number }
  | { readonly kind: "retry"; readonly attempt: number; readonly delayMs: number }
  | { readonly kind: "fix_input"; readonly description: string }
  | { readonly kind: "escalate"; readonly description: string }
  | { readonly kind: "request_credentials"; readonly description: string };

/**
 * Decide la recuperación a partir del resultado de la tool.
 *
 * @param result - El resultado MCP, éxito o fallo.
 * @param attempt - Reintentos ya consumidos (0 en la primera llamada).
 * @returns La acción a tomar.
 */
export function decideRecovery(result: McpToolResult, attempt: number): RecoveryAction {
  if (!result.isError) {
    const payload = result.structuredContent;
    // Sin matches no es un fallo: se acepta la respuesta y se termina.
    if (payload === undefined || payload.resultCount === 0) {
      return { kind: "accept_empty" };
    }
    return { kind: "proceed", resultCount: payload.resultCount };
  }

  const payload = result.structuredContent;
  if (payload === undefined) {
    // Un fallo sin metadata no se puede decidir: no reintentes a ciegas.
    return { kind: "escalate", description: "Unstructured failure: cannot decide recovery." };
  }

  switch (payload.errorCategory) {
    case "transient":
      return attempt < MAX_TRANSIENT_RETRIES
        ? { kind: "retry", attempt: attempt + 1, delayMs: 1000 * 2 ** attempt }
        : { kind: "escalate", description: payload.description };
    case "validation":
      return { kind: "fix_input", description: payload.description };
    case "business":
      // La regla no cede en el segundo intento: reintentar solo gasta llamadas.
      return { kind: "escalate", description: payload.description };
    case "permission":
      return { kind: "request_credentials", description: payload.description };
    default: {
      const exhaustive: never = payload.errorCategory;
      return exhaustive;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Extra — Propagación multi-agente: recuperación local y resultados parciales
//
// Why: los fallos se manejan lo más abajo posible y solo viajan hacia arriba
//      cuando no se pueden resolver. Un timeout lo reintenta el subagente sin
//      que el coordinator se entere; si se agota, sube con resultados parciales
//      y lo que se intentó.
// You should see: un reporte con cuántas fuentes se intentaron, cuántas
//      fallaron, los resultados parciales y si hace falta escalar.
// ─────────────────────────────────────────────────────────────────────────────

/** Resultado de una fuente dentro de un subagente. */
interface SourceOutcome {
  readonly source: string;
  readonly status: "ok" | "timeout";
  readonly findings: readonly string[];
}

/** Lo que un subagente reporta hacia arriba: nunca un "falló" pelado. */
interface SubagentReport {
  readonly attempted: number;
  readonly succeeded: number;
  readonly failedSources: readonly string[];
  readonly partialResults: readonly string[];
  readonly escalate: boolean;
}

/**
 * Compone el reporte que un subagente propaga al coordinator.
 *
 * Ni "search complete" (traga el fallo y lo presenta como éxito) ni "search
 * failed" (descarta el trabajo que sí salió): lo que realmente pasó.
 *
 * @param outcomes - El resultado de cada fuente.
 * @returns El reporte con parciales y lo intentado.
 */
export function buildSubagentReport(outcomes: readonly SourceOutcome[]): SubagentReport {
  const failed = outcomes.filter((outcome) => outcome.status === "timeout");
  return {
    attempted: outcomes.length,
    succeeded: outcomes.length - failed.length,
    failedSources: failed.map((outcome) => outcome.source),
    partialResults: outcomes.flatMap((outcome) => outcome.findings),
    escalate: failed.length > 0,
  };
}

/**
 * ============================================================================
 * ✗ ANTI-PATTERN — Lo que rompe la recuperación
 * ============================================================================
 */

/** ✗ ANTI-PATTERN 1 — Error genérico sin metadata.
 *
 * Sin `errorCategory`, `isRetryable` y una descripción usable, las cuatro
 * categorías son indistinguibles: una negativa de política se reintenta como un
 * timeout y un input malformado se escala como un problema de permisos.
 */
// return { isError: true, content: [{ type: "text", text: "Operation failed" }] };

/** ✗ ANTI-PATTERN 2 — Tratar un business error como reintentable.
 *
 * Un refund por encima del límite se rechaza porque una regla lo dice, y la
 * regla rige en cada intento. Reintentar gasta llamadas que llegan al mismo
 * rechazo; el camino es otro — escalar.
 */
// if (error.errorCategory === "business") { await retry(call); }  // nunca funciona

/** ✗ ANTI-PATTERN 3 — Reintentar un empty result válido.
 *
 * La query corrió y la respuesta es que no hay nada. Reintentar repite una
 * operación exitosa, y la escalación posterior presenta a un humano una
 * pregunta ya resuelta como si siguiera abierta.
 */
// if (data.resultCount === 0) { for (let i = 0; i < 3; i++) await retry(call); }

/** ✗ ANTI-PATTERN 4 — Misma forma para el access failure y el empty result.
 *
 * Devolver `[]` en ambos casos hace que "llegué a la base y no hay match" y "no
 * llegué a la base" se vean iguales, así que el agente aplica su manejo de
 * fallos a un éxito.
 */
// return { isError: false, content: [{ type: "text", text: "[]" }] };  // en ambos casos

/** ✗ ANTI-PATTERN 5 — Tragarse el error y reportar éxito vacío.
 *
 * "No pude buscar" se vuelve indistinguible de "no había nada que encontrar", y
 * el coordinator — el único que podía reintentar en otro sitio o acotar el
 * alcance — nunca se entera.
 */
// catch { return { isError: false, content: [{ type: "text", text: "[]" }] }; }

/** ✗ ANTI-PATTERN 6 — Abortar el workflow entero por un subagente.
 *
 * "Search failed" descarta los resultados que sí llegaron y eran recuperables.
 * El reporte correcto es "3 de 5 fuentes salieron, las 4 y 5 dieron timeout".
 */
// if (anySourceFailed) throw new Error("Search failed");  // tira 3 resultados buenos

/** ✗ ANTI-PATTERN 7 — Un protocol error para un fallo de ejecución.
 *
 * Un tool execution error va DENTRO de un resultado JSON-RPC exitoso con
 * `isError: true`. Un error de protocolo (tool desconocida, request malformado)
 * es otra cosa y el modelo nunca lo ve, así que no puede recuperarse de él.
 */
// throw new McpError(-32603, "Internal error");  // el modelo no ve esto

/**
 * ============================================================================
 * EXAM TRAPS — distractores recurrentes y criterio de rechazo
 * ============================================================================
 *
 * | Trampa                                             | Por qué se rechaza                                  |
 * |----------------------------------------------------|-----------------------------------------------------|
 * | Reintentar un empty result de una query exitosa    | Repite una operación exitosa; la respuesta no cambia |
 * | "Operation failed" sin metadata                    | Las cuatro categorías se vuelven indistinguibles     |
 * | Tratar business errors como retryable              | La regla rige en cada intento; hay que escalar       |
 * | Suprimir el error del subagente como éxito vacío   | El coordinator no puede compensar lo que no ve       |
 *
 * QUICK REFERENCE — datos de la fuente
 *
 *   Dos mecanismos MCP ..... protocol errors (JSON-RPC: tool desconocida,
 *                            args inválidos, error de servidor) vs tool
 *                            execution errors (`isError: true` dentro de un
 *                            resultado exitoso)
 *   Semántica de isError ... true = la tool falló; el modelo razona sobre la
 *                            recuperación en vez de leer el texto como resultado
 *   Equivalente API ........ `tool_result.is_error`; con el MCP connector,
 *                            `mcp_tool_result.is_error`
 *   structuredContent ...... objeto JSON de output estructurado; serializar
 *                            también a un bloque text por back-compat
 *   outputSchema ........... si se declara: el servidor MUST conformar, el
 *                            cliente SHOULD validar — garantiza los campos
 *   Cuatro categorías ...... transient (reintentar tras espera) · validation
 *                            (corregir input, reintentar) · business (nunca
 *                            reintentar, escalar) · permission (escalar / otras
 *                            credenciales)
 *   isRetryable ............ responde "¿puede algún reintento tener éxito?";
 *                            true para transient/validation, false para
 *                            business/permission
 *   Access failure ......... `isError: true` (no se alcanzó el dato)
 *   Empty result ........... `isError: false`, `resultCount: 0` (se alcanzó, no
 *                            había nada)
 *   Human-in-the-loop ...... el spec dice que SHOULD haber siempre un humano
 *                            capaz de denegar invocaciones — base para tratar
 *                            permission como escalate-only
 *   Retry automático ....... Claude reintenta 2-3 veces llamadas malformadas a
 *                            nivel de modelo, antes de tu tool; es OTRO
 *                            mecanismo que `isRetryable`
 *   Agent SDK .............. convierte excepciones no capturadas en error
 *                            results; es una red de seguridad, no un sustituto
 *                            del error estructurado
 *   Propagación ............ recuperación local de transient; propagar solo lo
 *                            irresoluble con resultados parciales y lo intentado
 *
 * ============================================================================
 * FLUJO DE EJECUCIÓN ESPERADO  (trace ilustrativo — no se ejecuta)
 * ============================================================================
 *
 * customerLookup({ identifier: "john@example.com", mode: "not_found" })
 *   → { isError: false, resultCount: 0 }          ← la query CORRIÓ, no hay match
 *   decideRecovery(result, 0) → { kind: "accept_empty" }
 *   ✅ se acepta la respuesta; 0 reintentos, 0 escalaciones
 *
 * customerLookup({ identifier: "john@example.com", mode: "timeout" })
 *   → { isError: true, errorCategory: "transient", isRetryable: true }
 *   decideRecovery(result, 0) → { kind: "retry", attempt: 1, delayMs: 1000 }
 *   decideRecovery(result, 1) → { kind: "retry", attempt: 2, delayMs: 2000 }
 *   decideRecovery(result, 2) → { kind: "retry", attempt: 3, delayMs: 4000 }
 *   decideRecovery(result, 3) → { kind: "escalate", description: "…under load…" }
 *
 * customerLookup({ identifier: "order-abc", mode: "invalid" })
 *   → { isError: true, errorCategory: "validation", isRetryable: true }
 *   decideRecovery(result, 0) → { kind: "fix_input", description: "…#NNNNN…" }
 *
 * customerLookup({ identifier: "CUST-00001", mode: "business" })
 *   → { isError: true, errorCategory: "business", isRetryable: false }
 *   decideRecovery(result, 0) → { kind: "escalate" }   ← NUNCA retry
 *
 * customerLookup({ identifier: "CUST-00001", mode: "permission" })
 *   → { isError: true, errorCategory: "permission", isRetryable: false }
 *   decideRecovery(result, 0) → { kind: "request_credentials" }
 *
 * ANTI-PATRÓN: si `not_found` devolviera `[]` con la MISMA forma que el timeout,
 * el agente reintentaría 3 veces una búsqueda que ya tuvo éxito y luego escalaría
 * a un humano para confirmar una respuesta que ya tenía.
 *
 * Subagente sobre 5 fuentes, 2 con timeout tras recuperación local:
 *   buildSubagentReport(...) → { attempted: 5, succeeded: 3,
 *                                failedSources: ["source4", "source5"],
 *                                partialResults: [...3 fuentes...], escalate: true }
 *   ✅ el coordinator decide con la foto completa: reintentar en otro sitio,
 *      acotar el alcance, o seguir con lo encontrado
 */
