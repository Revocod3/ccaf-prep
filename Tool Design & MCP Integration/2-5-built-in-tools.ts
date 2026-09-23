/**
 * ============================================================================
 * DOMINIO 2 · TASK STATEMENT 2.5 — Built-in Tools
 * ----------------------------------------------------------------------------
 * Objetivo oficial:
 *   Select and apply built-in tools (Read, Write, Edit, Bash, Grep, Glob)
 *   effectively.
 *
 * Qué evalúa el examen aquí:
 *   Seis built-ins cubren el trabajo con un codebase, y cada uno es para un
 *   trabajo concreto; tirar del equivocado cuesta tiempo, contexto o ambos.
 *   La distinción que más se testea: **Grep lee el interior de los archivos,
 *   Glob empareja sus rutas**. Y en las modificaciones, Edit es la vía por
 *   defecto: un match no único se responde ensanchando el anchor o con
 *   `replace_all: true`, no escalando. Read + Write es el último recurso. Y al
 *   explorar, nunca se leen todos los archivos primero: Grep para encontrar
 *   puntos de entrada, Read para seguir los imports, Grep otra vez para los
 *   nombres de los wrappers.
 *
 * Build Exercise: Trace and Refactor a Deprecated Function Using Built-in Tools
 *                 (Intermediate · 30 min)
 * ============================================================================
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tipos de la selección de tools
// ─────────────────────────────────────────────────────────────────────────────

/**
 * El roster documentado de built-ins.
 *
 * La task statement nombra seis (Read, Write, Edit, Bash, Grep, Glob), pero la
 * doc lista más: `WebFetch` recupera contenido externo y `Agent` spawnea
 * subagentes, "and others".
 */
export type BuiltInTool =
  | "Read"
  | "Write"
  | "Edit"
  | "Bash"
  | "Grep"
  | "Glob"
  | "WebFetch"
  | "Agent";

/** Las dos tools de búsqueda, la confusión central de la task statement. */
type SearchTool = "Grep" | "Glob";

/** Qué está preguntando el item: contenido o existencia de archivos. */
type SearchQuestion = "what files contain" | "which files exist";

/**
 * Elige entre Grep y Glob según la pregunta.
 *
 * Grep busca en el CONTENIDO de los archivos: quién llama a una función, dónde
 * se lanza un mensaje de error, qué módulos importan algo. Glob empareja RUTAS
 * por patrón de nombre: tests, configuración, todo lo de una extensión bajo un
 * directorio.
 *
 * @param about - Si la pregunta es sobre contenido o sobre qué archivos existen.
 * @returns La tool correcta para esa pregunta.
 */
export function chooseSearchTool(about: SearchQuestion): SearchTool {
  return about === "what files contain" ? "Grep" : "Glob";
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 1 — Grep para encontrar todos los callers
//
// Why: Grep busca en el contenido, así que es la tool correcta para encontrar
//      callers. Usar Glob aquí fallaría porque Glob empareja rutas, y una ruta
//      nunca contiene una llamada. El examen testea esto directamente.
// You should see: rutas con línea y la línea que matchea, p. ej.
//      `src/OrderProcessor.ts:42: await processLegacyOrder(orderId)`.
// ─────────────────────────────────────────────────────────────────────────────

/** Un match de Grep: archivo, línea y texto. */
export interface GrepMatch {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

/**
 * Un paso del plan de exploración, con la tool y por qué.
 *
 * Cada paso justifica el siguiente: el resultado de uno da los términos de
 * búsqueda del otro.
 */
interface ExplorationStep {
  readonly tool: "Grep" | "Glob" | "Read";
  readonly argument: string;
  readonly why: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 2 — Glob para los tests emparejados por convención de nombre
//
// Why: Glob empareja rutas por patrón de nombre, así que es la tool correcta
//      para encontrar tests por extensión o convención. Completa el patrón
//      Grep-then-Glob: contenido para los callers, rutas para sus tests.
// You should see: rutas como `src/OrderProcessor.test.tsx` y
//      `src/RefundHandler.test.tsx`, correspondientes a los callers del paso 1.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * El plan de tres pasadas del escenario de deprecación.
 *
 * Contenido, luego rutas, luego contenido otra vez: Grep para las referencias
 * directas, Glob para los tests que van al lado por convención, y Grep de nuevo
 * para la cobertura que llega a través de un wrapper. Empezar por Glob lo
 * invierte y solo encuentra los tests cuyo nombre ya podías adivinar.
 *
 * @param functionName - La función deprecada.
 * @param wrapperName - El nombre bajo el que un caller la reexpone.
 * @param callerFiles - Los archivos que salieron del primer Grep.
 * @returns Los pasos, en orden.
 */
export function planDeprecationTrace(
  functionName: string,
  wrapperName: string,
  callerFiles: readonly string[],
): readonly ExplorationStep[] {
  const testPatterns = callerFiles.map(
    (file) => `**/${file.replace(/\.[^./]+$/, "")}.test.*`,
  );
  return [
    {
      tool: "Grep",
      argument: functionName,
      why: "Content search: every file whose contents reference the function.",
    },
    {
      tool: "Glob",
      argument: testPatterns.join(" , "),
      why: "Path matching: the test file paired with each caller by naming convention.",
    },
    {
      tool: "Grep",
      argument: wrapperName,
      why: "Content search again: tests that reach the function through the wrapper.",
    },
  ];
}

/**
 * Traza el uso de una función a través de wrappers y barrel files.
 *
 * Un Grep por el nombre original deja invisibles a los consumidores que la usan
 * bajo el nombre del wrapper. Cada pasada da los términos de la siguiente.
 *
 * @param functionName - El nombre en el módulo que la declara.
 * @param exportedNames - Los nombres bajo los que sale del módulo definidor.
 * @param barrelModule - El módulo barrel (p. ej. `./utils`) que la reexporta.
 * @returns Los pasos de la traza.
 */
export function planWrapperTrace(
  functionName: string,
  exportedNames: readonly string[],
  barrelModule: string,
): readonly ExplorationStep[] {
  return [
    {
      tool: "Grep",
      argument: functionName,
      why: "Locate the module that declares it.",
    },
    {
      tool: "Read",
      argument: "<defining file>",
      why: "Note every name under which it leaves that module.",
    },
    ...exportedNames.map(
      (name): ExplorationStep => ({
        tool: "Grep",
        argument: name,
        why: "One search per alias: each has its own consumers.",
      }),
    ),
    {
      tool: "Grep",
      argument: barrelModule,
      why: "Catch imports written against the barrel rather than the source.",
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 3 — Read incremental, solo lo que el paso anterior justificó
//
// Why: leer todos los archivos primero es el error más caro disponible — un
//      codebase de 200 archivos leído entero se come la ventana de contexto
//      antes de empezar. El examen penaliza explícitamente ese orden.
// You should see: el contenido completo de cada caller, mostrando cómo se llama
//      la función y si se importa directo o a través de un wrapper.
// ─────────────────────────────────────────────────────────────────────────────

/** El orden correcto de exploración: estrecho primero, expandir solo si hace falta. */
export const INCREMENTAL_EXPLORATION_ORDER: readonly string[] = [
  "Grep — find entry points",
  "Read — follow imports and trace flows",
  "Grep again — wrapper and barrel names",
  "Read — only what the previous step justified",
];

// ─────────────────────────────────────────────────────────────────────────────
// Paso 4 y 5 — Edit primero; ensanchar el anchor antes de escalar
//
// Why: Edit toca solo la región que matchea, así que es rápido y preciso. Falla
//      cuando el texto aparece más de una vez, y esa negativa es la feature: una
//      adivinanza modificaría código que nunca miraste.
// You should see: al primer intento, un error del tipo "matches 3 locations"; al
//      segundo, con un anchor más ancho, Edit cambia exactamente una ocurrencia.
// ─────────────────────────────────────────────────────────────────────────────

/** Resultado de intentar un Edit. */
type EditOutcome =
  | { readonly status: "applied"; readonly replacements: number }
  | { readonly status: "non_unique"; readonly matches: number }
  | { readonly status: "not_found" };

/** La recuperación que corresponde a un Edit fallido. */
type EditRecovery =
  | { readonly action: "widen_anchor"; readonly reason: string }
  | { readonly action: "replace_all"; readonly reason: string }
  | { readonly action: "read_then_write"; readonly reason: string };

/**
 * Planifica la recuperación de un Edit, sin escalar antes de tiempo.
 *
 * Ensanchar `old_string` con más contexto, o `replace_all: true` si de verdad
 * todas las ocurrencias deben cambiar, mantienen la operación en Edit y no
 * cuestan casi nada. Read + Write —traer el archivo entero y devolverlo
 * entero— es el último recurso: gasta el contexto de un archivo entero para lo
 * que suele ser una línea.
 *
 * @param outcome - Lo que devolvió el intento de Edit.
 * @param allOccurrencesShouldChange - `true` si todas las ocurrencias cambian.
 * @returns La recuperación a aplicar, o `null` si no hace falta ninguna.
 */
export function planEditRecovery(
  outcome: EditOutcome,
  allOccurrencesShouldChange: boolean,
): EditRecovery | null {
  switch (outcome.status) {
    case "applied":
      return null;
    case "not_found":
      return {
        action: "widen_anchor",
        reason: "No match: re-read the region and supply a real anchor.",
      };
    case "non_unique":
      return allOccurrencesShouldChange
        ? {
            action: "replace_all",
            reason: `${outcome.matches} occurrences all should change: one atomic Edit.`,
          }
        : {
            action: "widen_anchor",
            reason: `${outcome.matches} matches: extend old_string with surrounding lines.`,
          };
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Extra — Built-ins en permisos y en el SDK
//
// Why: los built-ins comparten superficie de permisos con las tools MCP pero con
//      otra convención de nombres, y en el SDK el array `tools` decide qué
//      built-ins existen siquiera.
// You should see: la distinción entre permitir sin prompt y restringir
//      disponibilidad, y el patrón de nombres `mcp__<server>__<tool>`.
// ─────────────────────────────────────────────────────────────────────────────

/** `--allowedTools` salta el prompt; `--tools` restringe la disponibilidad. */
export const PERMISSION_MECHANISMS: Readonly<Record<string, string>> = {
  allowedTools: "Skips the permission prompt (uses permission-rule syntax).",
  tools: "Restricts which built-ins are available at all.",
};

/** Cómo se comporta una regla de `--disallowedTools`. */
type DisallowedRuleKind = "bare_removal" | "scoped_deny";

/**
 * Clasifica una regla de `--disallowedTools`.
 *
 * Un nombre pelado saca la tool del contexto por completo ("Edit" elimina Edit,
 * "*" elimina todas). Una regla con scope como `Bash(rm *)` deja la tool
 * disponible y solo deniega las llamadas que matchean.
 *
 * @param rule - La regla tal como se pasa al flag.
 * @returns Si elimina la tool o solo deniega llamadas que matchean.
 */
export function classifyDisallowedRule(rule: string): DisallowedRuleKind {
  return rule.includes("(") ? "scoped_deny" : "bare_removal";
}

/** Nombre de la tool que spawnea subagentes: `Agent` desde v2.1.63, alias `Task`. */
type SpawnToolName = "Agent" | "Task";

/** Ambos nombres designan la misma capacidad. */
export const SPAWN_TOOL_ALIASES: readonly SpawnToolName[] = ["Agent", "Task"];

/**
 * ¿Este nombre de tool es la de spawning?
 *
 * Los releases actuales emiten "Agent" en los bloques `tool_use` pero siguen
 * usando "Task" en la lista de `system:init` y en
 * `result.permission_denials[].tool_name`. Si el log del coordinator muestra
 * Task en vez de Agent, es un artefacto de versión, no otra tool.
 *
 * @param name - El nombre visto en un log o una regla.
 * @returns `true` si designa el spawning de subagentes.
 */
export function isSpawnTool(name: string): boolean {
  return SPAWN_TOOL_ALIASES.some((alias) => alias === name);
}

/**
 * ============================================================================
 * ✗ ANTI-PATTERN — Las confusiones que el examen construye
 * ============================================================================
 */

/** ✗ ANTI-PATTERN 1 — Glob para encontrar callers.
 *
 * Una ruta registra dónde está un archivo, nunca lo que dice, así que un call
 * site es invisible al path matching.
 */
// Glob("processLegacyOrder")  // → nada: una ruta nunca contiene una llamada

/** ✗ ANTI-PATTERN 2 — Grep para encontrar archivos por extensión.
 *
 * Grep puede tropezar con nombres de archivo que aparecen en el contenido, y eso
 * es peor que fallar limpiamente: un resultado parcial parece uno que funciona.
 */
// Grep("test")  // → un match parcial, engañoso

/** ✗ ANTI-PATTERN 3 — Leer todos los archivos primero.
 *
 * Un codebase de 200 archivos leído entero consume la ventana de contexto antes
 * de empezar, y casi todo en archivos sin relación con la tarea.
 */
// for (const file of allFiles) await Read(file);  // contexto agotado antes de trabajar

/** ✗ ANTI-PATTERN 4 — Read + Write como vía estándar de modificación.
 *
 * Edit toca solo la región que matchea; Read + Write carga y reescribe el
 * archivo entero, así que el mismo cambio de una línea cuesta el contexto de un
 * archivo.
 */
// const content = await Read(file); await Write(file, content.replace(a, b));  // siempre

/** ✗ ANTI-PATTERN 5 — Escalar a Read + Write en cuanto Edit dice "no único".
 *
 * La recuperación documentada es ensanchar `old_string` o `replace_all: true`:
 * ambas cuestan casi nada y siguen en Edit. Escala solo si ninguna de las dos
 * puede aislar el objetivo.
 */
// if (editError.matches > 1) await readThenWrite(file);  // a dos palabras del anchor

/**
 * ============================================================================
 * EXAM TRAPS — distractores recurrentes y criterio de rechazo
 * ============================================================================
 *
 * | Trampa                                             | Por qué se rechaza                                  |
 * |----------------------------------------------------|-----------------------------------------------------|
 * | Glob para encontrar callers                        | Las rutas no contienen llamadas                      |
 * | Grep para encontrar archivos por nombre            | Un match parcial parece que funcionó                 |
 * | Leer todos los archivos primero                    | Agota el contexto antes de empezar                   |
 * | Read + Write para cada modificación                | Cuesta un archivo entero por un cambio de una línea  |
 * | Escalar al primer match no único                   | Ensanchar el anchor estaba a dos palabras            |
 *
 * QUICK REFERENCE — datos de la fuente
 *
 *   Grep .................... busca en el CONTENIDO — callers, mensajes de error,
 *                             imports
 *   Glob .................... empareja RUTAS por patrón — `**\/*.test.tsx`,
 *                             `**\/config.*`
 *   Edit .................... modificación dirigida vía `old_string` único; falla
 *                             si el texto no es único
 *   Fix de no único ......... ensanchar `old_string` o `replace_all: true`
 *   Read + Write ............ fallback de ÚLTIMO recurso, solo si ninguna de las
 *                             dos anteriores desambigua
 *   Roster documentado ...... Bash, Read, Write, Edit, Glob, Grep, WebFetch,
 *                             Agent, "and others"
 *   Opción `tools` del SDK .. `tools: [...]` deja solo los built-ins listados
 *                             (MCP no se afecta); `tools: []` los quita todos
 *   Agent tool .............. spawnea subagentes; renombrada de `Task` en v2.1.63
 *                             (la guía del examen sigue diciendo "Task")
 *   --allowedTools .......... salta el prompt de permiso
 *   --tools ................. restringe qué built-ins están disponibles
 *   --disallowedTools ....... nombre pelado quita del contexto ("Edit", "*");
 *                             regla con scope (`Bash(rm *)`) solo deniega matches
 *   Prefijo Bash ............ `Bash(git diff *)` (espacio final) matchea cualquier
 *                             comando `git diff…`; sin el espacio también
 *                             matchearía `git diff-index`
 *   Regla de WebFetch ....... `WebFetch(domain:example.com)`;
 *                             `domain:*.example.com` matchea subdominios, no el apex
 *   Naming MCP .............. `mcp__<server-name>__<tool-name>`, p. ej.
 *                             `mcp__github__list_issues`
 *   Scoping MCP ............. `mcp__server` (todo el server) · `mcp__server__*`
 *                             (wildcard) · `mcp__server__tool` (una tool)
 *   Orden incremental ....... Grep puntos de entrada → Read trazar flujos → Grep
 *                             nombres de wrapper/barrel → Read solo lo justificado
 *
 * ============================================================================
 * FLUJO DE EJECUCIÓN ESPERADO  (trace ilustrativo — no se ejecuta)
 * ============================================================================
 *
 * Objetivo: todos los callers de processLegacyOrder() y los tests que lo ejercen.
 *
 * [Paso 1] chooseSearchTool("what files contain") → "Grep"
 *   Grep "processLegacyOrder"
 *     src/OrderProcessor.ts:42: await processLegacyOrder(orderId)   ✓
 *     src/RefundHandler.ts:17:  const r = processLegacyOrder(orderId) ✓
 *   (con Glob aquí: 0 resultados — una ruta nunca contiene una llamada)
 *
 * [Paso 2] chooseSearchTool("which files exist") → "Glob"
 *   Glob "**\/OrderProcessor.test.* , **\/RefundHandler.test.*"
 *     src/OrderProcessor.test.tsx   ✓  (ejerce la función indirectamente)
 *     src/RefundHandler.test.tsx    ✓
 *
 * [Paso 3] Read incremental — solo los archivos que el Grep justificó
 *   Read("src/OrderProcessor.ts") → importa directo desde "./legacyOrders"
 *   Read("src/RefundHandler.ts")  → reexpone la función como applyLegacyOrder
 *   (NUNCA: leer los 200 archivos del repo primero)
 *
 * [Paso 3b] planWrapperTrace(...) → Grep "applyLegacyOrder"
 *   src/RefundHandler.test.tsx:8  ✓  test que llega a la función vía el wrapper
 *
 * [Paso 4] Edit en cada caller
 *   Edit { old_string: "await processLegacyOrder(orderId)",
 *          new_string: "await processOrder(orderId, { validate: true })" }
 *   → Error: old_string matches 3 locations
 *
 * [Paso 5] planEditRecovery({ status: "non_unique", matches: 3 }, false)
 *   → { action: "widen_anchor",
 *       reason: "3 matches: extend old_string with surrounding lines." }
 *   Edit con el anchor ensanchado (incluye la función envolvente)
 *   → applied, replacements: 1   ✓ solo cambió handleRefund
 *
 *   (si TODAS debieran cambiar: replace_all: true → un Edit atómico)
 *   (Read + Write solo si ninguna de las dos anteriores aísla el objetivo)
 *
 * ANTI-PATRÓN: empezar por Glob con `**\/refund` devuelve tres archivos, ninguno
 * con el mensaje buscado, mientras los dos módulos que sí lo lanzan se llaman
 * policy.ts y messages.ts. La pregunta era sobre CONTENIDO: pertenece a Grep.
 */
