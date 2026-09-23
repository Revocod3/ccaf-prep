/**
 * ============================================================================
 * DOMINIO 3 · TASK STATEMENT 3.3 — Path-Specific Rules
 * ----------------------------------------------------------------------------
 * Objetivo oficial:
 *   Apply path-specific rules for conditional convention loading.
 *
 * Qué evalúa el examen aquí:
 *   Una regla path-specific hace que una convención dependa de QUÉ estás
 *   editando, no de dónde lanzaste Claude. Cierra un hueco que ni el CLAUDE.md de
 *   raíz ni el de directorio cubren bien: una regla que pertenece a un tipo de
 *   archivo repartido por todo el árbol. Los archivos viven en `.claude/rules/`
 *   y abren con frontmatter YAML con un campo `paths` de globs; solo aplican
 *   mientras trabajas en archivos que esos globs matchean. Es, además, un
 *   mecanismo de presupuesto de contexto: lo que no aplica no cuesta nada.
 *
 * Build Exercise: Configure Path-Specific Rules with Glob Patterns
 *                 (Intermediate · 30 min)
 * ============================================================================
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tipos de las reglas path-scoped
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Un archivo de regla en `.claude/rules/`.
 *
 * Con `paths`, es condicional. Sin `paths` (o sin frontmatter), NO es
 * condicional: carga al lanzar con la misma prioridad que `.claude/CLAUDE.md`.
 */
interface PathScopedRule {
  readonly file: string;
  readonly paths?: readonly string[];
  readonly body: readonly string[];
}

/** Los tres conjuntos de convenciones del ejercicio. */
export const RULES: readonly PathScopedRule[] = [
  {
    file: ".claude/rules/testing.md",
    paths: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts"],
    body: [
      "describe/it names read as sentences describing behaviour",
      "Every file covers at least one success path and one failure path",
      "Build test data through factory functions rather than inline literals",
      "Mock at the module boundary",
      "Assert on what the code does, never on how it does it",
    ],
  },
  {
    file: ".claude/rules/api-conventions.md",
    paths: ["src/api/**/*", "**/routes/**/*", "**/*.controller.ts"],
    body: [
      "Every response takes the shape { data, error, metadata }",
      "Validate with Zod at the handler boundary, before anything else runs",
      "Error responses carry the request ID",
      "State rate limits explicitly; inheriting a default is not a decision",
    ],
  },
  {
    file: ".claude/rules/terraform.md",
    paths: ["terraform/**/*", "**/*.tf", "infrastructure/**/*"],
    body: [
      "State lives in a remote backend; local state is never committed",
      "Environments are separated by workspace",
      "Modules are versioned and carry a CHANGELOG",
    ],
  },
];

/** Caracteres con significado en una regex que hay que escapar en un glob. */
const REGEX_SPECIALS = /[.+?^${}()|[\]\\]/;

/**
 * Convierte un glob a una regex anclada.
 *
 * Soporta las tres piezas que el examen menciona: `**` (cualquier profundidad,
 * incluida ninguna), `*` (dentro de un segmento) y brace expansion `{ts,tsx}`.
 * El resultado es lo que hace que un patrón sea un patrón de NOMBRE y no una
 * ubicación.
 *
 * @param pattern - El glob (p. ej. `**\/*.test.ts`).
 * @returns La regex equivalente, anclada al inicio y al fin.
 */
export function globToRegExp(pattern: string): RegExp {
  let source = "";

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === undefined) break;

    const next = pattern[index + 1];
    if (char === "*" && next === "*") {
      const followedBySlash = pattern[index + 2] === "/";
      source += followedBySlash ? "(?:.*/)?" : ".*";
      index += followedBySlash ? 2 : 1;
      continue;
    }
    if (char === "*") {
      source += "[^/]*";
      continue;
    }
    if (char === "{") {
      const close = pattern.indexOf("}", index);
      if (close > index) {
        const options = pattern.slice(index + 1, close).split(",");
        source += `(?:${options.join("|")})`;
        index = close;
        continue;
      }
    }
    source += REGEX_SPECIALS.test(char) ? `\\${char}` : char;
  }

  return new RegExp(`^${source}$`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 1 — `.claude/rules/testing.md` scoped al sufijo de test
//
// Why: los globs son la solución correcta para convenciones de un TIPO de archivo
//      repartido por muchos directorios. El escenario favorito del examen son
//      tests co-locados con su fuente a lo largo de 50+ directorios.
// You should see: `.claude/rules/testing.md` con un array `paths` de globs y al
//      menos tres convenciones (naming, assertions, mocking).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ¿Este archivo de regla carga cuando se abre `openFile`?
 *
 * Sin `paths`, la regla no es condicional: carga al lanzar, igual que el
 * CLAUDE.md de proyecto. Con `paths`, carga solo si algún glob matchea.
 *
 * @param rule - La regla.
 * @param openFile - La ruta del archivo que se está editando.
 * @returns `true` si la regla entra en contexto.
 */
export function ruleLoadsFor(rule: PathScopedRule, openFile: string): boolean {
  if (rule.paths === undefined || rule.paths.length === 0) return true;
  return rule.paths.some((pattern) => globToRegExp(pattern).test(openFile));
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 2 — `.claude/rules/api-conventions.md`
//
// Why: separar las convenciones de API en su propia regla path-scoped hace que
//      solo carguen al editar archivos de API. Evita gastar tokens con contexto
//      irrelevante al trabajar en frontend o infraestructura.
// You should see: `.claude/rules/api-conventions.md` con `paths` apuntando a los
//      directorios de API y al menos tres convenciones.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Qué reglas cargan para un archivo abierto.
 *
 * @param rules - Todas las reglas del proyecto.
 * @param openFile - El archivo que se está editando.
 * @returns Las rutas de las reglas que aplican.
 */
export function loadedRules(
  rules: readonly PathScopedRule[],
  openFile: string,
): readonly string[] {
  return rules.filter((rule) => ruleLoadsFor(rule, openFile)).map((rule) => rule.file);
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 3 — `.claude/rules/terraform.md`
//
// Why: las convenciones de infraestructura son irrelevantes al editar código de
//      aplicación. Path-scoped garantiza que las reglas de Terraform nunca
//      consuman tokens durante una sesión de React o de API.
// You should see: `.claude/rules/terraform.md` con `paths` que matchean archivos
//      de Terraform y convenciones de infraestructura.
// ─────────────────────────────────────────────────────────────────────────────

/** Un patrón con brace expansion, como en la doc. */
export const BRACE_EXPANSION_EXAMPLE = "src/**/*.{ts,tsx}";

// ─────────────────────────────────────────────────────────────────────────────
// Paso 4 y 5 — `/memory` confirma que solo carga la regla que matchea
//
// Why: probar el mecanismo. El examen testea que las reglas path-specific cargan
//      solo para archivos que matchean, y `/memory` es la herramienta de
//      diagnóstico para verificarlo.
// You should see: al editar un `.test.ts`, `/memory` lista testing.md pero NO
//      api-conventions.md ni terraform.md; al editar `src/api/auth.ts`, al revés.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Una comprobación de carga para un archivo concreto.
 *
 * @param openFile - El archivo a comprobar.
 * @param loaded - Las reglas que cargaron.
 * @param expected - Las que deberían haber cargado.
 * @returns Si la carga condicional se comportó como se esperaba.
 */
export function verifyConditionalLoad(
  openFile: string,
  loaded: readonly string[],
  expected: readonly string[],
): { readonly ok: boolean; readonly detail: string } {
  const ok =
    loaded.length === expected.length && expected.every((file) => loaded.includes(file));
  return {
    ok,
    detail: ok
      ? `${openFile} → only ${expected.join(", ")}`
      : `${openFile} → got [${loaded.join(", ")}], expected [${expected.join(", ")}]`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 6 — Huella de tokens: raíz vs path-specific
//
// Why: la eficiencia de tokens es un concepto clave del examen. El CLAUDE.md de
//      raíz carga todas las convenciones en cada sesión, sea cual sea la
//      relevancia; las reglas path-specific cargan solo las que matchean.
// You should see: con todo en la raíz, `/memory` muestra el set completo incluso
//      editando una utilidad; con reglas, solo el subset relevante.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cuenta las convenciones efectivamente cargadas para un archivo.
 *
 * Comparar este número entre "todo en el CLAUDE.md de raíz" y "reglas
 * path-scoped" es la medición que el ejercicio pide.
 *
 * @param rules - Las reglas (o una sola regla always-on que las represente).
 * @param openFile - El archivo que se está editando.
 * @returns Cuántas convenciones entran en contexto.
 */
export function loadedConventionCount(
  rules: readonly PathScopedRule[],
  openFile: string,
): number {
  return rules
    .filter((rule) => ruleLoadsFor(rule, openFile))
    .reduce((total, rule) => total + rule.body.length, 0);
}

/** Qué mecanismo corresponde a cada escenario. */
type ConventionApproach =
  | "root_claude_md"
  | "directory_claude_md"
  | "path_specific_rules"
  | "skill";

/**
 * Elige el mecanismo para un escenario de convenciones.
 *
 * La tabla de decisión del examen: estándares que cada línea debe seguir →
 * CLAUDE.md de raíz; convenciones de un paquete → CLAUDE.md de directorio;
 * convenciones de un tipo de archivo en cualquier parte → reglas path-specific;
 * un procedimiento que alguien corre a propósito → skills.
 *
 * @param scope - A qué aplica la convención.
 * @returns El mecanismo correcto.
 */
export function chooseApproach(
  scope:
    | "every_line_of_code"
    | "one_package_directory"
    | "file_type_anywhere"
    | "procedure_run_deliberately",
): ConventionApproach {
  switch (scope) {
    case "every_line_of_code":
      return "root_claude_md";
    case "one_package_directory":
      return "directory_claude_md";
    case "file_type_anywhere":
      return "path_specific_rules";
    case "procedure_run_deliberately":
      return "skill";
    default: {
      const exhaustive: never = scope;
      return exhaustive;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Extra — Reglas de usuario y reglas sin `paths`
//
// Why: las reglas personales de `~/.claude/rules/` aplican a todos tus proyectos
//      y cargan ANTES que las de proyecto, así que ante un conflicto real gana la
//      de proyecto (llega después en contexto).
// You should see: la distinción entre regla condicional y regla always-on.
// ─────────────────────────────────────────────────────────────────────────────

/** Scope de una regla. */
type RuleSource = "user" | "project";

/** Orden de carga: user primero, project después (el proyecto gana en conflicto). */
export const RULE_LOAD_ORDER: readonly RuleSource[] = ["user", "project"];

/**
 * ¿La regla es condicional?
 *
 * Sin frontmatter `paths` no lo es: carga al lanzar con la misma prioridad que
 * el CLAUDE.md de proyecto.
 *
 * @param rule - La regla.
 * @returns `true` si solo carga contra archivos que matchean.
 */
export function isConditional(rule: PathScopedRule): boolean {
  return rule.paths !== undefined && rule.paths.length > 0;
}

/**
 * ============================================================================
 * ✗ ANTI-PATTERN — Los errores que el examen construye
 * ============================================================================
 */

/** ✗ ANTI-PATTERN 1 — CLAUDE.md de directorio para convenciones cross-directorio.
 *
 * Un archivo de directorio alcanza UN directorio. Cubrir tests en 50 y pico
 * directorios serían 50 copias que escribir, extender y mantener en paso — y la
 * primera edición olvidada arranca la deriva.
 */
// CLAUDE.md en cada uno de los 50 directorios con tests  // 50 copias a sincronizar

/** ✗ ANTI-PATTERN 2 — Convenciones de un tipo de archivo en el CLAUDE.md de raíz.
 *
 * El de raíz carga siempre: Terraform está en contexto mientras editas React y
 * los tests mientras escribes handlers. Ninguno hace nada salvo gastar el
 * presupuesto que el trabajo actual necesita.
 */
// .claude/CLAUDE.md → "resource names in snake_case"  // presente editando React

/** ✗ ANTI-PATTERN 3 — Confundir skills con reglas path-specific.
 *
 * Ambas pueden dispararse por un frontmatter `paths`, y por eso parecen
 * intercambiables. Las reglas cargan como guía de fondo siempre que se lee un
 * archivo que matchea; una skill sigue siendo una unidad que se INVOCA.
 */
// .claude/skills/test-conventions/SKILL.md  // hay que invocarla; no es automática

/** ✗ ANTI-PATTERN 4 — Anclar los `paths` a directorios que hoy tienen tests.
 *
 * Listar los directorios actuales obliga a extender la lista cada vez que
 * aparece uno nuevo. El patrón es de NOMBRE, no de ubicación.
 */
// paths: ["src/components/**", "src/api/**", "src/utils/**"]  // se queda viejo

/** ✗ ANTI-PATTERN 5 — Quitar `paths` "para no fallar ningún test".
 *
 * Sin `paths` la regla deja de ser condicional y carga al lanzar, gastando
 * presupuesto en cada sesión — exactamente el problema que se quería resolver.
 */
// .claude/rules/testing.md sin frontmatter  // always-on, no condicional

/**
 * ============================================================================
 * EXAM TRAPS — distractores recurrentes y criterio de rechazo
 * ============================================================================
 *
 * | Trampa                                             | Por qué se rechaza                                  |
 * |----------------------------------------------------|-----------------------------------------------------|
 * | CLAUDE.md de directorio para lo cross-directorio   | 50 copias y la primera edición olvidada deriva       |
 * | Convenciones de tipo de archivo en la raíz         | Carga siempre; gasta presupuesto irrelevante         |
 * | Confundir skills con reglas path-specific          | La regla es automática; la skill se invoca           |
 * | Anclar `paths` a directorios concretos             | El glob es un patrón de nombre, no de ubicación      |
 *
 * QUICK REFERENCE — datos de la fuente
 *
 *   Ubicación .............. `.claude/rules/*.md`, descubiertos recursivamente
 *                            (subdirectorios incluidos)
 *   Frontmatter `paths` .... array YAML de globs; la regla carga solo para
 *                            archivos que matchean
 *   Sintaxis de glob ....... globs estándar (`**\/*.ts`) más brace expansion
 *                            (`src/**\/*.{ts,tsx}`)
 *   Regla sin `paths` ...... carga al lanzar — misma prioridad que `.claude/CLAUDE.md`
 *   Reglas de usuario ...... `~/.claude/rules/` — todos los proyectos de la máquina
 *   Prioridad user/project . las de usuario cargan primero; las de proyecto
 *                            después, así que el proyecto gana en conflicto
 *   Directorio vs path rule  CLAUDE.md de directorio = un directorio; path rules =
 *                            un tipo de archivo, en cualquier directorio
 *   Raíz vs path rule ...... la raíz carga siempre; path rules solo para matches
 *                            (ahorro de tokens)
 *
 * ============================================================================
 * FLUJO DE EJECUCIÓN ESPERADO  (trace ilustrativo — no se ejecuta)
 * ============================================================================
 *
 * globToRegExp("**\/*.test.ts")   → /^(?:.*\/)?[^\/]*\.test\.ts$/
 * globToRegExp("src/**\/*")        → /^src\/(?:.*\/)?[^\/]*$/
 * globToRegExp("src/**\/*.{ts,tsx}") → /^src\/(?:.*\/)?[^\/]*\.(?:ts|tsx)$/
 *
 * loadedRules(RULES, "src/utils/format.test.ts")
 *   → [".claude/rules/testing.md"]                    ← solo la que matchea
 * verifyConditionalLoad(..., loaded, [testing.md])
 *   → { ok: true, detail: "src/utils/format.test.ts → only .claude/rules/testing.md" }
 *
 * loadedRules(RULES, "src/api/auth.ts")
 *   → [".claude/rules/api-conventions.md"]
 *   ✅ testing y terraform se caen del contexto
 *
 * loadedRules(RULES, "terraform/vpc/main.tf")
 *   → [".claude/rules/terraform.md"]
 *
 * loadedRules(RULES, "README.md")
 *   → []                                               ← ninguna convención irrelevante
 *
 * Huella de tokens editando "src/utils/format.test.ts":
 *   Todo en root CLAUDE.md → 5 + 4 + 3 = 12 convenciones cargadas
 *   loadedConventionCount(RULES, "src/utils/format.test.ts") → 5
 *   ✅ mismo trabajo, 7 convenciones menos gastando presupuesto
 *
 * chooseApproach("file_type_anywhere")      → "path_specific_rules"
 * chooseApproach("procedure_run_deliberately") → "skill"
 *
 * ANTI-PATRÓN: con `paths: ["src/components/**\/*.test.tsx"]`, los tests de
 * src/api, src/utils y src/pages no reciben las convenciones y los reviewers
 * siguen marcando inconsistencias. El fix no es copiar el archivo en cada árbol
 * ni mover todo a la raíz: es anclar los `paths` al SUFIJO del archivo
 * (`**\/*.test.tsx`, `**\/*.test.ts`), para que la ubicación no entre en el match.
 */
