/**
 * ============================================================================
 * DOMINIO 1 · TASK STATEMENT 1.5 — Agent SDK Hooks
 * ----------------------------------------------------------------------------
 * Objetivo oficial:
 *   Apply Agent SDK hooks for tool call interception and data normalization.
 *
 * Qué evalúa el examen aquí:
 *   Un hook es un punto de intercepción determinista en el ciclo de una tool, y
 *   su dirección es lo que define para qué sirve. `PostToolUse` corre DESPUÉS
 *   de la ejecución y antes de que el modelo procese el resultado: es el lugar
 *   correcto para normalizar datos heterogéneos. `PreToolUse` corre ANTES: es el
 *   único lugar correcto para enforcement de política, porque cuando el hook
 *   bloquea, la acción nunca ocurrió. El marco de decisión es simple — hooks
 *   para requisitos del 100%, prompts para preferencias.
 *
 * Build Exercise: Implement Agent SDK Hooks for Normalisation and Policy Enforcement
 *                 (Advanced · 60 min)
 * ============================================================================
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tipos del Agent SDK (forma fiel a la config de `hooks`)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Eventos de hook del Agent SDK.
 *
 * Disponibles en Python y TypeScript: `PreToolUse`, `PostToolUse`,
 * `PostToolUseFailure`, `UserPromptSubmit`, `Stop`, `SubagentStart`,
 * `SubagentStop`, `PreCompact`, `PermissionRequest`, `Notification`.
 * Solo TypeScript: `SessionStart`, `SessionEnd`.
 */
type HookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "UserPromptSubmit"
  | "Stop"
  | "SubagentStart"
  | "SubagentStop"
  | "PreCompact"
  | "PermissionRequest"
  | "Notification"
  | "SessionStart"
  | "SessionEnd";

/** Entrada que recibe un hook de `PreToolUse`. */
interface PreToolUseInput {
  readonly hook_event_name: "PreToolUse";
  readonly tool_name: string;
  readonly tool_input: Readonly<Record<string, unknown>>;
}

/** Entrada que recibe un hook de `PostToolUse`, ya con la respuesta. */
interface PostToolUseInput {
  readonly hook_event_name: "PostToolUse";
  readonly tool_name: string;
  readonly tool_input: Readonly<Record<string, unknown>>;
  readonly tool_response: string;
}

/**
 * Decisión de un hook `PreToolUse`.
 *
 * No existe un booleano en el contrato: es un enum de cuatro valores. El
 * "allow sin cambios" mínimo se expresa devolviendo `{}`.
 *
 * Prioridad cuando coinciden varios hooks o reglas: `deny` > `defer` > `ask` >
 * `allow`. Si cualquier hook devuelve `deny`, la operación se bloquea aunque
 * otro hubiera permitido.
 */
type PermissionDecision = "allow" | "deny" | "ask" | "defer";

/**
 * Salida de un hook de `PreToolUse` (los campos viven en `hookSpecificOutput`).
 *
 * `updatedInput` permite reescribir la llamada antes de que corra, no solo
 * bloquearla: p. ej. capar el importe en $500 y auto-aprobar el capado.
 */
interface PreToolUseOutput {
  readonly hookSpecificOutput: {
    readonly hookEventName: "PreToolUse";
    readonly permissionDecision: PermissionDecision;
    readonly permissionDecisionReason?: string;
    readonly updatedInput?: Readonly<Record<string, unknown>>;
  };
}

/**
 * Salida de un hook de `PostToolUse`.
 *
 * `updatedToolOutput` REEMPLAZA lo que lee el modelo; `additionalContext` solo
 * añade una nota y deja el valor crudo intacto. Para normalizar, replace.
 */
interface PostToolUseOutput {
  readonly hookSpecificOutput: {
    readonly hookEventName: "PostToolUse";
    readonly updatedToolOutput?: string;
    readonly additionalContext?: string;
  };
}

/** Construye una salida `PreToolUse` con su decisión y el motivo opcional. */
const preToolUse = (
  permissionDecision: PermissionDecision,
  permissionDecisionReason?: string,
): PreToolUseOutput => ({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision,
    ...(permissionDecisionReason === undefined ? {} : { permissionDecisionReason }),
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Dirección del hook: qué se registra en cada evento y por qué
//
// PreToolUse   → política (la acción aún no ocurrió; puede allow/deny/ask/defer)
// PostToolUse  → normalización (la acción ya ocurrió; reemplaza el output)
// SubagentStart→ observa el spawn: registra y añade contexto, NO puede bloquear
// SubagentStop → valida la salida: puede bloquear la finalización con un motivo
//
// Un `matcher` (p. ej. `"process_refund|transfer_funds"`, o `^mcp__` para toda
// tool MCP) acota el hook a tools concretas; sin matcher corre para todas.
// ─────────────────────────────────────────────────────────────────────────────

/** Registro de qué hook vive en cada evento. La dirección es la decisión clave. */
export const hookRegistry: Readonly<Partial<Record<HookEvent, readonly string[]>>> = {
  PreToolUse: ["preToolUseRefundCapHook", "preToolUseAmlGateHook"],
  PostToolUse: ["postToolUseNormaliseHook"],
  // Start y Stop son hooks de ciclo de vida de subagentes: nunca transforman
  // output — eso es Pre/PostToolUse sobre la tool `Agent`.
  SubagentStart: ["recordSubagentSpawn"],
  SubagentStop: ["validateSubagentResult"],
};

// ─────────────────────────────────────────────────────────────────────────────
// Paso 1 — Tres MCP tools con formatos caóticos
//
// Why: sin normalización el modelo tiene que interpretar tres formatos de fecha
//      y tres representaciones de status, y la interpretación se vuelve
//      inconsistente entre iteraciones.
// You should see: Tool A con epoch + código numérico, Tool B con ISO + status
//      en inglés, Tool C con DD/MM/YYYY + carácter único.
// ─────────────────────────────────────────────────────────────────────────────

/** Tool A: devuelve epoch seconds y códigos numéricos. */
const toolA = (): string =>
  JSON.stringify({ order_id: "ord_1001", created: 1726790400, status: 1 });

/** Tool B: devuelve ISO 8601 y status en inglés. */
const toolB = (): string =>
  JSON.stringify({ order_id: "ord_1002", created: "2026-09-20T00:00:00Z", status: "shipped" });

/** Tool C: devuelve DD/MM/YYYY y un carácter de status. */
const toolC = (): string =>
  JSON.stringify({ order_id: "ord_1003", created: "21/09/2026", status: "P" });

// ─────────────────────────────────────────────────────────────────────────────
// Paso 2 — PostToolUse: normalizar fechas y status
//
// Why: PostToolUse corre después de la ejecución pero antes de que el modelo
//      procese el resultado. Es la dirección correcta para data normalisation.
// You should see: un hook que detecta el formato de cada campo y lo convierte —
//      epoch → ISO 8601, DD/MM/YYYY → ISO 8601, códigos → palabras.
// ─────────────────────────────────────────────────────────────────────────────

/** Mapas de traducción de status por herramienta. */
const numericStatus: Readonly<Record<string, string>> = {
  "1": "shipped",
  "2": "delivered",
  "3": "returned",
};

const charStatus: Readonly<Record<string, string>> = {
  P: "pending",
  S: "shipped",
  C: "cancelled",
};

/**
 * Convierte cualquier fecha soportada a ISO 8601.
 *
 * Acepta epoch seconds (número), ISO ya presente, y DD/MM/YYYY. El orden de
 * comprobación importa: DD/MM/YYYY es ambiguo para `Date.parse`, así que se
 * detecta antes.
 *
 * @param value - Fecha en cualquiera de los tres formatos.
 * @returns La fecha en ISO 8601, o `null` si no se pudo interpretar.
 */
function toIso8601(value: unknown): string | null {
  if (typeof value === "number") {
    // Epoch seconds → milisegundos.
    return new Date(value * 1000).toISOString();
  }
  if (typeof value !== "string") return null;

  const ddmmyyyy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (ddmmyyyy !== null) {
    const [, day, month, year] = ddmmyyyy;
    // Ojo: en DD/MM/YYYY el segundo grupo es el mes, no el día. Confundirlos es
    // el error de interpretación que la normalización elimina.
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).toISOString();
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/**
 * Normaliza el status de cualquier tool a una palabra en inglés.
 *
 * @param value - Status numérico, de un carácter, o ya textual.
 * @returns El status legible, o `null` si no se reconoce.
 */
function toStatusWord(value: unknown): string | null {
  if (typeof value === "number") return numericStatus[String(value)] ?? null;
  if (typeof value !== "string") return null;
  if (value.length === 1) return charStatus[value.toUpperCase()] ?? null;
  return value;
}

/**
 * Hook `PostToolUse`: normaliza fecha y status de cualquier tool.
 *
 * Corre después de la ejecución, así que transforma el dato en lugar de
 * impedir la acción. Usa `updatedToolOutput` (reemplaza) y no `additionalContext`
 * (que solo añadiría una nota dejando el valor crudo al alcance del modelo).
 *
 * @param input - Entrada del hook con la respuesta cruda de la tool.
 * @returns La salida con fecha en ISO 8601 y status en inglés.
 */
function postToolUseNormaliseHook(input: PostToolUseInput): PostToolUseOutput {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(input.tool_response) as Record<string, unknown>;
  } catch {
    return {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        updatedToolOutput: input.tool_response,
      },
    };
  }

  const normalised = Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => {
      if (key === "created" || key.endsWith("_at")) {
        return [key, toIso8601(value) ?? value];
      }
      if (key === "status") {
        return [key, toStatusWord(value) ?? value];
      }
      return [key, value];
    }),
  );

  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      updatedToolOutput: JSON.stringify(normalised),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 3 — Verificar consistencia con las tres tools
//
// Why: los datos consistentes eliminan errores de interpretación. Sin
//      normalización el modelo puede confundir día y mes, o leer `P` como
//      processed en vez de pending.
// You should see: tres resultados en ISO 8601 y status en inglés,
//      independientemente de qué tool los produjo.
// ─────────────────────────────────────────────────────────────────────────────

/** Aplica el hook de normalización y devuelve el JSON resultante. */
const normalise = (response: string): string =>
  postToolUseNormaliseHook({
    hook_event_name: "PostToolUse",
    tool_name: "any",
    tool_input: {},
    tool_response: response,
  }).hookSpecificOutput.updatedToolOutput ?? response;

/**
 * Verifica que las tres tools produzcan datos homogéneos.
 *
 * @returns Los tres resultados normalizados.
 */
export function verifyConsistency(): readonly string[] {
  return [toolA(), toolB(), toolC()].map(normalise);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pasos 4 y 5 — PreToolUse: política antes de la ejecución
//
// Why: un hook `PreToolUse` corre antes de la ejecución, así que el refund
//      nunca ocurre. El examen advierte contra usar `PostToolUse` para
//      bloquear: para entonces la acción ya sucedió.
// You should see: dos gates — uno por umbral ($500) y otro por precondición
//      (aml_check) — que devuelven `permissionDecision: "deny"` con un motivo.
// ─────────────────────────────────────────────────────────────────────────────

/** Umbral de refund que requiere escalado humano. */
const REFUND_AUTO_APPROVAL_LIMIT = 500;

/**
 * Hook `PreToolUse`: bloquea refunds por encima del umbral.
 *
 * @param input - Entrada del hook con la tool call a evaluar.
 * @returns `allow`, o `deny` con el motivo y la vía de escalado.
 */
function preToolUseRefundCapHook(input: PreToolUseInput): PreToolUseOutput {
  if (input.tool_name !== "process_refund") return preToolUse("allow");

  const amount = Number(input.tool_input.amount ?? 0);
  if (amount > REFUND_AUTO_APPROVAL_LIMIT) {
    return preToolUse(
      "deny",
      `Refund of $${amount} exceeds the $${REFUND_AUTO_APPROVAL_LIMIT} auto-approval limit. ` +
        `Escalate to the human approval workflow instead.`,
    );
  }
  return preToolUse("allow");
}

/** Estado de sesión mínimo para la precondición de AML. */
interface ComplianceSessionState {
  readonly completedChecks: readonly string[];
}

/**
 * Hook `PreToolUse`: bloquea transferencias sin AML check aprobado.
 *
 * Los prompts dan ~95% de cumplimiento; los requisitos regulatorios exigen 100%.
 * El hook aporta esa garantía determinista.
 *
 * @param input - Entrada del hook con la tool call a evaluar.
 * @param session - Estado de sesión con los checks completados.
 * @returns `allow`, o `deny` hasta que exista un `aml_check` previo.
 */
function preToolUseAmlGateHook(
  input: PreToolUseInput,
  session: ComplianceSessionState,
): PreToolUseOutput {
  if (input.tool_name !== "transfer_funds") return preToolUse("allow");

  if (!session.completedChecks.includes("aml_check")) {
    return preToolUse(
      "deny",
      "transfer_funds requires a passing aml_check in the current session. " +
        "Run aml_check first.",
    );
  }
  return preToolUse("allow");
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 6 — Probar que los hooks bloquean antes de ejecutar
//
// Why: la verificación clave es que la tool bloqueada NUNCA ejecuta — el hook
//      impide la llamada, no solo advierte después.
// You should see: ambas operaciones bloqueadas devuelven el mensaje de
//      intercepción sin ejecutar la tool subyacente.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ejecuta una tool solo si el hook `PreToolUse` lo permite.
 *
 * @param input - La tool call a evaluar.
 * @param session - Estado de sesión de compliance.
 * @param tool - La implementación a ejecutar si se permite.
 * @returns El resultado, o el bloqueo del hook sin haber ejecutado nada.
 */
function guardedExecute<T>(
  input: PreToolUseInput,
  session: ComplianceSessionState,
  tool: () => T,
): { readonly executed: false; readonly reason: string } | { readonly executed: true; readonly value: T } {
  // Prioridad: deny > defer > ask > allow — cualquiera de los dos hooks veta
  // la llamada por sí solo.
  const decisions = [preToolUseRefundCapHook(input), preToolUseAmlGateHook(input, session)];
  const denied = decisions.find(
    (d) => d.hookSpecificOutput.permissionDecision === "deny",
  );

  if (denied !== undefined) {
    return {
      executed: false,
      reason: denied.hookSpecificOutput.permissionDecisionReason ?? "denied by policy hook",
    };
  }
  return { executed: true, value: tool() };
}

/** Escenario de prueba de ambos hooks. */
export function runScenario(): void {
  const session: ComplianceSessionState = { completedChecks: [] };

  const bigRefund = guardedExecute(
    { hook_event_name: "PreToolUse", tool_name: "process_refund", tool_input: { amount: 900 } },
    session,
    () => "refund processed",
  );
  console.log("Refund $900:", bigRefund);

  const transfer = guardedExecute(
    { hook_event_name: "PreToolUse", tool_name: "transfer_funds", tool_input: { amount: 100 } },
    session,
    () => "transfer complete",
  );
  console.log("Transfer:", transfer);
}

/**
 * ============================================================================
 * ✗ ANTI-PATTERN — Confundir la dirección del hook
 * ============================================================================
 */

/** ✗ ANTI-PATTERN 1 — Bloquear desde `PostToolUse`.
 *
 * Cuando el hook corre, la tool ya ejecutó. Bloquear el refund aquí significa
 * que el dinero ya se movió y ahora el modelo recibe un mensaje de error sobre
 * una acción consumada.
 */
// PostToolUse: process_refund → if (amount > 500) return "blocked";  // tarde

/** ✗ ANTI-PATTERN 2 — Normalizar desde `PreToolUse`.
 *
 * Antes de ejecutar no hay resultado que normalizar. El hook vería la entrada,
 * no la salida, y el dato heterogéneo llegaría intacto al modelo.
 */
// PreToolUse: updatedToolOutput → normalise(...)   // no hay output que reemplazar aún

/** ✗ ANTI-PATTERN 3 — Confiar en el prompt para el umbral o el AML.
 *
 * 95% de cumplimiento no es un control regulatorio. Un solo check omitido puede
 * tener consecuencias legales.
 */
// systemPrompt: "Never refund more than $500. Always run aml_check first."

/** ✗ ANTI-PATTERN 4 — Normalización heurística dentro del prompt.
 *
 * Pedirle al modelo que "interprete DD/MM/YYYY como día/mes" reintroduce el
 * error de interpretación que el hook elimina de raíz.
 */
// systemPrompt: "Dates are sometimes DD/MM/YYYY — be careful with day and month."

/**
 * ============================================================================
 * EXAM TRAPS
 * ============================================================================
 *
 * | Trampa                                  | Criterio de rechazo                                   |
 * |-----------------------------------------|-------------------------------------------------------|
 * | `PostToolUse` para bloquear             | La acción ya ocurrió; el daño está hecho              |
 * | `PreToolUse` para normalizar            | No hay output que reemplazar con `updatedToolOutput`  |
 * | Prompt para umbral/AML                  | Requisito del 100% ⇒ hook, no instrucción             |
 * | Hook que solo loguea la infracción      | Un hook de política debe impedir, no documentar       |
 *
 * Marco de decisión: **hooks para el 100%, prompts para preferencias.**
 * Prioridad de decisiones: **deny > defer > ask > allow** (cualquier deny bloquea).
 *
 * QUICK REFERENCE — datos de la fuente
 *
 *   Eventos en Python Y TS ... PreToolUse, PostToolUse, PostToolUseFailure, UserPromptSubmit,
 *                              Stop, SubagentStart, SubagentStop, PreCompact,
 *                              PermissionRequest, Notification
 *   Solo TypeScript .......... SessionStart, SessionEnd
 *   Forma de `hooks` ......... dict[HookEvent, list[HookMatcher]]
 *   HookMatcher.matcher ...... se prueba contra el target del evento (p. ej. el nombre de la
 *                              tool); alternaciones (Write|Edit) o regex (^mcp__);
 *                              omitido = corre para todos los eventos de ese tipo
 *   permissionDecision ....... allow, deny, ask, defer
 *   Otros campos de PreToolUse  permissionDecisionReason, updatedInput
 *   updatedInput + allow ..... auto-aprueba el input modificado
 *   updatedInput + ask ....... muestra el input modificado al usuario
 *   updatedInput sin decisión  el input modificado aplica igual y pasa por la evaluación normal
 *   PostToolUse additionalContext  añade info al resultado (el original queda intacto)
 *   PostToolUse updatedToolOutput  reemplaza el output antes de que Claude lo vea
 *   Prioridad de decisión .... deny > defer > ask > allow; cualquier deny bloquea
 *   "Allow sin cambios" mínimo  {}
 *   Campos en toda salida ..... systemMessage, continue/continue_
 *
 * ============================================================================
 * FLUJO DE EJECUCIÓN ESPERADO  (trace ilustrativo — no se ejecuta)
 * ============================================================================
 *
 * ── Normalización (PostToolUse) ──────────────────────────────────────────────
 * toolA() → { created: 1726790400,          status: 1 }   epoch + numérico
 *            ↓ PostToolUse
 *          { created: "2024-09-20T00:00:00.000Z", status: "shipped" }
 *
 * toolB() → { created: "2026-09-20T00:00:00Z", status: "shipped" }  ISO + inglés
 *            ↓ PostToolUse
 *          { created: "2026-09-20T00:00:00.000Z", status: "shipped" }   (sin cambio)
 *
 * toolC() → { created: "21/09/2026",        status: "P" }   DD/MM/YYYY + char
 *            ↓ PostToolUse
 *          { created: "2026-09-21T00:00:00.000Z", status: "pending" }
 *            ↑ día 21, mes 09 — no confundidos
 *
 * verifyConsistency() → 3/3 en ISO 8601 + status en inglés  ✓
 *
 * ── Política (PreToolUse) ────────────────────────────────────────────────────
 * tool_call process_refund(amount: 900)
 *   PreToolUse refundCap → 900 > 500 → permissionDecision: "deny"
 *                                      permissionDecisionReason: "Refund of $900 exceeds …"
 *   → guardedExecute() → { executed: false }        ← refund NUNCA corrió
 *
 * tool_call transfer_funds(amount: 100), session.completedChecks = []
 *   PreToolUse amlGate → falta "aml_check" → permissionDecision: "deny"
 *                                            permissionDecisionReason: "transfer_funds requires …"
 *   → guardedExecute() → { executed: false }        ← transfer NUNCA corrió
 *
 * (tras satisfacer precondiciones: aml_check completado y refund ≤ $500)
 * process_refund(amount: 400) → allow → { executed: true }   ✓
 * transfer_funds(amount: 100) → allow → { executed: true }   ✓
 *
 * ANTI-PATRÓN (PostToolUse bloqueando):
 *   tool_call process_refund(amount: 900)
 *     → tool EJECUTA (el dinero se mueve)
 *     → PostToolUse → "blocked"
 *   realizado irreversible, y el modelo recibe un error sobre algo ya hecho
 */

export {};
