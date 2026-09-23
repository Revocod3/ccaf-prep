/**
 * ============================================================================
 * DOMINIO 5 · TASK STATEMENT 5.4 — Codebase Exploration & Context Degradation
 * ----------------------------------------------------------------------------
 * Objetivo oficial:
 *   Manage context effectively in large codebase exploration.
 *
 * Qué evalúa el examen aquí:
 *   Explorar un codebase grande es lo más hambriento de contexto que hay. Las
 *   sesiones largas producen una falla característica, la **context degradation**,
 *   y no es quedarse sin sitio: el modelo pierde agarre sobre lo que encontró
 *   antes a medida que el contexto se llena con el output verboso de encontrarlo.
 *   El síntoma es reconocible: empieza a describir patrones en vez de nombrar
 *   cosas — "this follows the typical repository pattern" donde antes tenía
 *   "OrderRepository at src/repos/order.ts". Un ventana más grande NO lo arregla:
 *   lo entierra más hondo.
 *
 * Build Exercise: Build a Context-Resilient Codebase Explorer  (Advanced · 60 min)
 * ============================================================================
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tipos de la exploración
// ─────────────────────────────────────────────────────────────────────────────

/** Una tarea de investigación delegada a un subagente. */
interface ExplorationTask {
  readonly subagent: string;
  readonly task: string;
}

/** Un finding estructurado, no el contenido crudo del archivo. */
interface SubagentFinding {
  readonly className: string;
  readonly filePath: string;
  readonly interfaces: readonly string[];
  readonly dependencies: readonly string[];
  readonly criticalNote: string | null;
}

/** El resumen de una fase, inyectable en los prompts de la siguiente. */
interface PhaseSummary {
  readonly architecture: string;
  readonly dependencyChain: string;
  readonly criticalIssue: string;
}

/** El estado persistido para crash recovery. */
interface ExplorationManifest {
  readonly sessionId: string;
  readonly phase: number;
  readonly exploredPaths: readonly string[];
  readonly keyFindings: Readonly<Record<string, string>>;
  readonly nextSteps: readonly string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 1 — Delegar la investigación a subagentes
//
// Why: la delegación a subagentes es sobre todo AISLAMIENTO de contexto, no
//      paralelización. El contexto del main agent queda limpio para la
//      coordinación de alto nivel mientras los subagentes hacen la exploración
//      verbosa.
// You should see: cada subagente devuelve un resumen estructurado (clases, rutas,
//      findings), no el output crudo; el coordinator queda limpio.
// ─────────────────────────────────────────────────────────────────────────────

/** Las tres investigaciones del ejercicio. */
export const INVESTIGATION_TASKS: readonly ExplorationTask[] = [
  {
    subagent: "test-coverage",
    task: "Find all test files for the order service and report coverage status.",
  },
  {
    subagent: "refund-flow",
    task: "Trace the refund flow from API endpoint to database, listing all intermediate services.",
  },
  {
    subagent: "external-apis",
    task: "Identify all external API integrations and their error handling patterns.",
  },
];

/**
 * Lo que cruza de vuelta desde un subagente.
 *
 * El subagente puede leer decenas de archivos y correr muchas búsquedas; lo que
 * cruza es un resumen que NOMBRA clases, rutas y cadenas — el contenido de los
 * archivos se queda en su contexto.
 *
 * @param finding - El finding estructurado.
 * @returns El resumen destilado.
 */
export function toCoordinatorSummary(finding: SubagentFinding): string {
  const note = finding.criticalNote ?? "None";
  return [
    `Class: ${finding.className} (${finding.filePath})`,
    `Implements: ${finding.interfaces.join(", ")}`,
    `Dependencies: ${finding.dependencies.join(" -> ")}`,
    `Critical: ${note}`,
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 2 — El scratchpad: persistir findings fuera de la conversación
//
// Why: es la mitigación primaria de la context degradation. Persiste el
//      conocimiento fuera del contexto conversacional, inmune al corrimiento de
//      atención que hace que el modelo cite patrones típicos en vez de las clases
//      concretas que descubrió.
// You should see: el agente escribe findings al scratchpad tras cada paso y lo lee
//      al inicio de cada paso siguiente, con nombres y rutas específicos.
// ─────────────────────────────────────────────────────────────────────────────

/** El header del scratchpad. */
export const SCRATCHPAD_HEADER = "# Exploration Scratchpad — Order Service";

/**
 * Formatea un finding para el scratchpad.
 *
 * @param finding - El finding estructurado.
 * @returns Su bloque en Markdown.
 */
export function formatScratchpadEntry(finding: SubagentFinding): string {
  const note = finding.criticalNote ?? "None";
  return [
    `## ${finding.className}`,
    `- Path: \`${finding.filePath}\``,
    `- Implements: ${finding.interfaces.join(", ")}`,
    `- Dependencies: ${finding.dependencies.join(" -> ")}`,
    `- Critical: ${note}`,
  ].join("\n");
}

/**
 * Añade un finding al scratchpad existente.
 *
 * El timing importa tanto como la técnica: se monta al INICIO de una exploración
 * extendida, porque para cuando la degradación es visible, los findings que valía
 * la pena escribir ya se difuminaron.
 *
 * @param existing - El contenido actual del scratchpad.
 * @param finding - El finding a añadir.
 * @returns El scratchpad actualizado.
 */
export function updateScratchpad(existing: string, finding: SubagentFinding): string {
  const base = existing.trim().length === 0 ? SCRATCHPAD_HEADER : existing.trimEnd();
  return `${base}\n\n${formatScratchpadEntry(finding)}`;
}

/**
 * Detecta el síntoma observable de la degradación.
 *
 * @param response - La respuesta del agente.
 * @returns `true` si describe patrones genéricos en vez de nombrar clases.
 */
export function showsDegradation(response: string): boolean {
  return /\b(typical|usual|standard|common pattern)\b/i.test(response);
}

/**
 * Mide la especificidad de una respuesta.
 *
 * Con scratchpad, las referencias específicas (`*.ts`) se mantienen y las
 * genéricas caen; sin él, al revés.
 *
 * @param response - La respuesta del agente.
 * @returns Conteo de referencias específicas y genéricas, y su ratio.
 */
export function measureSpecificity(response: string): {
  readonly specificRefs: number;
  readonly genericRefs: number;
  readonly ratio: number;
} {
  const specificRefs = response.match(/\b\w+\.ts\b/g)?.length ?? 0;
  const genericRefs = response.match(/typical|standard|common pattern/gi)?.length ?? 0;
  return { specificRefs, genericRefs, ratio: specificRefs / (genericRefs + 1) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 3 — Inyectar el resumen de la fase 1 en los prompts de la fase 2
//
// Why: un subagente de fase 2 arranca en frío — no hereda historia de la
//      conversación, solo el string del prompt. Sin el resumen, re-deriva la
//      arquitectura antes de empezar y paga dos veces la exploración de la fase 1.
// You should see: el resumen inyectado en el prompt inicial de cada subagente de
//      fase 2, que arranca orientado.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compone el prompt de un subagente de fase 2.
 *
 * "The only content you pass from parent to subagent is the Agent tool's prompt
 * string": si algo de la fase 1 tiene que estar disponible, hay que escribirlo aquí.
 *
 * @param phase1Summary - El resumen de la fase 1.
 * @param phase2Task - La tarea de la fase 2.
 * @returns El prompt con el contexto inyectado.
 */
export function buildPhase2Prompt(phase1Summary: PhaseSummary, phase2Task: string): string {
  return [
    "## Context from Phase 1 Exploration",
    `Architecture: ${phase1Summary.architecture}`,
    `Key dependency chain: ${phase1Summary.dependencyChain}`,
    `Critical concern: ${phase1Summary.criticalIssue}`,
    "",
    `## Your Phase 2 Task\n${phase2Task}`,
    "",
    "Use the Phase 1 context to guide your investigation. Do not re-explore already-discovered architecture.",
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 4 — Crash recovery con un manifest de estado estructurado
//
// Why: las sesiones largas terminan de forma inesperada. Sin nada persistido, la
//      exploración se pierde y se repite desde el principio. El manifest permite
//      reanudar en vez de reiniciar.
// You should see: el coordinator carga el manifest y lo inyecta en los prompts, y
//      `exploredPaths` evita re-leer archivos ya concluidos.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * El prompt de reanudación.
 *
 * `exploredPaths` es lo que evita el coste real de un reinicio ingenuo: re-leer
 * archivos cuyas conclusiones ya están registradas.
 *
 * @param manifest - El manifest guardado.
 * @returns El prompt para la sesión que reanuda.
 */
export function buildResumePrompt(manifest: ExplorationManifest): string {
  return [
    `Resuming session ${manifest.sessionId} from phase ${manifest.phase}.`,
    `Already explored (do NOT re-read): ${manifest.exploredPaths.join(", ")}`,
    `Key findings: ${JSON.stringify(manifest.keyFindings)}`,
    `Next steps: ${manifest.nextSteps.join("; ")}`,
  ].join("\n");
}

/**
 * ¿Qué archivos puede saltarse la sesión que reanuda?
 *
 * @param manifest - El manifest.
 * @returns Las rutas ya exploradas.
 */
export function skippedPaths(manifest: ExplorationManifest): readonly string[] {
  return manifest.exploredPaths;
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 5 — Verificar que el scratchpad frena la degradación
//
// Why: valida que la mitigación funciona. El síntoma observable es el modelo
//      citando patrones típicos en vez de clases y rutas concretas.
// You should see: sin scratchpad, el agente degrada a referencias genéricas tras
//      4-5 módulos; con scratchpad, mantiene nombres y rutas exactos.
// ─────────────────────────────────────────────────────────────────────────────

/** Los módulos del ejercicio, en orden de exploración. */
export const EXPLORED_MODULES: readonly string[] = [
  "src/repos/order.ts",
  "src/services/order.ts",
  "src/services/refund.ts",
  "src/gateways/payment.ts",
  "src/controllers/refund.ts",
];

/** El manifest del ejercicio, guardado antes del crash. */
export const DEMO_MANIFEST: ExplorationManifest = {
  sessionId: "explore-order-service-001",
  phase: 2,
  exploredPaths: ["src/repos/order.ts", "src/services/order.ts", "src/services/refund.ts"],
  keyFindings: {
    architecture: "Layered: Controllers -> Services -> Repositories -> DB",
    criticalIssue: "RefundProcessor has no retry logic for Stripe API failures",
    testCoverage: "OrderService 87%, RefundProcessor 12%",
  },
  nextSteps: [
    "Investigate PaymentGateway error handling",
    "Review RefundProcessor test files",
    "Check cache invalidation logic in OrderRepository",
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Extra — /compact, /clear y por qué checkpoints no son manifests
//
// Why: Claude Code tiene comandos para un contexto que se llena, y son distintos
//      entre sí y de los manifests.
// You should see: el comando correcto para cada necesidad.
// ─────────────────────────────────────────────────────────────────────────────

/** Comandos y mecanismos de gestión de contexto. */
type ContextMechanism = "compact" | "clear" | "checkpoint" | "manifest";

/**
 * Elige el mecanismo para una necesidad.
 *
 * @param need - Lo que hace falta.
 * @returns El mecanismo correspondiente.
 */
export function mechanismFor(
  need: "reclaim_space_focused" | "reset_between_tasks" | "undo_code_in_session" | "resume_across_crash",
): ContextMechanism {
  switch (need) {
    case "reclaim_space_focused":
      return "compact";
    case "reset_between_tasks":
      return "clear";
    case "undo_code_in_session":
      return "checkpoint";
    case "resume_across_crash":
      return "manifest";
    default: {
      const exhaustive: never = need;
      return exhaustive;
    }
  }
}

/**
 * Describe el contexto de un subagente al nacer.
 *
 * "A subagent's context window starts fresh, with no parent conversation, but isn't
 * empty": recibe su propio system prompt, el CLAUDE.md del proyecto y las
 * definiciones de tools, pero NO hereda la historia ni los tool results del padre —
 * y por eso la inyección de resumen es necesaria.
 *
 * @returns La descripción.
 */
export function subagentSpawnContext(): string {
  return (
    "Fresh — no parent conversation history or tool results; only the Agent tool's prompt " +
    "string is passed in. It still gets its own system prompt, project CLAUDE.md and tool definitions."
  );
}

/**
 * ============================================================================
 * ✗ ANTI-PATTERN — Los errores que el examen construye
 * ============================================================================
 */

/** ✗ ANTI-PATTERN 1 — Subir la ventana de contexto para la degradación.
 *
 * Nada se evictó por falta de sitio: los findings siguen presentes, solo que ya no
 * son prominentes. Una ventana mayor los entierra más hondo y admite más output
 * con el que enterrarlos.
 */
// switchToBiggerWindowModel();  // "a bigger window buries them at greater depth"

/** ✗ ANTI-PATTERN 2 — Creer que la delegación a subagentes es solo paralelización.
 *
 * Correr en paralelo es el beneficio visible y el menor. Lo que importa es que el
 * output verboso se quede en el contexto del subagente.
 */
// "subagents are for speed"  // en secuencia aíslan igual

/** ✗ ANTI-PATTERN 3 — Reiniciar sin guardar estado.
 *
 * Un reinicio limpia el output acumulado y todo lo aprendido con él, así que se
 * re-leen los mismos archivos para llegar a las mismas conclusiones.
 */
// restartSession();  // se repite la exploración entera

/** ✗ ANTI-PATTERN 4 — Usar `/compact` solo al tocar el límite.
 *
 * Tratado como medida de capacidad corre demasiado tarde, cuando los findings
 * precisos ya se enterraron.
 */
// if (windowFull) compact();  // "runs too late"

/** ✗ ANTI-PATTERN 5 — Devolver el contenido crudo de los archivos al coordinator.
 *
 * Reintroduce justo el output verboso que la delegación existía para aislar.
 */
// return { files: rawFileContents };  // el coordinator se llena igual

/** ✗ ANTI-PATTERN 6 — Subagente de fase 2 sin el resumen inyectado.
 *
 * Arranca en frío y re-deriva la arquitectura antes de empezar, pagando dos veces
 * por lo que la fase 1 ya hizo.
 */
// spawnSubagent({ prompt: "investigate PaymentGateway" });  // cold start

/** ✗ ANTI-PATTERN 7 — Confundir checkpoints con manifests.
 *
 * Los checkpoints deshacen cambios de código dentro de una sesión (y no rastrean
 * cambios de Bash); los manifests persisten findings de exploración a través de un
 * resume del coordinator.
 */
// manifest = git stash;  // mecanismos distintos

/**
 * ============================================================================
 * EXAM TRAPS — distractores recurrentes y criterio de rechazo
 * ============================================================================
 *
 * | Trampa                                             | Por qué se rechaza                                  |
 * |----------------------------------------------------|-----------------------------------------------------|
 * | Subir la ventana para la degradación                | Nada se evictó; enterrarlos más hondo no ayuda       |
 * | Creer que la delegación es solo paralelización      | El aislamiento es el beneficio; paralelo es el menor |
 * | Reiniciar sin guardar estado                        | Se repite la exploración entera                      |
 * | `/compact` solo al tocar el límite                  | Corre tarde: los specifics ya están enterrados       |
 *
 * QUICK REFERENCE — datos de la fuente
 *
 *   Context degradation ...... cita "patrones típicos" en vez de findings concretos;
 *                              NO es un problema de límite de tokens
 *   Scratchpad files = ....... structured note-taking / "agentic memory" (término oficial)
 *   Mejor encaje del note-taking  trabajo iterativo con milestones claros
 *   Delegación a subagentes = la tercera técnica long-horizon — ventanas limpias y
 *                              aisladas por subtarea
 *   Qué vuelve de un subagente  solo su mensaje final destilado; la exploración verbosa
 *                              se queda dentro
 *   `/clear` ................. contexto vacío; la conversación previa se guarda y es
 *                              reanudable con `/resume`
 *   `/compact [instructions]`  reemplaza la historia por un resumen (opcionalmente
 *                              enfocado)
 *   Checkpoints .............. auto-creados por prompt; `/rewind` restaura código,
 *                              conversación o ambos — "local undo", no git
 *   Punto ciego de checkpoints  no rastrea cambios hechos vía Bash
 *   Contexto del subagente ... fresco, sin conversación del padre; solo el prompt string
 *   Crash recovery ........... manifest de estado estructurado por agente, cargado por
 *                              el coordinator al reanudar
 *
 * ============================================================================
 * FLUJO DE EJECUCIÓN ESPERADO  (trace ilustrativo — no se ejecuta)
 * ============================================================================
 *
 * [Paso 1] INVESTIGATION_TASKS → test-coverage · refund-flow · external-apis
 *   toCoordinatorSummary({ className: "OrderRepository",
 *                          filePath: "src/repos/order.ts",
 *                          interfaces: ["Repository<T>"],
 *                          dependencies: ["PostgreSQL"],
 *                          criticalNote: "cache never invalidated on status change" })
 *   ✅ solo el resumen cruza; el contenido de los archivos se queda en el subagente
 *
 * [Paso 2] updateScratchpad(existing, finding)
 *   → "# Exploration Scratchpad — Order Service\n\n## OrderRepository\n- Path: …"
 *   showsDegradation("this follows the typical repository pattern") → true
 *   showsDegradation("OrderRepository at src/repos/order.ts implements Repository<T>") → false
 *   ✅ el scratchpad mantiene el detalle legible fuera de la conversación
 *
 * [Paso 3] buildPhase2Prompt(phase1Summary, "Investigate PaymentGateway error handling")
 *   → "## Context from Phase 1 Exploration\nArchitecture: Layered: Controllers -> …\n
 *      Key dependency chain: RefundController -> RefundProcessor -> …\n
 *      Critical concern: RefundProcessor has no retry logic for Stripe API failures\n\n
 *      ## Your Phase 2 Task\nInvestigate PaymentGateway error handling\n\n
 *      Use the Phase 1 context…"
 *   ✅ el subagente arranca orientado; no re-deriva la arquitectura
 *
 * [Paso 4] buildResumePrompt(DEMO_MANIFEST)
 *   → "Resuming session explore-order-service-001 from phase 2.
 *      Already explored (do NOT re-read): src/repos/order.ts, src/services/order.ts,
 *      src/services/refund.ts
 *      Next steps: Investigate PaymentGateway error handling; …"
 *   skippedPaths(DEMO_MANIFEST) → los 3 archivos ya concluidos
 *   ✅ reanuda en vez de repetir
 *
 * [Paso 5] measureSpecificity(respuestaSinScratchpad)
 *   → { specificRefs: 1, genericRefs: 4, ratio: 0.2 }   ← degradado
 *   measureSpecificity(respuestaConScratchpad)
 *   → { specificRefs: 5, genericRefs: 0, ratio: 5 }     ← específico
 *
 * mechanismFor("reclaim_space_focused") → "compact"
 * mechanismFor("undo_code_in_session")  → "checkpoint"
 * subagentSpawnContext() → "Fresh — no parent conversation history…"
 *
 * ANTI-PATRÓN: la sesión lleva dos horas anexando clases y rutas a
 * exploration-notes.md, y aun así responde "the usual service-layer pattern" en vez
 * de nombrar RefundProcessor en src/services/refund.ts, que el archivo SÍ registra.
 * El fix no es reiniciar, ni importar el archivo desde CLAUDE.md, ni una ventana
 * mayor: es que el agente LEA el scratchpad al inicio de cada paso, para que los
 * specifics registrados re-entren en contexto antes de responder.
 */
