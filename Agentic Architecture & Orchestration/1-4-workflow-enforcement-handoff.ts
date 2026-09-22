/**
 * ============================================================================
 * DOMINIO 1 · TASK STATEMENT 1.4 — Workflow Enforcement and Handoff
 * ----------------------------------------------------------------------------
 * Objetivo oficial:
 *   Implement multi-step workflows with enforcement and handoff patterns.
 *
 * Qué evalúa el examen aquí:
 *   Cuando el orden de los pasos ES el requisito — dinero, seguridad,
 *   cumplimiento — la flexibilidad del modelo deja de ser una virtud. Una
 *   instrucción de prompt se cumple el 92% de las veces y falla el 8%; un
 *   prerequisite gate se cumple el 100% porque bloquea la ejecución en código.
 *   El examen rechaza siempre la solución basada en prompt para operaciones
 *   financieras. Y cuando el caso se escala a un humano, el handoff debe ser
 *   autocontenido: el humano no ve el transcript, solo tu resumen.
 *
 * Build Exercise: Build a Prerequisite Gate for Financial Operations  (Advanced · 60 min)
 * ============================================================================
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tipos del dominio
// ─────────────────────────────────────────────────────────────────────────────

/** Resultado tipado de una tool. Los fallos viajan como datos, no como throws. */
type ToolOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

/** Cliente tal como lo devuelve `get_customer`. */
interface Customer {
  readonly customerId: string;
  readonly name: string;
  readonly verified: boolean;
}

interface Order {
  readonly orderId: string;
  readonly customerId: string;
  readonly total: number;
  readonly status: "shipped" | "delivered" | "returned";
}

interface RefundReceipt {
  readonly refundId: string;
  readonly customerId: string;
  readonly amount: number;
}

/**
 * Estado de sesión.
 *
 * Es el soporte del gate: registra hechos que deben seguir siendo ciertos en
 * pasos posteriores del mismo workflow (p. ej. "este cliente ya se verificó").
 */
interface SessionState {
  /** Último cliente verificado en esta sesión, si lo hay. */
  verifiedCustomerId: string | null;
  /** Refunds ya procesados, para idempotencia y auditoría. */
  readonly refundsProcessed: RefundReceipt[];
}

/** Crea el estado inicial de una sesión. */
export const createSessionState = (): SessionState => ({
  verifiedCustomerId: null,
  refundsProcessed: [],
});

// ─────────────────────────────────────────────────────────────────────────────
// Paso 1 — Tres tools que crean la dependencia de workflow
//
// Why: get_customer y process_refund tienen una dependencia de orden — ahí es
//      donde la enforcement programática se vuelve imprescindible.
// You should see: tres tools con `input_schema` correcto y las dependencias
//      entre ellas explícitas.
// ─────────────────────────────────────────────────────────────────────────────

/** Base de datos en memoria, solo para el ejemplo. */
const customersByName: Readonly<Record<string, Customer>> = {
  "ana lopez": { customerId: "cus_4471", name: "Ana Lopez", verified: true },
  "unverified user": { customerId: "cus_9999", name: "Unverified User", verified: false },
};

const ordersById: Readonly<Record<string, Order>> = {
  ord_1001: { orderId: "ord_1001", customerId: "cus_4471", total: 89.5, status: "shipped" },
};

/**
 * Busca un cliente y su estado de verificación.
 *
 * @param nameOrEmail - Nombre o email del cliente.
 * @returns El cliente, o un error si no existe.
 */
function getCustomer(
  session: SessionState,
  nameOrEmail: string,
): ToolOutcome<Customer> {
  const customer = customersByName[nameOrEmail.toLowerCase()];
  if (customer === undefined) {
    return { ok: false, error: `No customer found for "${nameOrEmail}".` };
  }
  // Efecto de sesión: la verificación queda registrada para pasos posteriores.
  if (customer.verified) {
    session.verifiedCustomerId = customer.customerId;
  }
  return { ok: true, value: customer };
}

/**
 * Recupera el detalle de una orden.
 *
 * @param orderId - Identificador de la orden.
 * @returns La orden, o un error si no existe.
 */
export function lookupOrder(orderId: string): ToolOutcome<Order> {
  const order = ordersById[orderId];
  return order === undefined
    ? { ok: false, error: `No order found for "${orderId}".` }
    : { ok: true, value: order };
}

/** Error devuelto por el gate cuando se incumple una precondición. */
const GATE_BLOCKED = "BLOCKED_BY_PREREQUISITE_GATE" as const;

// ─────────────────────────────────────────────────────────────────────────────
// Pasos 2 y 3 — El prerequisite gate, y su prueba de bypass
//
// Why: es el concepto central del examen — el prompt funciona el 92%, el gate el
//      100%. El examen rechaza siempre las soluciones prompt-based para
//      operaciones financieras.
// You should see: un tracker de sesión que registra la verificación, y un
//      handler de `process_refund` que la consulta antes de ejecutar.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Procesa un refund, pero solo si el gate se satisface.
 *
 * El gate es determinista: no depende de que el modelo haya decidido verificar
 * primero. Su comprobación ocurre en la frontera de la tool, así que ninguna
 * decisión del modelo puede saltársela.
 *
 * @param session - Estado de la sesión actual.
 * @param customerId - Cliente al que se le hace el refund.
 * @param amount - Importe a devolver.
 * @returns El recibo, o el error del gate si no hay cliente verificado.
 */
function processRefund(
  session: SessionState,
  customerId: string,
  amount: number,
): ToolOutcome<RefundReceipt> {
  // ── PREREQUISITE GATE ──────────────────────────────────────────────────────
  // Precondición: debe existir un cliente verificado EN ESTA SESIÓN y coincidir
  // con el cliente del refund. Sin esto, la tool no ejecuta nunca.
  const verified = session.verifiedCustomerId;
  if (verified === null) {
    return {
      ok: false,
      error: `${GATE_BLOCKED}: get_customer must return a verified customer before process_refund.`,
    };
  }
  if (verified !== customerId) {
    return {
      ok: false,
      error: `${GATE_BLOCKED}: refund target ${customerId} does not match verified customer ${verified}.`,
    };
  }

  const receipt: RefundReceipt = {
    refundId: `rf_${session.refundsProcessed.length + 1}`,
    customerId,
    amount,
  };
  session.refundsProcessed.push(receipt);
  return { ok: true, value: receipt };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dónde vive realmente la enforcement: orden de evaluación de permisos
//
// Why: el gate es determinista porque corre en un punto que el modelo no
//      controla. El SDK evalúa cada tool call en un orden fijo, y los prompts no
//      aparecen en esa lista — solo moldean lo que el modelo intenta.
// You should see: una comprobación en código, no una instrucción de prompt.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Orden en que el SDK evalúa cada tool call.
 *
 * Un `deny` bloquea incluso en `bypassPermissions`. Un hook que devuelve `allow`
 * NO salta los deny/ask posteriores. `canUseTool` no es universal: solo corre si
 * el flujo llega a un prompt — `acceptEdits`, `bypassPermissions` o una allow
 * rule se lo saltan. Por eso un check que debe correr en *cada* llamada va en un
 * hook `PreToolUse`, no en `canUseTool`.
 */
export const PERMISSION_EVALUATION_ORDER = [
  "hooks",
  "deny rules",
  "ask rules",
  "permission mode",
  "allow rules",
  "canUseTool callback",
] as const;

/**
 * Formas de enforcement programático, de más gruesa a más fina.
 *
 * - Prerequisite gate en el handler (este archivo): comprobación en código.
 * - Hook `PreToolUse` (Task 1.5): el lugar documentado para un gate; corre antes
 *   de cualquier otro paso y su `deny` aplica incluso en bypassPermissions.
 * - `disallowed_tools` con patrón (p. ej. `"Bash(rm *)"`): la tool sigue visible
 *   pero las llamadas que matchean se deniegan en todos los modos.
 */
export type EnforcementLever = "prerequisite_gate" | "pretooluse_hook" | "scoped_deny_rule";

// ─────────────────────────────────────────────────────────────────────────────
// Ciclo de vida de subagentes: SubagentStart y SubagentStop
//
// Why: complementan a Pre/PostToolUse. Son los dos hooks propios de subagentes,
//      y el examen distingue qué puede hacer cada uno.
// You should see: Start observa (no bloquea); Stop puede bloquear la
//      finalización y mandar al subagente de vuelta al trabajo.
//
// Notas: un subagente puede declarar sus propios Pre/PostToolUse en su
// AgentDefinition — observan solo SUS tool calls. Y un `Stop` declarado en el
// frontmatter del subagente se convierte en `SubagentStop` en runtime.
// ─────────────────────────────────────────────────────────────────────────────

/** Resultado de validar el output de un subagente en `SubagentStop`. */
type SubagentStopDecision =
  | { readonly decision: "allow" }
  | { readonly decision: "block"; readonly reason: string };

/**
 * Hook `SubagentStart`: observa el spawn, no lo controla.
 *
 * Recibe el tipo y el id del subagente: registra el spawn o añade contexto.
 * NO puede detener el spawn ni alterarlo. Para enforcement sobre el spawning
 * (rate limit, comprobar que el coordinator pasó el contexto) se usa un
 * `PreToolUse` sobre la tool `Agent`.
 *
 * @param subagentType - Tipo del subagente spawneado.
 * @param subagentId - Id único del spawn.
 */
export function recordSubagentSpawn(subagentType: string, subagentId: string): void {
  void subagentType;
  void subagentId;
  // Observacional: p. ej. telemetría de spawns por tipo.
}

/**
 * Hook `SubagentStop`: valida la salida y puede devolver al subagente al trabajo.
 *
 * Recibe el id y el mensaje final. Si la validación falla (p. ej. no cumple el
 * schema), devuelve `block` con un motivo y el subagente reanuda. Lo que NO
 * puede hacer es transformar lo que devuelve: reescribir o redactar el output
 * es trabajo de un `PostToolUse` sobre la tool `Agent` (`updatedToolOutput`).
 *
 * @param subagentId - Id del subagente que terminó.
 * @param finalMessage - Su mensaje final.
 * @returns `allow`, o `block` con el motivo para que reanude.
 */
export function validateSubagentResult(
  subagentId: string,
  finalMessage: string,
): SubagentStopDecision {
  void subagentId;
  if (finalMessage.trim().length === 0) {
    return { decision: "block", reason: "Subagent returned an empty result; retry." };
  }
  return { decision: "allow" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 4 — Structured handoff con los cinco campos requeridos
//
// Why: el agente humano NO tiene acceso al transcript. El resumen de handoff es
//      lo único que recibe. El examen evalúa que incluyas los cinco campos.
// You should see: un objeto con los cinco campos poblados, ninguno vacío ni con
//      texto de relleno.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Los cinco campos obligatorios del handoff, sin ninguno opcional.
 *
 * Nombres en snake_case como en la especificación: customer_id,
 * conversation_summary, root_cause_analysis, refund_amount, recommended_action.
 */
interface HandoffSummary {
  readonly customer_id: string;
  readonly conversation_summary: string;
  readonly root_cause_analysis: string;
  readonly refund_amount: number;
  readonly recommended_action: string;
}

/**
 * Construye un handoff autocontenido para un agente humano.
 *
 * Autocontenido significa que un humano que nunca vio la conversación puede
 * actuar solo con esto.
 *
 * @param frame - Los cinco campos ya resueltos por el agente.
 * @returns El resumen validado.
 * @throws Si algún campo queda vacío.
 */
function buildHandoffSummary(frame: HandoffSummary): HandoffSummary {
  const required: readonly (keyof HandoffSummary)[] = [
    "customer_id",
    "conversation_summary",
    "root_cause_analysis",
    "refund_amount",
    "recommended_action",
  ];

  const missing = required.filter((field) => {
    const value = frame[field];
    return typeof value === "number" ? Number.isNaN(value) : value.trim().length === 0;
  });

  if (missing.length > 0) {
    throw new Error(`Incomplete handoff; missing: ${missing.join(", ")}`);
  }
  return frame;
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 5 — Multi-concern: decomponer, investigar en paralelo, resolver unificado
//
// Why: el examen espera decomposición, investigación paralela y resolución
//      unificada — no manejo secuencial ni concerns olvidados.
// You should see: el agente identifica los tres concerns, investiga cada uno y
//      produce un handoff que cubre los tres.
// ─────────────────────────────────────────────────────────────────────────────

/** Tipos de concern que puede traer un mismo ticket. */
type ConcernKind = "return" | "billing_dispute" | "account_update";

interface Concern {
  readonly kind: ConcernKind;
  readonly detail: string;
  readonly resolved: boolean;
}

/** Clasificador de concerns a partir del texto del ticket. */
function classifyConcerns(ticketText: string): readonly Concern[] {
  const kinds: readonly ConcernKind[] = ["return", "billing_dispute", "account_update"];
  return kinds
    .filter((kind) => ticketText.toLowerCase().includes(kind.split("_")[0]!))
    .map((kind) => ({ kind, detail: `Detected in ticket: ${kind}`, resolved: false }));
}

/**
 * Resuelve un ticket multi-concern.
 *
 * Los concerns de un mismo ticket son independientes entre sí, así que se
 * investigan en paralelo y luego se resuelven de forma unificada.
 *
 * @param session - Estado de la sesión.
 * @param ticketText - El texto del ticket.
 * @returns El handoff, o `null` si todo se resolvió sin escalar.
 */
export async function resolveMultiConcern(
  session: SessionState,
  ticketText: string,
): Promise<HandoffSummary | null> {
  const concerns = classifyConcerns(ticketText);

  // Investigación paralela: los concerns no dependen entre sí.
  const investigated = await Promise.all(
    concerns.map(async (concern): Promise<Concern> => {
      await Promise.resolve(); // placeholder de una llamada real
      return { ...concern, resolved: concern.kind !== "billing_dispute" };
    }),
  );

  const unresolved = investigated.filter((concern) => !concern.resolved);
  if (unresolved.length === 0) return null;

  return buildHandoffSummary({
    customer_id: session.verifiedCustomerId ?? "UNKNOWN",
    conversation_summary: `Customer raised ${investigated.length} concerns: ${investigated
      .map((c) => c.kind)
      .join(", ")}.`,
    root_cause_analysis: unresolved.map((c) => c.detail).join(" | "),
    refund_amount: 0,
    recommended_action: `Resolve: ${unresolved.map((c) => c.kind).join(", ")}.`,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Escenario
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Demuestra el gate: refund directo (bloqueado) y luego con verificación previa.
 *
 * @param session - Estado de la sesión.
 */
export function runScenario(session: SessionState): void {
  // (a) Intento de bypass: el modelo decide saltarse la verificación.
  const blocked = processRefund(session, "cus_4471", 89.5);
  console.log("Direct refund:", blocked); // → BLOCKED_BY_PREREQUISITE_GATE

  // (b) Con la precondición satisfecha, el refund pasa.
  getCustomer(session, "ana lopez");
  const allowed = processRefund(session, "cus_4471", 89.5);
  console.log("Verified refund:", allowed); // → ok: true
}

/**
 * ============================================================================
 * ✗ ANTI-PATTERN — Enforcement basado en prompt
 * ============================================================================
 */

/** ✗ ANTI-PATTERN 1 — Pedir en el prompt que verifique primero.
 *
 * Funciona ~92% de las veces. Para operaciones financieras, "casi siempre" no
 * es una garantía que un regulador acepte, y el 8% restante no deja rastro.
 */
// systemPrompt: "IMPORTANT: always call get_customer before process_refund."

/** ✗ ANTI-PATTERN 2 — Gate que solo advierte.
 *
 * Un warning no es un gate. Si la tool ejecuta y luego se loguea la infracción,
 * el dinero ya se movió.
 */
// if (session.verifiedCustomerId === null) console.warn("unverified refund!");

/** ✗ ANTI-PATTERN 3 — Handoff que referencia el transcript.
 *
 * El humano no tiene la conversación. Un resumen que dice "ver mensaje 4 del
 * hilo" es un handoff que no se puede accionar.
 */
// return { summary: "See the conversation above for details." };

/** ✗ ANTI-PATTERN 4 — Manejar el multi-concern en serie y olvidar el último.
 *
 * La resolución secuencial sobre un mismo ticket tiende a cerrar tras el primer
 * concern y dejar los otros sin tocar.
 */
// await handleReturn(); return;  // billing_dispute y account_update sin resolver

/**
 * ============================================================================
 * EXAM TRAPS
 * ============================================================================
 *
 * | Trampa                                    | Criterio de rechazo                                    |
 * |-------------------------------------------|--------------------------------------------------------|
 * | Prompt "always verify first"              | 92% ≠ 100%; finanzas exigen deterministic enforcement   |
 * | Gate que solo loguea o advierte           | El gate debe impedir la ejecución, no documentarla      |
 * | Handoff que apunta al transcript          | El humano no tiene acceso a la conversación             |
 * | Escalar el ticket entero sin descomponer  | Los concerns se descomponen y se resuelven en paralelo  |
 * | `canUseTool` como enforcement universal   | Se salta con acceptEdits/bypassPermissions/allow rule   |
 * | Transformar output en Start/Stop          | Start/Stop no reescriben; eso es Pre/PostToolUse        |
 *
 * Números del examen: instrucción de prompt ≈ 92% de cumplimiento; prerequisite
 * gate = 100%, porque la comprobación no es una decisión del modelo.
 *
 * ============================================================================
 * FLUJO DE EJECUCIÓN ESPERADO  (trace ilustrativo — no se ejecuta)
 * ============================================================================
 *
 * session = { verifiedCustomerId: null, refundsProcessed: [] }
 *
 * [caso A] modelo intenta saltarse la verificación:
 *   tool_use process_refund(customerId: "cus_4471", amount: 89.5)
 *     ← no hubo get_customer previo
 *   processRefund() → GATE: verifiedCustomerId === null
 *   tool_result { is_error: true,
 *                 content: "BLOCKED_BY_PREREQUISITE_GATE: get_customer must …" }
 *   → la tool NUNCA ejecutó; refundsProcessed sigue vacío
 *
 * [caso B] modelo verifica y reintenta:
 *   tool_use get_customer("ana lopez")
 *     getCustomer() → { customerId: "cus_4471", verified: true }
 *     → session.verifiedCustomerId = "cus_4471"      ← estado de sesión
 *   tool_result { customerId: "cus_4471", verified: true }
 *
 *   tool_use process_refund(customerId: "cus_4471", amount: 89.5)
 *     processRefund() → GATE pasa (verificado y coincide)
 *     tool_result { refundId: "rf_1", customerId: "cus_4471", amount: 89.5 }
 *   → refundsProcessed = [rf_1]
 *
 * [multi-concern] ticket = "I want a return, my billing_dispute is open and I
 *                          need an account_update"
 *   classifyConcerns() → 3 concerns
 *   Promise.all([return, billing_dispute, account_update])   ← en paralelo
 *   unresolved = [billing_dispute]
 *   buildHandoffSummary() → validate 5 campos
 *     ✓ customer_id           "cus_4471"
 *     ✓ conversation_summary   "Customer raised 3 concerns: …"
 *     ✓ root_cause_analysis    "Detected in ticket: billing_dispute"
 *     ✓ refund_amount          0
 *     ✓ recommended_action     "Resolve: billing_dispute."
 *
 * ANTI-PATRÓN (prompt-based, sin gate):
 *   systemPrompt "always call get_customer first"
 *   [caso A] en el ~8% de los casos el modelo no verifica, process_refund
 *            EJECUTA igual (no hay gate), refundsProcessed = [rf_1]
 *   → el dinero se movió sin verificación, y nada lo señaló
 */

export {};
