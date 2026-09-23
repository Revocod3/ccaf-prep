/**
 * ============================================================================
 * DOMINIO 3 · TASK STATEMENT 3.1 — CLAUDE.md Hierarchy, Scoping & Modular Org
 * ----------------------------------------------------------------------------
 * Objetivo oficial:
 *   Configure CLAUDE.md files with appropriate hierarchy, scoping, and modular
 *   organization.
 *
 * Qué evalúa el examen aquí:
 *   Una cantidad sorprendente de items se reduce a notar que una regla se
 *   escribió en el nivel equivocado. `~/.claude/CLAUDE.md` es tuyo y nunca viaja
 *   por git; `.claude/CLAUDE.md` (o el `CLAUDE.md` de la raíz) se commitea y
 *   llega con cada clone; el `CLAUDE.md` de un subdirectorio se acota a esa parte
 *   del árbol. Y algo que se malinterpreta: los CLAUDE.md se **concatenan**, no
 *   se sobrescriben — si dos reglas se contradicen, "Claude may pick one
 *   arbitrarily". Lo que debe cumplirse en cada corrida va en `settings.json` o
 *   en un hook, no en un CLAUDE.md.
 *
 * Build Exercise: Build a Multi-Level CLAUDE.md Configuration  (Beginner · 30 min)
 * ============================================================================
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tipos de la jerarquía de memoria
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Los cuatro scopes de CLAUDE.md.
 *
 * `managed` es el cuarto, además de user/project/directory: política de
 * organización desplegada desde una ruta del sistema, aplica a toda sesión y
 * "cannot be excluded" por ningún ajuste individual.
 */
type ConfigScope = "managed" | "user" | "project" | "directory";

/** Un CLAUDE.md o un CLAUDE.local.md; el `.local` carga después en su nivel. */
type ConfigLayer = "CLAUDE.md" | "CLAUDE.local.md";

/**
 * Un archivo de memoria descubierto.
 *
 * Discriminado por scope: solo el nivel de directorio lleva `directory`, que es
 * lo que acota cuándo carga.
 */
type MemoryFile =
  | {
      readonly scope: "managed" | "user" | "project";
      readonly layer: ConfigLayer;
      readonly path: string;
      readonly sharedViaGit: boolean;
    }
  | {
      readonly scope: "directory";
      readonly layer: ConfigLayer;
      readonly path: string;
      readonly sharedViaGit: boolean;
      readonly directory: string;
    };

/** Rangos de carga: de más amplio (managed) a más específico (directory). */
const SCOPE_RANK: Readonly<Record<ConfigScope, number>> = {
  managed: 0,
  user: 1,
  project: 2,
  directory: 3,
};

/** Dentro de un mismo nivel, `CLAUDE.local.md` llega después del `CLAUDE.md`. */
const LAYER_RANK: Readonly<Record<ConfigLayer, number>> = {
  "CLAUDE.md": 0,
  "CLAUDE.local.md": 1,
};

// ─────────────────────────────────────────────────────────────────────────────
// Paso 1 — CLAUDE.md a nivel de proyecto: los estándares del equipo
//
// Why: la config de proyecto es la base de los estándares compartidos. El examen
//      testea que pongas las convenciones compartidas aquí y no en la config de
//      usuario, que es el escenario de mala configuración más común.
// You should see: `.claude/CLAUDE.md` en la raíz con al menos tres secciones:
//      naming conventions, error handling y code review checklist.
// ─────────────────────────────────────────────────────────────────────────────

/** El archivo de proyecto del ejercicio. */
export const PROJECT_MEMORY_FILE: MemoryFile = {
  scope: "project",
  layer: "CLAUDE.md",
  path: ".claude/CLAUDE.md",
  sharedViaGit: true,
};

/** El CLAUDE.md personal: existe, pero git nunca lo ve. */
export const USER_MEMORY_FILE: MemoryFile = {
  scope: "user",
  layer: "CLAUDE.md",
  path: "~/.claude/CLAUDE.md",
  sharedViaGit: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// Paso 2 — CLAUDE.md a nivel de directorio: solo para ese paquete
//
// Why: la config de directorio acota las convenciones a un paquete. El examen
//      testea que un CLAUDE.md de subdirectorio aplica solo dentro de ese
//      directorio, no a todo el proyecto.
// You should see: `packages/api/CLAUDE.md` con convenciones REST; al correr
//      `/memory` desde ahí aparecen cargados el de proyecto y el de directorio.
// ─────────────────────────────────────────────────────────────────────────────

/** El archivo de directorio del ejercicio. */
export const API_DIRECTORY_MEMORY_FILE: MemoryFile = {
  scope: "directory",
  layer: "CLAUDE.md",
  path: "packages/api/CLAUDE.md",
  sharedViaGit: true,
  directory: "packages/api/",
};

/**
 * ¿Este archivo carga cuando se trabaja en `cwd`?
 *
 * Los niveles managed, user y project cargan siempre; el de directorio solo si
 * `cwd` está dentro de su subárbol. El switch es exhaustivo: el `never` obliga a
 * cubrir cualquier scope nuevo.
 *
 * @param file - El archivo de memoria.
 * @param cwd - El directorio de trabajo.
 * @returns `true` si el archivo entra en contexto.
 */
export function loadsFor(file: MemoryFile, cwd: string): boolean {
  switch (file.scope) {
    case "managed":
    case "user":
    case "project":
      return true;
    case "directory":
      return cwd.startsWith(file.directory);
    default: {
      const exhaustive: never = file;
      return exhaustive;
    }
  }
}

/**
 * Orden de carga: de más amplio a más específico.
 *
 * "Content is ordered from the filesystem root down to your working directory",
 * así que las instrucciones más cercanas a donde lanzaste Claude se leen al
 * final. Llegar después NO es ganar: los archivos se concatenan y una
 * contradicción puede resolverse en cualquier dirección.
 *
 * @param files - Los archivos descubiertos.
 * @returns La secuencia en que entran en contexto.
 */
export function loadOrder(files: readonly MemoryFile[]): readonly MemoryFile[] {
  return [...files].sort((a, b) => {
    const byScope = SCOPE_RANK[a.scope] - SCOPE_RANK[b.scope];
    return byScope !== 0 ? byScope : LAYER_RANK[a.layer] - LAYER_RANK[b.layer];
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 3 — `.claude/rules/` para archivos por tema
//
// Why: en vez de un CLAUDE.md monolítico, `.claude/rules/` guarda un archivo por
//      tema. Sin frontmatter carga en toda sesión; con frontmatter se acota a
//      rutas concretas (Task Statement 3.3).
// You should see: `.claude/rules/testing.md` con al menos tres convenciones de
//      test, visible como cargado en `/memory`.
// ─────────────────────────────────────────────────────────────────────────────

/** Cuándo entra en contexto cada mecanismo de organización. */
type LoadTrigger = "every_session" | "on_path_match" | "eager_inline";

/**
 * Qué dispara la carga de cada mecanismo.
 *
 * - Un `@import` se resuelve EAGER: el archivo se inlinea al instante, igual que
 *   si lo hubieras pegado. Partir 600 líneas en seis archivos mejora la edición
 *   y deja el contexto EXACTAMENTE igual de grande.
 * - Un archivo de `.claude/rules/` sin frontmatter carga en toda sesión.
 * - Con frontmatter path-scoped, carga solo cuando los paths matchean: es el
 *   mecanismo que de verdad reduce lo que se carga.
 *
 * @param kind - El mecanismo.
 * @returns Cuándo se carga.
 */
export function loadTrigger(
  kind: "at_import" | "rules_without_frontmatter" | "rules_with_frontmatter",
): LoadTrigger {
  switch (kind) {
    case "at_import":
      return "eager_inline";
    case "rules_without_frontmatter":
      return "every_session";
    case "rules_with_frontmatter":
      return "on_path_match";
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 4 — La sintaxis `@` para modularizar
//
// Why: no hay keyword `@import`: una línea con `@` seguido de una ruta es la
//      directiva. Los imports recursan hasta 4 hops y el parser SALTA code spans
//      y bloques de código, así que envolver una ruta en backticks evita que se
//      importe.
// You should see: `.claude/CLAUDE.md` con una línea que empieza por `@` apuntando
//      a `./standards/naming.md`, y su contenido inlineado en `/memory`.
// ─────────────────────────────────────────────────────────────────────────────

/** Profundidad máxima de recursión de los imports. */
export const MAX_IMPORT_DEPTH = 4;

/**
 * Extrae las directivas `@ruta` de un CLAUDE.md.
 *
 * El parser ignora los bloques de código cercados y las líneas que son un code
 * span, así que mencionar una ruta entre backticks no dispara un import.
 *
 * @param lines - Las líneas del archivo.
 * @returns Las rutas importadas, en orden.
 */
export function parseImports(lines: readonly string[]): readonly string[] {
  const imports: string[] = [];
  let inFence = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence || trimmed.startsWith("`")) continue;

    const match = /^@(\S+)$/.exec(trimmed);
    const target = match?.[1];
    if (target !== undefined) imports.push(target);
  }
  return imports;
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 5 — `/memory` para verificar qué está cargado
//
// Why: `/memory` reporta qué archivos tiene realmente la sesión. Sirve cuando el
//      comportamiento deriva entre sesiones o entre desarrolladores: responde si
//      los archivos que asumes cargados lo están de verdad.
// You should see: en la raíz, el CLAUDE.md de proyecto y los rules; en
//      `packages/api/`, además el CLAUDE.md de directorio.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Los archivos cargados en una sesión, en orden de carga.
 *
 * `/memory` es una vista de solo lectura: los archivos cargan solos según su
 * nivel y ubicación, así que correr el comando no cambia nada.
 *
 * @param files - Todos los archivos descubiertos.
 * @param cwd - El directorio de trabajo.
 * @returns Los que aplican, ya ordenados.
 */
export function memoryReport(
  files: readonly MemoryFile[],
  cwd: string,
): readonly MemoryFile[] {
  return loadOrder(files.filter((file) => loadsFor(file, cwd)));
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 6 — El escenario trampa: el nuevo miembro no recibe las instrucciones
//
// Why: es la trampa favorita del examen para 3.1. Alguien con años en el equipo
//      obtiene el comportamiento esperado; un recién llegado clona el MISMO repo,
//      el MISMO branch, y su output ignora cada convención. La causa es la misma
//      siempre: las convenciones viven en el `~/.claude/CLAUDE.md` del veterano.
// You should see: el diagnóstico apunta a dónde vive la config, no al código, y
//      el fix mueve las instrucciones de user-level a project-level.
// ─────────────────────────────────────────────────────────────────────────────

/** Diagnóstico del escenario de scoping. */
interface ScopingDiagnosis {
  readonly cause: string;
  readonly fix: string;
}

/**
 * Diagnostica por qué un nuevo miembro no recibe las instrucciones.
 *
 * El detalle que confirma el diagnóstico es que repo y branch coinciden:
 * elimina el código y apunta a configuración que vive a nivel de usuario. Nada
 * bajo `~/.claude/` se commitea, así que no podría alcanzarlos por más que
 * clonen con cuidado.
 *
 * @param input - Lo observado.
 * @returns El diagnóstico, o `null` si el setup no muestra el patrón.
 */
export function diagnoseMissingInstructions(input: {
  readonly repoAndBranchIdentical: boolean;
  readonly conventionLocation: ConfigScope;
}): ScopingDiagnosis | null {
  if (!input.repoAndBranchIdentical || input.conventionLocation !== "user") {
    return null;
  }
  return {
    cause:
      "The conventions live in a personal ~/.claude/CLAUDE.md. Nothing under ~/.claude/ is committed, so it never reaches a teammate on any branch.",
    fix: "Move the instructions into .claude/CLAUDE.md (project level) so git carries them with the code.",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Extra — Qué SÍ tiene precedencia: `settings.json` y los hooks
//
// Why: `settings.json` resuelve por una cadena de precedencia real; CLAUDE.md no.
//      Una regla que debe cumplirse en cada corrida va donde el cliente la
//      aplique pase lo que pase.
// You should see: la cadena managed > CLI args > local > project > user.
// ─────────────────────────────────────────────────────────────────────────────

/** Los cinco niveles de precedencia de `settings.json`, de mayor a menor. */
type SettingScope = "managed" | "cli" | "local" | "project" | "user";

/** Orden estricto: el de mayor precedencia gana siempre. */
export const SETTINGS_PRECEDENCE: readonly SettingScope[] = [
  "managed",
  "cli",
  "local",
  "project",
  "user",
];

/**
 * Resuelve un setting aplicando la precedencia estricta.
 *
 * A diferencia de CLAUDE.md, aquí sí hay un ganador: managed (política de
 * empresa, no se puede sobrescribir) > argumentos de CLI > local > project >
 * user.
 *
 * @param values - Los valores definidos por scope.
 * @returns El scope ganador y su valor, o `null` si no está definido.
 */
export function resolveSetting(
  values: Readonly<Partial<Record<SettingScope, string>>>,
): { readonly scope: SettingScope; readonly value: string } | null {
  for (const scope of SETTINGS_PRECEDENCE) {
    const value = values[scope];
    if (value !== undefined) return { scope, value };
  }
  return null;
}

/** Dónde vive la enforcement, según lo que la regla exija. */
export type EnforcementLayer = "claude_md" | "settings_json" | "hook";

/**
 * Elige la capa correcta para un requisito.
 *
 * CLAUDE.md llega al modelo como un user message, no como parte del system
 * prompt, y "there's no guarantee of strict compliance". Es guía que suele
 * seguirse. Lo que debe sostenerse en cada corrida —una tool bloqueada, un
 * formatter que corre, un permiso que no se concede— va en `settings.json`
 * (el cliente lo aplica decida lo que decida el modelo) o en un hook.
 *
 * @param requirement - Si es una preferencia o una garantía.
 * @returns La capa donde debe vivir.
 */
export function enforcementFor(
  requirement: "guidance" | "must_hold_every_run",
): EnforcementLayer {
  return requirement === "guidance" ? "claude_md" : "settings_json";
}

/**
 * ============================================================================
 * ✗ ANTI-PATTERN — Los errores de scoping que el examen construye
 * ============================================================================
 */

/** ✗ ANTI-PATTERN 1 — Convenciones del equipo en `~/.claude/CLAUDE.md`.
 *
 * Nada bajo el home se commitea: el nuevo miembro no recibe nada y no podría,
 * en ningún branch.
 */
// ~/.claude/CLAUDE.md → "use camelCase; never swallow exceptions"  // no viaja

/** ✗ ANTI-PATTERN 2 — Creer que el CLAUDE.md más específico "gana".
 *
 * Los archivos se concatenan, no se sobrescriben; ante una contradicción, "Claude
 * may pick one arbitrarily". Distractores como "the more specific scope wins" son
 * invenciones: los docs no afirman eso.
 */
// "packages/api/CLAUDE.md overrides the root CLAUDE.md"  // no hay override

/** ✗ ANTI-PATTERN 3 — Creer que partir en `@imports` reduce el contexto.
 *
 * Los imports se resuelven eager: el archivo se inlinea al instante. Partir 600
 * líneas en seis archivos de 100 mejora la edición y deja el contexto igual.
 */
// "@imports shrink what loads"  // mismo total; distinto mecanismo: .claude/rules/

/** ✗ ANTI-PATTERN 4 — Tratar `/memory` como un switch.
 *
 * Los archivos cargan solos según nivel y ubicación. `/memory` reporta lo que ese
 * proceso produjo; correrlo no activa nada.
 */
// await runMemory();  // no carga nada: es solo lectura

/** ✗ ANTI-PATTERN 5 — CLAUDE.md de directorio para convenciones cross-directorio.
 *
 * Un archivo de directorio alcanza el trabajo de ESE directorio y se detiene ahí.
 * Convenciones que van con un tipo de archivo —tests repartidos por todo el
 * árbol— se cubren con reglas path-scoped en `.claude/rules/`.
 */
// packages/api/CLAUDE.md → "all test files use factories"  // no alcanza el frontend

/** ✗ ANTI-PATTERN 6 — Poner una regla dura en CLAUDE.md.
 *
 * Un requisito que debe cumplirse siempre no se vuelve vinculante por escribirlo
 * en el CLAUDE.md correcto: va en settings.json o en un hook.
 */
// .claude/CLAUDE.md → "NEVER run migrations"  // guía, no enforcement

/**
 * ============================================================================
 * EXAM TRAPS — distractores recurrentes y criterio de rechazo
 * ============================================================================
 *
 * | Trampa                                             | Por qué se rechaza                                  |
 * |----------------------------------------------------|-----------------------------------------------------|
 * | Nuevo miembro sin instrucciones (mismo repo/branch) | Viven en `~/.claude/`; no se commitean              |
 * | Creer que `/memory` dispara la carga               | Carga sola por nivel y ubicación; es diagnóstico    |
 * | CLAUDE.md de directorio para lo cross-directorio   | Alcanza solo ese directorio; usar rules path-scoped |
 * | Buscar "qué CLAUDE.md gana"                        | Se concatenan; un conflicto puede ir a cualquiera   |
 *
 * QUICK REFERENCE — datos de la fuente
 *
 *   User-level .............. `~/.claude/CLAUDE.md` — personal, no git-shared
 *   Project-level ........... `.claude/CLAUDE.md` o `CLAUDE.md` de la raíz —
 *                             compartido por git
 *   Directory-level ......... `CLAUDE.md` de subdirectorio — carga on demand
 *                             cuando Claude lee archivos ahí
 *   Managed policy .......... ruta OS del sistema; no se puede excluir, aplica a
 *                             toda sesión
 *   Orden de carga .......... más amplio → más específico; `CLAUDE.local.md`
 *                             carga después del `CLAUDE.md` del mismo nivel
 *   Conflictos .............. concatenados, no sobrescritos — "Claude may pick
 *                             one arbitrarily"
 *   Precedencia settings.json managed > CLI args > local > project > user (estricto)
 *   Ubicaciones settings.json user `~/.claude/settings.json`; project
 *                             `.claude/settings.json` (shared) /
 *                             `.claude/settings.local.json` (personal);
 *                             enterprise en ruta OS
 *   Rutas managed ........... macOS `/Library/Application Support/ClaudeCode/`;
 *                             Linux/WSL `/etc/claude-code/`; Windows
 *                             `C:\Program Files\ClaudeCode\`
 *   Sintaxis @ import ....... `@ruta` en su propia línea — sin keyword `@import`
 *   Profundidad de import ... 4 hops máx, recursivo (docs viejos decían 5)
 *   Scope del import ........ code spans / bloques cercados nunca se parsean
 *   /init ................... genera o mejora un CLAUDE.md desde el codebase
 *   /memory ................. solo diagnóstico — muestra cargados, nunca dispara
 *   Tamaño recomendado ...... menos de 200 líneas por archivo
 *   .claude/rules/ sin paths  carga al lanzar, misma prioridad que `.claude/CLAUDE.md`
 *   CLAUDE.local.md ......... scoped a un working tree; no sigue a un git worktree
 *                             (para eso, importar desde el home)
 *
 * ============================================================================
 * FLUJO DE EJECUCIÓN ESPERADO  (trace ilustrativo — no se ejecuta)
 * ============================================================================
 *
 * [Paso 1] PROJECT_MEMORY_FILE  → .claude/CLAUDE.md  (committed)
 * [Paso 2] API_DIRECTORY_MEMORY_FILE → packages/api/CLAUDE.md
 * [Paso 3] .claude/rules/testing.md → sin frontmatter ⇒ loadTrigger(...)
 *          → "every_session"
 * [Paso 4] parseImports([...]) → ["@./standards/naming.md"] ⇒ "./standards/naming.md"
 *          MAX_IMPORT_DEPTH = 4   (recursivo; 5 en docs viejas)
 *          Una ruta entre backticks NO se importa.
 *
 * [Paso 5] memoryReport([...], cwd)
 *   cwd = "."             → [ user CLAUDE.md, project CLAUDE.md, rules/testing.md ]
 *   cwd = "packages/api/" → [ user CLAUDE.md, project CLAUDE.md,
 *                             packages/api/CLAUDE.md, rules/testing.md ]
 *   loadOrder(): managed(0) < user(1) < project(2) < directory(3)
 *                y dentro de un nivel, CLAUDE.md antes que CLAUDE.local.md
 *   ✅ llegar después no es ganar: todo se concatena
 *
 * [Paso 6] diagnoseMissingInstructions({ repoAndBranchIdentical: true,
 *                                        conventionLocation: "user" })
 *   → { cause: "The conventions live in a personal ~/.claude/CLAUDE.md…",
 *       fix:   "Move the instructions into .claude/CLAUDE.md…" }
 *
 * resolveSetting({ project: "A", user: "B" }) → { scope: "project", value: "A" }
 * resolveSetting({ user: "B" })               → { scope: "user", value: "B" }
 * enforcementFor("must_hold_every_run")       → "settings_json"
 *
 * ANTI-PATRÓN: dos CLAUDE.md que se contradicen (uno dice "use camelCase" en el
 * proyecto, otro "use snake_case" en el usuario) NO se resuelven por especificidad
 * — todo entra al contexto y Claude puede elegir cualquiera. Si la regla tiene
 * que sostenerse, va en settings.json o en un hook.
 */
