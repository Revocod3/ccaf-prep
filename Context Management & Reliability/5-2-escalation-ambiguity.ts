/**
 * ============================================================================
 * DOMINIO 5 · TASK STATEMENT 5.2 — Escalation & Ambiguity Resolution
 * ----------------------------------------------------------------------------
 * Objetivo oficial:
 *   Design effective escalation and ambiguity resolution patterns.
 *
 * Qué evalúa el examen aquí:
 *   Dónde cae la línea de escalación decide si el agente sirve. Hay exactamente
 *   TRES razones que justifican pasar un caso a una persona: el cliente pide
 *   explícitamente un humano (se honra al instante, sin investigar ni ofrecer
 *   ayuda), un **policy gap** (no una violación — la política no dice nada), y la
 *   incapacidad de progresar tras intentarlo. Y DOS que no lo justifican aunque
 *   suenen bien: el sentimiento y la confianza auto-reportada, que miden la cosa
 *   equivocada.
 *
 * Build Exercise: Build an Escalation Decision Engine  (Intermediate · 40 min)
 * ============================================================================
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tipos del motor de decisión
// ─────────────────────────────────────────────────────────────────────────────

/** Las tres razones que SÍ justifican escalar. */
type EscalationTrigger =
  | "explicit_human_request"
  | "policy_gap"
  | "inability_to_progress";

/** Las dos que NO, aunque parezcan razonables. */
type UnreliableTrigger = "sentiment" | "self_reported_confidence";

/** Qué hace el agente con el caso. */
type EscalationAction =
  | "escalate_immediate"
  | "escalate_with_context"
  | "resolve"
  | "disambiguate"
  | "not_found";

/** Cómo cubre la política documentada la petición del cliente. */
type PolicyCoverage =
  /** La política responde: se aplica. */
  | "covered"
  /** La política dice que no. Es una violación, no un gap. */
  | "violation"
  /** La política no dice nada. Es un gap. */
  | "gap";

/** Todo lo que el motor recibe para decidir. */
interface EscalationInput {
  readonly requestedHuman: boolean;
  readonly policyCoverage: PolicyCoverage;
  readonly resolutionAttempts: number;
  /** Solo para documentar que NO debe afectar la decisión. */
  readonly sentiment: "calm" | "frustrated" | "angry";
  /** Solo para documentar que NO debe afectar la decisión. */
  readonly selfReportedConfidence: number;
}

/** La decisión del motor. */
interface EscalationDecision {
  readonly action: EscalationAction;
  readonly trigger: EscalationTrigger | null;
  readonly reason: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 1 — El criterio explícito en el system prompt
//
// Why: los criterios explícitos en el system prompt son la respuesta proporcionada
//      ANTES de añadir infraestructura como classifiers o modelos de sentimiento.
//      El examen testea que la optimización del prompt precede al cambio
//      arquitectónico.
// You should see: tres triggers con descripción y regla de decisión, y los dos
//      anti-patrones nombrados explícitamente.
// ─────────────────────────────────────────────────────────────────────────────

/** El criterio de escalación del ejercicio. */
export const ESCALATION_CRITERIA = [
  "## Escalation Criteria",
  "",
  "1. EXPLICIT HUMAN REQUEST: If the customer says they want a human, escalate IMMEDIATELY. Do not attempt to resolve first, and do not offer to try.",
  "2. POLICY GAP: If the request falls outside documented policy — not a violation, but a gap where policy is silent — escalate for human judgement.",
  "3. INABILITY TO PROGRESS: If you have attempted resolution and cannot advance (tool errors local retry cannot clear, missing system access, engineering intervention), escalate with context.",
  "",
  "DO NOT escalate based on: customer frustration level, your own confidence score, or sentiment analysis.",
].join("\n");

/**
 * El motor de decisión.
 *
 * El orden importa: el pedido explícito gana a todo y no consume pasos de
 * investigación. Después el gap de política. Después el intento agotado. El
 * sentimiento y la confianza se reciben pero NO se leen: están en el tipo para
 * dejar constancia de que no son señales.
 *
 * @param input - El caso.
 * @returns La decisión, con su trigger y su motivo.
 */
export function decideEscalation(input: EscalationInput): EscalationDecision {
  // Regla absoluta, sin excepciones ni investigación previa.
  if (input.requestedHuman) {
    return {
      action: "escalate_immediate",
      trigger: "explicit_human_request",
      reason: "Customer explicitly requested a human — honour it with zero investigation.",
    };
  }

  // Un gap no es una violación: la política no dice nada, así que decide un humano.
  if (input.policyCoverage === "gap") {
    return {
      action: "escalate_with_context",
      trigger: "policy_gap",
      reason: "Documented policy is silent on this request; an exception needs human judgement.",
    };
  }

  // La catch-all es CONDICIONAL a que el intento haya ocurrido.
  if (input.resolutionAttempts >= 2) {
    return {
      action: "escalate_with_context",
      trigger: "inability_to_progress",
      reason: "Resolution was attempted and cannot advance past a genuine blocker.",
    };
  }

  return {
    action: "resolve",
    trigger: null,
    reason:
      "Issue is within the agent's capability. Frustration is not a trigger — acknowledge it and resolve.",
  };
}

/**
 * Las dos señales que el examen marca como no fiables.
 *
 * @returns Los dos triggers inválidos.
 */
export function unreliableTriggers(): readonly UnreliableTrigger[] {
  return ["sentiment", "self_reported_confidence"];
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 2 — Few-shot examples de cuándo escalar vs resolver
//
// Why: los ejemplos que demuestran cuándo escalar y cuándo resolver atacan
//      directamente una frontera de decisión poco clara. Es la técnica exacta que
//      el examen identifica para un agente con mal first-contact resolution.
// You should see: tres ejemplos, cada uno con su escenario, decisión y reasoning.
// ─────────────────────────────────────────────────────────────────────────────

/** Un ejemplo de escalación con su reasoning. */
interface EscalationExample {
  readonly customer: string;
  readonly action: string;
  readonly reasoning: string;
}

/** Los tres ejemplos del ejercicio. */
export const ESCALATION_EXAMPLES: readonly EscalationExample[] = [
  {
    customer: "I want to speak to a real person right now.",
    action: "ESCALATE IMMEDIATELY.",
    reasoning:
      "Customer explicitly requested a human. Do not investigate or offer to help first.",
  },
  {
    customer: "This is ridiculous! My package is a week late and nobody seems to care!",
    action: "RESOLVE. Acknowledge the frustration, apologise, offer reshipment or compensation.",
    reasoning:
      "The issue is straightforward (late delivery). Frustration accompanies a resolvable problem, so it is answered by resolving it.",
  },
  {
    customer: "I bought this from a competitor but want to return it at your store. Your website says nothing about this.",
    action: "ESCALATE.",
    reasoning:
      "Policy gap — competitor returns are not covered in documented policy. Requires human judgement on whether to make an exception.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Paso 3 — Matching ambiguo: pedir un discriminador
//
// Why: seleccionar de un match ambiguo con heurísticas (el más reciente, el más
//      activo) arriesga violaciones de privacidad y acciones incorrectas. El
//      examen testea que la única respuesta segura es pedir identificadores.
// You should see: una función que detecta múltiples records y pide desambiguación
//      en vez de aplicar cualquier heurística.
// ─────────────────────────────────────────────────────────────────────────────

/** Un record de cliente devuelto por el lookup. */
interface CustomerRecord {
  readonly name: string;
  readonly city: string;
  readonly lastActive: string;
}

/** El resultado de un lookup: nunca "elegido por heurística". */
type LookupOutcome =
  | { readonly action: "not_found"; readonly message: string }
  | { readonly action: "matched"; readonly customer: CustomerRecord }
  | { readonly action: "disambiguate"; readonly message: string; readonly matchCount: number };

/**
 * Maneja el resultado de un lookup de cliente.
 *
 * Con más de un match, se pide un discriminador. Cualquier regla de desempate es
 * una apuesta disfrazada de regla, y equivocarse no cuesta un retry: leerle los
 * datos de un cliente a otro es una brecha de privacidad, y reembolsar la cuenta
 * equivocada es un error financiero hecho con confianza.
 *
 * @param results - Los records devueltos.
 * @returns La acción segura.
 */
export function handleCustomerLookup(results: readonly CustomerRecord[]): LookupOutcome {
  if (results.length === 0) {
    return { action: "not_found", message: "No matching customer records found." };
  }
  const only = results[0];
  if (results.length === 1 && only !== undefined) {
    return { action: "matched", customer: only };
  }
  return {
    action: "disambiguate",
    message:
      "I found multiple accounts matching that name. Could you provide one of the following " +
      "to help me find the right account?\n- Email address\n- Phone number\n- Order number\n- Postcode",
    matchCount: results.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 4 — Cuatro escenarios que cubren las fronteras críticas
//
// Why: cubren la nuancia de la frustración, la distinción gap/violación, la regla
//      absoluta del pedido explícito y la desambiguación segura.
// You should see: resolución ofrecida al frustrado, escalación para el gap,
//      escalación inmediata para el pedido explícito, y desambiguación.
// ─────────────────────────────────────────────────────────────────────────────

/** Un escenario de prueba con su resultado esperado. */
interface EscalationScenario {
  readonly input: string;
  readonly expected: EscalationAction;
  readonly reason: string;
}

/** Los cuatro escenarios del ejercicio. */
export const TEST_SCENARIOS: readonly EscalationScenario[] = [
  {
    input: "This is SO frustrating! My order arrived broken!",
    expected: "resolve",
    reason: "Straightforward damage replacement.",
  },
  {
    input: "I want you to match the price I saw at a competitor.",
    expected: "escalate_with_context",
    reason: "Policy gap — competitor matching is not in policy.",
  },
  {
    input: "I want to talk to a real human being.",
    expected: "escalate_immediate",
    reason: "Explicit human request — no investigation first.",
  },
  {
    input: "Look up my account, name is John Smith.",
    expected: "disambiguate",
    reason: "Multiple matches — ask for an additional identifier.",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Paso 5 — Verificar las dos reglas absolutas
//
// Why: son las dos reglas sin excepción que el examen testea. Cualquier
//      investigación antes de escalar por pedido explícito, o cualquier selección
//      heurística de un match ambiguo, es un fallo crítico.
// You should see: escalación en la PRIMERA respuesta con cero pasos de
//      investigación; y el match ambiguo pidiendo identificadores.
// ─────────────────────────────────────────────────────────────────────────────

/** Las variantes de pedido explícito que deben disparar la regla. */
export const HUMAN_REQUEST_PHRASINGS: readonly string[] = [
  "Transfer me to a human.",
  "I want to speak to a real person.",
  "Get me a manager.",
  "Let me talk to someone real, not a bot.",
];

/** El match ambiguo del ejercicio, con su heurística tentadora. */
export const AMBIGUOUS_MATCHES: readonly CustomerRecord[] = [
  { name: "John Smith", city: "London", lastActive: "2024-03-14" },
  { name: "John Smith", city: "Manchester", lastActive: "2023-01-02" },
];

/**
 * ¿Se respetaron las dos reglas absolutas?
 *
 * @param explicitRequest - El resultado del pedido explícito.
 * @param ambiguous - El resultado del match ambiguo.
 * @returns `true` si ninguna regla se rompió.
 */
export function respectsAbsoluteRules(
  explicitRequest: EscalationDecision,
  ambiguous: LookupOutcome,
): boolean {
  const honouredImmediately =
    explicitRequest.action === "escalate_immediate" &&
    explicitRequest.trigger === "explicit_human_request";
  const neverSelectedHeuristically = ambiguous.action === "disambiguate";
  return honouredImmediately && neverSelectedHeuristically;
}

// ─────────────────────────────────────────────────────────────────────────────
// Extra — Enforcement determinista y el handoff estructurado
//
// Why: los criterios en el prompt son probabilísticos; donde la escalación debe
//      estar GARANTIZADA, el mecanismo es un hook. Y el humano que recibe el caso
//      no ve el transcript.
// You should see: la prioridad de decisiones del hook y los campos del handoff.
// ─────────────────────────────────────────────────────────────────────────────

/** La decisión que devuelve un hook `PreToolUse`. */
type PermissionDecision = "allow" | "deny" | "ask" | "defer";

/** Prioridad cuando coinciden varios hooks o reglas. */
export const HOOK_DECISION_PRIORITY: readonly PermissionDecision[] = [
  "deny",
  "defer",
  "ask",
  "allow",
];

/**
 * Resuelve varias decisiones de hook.
 *
 * `deny` gana a `defer`, que gana a `ask`, que gana a `allow`. Si cualquier hook
 * devuelve `deny`, la operación se bloquea aunque otros permitan — incluso en
 * `bypassPermissions`.
 *
 * @param decisions - Las decisiones de los hooks que aplican.
 * @returns La decisión ganadora.
 */
export function resolveHookDecisions(
  decisions: readonly PermissionDecision[],
): PermissionDecision {
  for (const candidate of HOOK_DECISION_PRIORITY) {
    if (decisions.includes(candidate)) return candidate;
  }
  return "allow";
}

/**
 * ¿Un `deny` sobrevive a `bypassPermissions`?
 *
 * Sí: no hay permission mode que pueda saltarse en silencio una parada real de
 * política. Por eso un check que debe correr en CADA tool call va en un hook
 * `PreToolUse`, no en `canUseTool`.
 *
 * @returns `true`.
 */
export function denySurvivesBypassPermissions(): boolean {
  return true;
}

/**
 * ¿`canUseTool` es universal?
 *
 * No: se llama solo "if not resolved by any of the above". Una tool auto-aprobada
 * por `acceptEdits`, `bypassPermissions` o una allow rule nunca llega a él, así que
 * los checks que pongas ahí se saltan en silencio para esa tool.
 *
 * @returns `false`.
 */
export function canUseToolIsUniversal(): boolean {
  return false;
}

/** Lo que un humano necesita para tomar el caso, sin ver el transcript. */
interface EscalationHandoff {
  readonly customerId: string;
  readonly rootCauseAnalysis: string;
  readonly recommendedAction: string;
  /** El importe específico, cuando el caso es de reembolso. */
  readonly amount?: string;
}

/**
 * Construye el handoff estructurado.
 *
 * El humano no tiene acceso a la conversación, así que este payload es requerido,
 * no un adorno opcional.
 *
 * @param handoff - Los campos del handoff.
 * @returns El bloque listo para entregar.
 */
export function renderHandoff(handoff: EscalationHandoff): string {
  const lines = [
    `Customer ID: ${handoff.customerId}`,
    `Root cause: ${handoff.rootCauseAnalysis}`,
    `Recommended action: ${handoff.recommendedAction}`,
  ];
  if (handoff.amount !== undefined) lines.push(`Amount: ${handoff.amount}`);
  return lines.join("\n");
}

/**
 * ============================================================================
 * ✗ ANTI-PATTERN — Los errores que el examen construye
 * ============================================================================
 */

/** ✗ ANTI-PATTERN 1 — Escalar por sentimiento.
 *
 * La frustración y la dificultad son cantidades sin relación: un cliente furioso
 * por una entrega tarde tiene un caso fácil; uno calmado preguntando por price
 * matching cae en un gap que necesita a una persona.
 */
// if (sentiment === "angry") escalate();  // manda los fáciles arriba

/** ✗ ANTI-PATTERN 2 — Escalar por confianza auto-reportada.
 *
 * El número está mal calibrado y de forma predecible: los casos duros atraen
 * confianza, porque no saber qué no sabe es justo la condición.
 */
// if (confidence < 0.7) escalate();  // simples escalados, complejos intentados

/** ✗ ANTI-PATTERN 3 — Investigar antes de honrar el pedido explícito.
 *
 * "Let me see if I can help first" se lee como amabilidad y aterriza como negativa:
 * el cliente ya dijo lo que quiere.
 */
// "Let me check whether I can help with that first…"  // el pedido ya estaba hecho

/** ✗ ANTI-PATTERN 4 — Seleccionar del match ambiguo por heurística.
 *
 * "El más reciente" o "el más activo" son apuestas con justificación convincente, y
 * equivocarse filtra datos de un cliente a otro.
 */
// pick(results.sort(byLastActive)[0]);  // brecha de privacidad

/** ✗ ANTI-PATTERN 5 — Tratar un gap como violación (o al revés).
 *
 * Una violación la responde la política (no). Un gap es que la política no tenga
 * nada que decir. Los gaps escalan; las violaciones se aplican.
 */
// if (outsidePolicy) resolve("no");  // confunde gap con violación

/** ✗ ANTI-PATTERN 6 — Poner el check duro en `canUseTool`.
 *
 * "Siempre preguntar antes de un refund > $500" va en un hook `PreToolUse`:
 * `canUseTool` se salta con auto-aprobaciones.
 */
// canUseTool = (tool) => tool.name === "process_refund" ? askHuman() : allow();  // se salta

/** ✗ ANTI-PATTERN 7 — Handoff sin los campos requeridos.
 *
 * El humano no ve el transcript: sin customer ID, root cause y recommended action
 * no puede decidir nada.
 */
// escalate({ summary: "customer is upset" });  // sin ID, sin causa, sin acción

/**
 * ============================================================================
 * EXAM TRAPS — distractores recurrentes y criterio de rechazo
 * ============================================================================
 *
 * | Trampa                                             | Por qué se rechaza                                  |
 * |----------------------------------------------------|-----------------------------------------------------|
 * | Escalación por sentimiento                          | Sentir y dificultad son independientes               |
 * | Escalación por confianza auto-reportada             | Mal calibrada en ambas direcciones                   |
 * | Investigar antes de honrar el pedido explícito      | Se lee como negativa; el pedido ya estaba hecho      |
 * | Selección heurística de un match ambiguo            | Privacidad o reembolso a la cuenta equivocada        |
 *
 * QUICK REFERENCE — datos de la fuente
 *
 *   Tres triggers válidos ..... pedido explícito de humano · excepción/gap de política ·
 *                               incapacidad de progresar
 *   Dos triggers no fiables ... sentimiento/frustración · confianza auto-reportada
 *   Pedido explícito .......... escalar al instante, cero investigación primero
 *   Enforcement determinista .. hooks del Agent SDK (p. ej. `PreToolUse`) — garantizado,
 *                               no probabilístico
 *   Valores de permissionDecision ... `allow`, `deny`, `ask`, `defer`
 *   Regla de `canUseTool` ..... solo dispara si el flujo llega a un prompt; se salta
 *                               en llamadas auto-aprobadas
 *   Prioridad de decisión ..... `deny` > `defer` > `ask` > `allow`; un deny bloquea
 *                               incluso bajo `bypassPermissions`
 *   Campos del handoff ........ customer ID, root cause analysis, recommended action
 *                               (+ importe donde aplique)
 *   Match ambiguo ............. pedir identificadores adicionales (email, phone, order
 *                               number) — nunca seleccionar por heurística
 *   Prompt vs arquitectura .... criterios explícitos + few-shot ANTES de añadir
 *                               classifiers o modelos de sentimiento
 *
 * ============================================================================
 * FLUJO DE EJECUCIÓN ESPERADO  (trace ilustrativo — no se ejecuta)
 * ============================================================================
 *
 * decideEscalation({ requestedHuman: true, … })
 *   → { action: "escalate_immediate", trigger: "explicit_human_request" }
 *   ✅ cero pasos de investigación; ni se ofrece ayuda primero
 *
 * decideEscalation({ requestedHuman: false, policyCoverage: "gap",
 *                    resolutionAttempts: 0, … })
 *   → { action: "escalate_with_context", trigger: "policy_gap" }
 *
 * decideEscalation({ requestedHuman: false, policyCoverage: "violation",
 *                    resolutionAttempts: 0, … })
 *   → { action: "resolve" }        ← una violación la responde la política: no
 *
 * decideEscalation({ requestedHuman: false, policyCoverage: "covered",
 *                    resolutionAttempts: 2, … })
 *   → { action: "escalate_with_context", trigger: "inability_to_progress" }
 *
 * decideEscalation({ requestedHuman: false, policyCoverage: "covered",
 *                    resolutionAttempts: 0, sentiment: "angry",
 *                    selfReportedConfidence: 0.2 })
 *   → { action: "resolve" }
 *   ✅ ni el sentimiento ni la confianza entran en la decisión
 *
 * handleCustomerLookup(AMBIGUOUS_MATCHES)
 *   → { action: "disambiguate", matchCount: 2,
 *       message: "…Could you provide … Email address / Phone number / Order number / Postcode" }
 *   ✅ ninguno de los dos records se toca
 *
 * resolveHookDecisions(["allow", "ask", "deny"]) → "deny"
 * resolveHookDecisions(["allow", "defer", "ask"]) → "defer"
 * denySurvivesBypassPermissions() → true
 * canUseToolIsUniversal() → false
 * renderHandoff({ customerId: "C-4421", rootCauseAnalysis: "refund over the £500 ceiling",
 *                 recommendedAction: "manager approval", amount: "£750" })
 *
 * ANTI-PATRÓN: una línea de producto sin política de devoluciones escrita. El agente
 * aplica la política análoga más cercana "cuando se siente seguro" y escala cuando
 * no. Dos clientes con peticiones casi idénticas reciben resultados opuestos. El fix
 * no es subir el umbral de confianza ni aplicar la análoga de forma consistente: es
 * definir el GAP mismo como trigger, así las peticiones que la política escrita no
 * cubre llegan a un humano sea cual sea la confianza.
 */
