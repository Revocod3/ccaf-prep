/**
 * ============================================================================
 * DOMINIO 2 · TASK STATEMENT 2.3 — Tool Distribution & Tool Choice
 * ----------------------------------------------------------------------------
 * Objetivo oficial:
 *   Distribute tools appropriately across agents and configure tool choice.
 *
 * Qué evalúa el examen aquí:
 *   Cuántas tools lleva un agente no es una pregunta de empaquetado: cambia la
 *   frecuencia con la que elige la correcta. Con 18 tools la fiabilidad de
 *   selección se cae; lo que funciona son 4-5 por agente, elegidas para su rol.
 *   Y la relevancia importa tanto como el número: un agente de síntesis con
 *   `web_search` empieza a buscar por su cuenta en vez de trabajar con los
 *   resultados que ya le dieron. La frontera del toolkit es la frontera del rol.
 *   Aparte, `tool_choice` fija cómo el modelo se relaciona con el toolkit: `auto`
 *   decide, `any` obliga a llamar alguna tool, `tool` obliga a una concreta, y
 *   `none` prohíbe llamarlas.
 *
 * Build Exercise: Configure Tool Distribution Across a Multi-Agent System
 *                 (Intermediate · 45 min)
 * ============================================================================
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tipos del sistema multi-agente
// ─────────────────────────────────────────────────────────────────────────────

/** Los cuatro roles del sistema de investigación. */
type AgentRole = "web_search" | "document_analysis" | "synthesis" | "coordinator";

/** Una tool con su descripción: la descripción es el mecanismo de selección. */
interface ToolSpec {
  readonly name: string;
  readonly description: string;
}

/** El toolkit de un agente, acotado a su rol. */
interface AgentToolset {
  readonly role: AgentRole;
  readonly purpose: string;
  readonly tools: readonly ToolSpec[];
}

/**
 * Los cuatro modos de `tool_choice`.
 *
 * `auto` es el default cuando se pasan `tools`; `none` es el default cuando no
 * se pasan. Con `any` y `tool` la API prefigura el mensaje del assistant: el
 * modelo NO emite texto natural antes del `tool_use`, aunque se le pida.
 */
type ToolChoice =
  | { readonly type: "auto"; readonly disable_parallel_tool_use?: boolean }
  | { readonly type: "any"; readonly disable_parallel_tool_use?: boolean }
  | {
      readonly type: "tool";
      readonly name: string;
      readonly disable_parallel_tool_use?: boolean;
    }
  | { readonly type: "none" };

// ─────────────────────────────────────────────────────────────────────────────
// Paso 1 — Tres roles con 4-5 tools cada uno, scoped a su rol
//
// Why: la sobrecarga de tools degrada la fiabilidad de selección. El examen
//      testea que cada agente lleve 4-5 tools de su rol; darle 18 a uno es un
//      anti-patrón conocido que causa misrouting.
// You should see: tres agentes con 4-5 tools cada uno, sin tool repetida entre
//      roles (salvo las cross-role scoped que se añaden después).
// ─────────────────────────────────────────────────────────────────────────────

/** Los toolkits base. El coordinator no lleva NINGUNA tool de dominio. */
export const AGENT_TOOLSETS: Readonly<Record<AgentRole, AgentToolset>> = {
  web_search: {
    role: "web_search",
    purpose: "Finds and retrieves web content.",
    tools: [
      { name: "search_web", description: "Searches the web for a query and returns ranked results." },
      { name: "fetch_page", description: "Fetches the full content of a web page by URL." },
      { name: "extract_links", description: "Extracts all hyperlinks from a web page." },
      { name: "save_snippet", description: "Saves a text snippet with its source URL for later use." },
    ],
  },
  document_analysis: {
    role: "document_analysis",
    purpose: "Analyses document structure and content.",
    tools: [
      { name: "extract_metadata", description: "Extracts title, author, date and document type." },
      { name: "extract_data_points", description: "Extracts structured data fields (dates, amounts, names)." },
      { name: "summarize_content", description: "Produces a concise summary of a document's key arguments." },
      { name: "verify_claim", description: "Checks whether a claim is supported by the source document." },
    ],
  },
  synthesis: {
    role: "synthesis",
    purpose: "Compiles findings into reports.",
    tools: [
      { name: "compile_report", description: "Assembles research findings into a structured report." },
      { name: "format_citation", description: "Formats a source reference in the required citation style." },
      { name: "assess_coverage", description: "Evaluates whether all research questions have been addressed." },
    ],
  },
  coordinator: {
    role: "coordinator",
    purpose: "Runs the workflow; never does the domain work itself.",
    tools: [
      { name: "Task", description: "Spawns a subagent (named Agent in current tooling)." },
      { name: "review_output", description: "Reviews a subagent's output against the brief." },
      { name: "request_revision", description: "Sends a subagent back to revise its output." },
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Paso 2 — Una tool cross-role scoped para el caso simple y frecuente
//
// Why: enrutar cada verificación por el coordinator cuesta 2-3 hops y hasta 40%
//      de latencia en checks que se resuelven en milisegundos. El examen testea
//      el patrón: una versión acotada de la capacidad para el 85% simple, y los
//      casos complejos siguen por el pipeline completo.
// You should see: un `verify_fact` en el agente de síntesis, con una descripción
//      que lo limita a lookups simples de una sola fuente y dice que lo complejo
//      se escala al coordinator.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `verify_fact` scoped: la capacidad ajena, deliberadamente estrechada.
 *
 * La frontera en la descripción es lo que impide que se convierta en una
 * segunda tool de búsqueda: un solo documento, y lo difícil se escala.
 */
export const SCOPED_VERIFY_FACT: ToolSpec = {
  name: "verify_fact",
  description:
    "Verifies a simple factual claim against a single source document. Use for quick checks during report compilation. For complex verifications requiring multiple sources or cross-referencing, escalate to the coordinator.",
};

/**
 * Añade la tool cross-role scoped a un toolkit.
 *
 * @param toolset - El toolkit base del agente.
 * @param tool - La tool scoped a añadir.
 * @returns Un toolkit nuevo con la tool al final.
 */
export function addScopedTool(toolset: AgentToolset, tool: ToolSpec): AgentToolset {
  return { ...toolset, tools: [...toolset.tools, tool] };
}

/** Toolkits activos: la síntesis lleva su `verify_fact` scoped. */
export const ACTIVE_TOOLSETS: Readonly<Record<AgentRole, AgentToolset>> = {
  ...AGENT_TOOLSETS,
  synthesis: addScopedTool(AGENT_TOOLSETS.synthesis, SCOPED_VERIFY_FACT),
};

// ─────────────────────────────────────────────────────────────────────────────
// Paso 3 — tool_choice forzado para el primer paso obligatorio
//
// Why: la selección forzada impone el orden del workflow. El examen evalúa los
//      tres modos: `auto` deja elegir, `any` garantiza una llamada a alguna
//      tool, y `tool` garantiza una concreta. Evita que el modelo se salte pasos
//      obligatorios.
// You should see: la primera llamada del agente de document analysis con
//      `type: "tool"` y `name: "extract_metadata"`, y las siguientes con `auto`.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * El `tool_choice` que corresponde a cada turno del document analysis.
 *
 * Turno 0 forzado (nada puede correr antes de extraer la metadata); a partir de
 * ahí `auto`, para que el modelo elija la tool de análisis que toque. Ojo: ese
 * cambio de `tool_choice` entre turnos invalida los bloques de mensaje cacheados
 * (las definiciones de tools y el system prompt siguen cacheados).
 *
 * @param turn - Número de turno (0 = primero).
 * @returns El `tool_choice` del turno.
 */
export function documentAnalysisToolChoice(turn: number): ToolChoice {
  return turn === 0 ? { type: "tool", name: "extract_metadata" } : { type: "auto" };
}

/**
 * Describe la garantía que da cada modo de `tool_choice`.
 *
 * @param choice - La configuración de `tool_choice`.
 * @returns La garantía en una frase.
 */
export function describeToolChoice(choice: ToolChoice): string {
  switch (choice.type) {
    case "auto":
      return choice.disable_parallel_tool_use === true
        ? "tool call or text — at most one tool call"
        : "tool call or text — model decides";
    case "any":
      return choice.disable_parallel_tool_use === true
        ? "exactly one tool call"
        : "must call a tool — any of them";
    case "tool":
      return choice.disable_parallel_tool_use === true
        ? `exactly one tool call: ${choice.name}`
        : `must call ${choice.name}`;
    case "none":
      return "no tool calls — text only";
    default: {
      const exhaustive: never = choice;
      return exhaustive;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 4 — Reemplazar la tool genérica por una alternativa acotada
//
// Why: least privilege aplicado al diseño de tools. `fetch_url` recupera
//      cualquier cosa de cualquier sitio; `load_document`, que valida URLs de
//      documento, no. El mismo cambio mejora la seguridad y la descripción.
// You should see: una `load_document` con validación de URL (extensiones de
//      documento y dominios de confianza) que rechaza lo que no es un documento
//      con un mensaje claro.
// ─────────────────────────────────────────────────────────────────────────────

const VALID_EXTENSIONS = [".pdf", ".docx", ".md", ".txt", ".html"] as const;
const TRUSTED_DOMAINS = ["docs.internal.com", "wiki.company.com"] as const;

/** Resultado de cargar un documento: éxito o rechazo, discriminado. */
export type LoadDocumentResult =
  | { readonly isError: false; readonly url: string; readonly content: string }
  | { readonly isError: true; readonly url: string; readonly description: string };

/**
 * Carga un documento desde una URL validada.
 *
 * Solo acepta URLs con extensión de documento y de un dominio de confianza. Se
 * usa en lugar de `fetch_url` para recuperación de documentos: un reach acotado
 * al rol y no más allá.
 *
 * @param url - La URL a cargar.
 * @returns El contenido, o un rechazo estructurado si no es un documento válido.
 */
export function loadDocument(url: string): LoadDocumentResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { isError: true, url, description: `Rejected: ${url} is not a valid URL.` };
  }

  const hasValidExtension = VALID_EXTENSIONS.some((extension) =>
    parsed.pathname.endsWith(extension),
  );
  const isTrustedDomain = (TRUSTED_DOMAINS as readonly string[]).includes(parsed.hostname);

  if (!hasValidExtension || !isTrustedDomain) {
    return {
      isError: true,
      url,
      description: `Rejected: ${url} is not a valid document URL. Must be a document file from a trusted domain.`,
    };
  }
  return { isError: false, url, content: `Document content from ${url}` };
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 5 — Test end-to-end: que ningún agente use tools fuera de su rol
//
// Why: el test valida que el reparto funciona en la práctica. El cross-role
//      misuse — un agente de síntesis corriendo sus propias búsquedas — es un
//      fallo común que el examen espera que prevengas con el scoping.
// You should see: web search solo con sus tools, document analysis empezando por
//      `extract_metadata` forzado, y synthesis con `compile_report` + `verify_fact`.
// ─────────────────────────────────────────────────────────────────────────────

/** Una llamada a tool registrada, con el agente que la hizo. */
interface ToolCallLogEntry {
  readonly agent: AgentRole;
  readonly tool: string;
}

/** Veredicto de una llamada: dentro del rol o violación. */
interface MisuseReport {
  readonly entry: ToolCallLogEntry;
  readonly verdict: "valid" | "cross_role_violation";
}

/**
 * Comprueba que cada llamada venga del toolkit correcto.
 *
 * @param log - Las llamadas registradas durante la corrida.
 * @returns Un veredicto por llamada.
 */
export function verifyToolDistribution(
  log: readonly ToolCallLogEntry[],
): readonly MisuseReport[] {
  return log.map((entry) => {
    const allowed = ACTIVE_TOOLSETS[entry.agent].tools.some(
      (tool) => tool.name === entry.tool,
    );
    return {
      entry,
      verdict: allowed ? "valid" : "cross_role_violation",
    };
  });
}

/**
 * ============================================================================
 * ✗ ANTI-PATTERN — Lo que rompe el reparto de tools
 * ============================================================================
 */

/** ✗ ANTI-PATTERN 1 — 18 tools en un agente.
 *
 * Cada tool añadida ensancha la decisión y la fiabilidad cae con ella. El fix de
 * un agente sobrecargado es dividir el rol, no escribir mejores descripciones
 * para dieciocho tools.
 */
// tools: [...18 tools...]  // "selection reliability falls away"

/** ✗ ANTI-PATTERN 2 — Un agente de síntesis con `web_search`.
 *
 * Un toolkit que pasa la frontera del rol es una invitación a cruzarla: la
 * síntesis empieza a buscar por su cuenta, duplica trabajo ya hecho y gasta
 * contexto en ello.
 */
// synthesis.tools.push(searchWebTool);  // "searches for itself, duplicates work"

/** ✗ ANTI-PATTERN 3 — `tool_choice: "auto"` cuando el output estructurado es obligatorio.
 *
 * Bajo `auto` el modelo todavía puede responder en texto, así que nada garantiza
 * el resultado estructurado que el pipeline espera. `any` obliga a una llamada;
 * `tool` obliga a la concreta.
 */
// tool_choice: { type: "auto" }  // "a text reply remains available"

/** ✗ ANTI-PATTERN 4 — `fetch_url` genérico donde bastaría `load_document`.
 *
 * Una tool que puede recuperar cualquier cosa invita a recuperar cualquier cosa,
 * y no se puede describir con la precisión que la selección fiable necesita:
 * su propósito es demasiado amplio.
 */
// { name: "fetch_url", description: "Fetches a URL" }  // alcanza un panel de admin

/** ✗ ANTI-PATTERN 5 — Enrutar el 85% de checks simples por el coordinator.
 *
 * Cada round trip añade 2-3 hops a un lookup de milisegundos, y hacerlo con el
 * 85% de los checks puede costar 40% del presupuesto de latencia.
 */
// for (const claim of claims) await coordinator.delegate("verify_fact", claim);

/** ✗ ANTI-PATTERN 6 — `disable_parallel_tool_use` a nivel top.
 *
 * No es un parámetro top-level del request: vive DENTRO de `tool_choice`, y su
 * efecto depende del tipo que lo envuelve.
 */
// { disable_parallel_tool_use: true, tool_choice: { type: "any" } }  // no es top-level

/** ✗ ANTI-PATTERN 7 — `tool_choice` forzado con manual extended thinking.
 *
 * `any` y `tool` no están soportados con thinking manual (`thinking: {type:
 * "enabled"}`) y dan error; solo `auto` y `none` son compatibles. El thinking
 * adaptativo (incluido el que va por defecto en Opus 5) sí admite forzado.
 */
// { thinking: { type: "enabled" }, tool_choice: { type: "tool", name: "extract_metadata" } }  // error

/**
 * ============================================================================
 * EXAM TRAPS — distractores recurrentes y criterio de rechazo
 * ============================================================================
 *
 * | Trampa                                             | Por qué se rechaza                                  |
 * |----------------------------------------------------|-----------------------------------------------------|
 * | Enrutar todo check simple por el coordinator       | 2-3 hops por lookup; hasta 40% más de latencia      |
 * | `tool_choice: "auto"` con output estructurado      | El texto sigue disponible; nada garantiza el shape  |
 * | 18 tools y esperar selección fiable                | Cada tool ensancha la decisión; 4-5 es el rango      |
 * | `fetch_url` genérico en vez de `load_document`     | No se puede describir con precisión; invita al abuso |
 *
 * QUICK REFERENCE — datos de la fuente
 *
 *   tool_choice: auto ...... el modelo decide tool call o texto; default cuando
 *                            se pasan `tools`
 *   tool_choice: any ....... debe llamar a alguna tool, elige cuál
 *   tool_choice: tool ...... `{"type":"tool","name":"…"}` — debe llamar a esa
 *   tool_choice: none ...... no puede llamar tools; default cuando no hay `tools`
 *   Efecto de forzar ....... la API prefigura el mensaje del assistant: sin texto
 *                            natural antes del `tool_use`, aunque se pida
 *   Extended thinking ...... thinking manual solo con `auto`/`none`; `any`/`tool`
 *                            dan error (el adaptativo sí los admite)
 *   disable_parallel_tool_use dentro de `tool_choice`, no top-level; con `auto`:
 *                            como mucho una llamada; con `any`/`tool`: exactamente una
 *   Cambiar tool_choice ..... invalida los bloques de mensaje cacheados; tools y
 *                            system prompt siguen cacheados
 *   Tools óptimas por agente  4-5, scoped al rol
 *   Tool sets inflados ...... failure mode nombrado por Anthropic: puntos de
 *                            decisión ambiguos por funcionalidad solapada
 *   Cross-role scoped ....... capacidad acotada dada directo a un agente para su
 *                            caso simple y frecuente; lo complejo, al coordinator
 *   Coordinator ............. sin tools de dominio: darle medios para hacer el
 *                            trabajo es cómo empieza a hacerlo él mismo
 *
 * ============================================================================
 * FLUJO DE EJECUCIÓN ESPERADO  (trace ilustrativo — no se ejecuta)
 * ============================================================================
 *
 * [Paso 1] AGENT_TOOLSETS
 *   web_search        → search_web · fetch_page · extract_links · save_snippet   (4)
 *   document_analysis → extract_metadata · extract_data_points ·
 *                       summarize_content · verify_claim                        (4)
 *   synthesis         → compile_report · format_citation · assess_coverage       (3)
 *   coordinator       → Task · review_output · request_revision   (0 de dominio)
 *
 * [Paso 2] addScopedTool(synthesis, SCOPED_VERIFY_FACT)
 *   synthesis → compile_report · format_citation · assess_coverage · verify_fact  (4)
 *   "…single source document… escalate to the coordinator."
 *   85% de los checks se resuelven en el sitio; el 15% difícil sigue por el pipeline
 *
 * [Paso 3] documentAnalysisToolChoice(0) → { type: "tool", name: "extract_metadata" }
 *          documentAnalysisToolChoice(1) → { type: "auto" }
 *   turno 0: el modelo NO puede empezar por enrichment — el forzado lo impide
 *   turno 1+: vuelve a `auto` para el resto del análisis
 *
 * [Paso 4] loadDocument("https://docs.internal.com/q3-report.pdf")
 *   → { isError: false, content: "Document content from …" }        ✓
 *   loadDocument("https://admin.internal.com/users")
 *   → { isError: true, description: "Rejected: … not a valid document URL…" }  ✓
 *   (con `fetch_url` genérico, la segunda habría pasado)
 *
 * [Paso 5] verifyToolDistribution(log)
 *   { agent: "web_search",        tool: "search_web" }       → valid
 *   { agent: "document_analysis", tool: "extract_metadata" } → valid
 *   { agent: "synthesis",         tool: "compile_report" }   → valid
 *   { agent: "synthesis",         tool: "verify_fact" }      → valid (scoped)
 *   { agent: "synthesis",         tool: "search_web" }       → cross_role_violation ✗
 *
 * ANTI-PATRÓN: con `search_web` en el toolkit de síntesis, el agente corre sus
 * propias búsquedas sobre temas ya cubiertos — duplica ~1/5 del trabajo de
 * retrieval y empuja su contexto al límite. La solución NO es reescribir la
 * descripción ni añadir un routing layer: es sacar la tool del toolkit.
 */
