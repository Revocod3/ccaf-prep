/**
 * ============================================================================
 * DOMINIO 3 · TASK STATEMENT 3.2 — Custom Slash Commands and Skills
 * ----------------------------------------------------------------------------
 * Objetivo oficial:
 *   Create and configure custom slash commands and skills.
 *
 * Qué evalúa el examen aquí:
 *   Comandos y skills ya son un solo sistema. `.claude/commands/` produce
 *   `/comandos` desde un `.md` plano; `.claude/skills/` produce los mismos desde
 *   un directorio con `SKILL.md` dentro — y es la ubicación canónica. Tirar un
 *   `.md` suelto en `.claude/skills/` no produce NADA y no reporta error. Aparte
 *   está la frontera central: una skill se **invoca para una tarea** (la
 *   descripción vive en contexto, el cuerpo llega al invocarla); CLAUDE.md está
 *   presente desde el inicio de cada sesión. Y `context: fork` aísla el output
 *   verboso para que no degrade los turnos siguientes.
 *
 * Build Exercise: Create Custom Commands and Skills  (Intermediate · 30 min)
 * ============================================================================
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tipos del sistema unificado de skills
// ─────────────────────────────────────────────────────────────────────────────

/** Los dos scopes: `.claude/` viaja por git; `~/.claude/` es solo tuyo. */
type SkillScope = "project" | "user";

/**
 * Frontmatter de un `SKILL.md`.
 *
 * Todos los campos son opcionales; solo `description` es recomendado, porque es
 * lo que Claude usa para decidir cuándo auto-invocar la skill (si falta, cae al
 * primer párrafo del cuerpo).
 */
interface SkillFrontmatter {
  readonly name?: string;
  readonly description?: string;
  readonly "argument-hint"?: string;
  /**
   * En la guía del examen: restringe el acceso a tools durante la skill.
   * En la doc actual: pre-aprueba las listadas para el turno de invocación.
   */
  readonly "allowed-tools"?: readonly string[];
  readonly model?: string;
  readonly context?: "fork";
  readonly agent?: string;
  readonly "disable-model-invocation"?: boolean;
  readonly "user-invocable"?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 1 — Un comando de proyecto para todo el equipo
//
// Why: los comandos de proyecto se comparten por git, así que cada desarrollador
//      los recibe al clonar. El examen testea que pongas los comandos del equipo
//      en `.claude/commands/` (proyecto) y no en `~/.claude/commands/` (personal).
// You should see: `.claude/commands/review.md` en el repo; correr `/review`
//      dispara el checklist y aparece en cualquier clone.
// ─────────────────────────────────────────────────────────────────────────────

/** Qué encontró el descubridor en una ruta. */
type CommandDescriptor =
  | { readonly kind: "command"; readonly name: string; readonly path: string; readonly scope: SkillScope }
  | { readonly kind: "skill"; readonly name: string; readonly path: string; readonly scope: SkillScope }
  | { readonly kind: "invalid"; readonly path: string; readonly reason: string };

const PROJECT_COMMAND = /^\.claude\/commands\/([^/]+)\.md$/;
const USER_COMMAND = /^~\/\.claude\/commands\/([^/]+)\.md$/;
const PROJECT_SKILL = /^\.claude\/skills\/([^/]+)\/SKILL\.md$/;
const USER_SKILL = /^~\/\.claude\/skills\/([^/]+)\/SKILL\.md$/;
const LOOSE_SKILL = /^(?:~\/)?\.claude\/skills\/([^/]+)\.md$/;

/**
 * Descubre el comando que produce una ruta, o por qué no produce ninguno.
 *
 * El caso clave: un `.md` suelto dentro de `.claude/skills/` NO es una skill.
 * Una skill es un directorio con `SKILL.md` dentro, así que el archivo suelto
 * nunca se descubre — y nada reporta el error.
 *
 * @param path - La ruta del archivo candidato.
 * @returns El descriptor correspondiente.
 */
export function discoverCommand(path: string): CommandDescriptor {
  const projectCommand = PROJECT_COMMAND.exec(path);
  const projectName = projectCommand?.[1];
  if (projectName !== undefined) {
    return { kind: "command", name: projectName, path, scope: "project" };
  }

  const userCommand = USER_COMMAND.exec(path);
  const userName = userCommand?.[1];
  if (userName !== undefined) {
    return { kind: "command", name: userName, path, scope: "user" };
  }

  const projectSkill = PROJECT_SKILL.exec(path);
  const projectSkillName = projectSkill?.[1];
  if (projectSkillName !== undefined) {
    return { kind: "skill", name: projectSkillName, path, scope: "project" };
  }

  const userSkill = USER_SKILL.exec(path);
  const userSkillName = userSkill?.[1];
  if (userSkillName !== undefined) {
    return { kind: "skill", name: userSkillName, path, scope: "user" };
  }

  if (LOOSE_SKILL.test(path)) {
    return {
      kind: "invalid",
      path,
      reason:
        "A skill is a directory with SKILL.md inside it. A loose .md under .claude/skills/ is never discovered, and nothing reports the mistake.",
    };
  }
  return { kind: "invalid", path, reason: "Unrecognised command or skill location." };
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 2 — Una skill personal con `context: fork`
//
// Why: `context: fork` corre la skill en un contexto de subagente aislado, así
//      que lo que genera se queda ahí y la conversación principal no se toca.
//      Importa para todo lo ruidoso: análisis de codebase, brainstorming.
// You should see: `~/.claude/skills/brainstorm/SKILL.md` con `context: fork`,
//      disponible solo en tus sesiones.
// ─────────────────────────────────────────────────────────────────────────────

/** Dónde corre la skill y qué consecuencia tiene para el contexto. */
interface IsolationPlan {
  readonly where: "isolated_subagent" | "main_conversation";
  readonly agent: string;
  readonly why: string;
}

/**
 * Planifica el aislamiento según el frontmatter.
 *
 * Sin `context: fork`, cada línea que emite la skill aterriza en la conversación
 * principal, gastando contexto que los turnos siguientes necesitarán — el daño
 * aparece DESPUÉS de que la skill terminó, en respuestas degradadas a preguntas
 * sin relación. Con fork, el contenido de la skill pasa a ser el prompt del
 * subagente, que no tiene acceso al historial del padre.
 *
 * @param frontmatter - El frontmatter de la skill.
 * @returns Dónde corre y con qué subagente.
 */
export function planIsolation(frontmatter: SkillFrontmatter): IsolationPlan {
  if (frontmatter.context !== "fork") {
    return {
      where: "main_conversation",
      agent: "none",
      why: "No context: fork — verbose output accumulates in the main conversation and degrades later turns.",
    };
  }
  return {
    where: "isolated_subagent",
    // `agent` elige el subagente; default general-purpose cuando se omite.
    agent: frontmatter.agent ?? "general-purpose",
    why: "context: fork — noisy work stays contained and only a short summary crosses back.",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 3 — `allowed-tools`, y la trampa de qué significa realmente
//
// Why: la guía del examen describe `allowed-tools` como restrictivo, y esa es la
//      respuesta que puntúa. La doc actual define otra cosa: pre-aprueba las
//      listadas para el turno de invocación, sin tocar el resto. El límite real
//      es `disallowed-tools` o una deny rule.
// You should see: el frontmatter con `allowed-tools` = Read, Grep, Glob.
// ─────────────────────────────────────────────────────────────────────────────

/** Las dos lecturas de `allowed-tools`, más dónde vive la frontera de verdad. */
interface AllowedToolsSemantics {
  readonly examGuide: string;
  readonly currentDocs: string;
  readonly realBoundary: string;
}

export const ALLOWED_TOOLS_SEMANTICS: AllowedToolsSemantics = {
  examGuide: "Restricts tool access during skill execution.",
  currentDocs:
    "Pre-approves the listed tools for the invoking turn only; the grant clears on your next message, and every other tool remains reachable.",
  realBoundary: "disallowed-tools, or a deny rule in permission settings.",
};

/**
 * ¿Este campo es una frontera de tools real?
 *
 * @param field - El campo a evaluar.
 * @returns `true` solo si el campo saca la tool de alcance.
 */
export function isTrueToolBoundary(
  field: "allowed-tools" | "disallowed-tools" | "permissions.deny",
): boolean {
  switch (field) {
    case "allowed-tools":
      return false;
    case "disallowed-tools":
    case "permissions.deny":
      return true;
    default: {
      const exhaustive: never = field;
      return exhaustive;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 4 — `argument-hint`
//
// Why: le dice al desarrollador qué espera la skill cuando la invoca sin nada.
//      Convierte "nunca recuerdo qué pide esta" en un prompt en el punto de uso.
// You should see: al invocar `/brainstorm` sin argumentos, aparece el texto del
//      `argument-hint`.
// ─────────────────────────────────────────────────────────────────────────────

/** El frontmatter de la skill del ejercicio, ya completo. */
export const BRAINSTORM_FRONTMATTER: SkillFrontmatter = {
  context: "fork",
  "allowed-tools": ["Read", "Grep", "Glob"],
  "argument-hint": "Provide a feature description or codebase area to explore",
};

/**
 * Sustituye `$ARGUMENTS`, `$ARGUMENTS[N]` y `$N` en el cuerpo de la skill.
 *
 * `$N` es shorthand de `$ARGUMENTS[N]` con indexado 0-based: `$0` es el primer
 * argumento. Si el cuerpo no referencia `$ARGUMENTS` en absoluto, Claude Code
 * los añade igualmente como `ARGUMENTS: <value>`, así que nunca se pierden en
 * silencio.
 *
 * @param body - El cuerpo de la skill.
 * @param args - Los argumentos pasados en la invocación.
 * @returns El cuerpo con los placeholders resueltos.
 */
export function renderSkillBody(body: string, args: readonly string[]): string {
  const joined = args.join(" ");
  const hasArgumentsToken = /\$ARGUMENTS(\[\d+\])?/.test(body);
  const hasPositional = /\$\d+/.test(body);

  if (!hasArgumentsToken && !hasPositional) {
    return `${body}\n\nARGUMENTS: ${joined}`;
  }

  return body
    .replace(/\$ARGUMENTS\[(\d+)\]/g, (_match, index: string) => args[Number(index)] ?? "")
    .replace(/\$ARGUMENTS/g, joined)
    .replace(/\$(\d+)/g, (_match, index: string) => args[Number(index)] ?? "");
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 5 — Verificar la frontera de scoping
//
// Why: `.claude/` se comparte por git y `~/.claude/` es personal. Es la misma
//      regla para CLAUDE.md, comandos, skills y rules.
// You should see: `/review` funciona en cualquier clone; `/brainstorm` solo en
//      tu sesión.
// ─────────────────────────────────────────────────────────────────────────────

/** De dónde puede invocarse una skill. */
type InvocationMode = "both" | "user_only" | "model_only";

/**
 * Deriva el modo de invocación del frontmatter.
 *
 * `disable-model-invocation: true` restringe a invocación explícita del usuario y
 * deja la descripción FUERA del contexto. `user-invocable: false` es lo opuesto:
 * solo Claude puede invocarla, oculta del menú `/`.
 *
 * @param frontmatter - El frontmatter de la skill.
 * @returns Quién puede invocarla.
 */
export function invocationMode(frontmatter: SkillFrontmatter): InvocationMode {
  if (frontmatter["disable-model-invocation"] === true) return "user_only";
  if (frontmatter["user-invocable"] === false) return "model_only";
  return "both";
}

/** Fuentes de skills, de mayor a menor precedencia. */
export type SkillSource = "enterprise" | "personal" | "project" | "bundled";

/** Precedencia cuando dos skills chocan de nombre. */
export const SKILL_PRECEDENCE: readonly SkillSource[] = [
  "enterprise",
  "personal",
  "project",
  "bundled",
];

/**
 * Resuelve un choque de nombres entre una skill y un comando.
 *
 * Cuando ambos definen el mismo nombre, gana la skill. En skills anidadas el
 * choque se cualifica como `apps/web:deploy`.
 *
 * @param skillPresent - Si existe la skill del nombre.
 * @returns El ganador del choque.
 */
export function resolveNameClash(skillPresent: boolean): "skill" | "command" {
  return skillPresent ? "skill" : "command";
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 6 — El output verboso no debe llegar a la conversación principal
//
// Why: con `context: fork`, el subagente hace el trabajo ruidoso y solo un
//      resumen corto cruza de vuelta. Sin él, el daño aparece después, en
//      respuestas degradadas a preguntas sin relación.
// You should see: tras `/brainstorm src/api`, la conversación principal muestra
//      un resumen conciso, no listados de archivos ni excerpts.
// ─────────────────────────────────────────────────────────────────────────────

/** Qué recibe cada lado cuando la skill corre forkeada. */
interface ForkedOutput {
  readonly subagent: readonly string[];
  readonly mainConversation: readonly string[];
}

/**
 * Separa lo que se queda en el subagente de lo que cruza al hilo principal.
 *
 * @param verboseOutput - Todo lo que produjo la exploración.
 * @param summary - El resumen que debe cruzar.
 * @returns La partición entre subagente y conversación principal.
 */
export function partitionForkedOutput(
  verboseOutput: readonly string[],
  summary: string,
): ForkedOutput {
  return {
    subagent: verboseOutput,
    mainConversation: [summary],
  };
}

/**
 * ============================================================================
 * ✗ ANTI-PATTERN — Los errores que el examen construye
 * ============================================================================
 */

/** ✗ ANTI-PATTERN 1 — Un `.md` suelto en `.claude/skills/`.
 *
 * Una skill es un directorio con `SKILL.md` dentro. El archivo suelto nunca se
 * descubre y nada reporta el error.
 */
// .claude/skills/release-notes.md  // no aparece /release-notes, sin error

/** ✗ ANTI-PATTERN 2 — El comando del equipo en `~/.claude/`.
 *
 * Nada bajo `~/.claude/` se commitea: el colega que clona no recibe nada.
 */
// ~/.claude/commands/review.md  // invisible para el equipo

/** ✗ ANTI-PATTERN 3 — Tratar la skill como guía always-on.
 *
 * La descripción de una skill está siempre en contexto, pero el cuerpo no:
 * llega solo al invocarla. Convenciones que deben aplicar a cada edición van en
 * CLAUDE.md o `.claude/rules/`.
 */
// "the skill runs on every turn"  // solo el body al invocar

/** ✗ ANTI-PATTERN 4 — Skill verbosa sin `context: fork`.
 *
 * El output se acumula en la conversación principal y gasta contexto que los
 * turnos siguientes necesitan.
 */
// /brainstorm  // sin fork: los turnos posteriores degradan

/** ✗ ANTI-PATTERN 5 — Un workflow de tarea en CLAUDE.md.
 *
 * CLAUDE.md carga en cada sesión, así que un procedimiento puesto ahí se paga en
 * cada turno siendo relevante en casi ninguno. Las rutinas de review y los
 * workflows de análisis son skills.
 */
// .claude/CLAUDE.md → "1. map modules 2. find anti-patterns…"  // se paga siempre

/** ✗ ANTI-PATTERN 6 — Creer que `allowed-tools` es un sandbox.
 *
 * En la doc actual pre-aprueba para el turno de invocación; el resto de tools
 * siguen alcanzables. El límite real es `disallowed-tools` o `permissions.deny`.
 */
// "allowed-tools: Read means Write is impossible"  // no: Write sigue reachable

/**
 * ============================================================================
 * EXAM TRAPS — distractores recurrentes y criterio de rechazo
 * ============================================================================
 *
 * | Trampa                                             | Por qué se rechaza                                  |
 * |----------------------------------------------------|-----------------------------------------------------|
 * | `.claude/skills/review.md` para crear `/review`    | Una skill es un directorio con `SKILL.md` dentro    |
 * | Comando del equipo en `~/.claude/`                 | No se commitea; el colega no lo recibe              |
 * | Tratar la skill como guía always-on                | El body llega solo al invocar; no es CLAUDE.md      |
 * | No saber cuándo usar `context: fork`               | Sin fork, los turnos siguientes degradan            |
 * | Workflow de tarea puesto en CLAUDE.md              | Se paga en cada turno siendo relevante en pocos     |
 *
 * QUICK REFERENCE — datos de la fuente
 *
 *   Archivo de comando ...... `.claude/commands/<name>.md` — Markdown plano, el
 *                             nombre del archivo es el del comando
 *   Directorio de skill ..... `.claude/skills/<name>/SKILL.md` — directorio
 *                             obligatorio, ubicación canónica
 *   Choque skill/comando .... gana la skill
 *   $ARGUMENTS .............. todos los argumentos; si no se referencia, se añade
 *                             como `ARGUMENTS: <value>`
 *   $N / $ARGUMENTS[N] ...... argumento posicional, 0-based (`$0` = primero)
 *   !`cmd` .................. corre el shell pre-envío; su output reemplaza el
 *                             placeholder
 *   context: fork ........... contexto de subagente aislado; el contenido de la
 *                             skill pasa a ser el prompt del subagente
 *   agent (con fork) ........ `Explore` | `Plan` | `general-purpose` (default) |
 *                             custom en `.claude/agents/`
 *   allowed-tools (actual) .. pre-aprueba para el turno; NO es restricción
 *   allowed-tools (examen) .. "restringe el acceso a tools durante la skill"
 *   disallowed-tools ........ la frontera real — el nombre pelado lo saca del contexto
 *   disable-model-invocation: true ... solo el usuario; descripción oculta del contexto
 *   user-invocable: false ... solo Claude; oculta del menú `/`
 *   Precedencia de skills ... enterprise > personal (`~/.claude/skills/`) >
 *                             project (`.claude/skills/`) > bundled
 *   Choque anidado .......... se cualifica como `apps/web:deploy`
 *   Reglas de permiso ....... `Skill(name)` matchea una skill exacta;
 *                             `Skill(name *)` es prefijo y cubre cualquier argumento
 *   Prompts MCP ............. `/mcp__servername__promptname`, argumentos separados
 *                             por espacios
 *   Skills vs CLAUDE.md ..... skills cargan al invocar; CLAUDE.md carga cada sesión
 *
 * ============================================================================
 * FLUJO DE EJECUCIÓN ESPERADO  (trace ilustrativo — no se ejecuta)
 * ============================================================================
 *
 * [Paso 1] discoverCommand(".claude/commands/review.md")
 *   → { kind: "command", name: "review", scope: "project" }   ⇒ /review en git
 *
 * [Escenario trampa] discoverCommand(".claude/skills/release-notes.md")
 *   → { kind: "invalid",
 *       reason: "A skill is a directory with SKILL.md inside it…" }
 *   ✅ nunca se descubre y nada reporta el error
 *   Fix: discoverCommand(".claude/skills/release-notes/SKILL.md")
 *   → { kind: "skill", name: "release-notes", scope: "project" }
 *
 * [Paso 2] planIsolation(BRAINSTORM_FRONTMATTER)
 *   → { where: "isolated_subagent", agent: "general-purpose" }
 *   (sin context: fork → { where: "main_conversation" })
 *
 * [Paso 3] isTrueToolBoundary("allowed-tools")      → false
 *          isTrueToolBoundary("disallowed-tools")   → true
 *
 * [Paso 4] renderSkillBody("Investigate issue #$0 (priority: $1).", ["4521","high"])
 *   → "Investigate issue #4521 (priority: high)."
 *   renderSkillBody("Do the thing.", ["a","b"])
 *   → "Do the thing.\n\nARGUMENTS: a b"   ← nunca se pierden en silencio
 *
 * [Paso 5] invocationMode({}) → "both"
 *          invocationMode({ "disable-model-invocation": true }) → "user_only"
 *          invocationMode({ "user-invocable": false }) → "model_only"
 *          resolveNameClash(skillPresent = true) → "skill"
 *
 * [Paso 6] partitionForkedOutput([listing, excerpt, note], "5 files, 3 handlers")
 *   → { subagent: [listing, excerpt, note], mainConversation: ["5 files, 3 handlers"] }
 *   ✅ la conversación principal queda limpia; los turnos siguientes responden normal
 *
 * ANTI-PATRÓN: sin fork, la línea de tiempo se llena de listados y notas, y una
 * pregunta posterior sin relación llega apretada por todo ello. El problema no se
 * ve cuando la skill corre, sino después.
 */
