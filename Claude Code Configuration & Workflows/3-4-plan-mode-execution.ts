/**
 * ============================================================================
 * DOMINIO 3 · TASK STATEMENT 3.4 — Plan Mode vs Direct Execution
 * ----------------------------------------------------------------------------
 * Objetivo oficial:
 *   Determine when to use plan mode vs direct execution.
 *
 * Qué evalúa el examen aquí:
 *   Dos formas de entrar a una tarea: planificar primero o empezar a cambiar
 *   cosas. El examen te pide elegir según la evidencia del escenario, y el
 *   criterio es firme: **la ambigüedad decide, no la dificultad**. Un null
 *   pointer en la línea 42 es difícil de rastrear pero el stack trace nombra una
 *   función y la causa se conoce: ejecución directa. Añadir una capa de caché
 *   suena fácil pero se puede construir de tres formas con requisitos de
 *   infraestructura distintos: plan mode. Y para lo sustancial, el patrón es
 *   **plan then execute**, no plan or execute.
 *
 * Build Exercise: Practice Plan Mode vs Direct Execution Decision-Making
 *                 (Intermediate · 45 min)
 * ============================================================================
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tipos de la decisión
// ─────────────────────────────────────────────────────────────────────────────

/** Las dos formas de entrar a una tarea. */
type ExecutionMode = "plan" | "direct_execution";

/** Las cuatro fases del workflow recomendado. */
type Phase = "explore" | "plan" | "implement" | "commit";

/** Workflow recomendado por la doc. */
export const RECOMMENDED_PHASES: readonly Phase[] = ["explore", "plan", "implement", "commit"];

/** Perfil de una tarea, tal como lo anuncia el escenario. */
interface TaskProfile {
  readonly multiFile: boolean;
  readonly multipleValidApproaches: boolean;
  readonly architecturalDecision: boolean;
  readonly explorationNeeded: boolean;
  /** Si el diff entero se puede describir en una frase, no hay nada que planear. */
  readonly diffDescribableInOneSentence: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 1 — Una tarea multi-archivo compleja por plan mode
//
// Why: plan mode es para tareas con múltiples enfoques válidos, decisiones de
//      arquitectura o modificaciones multi-archivo. El examen testea que elijas
//      plan mode por adelantado cuando la complejidad viene declarada en el
//      requisito, en vez de esperar sorpresas.
// You should see: Claude explora sin modificar nada y devuelve dependencias,
//      enfoques alternativos con tradeoffs y una estrategia recomendada.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Elige el modo según la ambigüedad, no la dificultad.
 *
 * Plan mode cuando hay varias aproximaciones válidas, decisiones de arquitectura
 * o exploración necesaria, o cuando el cambio abarca muchos archivos. Ejecución
 * directa cuando el diff se describe en una frase: no queda nada que diseñar y
 * planificar es puro overhead.
 *
 * @param profile - Lo que el escenario anuncia de la tarea.
 * @returns El modo correcto.
 */
export function chooseMode(profile: TaskProfile): ExecutionMode {
  // "If you could describe the diff in one sentence, skip the plan."
  if (profile.diffDescribableInOneSentence) return "direct_execution";

  const needsPlan =
    profile.multiFile ||
    profile.multipleValidApproaches ||
    profile.architecturalDecision ||
    profile.explorationNeeded;

  return needsPlan ? "plan" : "direct_execution";
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 2 — Un bug de un solo archivo por ejecución directa
//
// Why: la ejecución directa es correcta cuando problema, ubicación y solución
//      están claros. El examen testea que NO sobre-planifiques cambios bien
//      entendidos: la decisión es sobre ambigüedad, no dificultad.
// You should see: el fix inmediato, confinado a una función, en mucho menos
//      tiempo que la tarea de plan mode.
// ─────────────────────────────────────────────────────────────────────────────

/** El bug del ejercicio: difícil de rastrear, pero sin nada que diseñar. */
export const CLEAR_BUG_PROFILE: TaskProfile = {
  multiFile: false,
  multipleValidApproaches: false,
  architecturalDecision: false,
  explorationNeeded: false,
  diffDescribableInOneSentence: true,
};

/** La feature que suena trivial pero tiene tres diseños posibles. */
export const AMBIGUOUS_FEATURE_PROFILE: TaskProfile = {
  multiFile: true,
  multipleValidApproaches: true,
  architecturalDecision: true,
  explorationNeeded: true,
  diffDescribableInOneSentence: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// Paso 3 — El híbrido: plan mode para diseñar, ejecución directa para aplicar
//
// Why: la mayoría del trabajo sustancial usa LOS DOS, en secuencia. Opciones que
//      los presentan como alternativas se pierden el patrón: para una migración
//      de 30 archivos, el plan sin ejecución deja una estrategia sin aplicar, y
//      la ejecución sin plan aplica una estrategia distinta a cada archivo.
// You should see: fase 1 identifica imports y diferencias de API y produce un
//      patrón; fase 2 lo aplica archivo por archivo, consistente.
// ─────────────────────────────────────────────────────────────────────────────

/** La partición del trabajo en sus dos fases. */
interface HybridPlan {
  readonly planPhase: readonly string[];
  readonly executePhase: readonly string[];
}

/**
 * Compone el plan híbrido de una migración de librería.
 *
 * El punto es el ORDEN: las decisiones se toman todas en la fase de plan, así
 * que al empezar a ejecutar no queda ninguna por tomar y el mismo patrón aterriza
 * en cada archivo.
 *
 * @param oldLibrary - La librería que se reemplaza.
 * @param importerFiles - Los archivos que la importan.
 * @returns Las dos fases.
 */
export function planMigration(
  oldLibrary: string,
  importerFiles: readonly string[],
): HybridPlan {
  return {
    planPhase: [
      `Find every file importing ${oldLibrary} (${importerFiles.length} found)`,
      "Map where the two APIs differ",
      "Settle on one migration shape",
      "Flag calls that will not translate cleanly",
    ],
    executePhase: [
      "Apply the settled shape file by file, with no decisions left to make",
      ...importerFiles.map((file) => `Migrate ${file}`),
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 4 — El subagente Explore para el descubrimiento verboso
//
// Why: el descubrimiento es verboso y vale solo hasta que se llega a una
//      conclusión. Dejado en la conversación principal, ocupa el contexto que la
//      implementación va a necesitar.
// You should see: solo un resumen cruza de vuelta; los listados y excerpts se
//      quedan contenidos en el subagente.
// ─────────────────────────────────────────────────────────────────────────────

/** Nivel de exhaustividad con que se invoca Explore. */
type Thoroughness = "quick" | "medium" | "very_thorough";

/** Puerto del subagente Explore. */
interface ExploreRequest {
  readonly target: string;
  readonly thoroughness: Thoroughness;
}

/** Lo que devuelve Explore: un resumen, y lo verboso contenido. */
interface ExploreResult {
  readonly summary: string;
  readonly contained: readonly string[];
}

/**
 * Características fijas del subagente Explore.
 *
 * Es read-only: Write y Edit están explícitamente denegados. Además, Explore (y
 * el subagente Plan) SALTAN tus archivos CLAUDE.md y el git status de la sesión
 * padre para mantener la investigación rápida y barata; cualquier otro subagente
 * los carga.
 */
export const EXPLORE_CAPABILITIES = {
  readOnly: true,
  deniedTools: ["Write", "Edit"],
  skips: ["CLAUDE.md", "parent session git status"],
  thoroughnessLevels: ["quick", "medium", "very_thorough"],
} as const;

/**
 * Corre el descubrimiento aislando lo verboso.
 *
 * @param request - Qué explorar y con qué exhaustividad.
 * @param verboseFindings - Todo lo que la exploración produce por dentro.
 * @returns El resumen que cruza, más lo que se quedó contenido.
 */
export function runExplore(
  request: ExploreRequest,
  verboseFindings: readonly string[],
): ExploreResult {
  return {
    summary: `Explored ${request.target} (${request.thoroughness}): ${verboseFindings.length} findings summarised.`,
    contained: verboseFindings,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 5 — El framework de decisión, escrito
//
// Why: internalizar los criterios es esencial para el examen. El framework debe
//      cubrir la distinción clave: la ambigüedad determina el modo, no la
//      dificultad.
// You should see: al menos cuatro criterios para plan mode y tres para
//      ejecución directa, cada uno con un ejemplo concreto.
// ─────────────────────────────────────────────────────────────────────────────

/** Un criterio del framework, con su ejemplo. */
interface ModeCriterion {
  readonly mode: ExecutionMode;
  readonly signal: string;
  readonly example: string;
}

/** El framework escrito del ejercicio. */
export const DECISION_FRAMEWORK: readonly ModeCriterion[] = [
  {
    mode: "plan",
    signal: "Multiple valid approaches exist",
    example: "Monolith to microservices — where do the service boundaries go?",
  },
  {
    mode: "plan",
    signal: "Multi-file modifications needed",
    example: "Library migration across 45+ files needs one uniform strategy",
  },
  {
    mode: "plan",
    signal: "Architectural decisions required",
    example: "Service boundaries, dependency direction, API contracts",
  },
  {
    mode: "plan",
    signal: "Codebase exploration required",
    example: "Mapping dependency chains before extracting a service",
  },
  {
    mode: "direct_execution",
    signal: "Clear stack trace points to a single function",
    example: "Null pointer at src/utils/format.ts:42",
  },
  {
    mode: "direct_execution",
    signal: "Known fix, known location, known approach",
    example: "Update a configuration value",
  },
  {
    mode: "direct_execution",
    signal: "Limited scope, no design decisions",
    example: "Add a date validation conditional",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Extra — Cómo se entra a plan mode, qué restringe y cómo se aprueba
//
// Why: el examen pregunta por el mecanismo, no solo por la decisión: los tres
//      puntos de entrada, la cadena de permission modes y las opciones de
//      aprobación.
// You should see: las tres vías de entrada y el efecto de cada aprobación.
// ─────────────────────────────────────────────────────────────────────────────

/** Las tres vías documentadas de entrada a plan mode, más el default de proyecto. */
export type PlanModeEntry =
  | "shift_tab"
  | "slash_plan_prefix"
  | "cli_permission_mode_plan"
  | "settings_default_mode";

/** Los permission modes, en el orden en que Shift+Tab cicla por los habilitados. */
type PermissionMode =
  | "default"
  | "acceptEdits"
  | "plan"
  | "auto"
  | "dontAsk"
  | "bypassPermissions";

/** Qué corre sin preguntar en cada modo. */
export const PERMISSION_MODE_BEHAVIOUR: Readonly<Record<PermissionMode, string>> = {
  default: "Reads only.",
  acceptEdits: "Reads, edits, and common filesystem commands.",
  plan: "Reads, plus classifier-approved commands when auto mode is available.",
  auto: "Everything, with safety checks.",
  dontAsk: "Only pre-approved tools.",
  bypassPermissions:
    "Everything (explicit ask rules and the destructive-command circuit breaker still prompt).",
};

/**
 * Entra a plan mode.
 *
 * `Shift+Tab` cicla por TODOS los permission modes habilitados, no solo por plan;
 * `/plan` prefija un prompt suelto; `claude --permission-mode plan` arranca el CLI
 * ya en plan mode. Mientras está activo, la status bar muestra `⏸ plan mode on`.
 *
 * @param entry - La vía de entrada.
 * @returns Qué hace esa vía.
 */
export function planModeEntryEffect(entry: PlanModeEntry): string {
  switch (entry) {
    case "shift_tab":
      return "Cycles through all enabled permission modes (default, acceptEdits, plan, auto, bypassPermissions…).";
    case "slash_plan_prefix":
      return "Prefixes a single prompt with /plan.";
    case "cli_permission_mode_plan":
      return "Starts the CLI in plan mode: claude --permission-mode plan.";
    case "settings_default_mode":
      return "permissions.defaultMode: \"plan\" in .claude/settings.json makes it the project default.";
    default: {
      const exhaustive: never = entry;
      return exhaustive;
    }
  }
}

/** Qué se elige al aprobar un plan. */
type ApprovalChoice = "auto_mode" | "manual_edits" | "keep_planning";

/**
 * El efecto de cada opción de aprobación.
 *
 * Aprobar un plan sale de plan mode y cambia la sesión al modo que describa la
 * opción elegida. `No, keep planning` se queda en plan mode para redirigir.
 *
 * @param choice - La opción elegida.
 * @returns El efecto sobre la sesión.
 */
export function approvalEffect(choice: ApprovalChoice): string {
  switch (choice) {
    case "auto_mode":
      return "Approves and starts in auto mode — auto-accepts edits going forward.";
    case "manual_edits":
      return "Approves but reviews each edit individually.";
    case "keep_planning":
      return "Stays in plan mode so you can redirect Claude.";
    default: {
      const exhaustive: never = choice;
      return exhaustive;
    }
  }
}

/**
 * ============================================================================
 * ✗ ANTI-PATTERN — Los errores que el examen construye
 * ============================================================================
 */

/** ✗ ANTI-PATTERN 1 — Ejecución directa para un cambio arquitectónico multi-archivo.
 *
 * Donde hay varios diseños viables y el cambio abarca muchos archivos, el trabajo
 * ES elegir entre ellos. La ejecución directa elige implícitamente, archivo por
 * archivo, sin declararlo: una dependencia descubierta en el archivo 30 invalida
 * lo hecho en los archivos 1 a 29.
 */
// mode = "direct_execution"  // para "restructure the monolith into microservices"

/** ✗ ANTI-PATTERN 2 — Plan mode para un bug de una archivo con stack trace claro.
 *
 * El trace nombra una función y la causa se conoce: no queda nada que diseñar.
 * Plan mode produce un documento que repite lo que el trace ya decía.
 */
// mode = "plan"  // para "null pointer at src/utils/format.ts:42"

/** ✗ ANTI-PATTERN 3 — Presentar plan y ejecución como alternativas.
 *
 * La migración de 30 archivos usa LOS DOS, en ese orden. Planificar sin ejecutar
 * deja una estrategia sin aplicar; ejecutar sin planificar aplica una estrategia
 * distinta a cada archivo.
 */
// "use plan mode OR direct execution"  // para una migración: usa ambos

/** ✗ ANTI-PATTERN 4 — Empezar en ejecución directa y pasar a plan al complicarse.
 *
 * Cuando el requisito ya declara la escala, la evidencia estaba antes de abrir
 * nada. Cambiar a mitad significa explorar un codebase ya parcialmente modificado:
 * un mapa de un blanco móvil.
 */
// start direct; if (complexity) switchToPlan();  // el mapa ya está desactualizado

/** ✗ ANTI-PATTERN 5 — Darle Write/Edit al descubrimiento.
 *
 * Explore es read-only por diseño: Write y Edit están denegados. Un subagente de
 * descubrimiento con capacidad de escritura deja de ser seguro de dejar suelto.
 */
// Explore con tools: ["Read", "Write", "Edit"]  // no es Explore

/** ✗ ANTI-PATTERN 6 — Plan mode sin ninguna decisión que tomar.
 *
 * Un cambio cuyo diff entero cabe en una frase no tiene nada que diseñar. El
 * overhead es un coste real aunque el modo sea el "más seguro".
 */
// mode = "plan"  // para "rename this symbol across forty files"

/**
 * ============================================================================
 * EXAM TRAPS — distractores recurrentes y criterio de rechazo
 * ============================================================================
 *
 * | Trampa                                             | Por qué se rechaza                                  |
 * |----------------------------------------------------|-----------------------------------------------------|
 * | Ejecución directa en cambios arquitectónicos       | Elige el diseño implícitamente; rework caro          |
 * | Plan mode para un fix de un archivo con trace      | No queda nada que diseñar; puro overhead             |
 * | No reconocer el híbrido plan-then-execute          | Para una migración, ni uno ni otro por separado      |
 * | Pasar a plan solo cuando aparece la complejidad    | La evidencia ya estaba antes de abrir nada           |
 * | Decidir por dificultad en vez de por ambigüedad    | Difícil pero claro ⇒ directo; fácil pero incierto ⇒ plan |
 *
 * QUICK REFERENCE — datos de la fuente
 *
 *   Entrar a plan mode .... Shift+Tab, prefijo `/plan`, o
 *                            `claude --permission-mode plan`
 *   Qué restringe .......... edita solo lectura/exploración read-only hasta
 *                            aprobar (salvo sesiones con bypass permissions)
 *   Aprobar: auto .......... "Yes, and use auto mode"
 *   Aprobar: manual ........ "Yes, manually approve edits" — revisa cada edición
 *   Rechazar ............... "No, keep planning" — se queda en plan mode
 *   Editar el plan ......... Ctrl+G lo abre en tu editor
 *   Salir sin aprobar ...... Shift+Tab otra vez
 *   Default de proyecto .... `permissions.defaultMode: "plan"` en `.claude/settings.json`
 *   Permission modes ....... default (reads only) · acceptEdits (reads + edits +
 *                            comandos de fs comunes) · plan (reads +
 *                            commands aprobados por classifier) · auto (todo, con
 *                            safety checks) · dontAsk (solo pre-aprobadas) ·
 *                            bypassPermissions (todo, sin prompts)
 *   Subagente Explore ...... read-only, deniega Write/Edit; thoroughness: quick /
 *                            medium / very thorough
 *   Explore y Plan ......... saltan CLAUDE.md y el git status del padre; los demás
 *                            subagentes cargan ambos
 *   Workflow recomendado ... Explore → Plan → Implement → Commit
 *   Cuándo saltarse el plan  cuando el diff entero cabe en una frase
 *
 * ============================================================================
 * FLUJO DE EJECUCIÓN ESPERADO  (trace ilustrativo — no se ejecuta)
 * ============================================================================
 *
 * chooseMode(CLEAR_BUG_PROFILE)
 *   → "direct_execution"    ← difícil, pero no incierto
 * chooseMode(AMBIGUOUS_FEATURE_PROFILE)
 *   → "plan"                ← fácil, pero tres diseños posibles
 *
 * planMigration("moment.js", [30 archivos])
 *   planPhase:    [find importers (30), map API differences, settle one shape, flag hard calls]
 *   executePhase: [apply the shape file by file, Migrate <file> ×30]
 *   ✅ plan THEN execute — no plan OR execute
 *
 * runExplore({ target: "src/api/", thoroughness: "very_thorough" },
 *            [listing, dependencyGraph, excerpt, note])
 *   → { summary: "Explored src/api/ (very_thorough): 4 findings summarised.",
 *       contained: [listing, dependencyGraph, excerpt, note] }
 *   EXPLORE_CAPABILITIES: read-only, denied ["Write","Edit"],
 *                         skips ["CLAUDE.md","parent session git status"]
 *   ✅ solo el resumen entra a la conversación principal
 *
 * planModeEntryEffect("shift_tab") → "Cycles through all enabled permission modes…"
 * approvalEffect("keep_planning")  → "Stays in plan mode so you can redirect Claude."
 * RECOMMENDED_PHASES → [explore, plan, implement, commit]
 *
 * ANTI-PATRÓN: la race condition en payment reconciliation es el bug MÁS difícil
 * del trimestre, pero hay un test que la reproduce, un stack trace y acuerdo sobre
 * la única función culpable y su fix. Difícil ≠ incierto: el examen espera
 * "direct execution". Ir a plan mode aquí es overhead disfrazado de prudencia.
 */
