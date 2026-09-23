/**
 * ============================================================================
 * DOMINIO 2 · TASK STATEMENT 2.4 — MCP Server Integration
 * ----------------------------------------------------------------------------
 * Objetivo oficial:
 *   Integrate MCP servers into Claude Code and agent workflows.
 *
 * Qué evalúa el examen aquí:
 *   Dónde vive la configuración decide si un equipo comparte un toolset o cada
 *   desarrollador arma el suyo en silencio. El proyecto va en `.mcp.json` en la
 *   raíz, commiteado, y llega con cada clone; lo personal o experimental va en
 *   `~/.claude.json`, invisible para el resto. Las credenciales no van en
 *   ninguno de los dos: se referencian como `${VAR}` para que el archivo sea
 *   commiteable y cada uno ponga su valor. Y una tool MCP con descripción pobre
 *   pierde contra una built-in aunque haga mejor el trabajo, porque la selección
 *   corre sobre descripciones.
 *
 * Build Exercise: Configure MCP Servers with Scoping and Environment Variables
 *                 (Beginner · 30 min)
 * ============================================================================
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tipos de la configuración MCP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Una entrada de servidor MCP.
 *
 * Un comando lanzado ⇒ stdio. Una URL ⇒ HTTP o SSE. Tools escritas en tu propio
 * código ⇒ un MCP server del SDK. `streamable-http` es alias de `http`, así que
 * las configs copiadas de terceros funcionan sin tocar.
 */
interface McpServerEntry {
  readonly command?: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly type?: "stdio" | "http" | "sse" | "streamable-http";
  readonly url?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

/** La forma de `.mcp.json` y de `~/.claude.json`. */
interface McpConfigFile {
  readonly mcpServers: Readonly<Record<string, McpServerEntry>>;
}

/**
 * Los tres scopes actuales de Claude Code.
 *
 * La guía del examen describe dos niveles (project vs user); la doc actual
 * describe tres. El "user-level" de la guía cubre `local` y `user`: ambos son
 * personales, ambos viven en `~/.claude.json`, y solo difieren en si el servidor
 * se ve desde tus otros proyectos.
 */
type McpScope = "local" | "project" | "user";

/** Fuentes posibles, incluidos los que no son scopes de usuario. */
type McpScopeSource = McpScope | "plugin" | "claude_ai_connector";

/** Dónde vive cada scope y quién lo ve. */
interface ScopeInfo {
  readonly visibleTo: string;
  readonly sharedViaVcs: boolean;
  readonly storedIn: string;
}

/** Orden de precedencia cuando el mismo nombre está configurado en varios sitios. */
export const SCOPE_PRECEDENCE: readonly McpScopeSource[] = [
  "local",
  "project",
  "user",
  "plugin",
  "claude_ai_connector",
];

/** Metadatos de cada scope de usuario. */
export const MCP_SCOPES: Readonly<Record<McpScope, ScopeInfo>> = {
  local: {
    visibleTo: "Current project only, private to you",
    sharedViaVcs: false,
    storedIn: "~/.claude.json, nested under that project's path",
  },
  project: {
    visibleTo: "Current project, all teammates",
    sharedViaVcs: true,
    storedIn: ".mcp.json in the project root",
  },
  user: {
    visibleTo: "All of your projects",
    sharedViaVcs: false,
    storedIn: "~/.claude.json",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Paso 1 — `.mcp.json` en la raíz con un servidor de la comunidad
//
// Why: `.mcp.json` a nivel de proyecto está versionado y llega con cada clone.
//      El examen testea que los servidores del equipo van aquí y no en
//      `~/.claude.json`; y que para integraciones estándar se adopta un servidor
//      de la comunidad en vez de construirlo.
// You should see: un `.mcp.json` con un objeto `mcpServers` y al menos una
//      entrada con `command` y `args`.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * La config de proyecto del ejercicio.
 *
 * Se commitea: describe qué servidores necesita el equipo, no con qué
 * credenciales.
 */
export const PROJECT_MCP_CONFIG: McpConfigFile = {
  mcpServers: {
    github: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: {
        // Referencia, no valor: lo que se commitea es el NOMBRE de la variable.
        GITHUB_TOKEN: "${GITHUB_TOKEN}",
      },
    },
    jira: {
      command: "npx",
      args: ["-y", "@community/mcp-server-jira"],
      env: {
        JIRA_URL: "${JIRA_URL}",
        JIRA_TOKEN: "${JIRA_TOKEN}",
      },
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Paso 2 — Expansión de variables de entorno
//
// Why: commitear credenciales directamente es un riesgo que el examen penaliza.
//      `${VARIABLE_NAME}` deja que el archivo describa qué variables hacen falta
//      sin contener sus valores, así que nada sensible entra al repositorio.
// You should see: `env` con `${GITHUB_TOKEN}` (no un token real), y `git diff`
//      sin secretos en stage. Cada desarrollador pone el suyo en local.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Expande `${VAR}` y `${VAR:-default}` en un valor de configuración.
 *
 * La expansión funciona en cinco campos de una entrada: `command`, `args`,
 * `env`, `url` y `headers`. Con `:-` hay valor por defecto si la variable no
 * está definida.
 *
 * @param value - El valor con referencias, tal como está en el archivo.
 * @param env - El entorno disponible en tiempo de conexión.
 * @returns El valor con las referencias resueltas.
 */
export function expandEnv(
  value: string,
  env: Readonly<Record<string, string | undefined>>,
): string {
  return value.replace(
    /\$\{([A-Za-z0-9_]+)(?::?-([^}]*))?\}/g,
    (_match: string, name: string, fallback: string | undefined): string => {
      const found = env[name];
      if (found !== undefined) return found;
      return fallback ?? "";
    },
  );
}

/**
 * Detecta un secreto literal commiteado en la config.
 *
 * Lo que se commitea es el nombre de la variable; un valor con pinta de token es
 * el fallo que el examen penaliza.
 *
 * @param config - La config a revisar.
 * @returns Las rutas de los valores que parecen secretos literales.
 */
export function findLiteralSecrets(config: McpConfigFile): readonly string[] {
  const looksLikeSecret = (value: string): boolean =>
    !value.includes("${") && /^(ghp_|sk-|xoxb-|[A-Za-z0-9_-]{32,})$/.test(value);

  return Object.entries(config.mcpServers).flatMap(([serverName, entry]) =>
    Object.entries(entry.env ?? {})
      .filter(([, value]) => looksLikeSecret(value))
      .map(([key]) => `mcpServers.${serverName}.env.${key}`),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 3 — Un servidor personal o experimental en `~/.claude.json`
//
// Why: el user-level es personal, no versionado y no compartido. El examen testea
//      la jerarquía de scopes: `.mcp.json` para el equipo, `~/.claude.json` para
//      lo personal o experimental.
// You should see: un `~/.claude.json` con un `mcpServers` para un servidor
//      personal, que NO está en el repo ni en control de versiones.
// ─────────────────────────────────────────────────────────────────────────────

/** Config personal: un servidor experimental que aún no se propone al equipo. */
export const USER_MCP_CONFIG: McpConfigFile = {
  mcpServers: {
    "experimental-search": {
      command: "node",
      args: ["/path/to/my/experimental-search-server.js"],
      env: {
        API_KEY: "${EXPERIMENTAL_API_KEY}",
      },
    },
  },
};

/**
 * Resuelve qué definición gana cuando un nombre está en varios scopes.
 *
 * Claude Code NO fusiona definiciones: se conecta una vez usando la entrada del
 * origen de mayor precedencia. Un override local personal gana en silencio sobre
 * la entrada del `.mcp.json` del equipo — útil para probar un fork, y fuente de
 * confusión si no se documenta.
 *
 * @param name - Nombre del servidor.
 * @param configured - Las entradas presentes por origen.
 * @returns La entrada ganadora y su origen, o `null` si no está configurado.
 */
export function resolveServer(
  name: string,
  configured: Readonly<Partial<Record<McpScopeSource, McpServerEntry>>>,
): { readonly name: string; readonly source: McpScopeSource; readonly entry: McpServerEntry } | null {
  for (const source of SCOPE_PRECEDENCE) {
    const entry = configured[source];
    if (entry !== undefined) return { name, source, entry };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 4 — Exponer un catálogo de contenido como recurso MCP
//
// Why: los recursos dan visibilidad de qué datos existen sin llamadas
//      exploratorias. Sin un recurso de schema, el agente se orienta con
//      `list_tables` y un `describe_table` por tabla — una secuencia que no
//      produce trabajo, solo el conocimiento de sobre qué podría trabajar.
// You should see: un recurso con `name`, `description` y `mimeType` en un URI
//      como `db://schema/main`.
// ─────────────────────────────────────────────────────────────────────────────

/** Un recurso MCP: catálogo de contenido, no una acción. */
interface McpResource {
  readonly uri: string;
  readonly name: string;
  readonly description: string;
  readonly mimeType: string;
}

/** El recurso del ejercicio: el schema de la base de datos. */
export const DB_SCHEMA_RESOURCE: McpResource = {
  uri: "db://schema/main",
  name: "db-schema",
  description: "Database schema with all tables, columns and their types.",
  mimeType: "application/json",
};

/**
 * Cuántas llamadas exploratorias evita publicar el schema como recurso.
 *
 * Sin recurso: `list_tables` (1) más `describe_table` por tabla. Con recurso: 0.
 * El ahorro está en las llamadas que nunca se hacen.
 *
 * @param tableCount - Número de tablas de la base de datos.
 * @returns El número de llamadas de orientación evitadas.
 */
export function exploratoryCallsAvoided(tableCount: number): number {
  return 1 + tableCount;
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 5 — Descripciones que compitan con las built-in
//
// Why: una tool MCP con descripción pobre pierde contra una built-in aunque
//      hiciera mejor el trabajo: las built-in llegan descritas en detalle y la
//      selección corre sobre descripciones. El examen testea que la descripción
//      MCP explique qué hace, qué devuelve y cuándo preferirla.
// You should see: descripciones de 3-5 frases que expliquen capacidades, salidas
//      y la comparación explícita contra la built-in con la que compite.
// ─────────────────────────────────────────────────────────────────────────────

/** Una tool MCP con su descripción de selección. */
interface McpToolSpec {
  readonly name: string;
  readonly description: string;
}

/** La versión pobre: pierde contra Grep aunque sea más capaz. */
export const SPARSE_SEARCH_TOOL: McpToolSpec = {
  name: "search_codebase",
  description: "Search the code",
};

/** La versión mejorada: da al modelo motivos para preferirla. */
export const ENHANCED_SEARCH_TOOL: McpToolSpec = {
  name: "search_codebase",
  description:
    "Semantic search over the whole repository, indexed by AST rather than by line. " +
    "Matches functions, classes and methods, returning each with its file path, line " +
    "numbers and the code around it. Because it matches on intent rather than on exact " +
    "strings, it finds code that grep would miss when you know what something does but " +
    "not how it is spelled. Prefer this to Grep whenever the search is by behaviour " +
    "rather than by text.",
};

/** Decisión build-vs-use para una integración MCP. */
export type McpServerStrategy = "adopt_community" | "build_custom";

/**
 * Elige entre adoptar un servidor de la comunidad o construir uno propio.
 *
 * Integración estándar (Jira, GitHub, Slack, Linear, Notion) ⇒ adoptar: los casos
 * ordinarios están cubiertos, probados por más gente de la que tu equipo tiene, y
 * mantenidos por otros. Adoptar cuesta una tarde; poseerlo cuesta indefinidamente.
 * Construir solo cuando el workflow es particular del equipo, las reglas de
 * negocio deben vivir en la capa de tools, o el sistema es propietario.
 *
 * @param requirement - Qué exige la integración.
 * @returns La estrategia que el examen puntúa.
 */
export function chooseServerStrategy(requirement: {
  readonly standardIntegration: boolean;
  readonly teamSpecificWorkflow: boolean;
  readonly proprietarySystem: boolean;
}): McpServerStrategy {
  const noCommunityServerCould =
    requirement.teamSpecificWorkflow || requirement.proprietarySystem;
  return requirement.standardIntegration && !noCommunityServerCould
    ? "adopt_community"
    : "build_custom";
}

/**
 * ============================================================================
 * ✗ ANTI-PATTERN — Lo que rompe la integración MCP
 * ============================================================================
 */

/** ✗ ANTI-PATTERN 1 — Config del equipo en `~/.claude.json`.
 *
 * Nada en el home se commitea: un colega que clona el repo no recibe nada y su
 * agente se queda sin las tools que el tuyo sí tiene.
 */
// ~/.claude.json → { mcpServers: { github: ... } }  // invisible para el equipo

/** ✗ ANTI-PATTERN 2 — Credenciales literales en `.mcp.json`.
 *
 * Un secreto commiteado queda en el historial para siempre, y rotarlo después no
 * lo saca de ahí.
 */
// "GITHUB_TOKEN": "ghp_a8f9e2c1..."  // en el historial permanentemente

/** ✗ ANTI-PATTERN 3 — Construir un MCP server para Jira.
 *
 * Ya existe un servidor de la comunidad mantenido para los sistemas comunes.
 * Construir es correcto solo si el escenario nombra un requisito que ninguno
 * puede cubrir.
 */
// writeCustomServer("jira");  // "owning one costs indefinitely"

/** ✗ ANTI-PATTERN 4 — Dejar la descripción MCP pobre.
 *
 * El built-in llega descrito a fondo, así que en una comparación pobre el modelo
 * prefiere lo que entiende — aunque la tool MCP sea la más capaz.
 */
// { name: "search_codebase", description: "Search the code" }  // pierde contra Grep

/** ✗ ANTI-PATTERN 5 — Explorar con tools lo que un recurso publica.
 *
 * `list_tables` + `describe_table` por tabla no produce trabajo, solo el
 * conocimiento de sobre qué se podría trabajar.
 */
// for (const table of await listTables()) await describeTable(table);  // 6 llamadas

/** ✗ ANTI-PATTERN 6 — Asumir que los scopes se fusionan.
 *
 * Cuando el mismo nombre está en varios scopes, gana la entrada completa del
 * origen de mayor precedencia; los campos NO se mezclan entre scopes.
 */
// expect({...projectEntry, ...userEntry})  // no hay merge: local > project > user

/**
 * ============================================================================
 * EXAM TRAPS — distractores recurrentes y criterio de rechazo
 * ============================================================================
 *
 * | Trampa                                             | Por qué se rechaza                                  |
 * |----------------------------------------------------|-----------------------------------------------------|
 * | Server custom para una integración estándar        | Ya hay servidores de la comunidad, más probados     |
 * | Config de equipo en `~/.claude.json`               | No se commitea; el colega no recibe nada            |
 * | Credenciales literales en `.mcp.json`              | Quedan en el historial para siempre                 |
 * | Descripciones MCP pobres                           | Pierden contra las built-in, que sí están descritas |
 *
 * QUICK REFERENCE — datos de la fuente
 *
 *   Añadir remoto ........... `claude mcp add --transport http <name> <url>`
 *   Añadir stdio local ...... `claude mcp add [options] <name> -- <command> [args...]`
 *                             (el `--` es obligatorio)
 *   Añadir desde JSON ....... `claude mcp add-json <name> '<json>'`
 *   Scope local (default) ... solo el proyecto actual, privado; en `~/.claude.json`
 *                             bajo la ruta del proyecto
 *   Scope project ........... equipo; `.mcp.json` en la raíz, en VCS
 *   Scope user .............. todos tus proyectos, privado; `~/.claude.json`
 *   Nombres viejos .......... `local` se llamaba `project`; `user` se llamaba `global`
 *   Precedencia ............. local > project > user > plugin servers >
 *                             claude.ai connectors (sin merge)
 *   Expansión de env ........ `${VAR}` y `${VAR:-default}`, en command/args/env/
 *                             url/headers
 *   Transports .............. stdio y Streamable HTTP (spec); SSE deprecado en
 *                             Claude Code
 *   Alias de tipo ........... `streamable-http` == `http`
 *   Gestionar ............... `claude mcp list` / `get <name>` / `remove <name>`;
 *                             `/mcp` para estado en sesión
 *   Aprobación .............. prompt antes del primer uso de servers de proyecto;
 *                             `claude mcp reset-project-choices` lo resetea
 *   Auth remota ............. OAuth 2.0 vía `/mcp` o `claude mcp login <name>`;
 *                             tokens guardados y refrescados automáticamente
 *   Claude como server ...... `claude mcp serve` expone las tools de Claude por stdio
 *   Referenciar recurso ..... `@server:protocol://resource/path`
 *   Prompt como slash cmd ... `/mcp__servername__promptname`
 *   Límites de output ....... avisa por encima de 10.000 tokens; cap a 25.000 por
 *                             defecto (`MAX_MCP_OUTPUT_TOKENS`)
 *   Naming de tools ......... `mcp__<server-name>__<tool-name>`
 *   Truncado ................ 2KB para descripciones de tool e instrucciones de server
 *
 * ============================================================================
 * FLUJO DE EJECUCIÓN ESPERADO  (trace ilustrativo — no se ejecuta)
 * ============================================================================
 *
 * [Paso 1 y 2] PROJECT_MCP_CONFIG  (.mcp.json, commiteado)
 *   github → command: npx, args: [-y, @modelcontextprotocol/server-github]
 *            env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" }
 *   jira   → env: { JIRA_URL: "${JIRA_URL}", JIRA_TOKEN: "${JIRA_TOKEN}" }
 *   findLiteralSecrets(PROJECT_MCP_CONFIG) → []        ✅ nada que rotar en el repo
 *
 *   expandEnv("${INTERNAL_API_URL:-https://api.internal.example.com}", {})
 *     → "https://api.internal.example.com"             ✅ usa el default
 *   expandEnv("Bearer ${API_TOKEN}", { API_TOKEN: "abc" })
 *     → "Bearer abc"
 *
 * [Paso 3] USER_MCP_CONFIG  (~/.claude.json, NO commiteado)
 *   experimental-search → solo visible en mi máquina
 *
 *   resolveServer("github", { project: githubEntry, user: otherGithubEntry })
 *     → { source: "project" }        ← gana project sobre user
 *   resolveServer("github", { local: localFork, project: githubEntry })
 *     → { source: "local" }          ← un override local gana en silencio
 *   ✅ una sola definición, sin merge de campos
 *
 * [Paso 4] DB_SCHEMA_RESOURCE → "db://schema/main"
 *   Sin recurso: list_tables() + describe_table() × 5 = 6 llamadas, 0 trabajo
 *   exploratoryCallsAvoided(5) → 6
 *   Con recurso: el conocimiento está presente, 0 llamadas
 *
 * [Paso 5] ENHANCED_SEARCH_TOOL vs Grep
 *   "Find the code that handles refund eligibility"
 *   ANTES  → el modelo elige Grep (descrito a fondo) sobre "Search the code"
 *   DESPUÉS → el modelo elige search_codebase: la descripción dice qué devuelve y
 *             cuándo preferirla sobre Grep
 *   ✅ detalle, no disponibilidad, es lo que decide la elección
 *
 * ANTI-PATRÓN: con el server añadido solo con `claude mcp add` (scope local), el
 * agente funciona en tu máquina y falla en la de tus colegas: sus agentes escalan
 * cada pregunta de billing porque ninguna de las dos tools resuelve. El fix es
 * declarar el server en `.mcp.json` del proyecto con `${VAR}` para las credenciales.
 */
