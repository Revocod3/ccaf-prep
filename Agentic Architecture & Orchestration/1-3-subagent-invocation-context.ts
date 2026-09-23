/**
 * ============================================================================
 * DOMINIO 1 · TASK STATEMENT 1.3 — Subagent Invocation and Context Passing
 * ----------------------------------------------------------------------------
 * Objetivo oficial:
 *   Configure subagent invocation, context passing, and spawning.
 *
 * Qué evalúa el examen aquí:
 *   Invocar subagentes es un gate binario, no una preferencia: el coordinator
 *   necesita `Task` (o `Agent`, su nombre actual) dentro de `allowedTools` o no
 *   puede spawnear nada. Y una vez spawneado, el subagente está aislado: cada
 *   finding que produzca debe viajar con su metadata. Cuando un agente de
 *   síntesis emite claims sin fuente, la causa raíz no es su prompt — es que el
 *   coordinator pasó el contenido sin la metadata que lo acredita.
 *
 * Build Exercise: Implement Context Passing with Structured Metadata  (Intermediate · 50 min)
 * ============================================================================
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tipos del Agent SDK (nombres fieles a la API real)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Nombre de la tool que permite spawnear subagentes.
 *
 * Renombrada a `Agent` en Claude Code v2.1.63; `Task` sigue funcionando como
 * alias. Es el hard gate del spawning.
 */
type SpawnToolName = "Task" | "Agent";

/**
 * Definición de un subagente registrado en el coordinator.
 *
 * Contrato del SDK: `description` y `prompt` son REQUERIDOS; `tools` y `model`
 * son opcionales. Nota de campo: el system prompt se llama `prompt`, no
 * `systemPrompt` — un detalle que el examen puede pedir literalmente.
 */
interface AgentDefinition {
  readonly description: string;
  /** System prompt del subagente. */
  readonly prompt: string;
  /**
   * Tools permitidas al subagente.
   *
   * Omitir el campo NO restringe: el subagente recibe todas las tools
   * disponibles para subagentes. Enumerarlas sí restringe a esas.
   */
  readonly tools?: readonly string[];
  /** Override de modelo: 'opus' | 'sonnet' | 'haiku' | 'inherit' | id completo. */
  readonly model?: string;
}

/** Opciones de la llamada `query()` del Agent SDK. */
interface QueryOptions {
  /**
   * Tools que el *coordinator* puede usar directamente.
   *
   * Debe incluir `Task`/`Agent` o el spawning es imposible. No es opcional ni
   * configurable en runtime.
   */
  readonly allowedTools: readonly string[];
  readonly agents: Readonly<Record<string, AgentDefinition>>;
}

/** Nivel de confianza reportado por el subagente (la fuente lo modela como string). */
type Confidence = "low" | "medium" | "high";

/** Procedencia de un dato: quién lo recuperó y de dónde. */
interface SourceMetadata {
  readonly sourceUrl?: string;
  readonly documentName?: string;
  readonly pageNumber?: number;
  readonly confidence: Confidence;
  readonly retrievedBy: "web_search" | "document_analysis";
}

/**
 * Un hallazgo con contenido y procedencia separados.
 *
 * La separación es deliberada: el contenido es lo que se cita, la metadata es
 * lo que permite acreditarlo. Strippear la metadata antes de la síntesis es
 * exactamente lo que produce claims huérfanos.
 */
interface Finding {
  readonly claim: string;
  readonly metadata: SourceMetadata;
}

/** Informe de síntesis donde cada claim factual lleva su cita. */
interface SynthesisReport {
  readonly statements: readonly { readonly claim: string; readonly citation: string }[];
  readonly orphanedClaims: readonly string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 1 — `allowedTools` con la tool de spawning
//
// Why: `Task`/`Agent` es el hard gate. Sin él en `allowedTools`, el coordinator
//      no puede invocar ningún subagente. El examen lo evalúa como requisito
//      binario.
// You should see: `allowedTools` conteniendo explícitamente `Agent` (o `Task`),
//      más las tools que el coordinator usa directamente, y los subagentes bajo
//      `options.agents`.
// ─────────────────────────────────────────────────────────────────────────────

/** Opciones del coordinator: nota el gate de spawning en `allowedTools`. */
const coordinatorOptions: QueryOptions = {
  // `Agent` es el nombre actual; `Task` sigue aceptándose como alias.
  allowedTools: ["Agent", "Task", "Read"],
  agents: {
    web_search: {
      description: "Searches the open web and returns sourced results.",
      prompt: "Return a claim per line. Always include the source URL.",
      tools: ["WebSearch"],
      // `model` acepta alias: se le puede dar un modelo más barato por rol.
      model: "haiku",
    },
    document_analysis: {
      description: "Analyses uploaded documents and returns page-referenced findings.",
      prompt: "Return a claim per line. Always include the document name and page.",
      tools: ["Read", "Grep"],
    },
    synthesis: {
      description: "Synthesises findings into a cited report.",
      prompt:
        "Every factual claim must carry its citation. Never invent a source; " +
        "if a finding has no metadata, report it as an orphaned claim.",
      // `tools: []` restringe a cero; OMITIR el campo sería permisivo.
      tools: [],
    },
  },
};

/**
 * Comprueba que el coordinator tenga permiso de spawning.
 *
 * Es el hard gate del exercise: sin `Task`/`Agent` en `allowedTools`, el
 * coordinator no puede invocar ningún subagente, sin importar cuántos tenga
 * definidos en `agents`.
 *
 * @param allowedTools - Las tools habilitadas para el coordinator.
 * @returns `true` si el spawning está permitido.
 */
export function hasSpawnPermission(allowedTools: readonly string[]): boolean {
  const spawnTools: readonly SpawnToolName[] = ["Task", "Agent"];
  return spawnTools.some((tool) => allowedTools.includes(tool));
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 2 — Dos subagentes con tools acotadas a su rol
//
// Why: cada subagente necesita acceso a tools acotado a su rol. El examen
//      evalúa que definas los `AgentDefinition` con sus campos reales:
//      `description` y `prompt` (requeridos), `tools` y `model` (opcionales).
// You should see: dos definiciones — web search solo con tools de búsqueda,
//      document analysis solo con tools de lectura de archivos.
// ─────────────────────────────────────────────────────────────────────────────

/** Los dos subagentes de investigación, derivados de la misma definición. */
const researchSubagents = ["web_search", "document_analysis"] as const;
type ResearchSubagent = (typeof researchSubagents)[number];

/** Verifica que un subagente de investigación esté realmente registrado. */
export const getAgentDefinition = (name: ResearchSubagent): AgentDefinition => {
  const definition = coordinatorOptions.agents[name];
  if (definition === undefined) {
    throw new Error(`Subagent not registered: ${name}`);
  }
  return definition;
};

// ─────────────────────────────────────────────────────────────────────────────
// Paso 3 — Formato estructurado: contenido separado de metadata
//
// Why: el examen evalúa específicamente el attribution failure pattern. Separar
//      contenido de metadata es el fix.
// You should see: una interfaz `Finding` con campos de contenido (claim) y de
//      metadata (sourceUrl, documentName, pageNumber, confidence, retrievedBy).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Construye un `Finding` a partir de la salida cruda de un subagente.
 *
 * Mantiene contenido y procedencia en campos distintos; nunca los fusiona en
 * un solo string, porque fusionarlos es lo que hace imposible citar después.
 *
 * @param claim - El enunciado factual.
 * @param metadata - La procedencia, sin recortes.
 * @returns El finding estructurado.
 */
function toFinding(claim: string, metadata: SourceMetadata): Finding {
  return { claim: claim.trim(), metadata };
}

/** Ejemplo de un finding de búsqueda web (con URL como procedencia). */
export const webFinding: Finding = toFinding("Bitcoin traded at $64,200 on 2026-09-20.", {
  sourceUrl: "https://example.com/btc-price",
  confidence: "high",
  retrievedBy: "web_search",
});

/** Ejemplo de un finding de análisis documental (con página como procedencia). */
export const docFinding: Finding = toFinding("The 2025 renewables share reached 41%.", {
  documentName: "iea-outlook-2025.pdf",
  pageNumber: 87,
  confidence: "high",
  retrievedBy: "document_analysis",
});

// ─────────────────────────────────────────────────────────────────────────────
// Paso 4 — Pasar el output estructurado completo a síntesis
//
// Why: este es el paso crítico. Strippear la metadata antes de pasarla al agente
//      de síntesis es la causa raíz de los fallos de atribución. El coordinator
//      debe pasar el output completo, no solo el texto del claim.
// You should see: el coordinator pasa el array de findings con toda la metadata
//      intacta al prompt de síntesis. Ningún campo se recorta ni se resume.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Serializa findings preservando la metadata.
 *
 * La regla es simple y no admite variantes: se pasa el array completo. Cualquier
 * `.map(f => f.claim)` es el bug.
 *
 * @param findings - Hallazgos con su metadata.
 * @returns La representación que va en el prompt del agente de síntesis.
 */
function passFindingsToSynthesis(findings: readonly Finding[]): string {
  return JSON.stringify(
    findings.map((finding) => ({
      claim: finding.claim,
      source_url: finding.metadata.sourceUrl ?? null,
      document_name: finding.metadata.documentName ?? null,
      page_number: finding.metadata.pageNumber ?? null,
      confidence: finding.metadata.confidence,
      retrieved_by: finding.metadata.retrievedBy,
    })),
    null,
    2,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 5 — Verificar que todo claim sea atribuible
//
// Why: confirma que el context passing funcionó. Si un claim queda sin
//      atribución, traza hacia atrás si la metadata se pasó realmente — no
//      culpes al prompt de síntesis.
// You should see: un informe donde cada claim factual lleva URL y página. Sin
//      claims huérfanos.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formatea la cita de un finding, o `null` si la procedencia es insuficiente.
 *
 * @param finding - El hallazgo a citar.
 * @returns La cita legible, o `null` cuando la metadata no alcanza.
 */
function formatCitation(finding: Finding): string | null {
  const { sourceUrl, documentName, pageNumber } = finding.metadata;
  if (sourceUrl !== undefined) return `Source: ${sourceUrl}`;
  if (documentName !== undefined && pageNumber !== undefined) {
    return `Source: ${documentName}, p. ${pageNumber}`;
  }
  return null;
}

/**
 * Verifica que un informe de síntesis no tenga claims huérfanos.
 *
 * @param findings - Los findings que se pasaron a síntesis.
 * @returns El reporte con el recuento de claims no atribuibles.
 */
function verifyAttribution(findings: readonly Finding[]): SynthesisReport {
  const statements = findings.flatMap((finding) => {
    const citation = formatCitation(finding);
    return citation === null ? [] : [{ claim: finding.claim, citation }];
  });

  const orphanedClaims = findings
    .filter((finding) => formatCitation(finding) === null)
    .map((finding) => finding.claim);

  return { statements, orphanedClaims };
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 6 — Spawn paralelo de subagentes independientes
//
// Why: el examen evalúa latency awareness. Spawnear en serie subagentes
//      independientes desperdicia tiempo.
// You should see: web search y document analysis invocados simultáneamente,
//      esperando ambos antes de pasar a síntesis.
// ─────────────────────────────────────────────────────────────────────────────

/** Puerto de spawning: en el SDK real, una tool call `Task`/`Agent`. */
interface SubagentInvoker {
  invoke(agent: ResearchSubagent, prompt: string): Promise<readonly Finding[]>;
}

/**
 * Corre la investigación con ambos subagentes en paralelo.
 *
 * Contraste con `fork_session`: `fork_session` bifurca una sesión para
 * exploración divergente; esto son invocaciones `Task` independientes y
 * concurrentes dentro de la misma sesión del coordinator.
 *
 * @param invoker - Puerto de spawning.
 * @param topic - Tema a investigar.
 * @returns El reporte de síntesis, ya con la verificación de atribución.
 */
export async function researchInParallel(
  invoker: SubagentInvoker,
  topic: string,
): Promise<SynthesisReport> {
  // Ambas invocaciones son independientes: se emiten en el mismo turno.
  const [webFindings = [], docFindings = []] = await Promise.all(
    researchSubagents.map((agent) =>
      invoker.invoke(agent, `Research "${topic}" and return findings with sources.`),
    ),
  );

  // La metadata viaja intacta hacia síntesis.
  const payload = passFindingsToSynthesis([...webFindings, ...docFindings]);
  void payload;

  return verifyAttribution([...webFindings, ...docFindings]);
}

/**
 * ============================================================================
 * ✗ ANTI-PATTERN — Romper el context passing
 * ============================================================================
 */

/** ✗ ANTI-PATTERN 1 — Olvidar la tool de spawning en `allowedTools`.
 *
 * No es "menos capaz": el coordinator simplemente no puede invocar subagentes,
 * y el fallo aparece en runtime, no al compilar.
 */
// allowedTools: ["Read", "Grep"]   // sin Agent/Task → spawning imposible

/** ✗ ANTI-PATTERN 2 — Strippear la metadata antes de síntesis.
 *
 * El agente de síntesis no puede atribuir lo que no recibió. Es la causa raíz
 * del attribution failure pattern, y aparece como "el agente de síntesis alucina
 * fuentes" cuando en realidad nunca tuvo fuentes.
 */
// const payload = findings.map((f) => f.claim).join("\n");  // metadata perdida

/** ✗ ANTI-PATTERN 3 — Spawn secuencial de subagentes independientes.
 *
 * El segundo no depende del primero, así que serializarlos suma latencia sin
 * ganar nada.
 */
// const web = await invoker.invoke("web_search", topic);
// const doc = await invoker.invoke("document_analysis", topic);  // espera de más

/**
 * ============================================================================
 * EXAM TRAPS
 * ============================================================================
 *
 * | Trampa                                        | Criterio de rechazo                                  |
 * |-----------------------------------------------|------------------------------------------------------|
 * | Síntesis sin fuentes                          | Revisa si el coordinator pasó la metadata            |
 * | `allowedTools` sin `Task`/`Agent`             | Gate binario: sin él no hay spawning                 |
 * | Metadata "resumida" para ahorrar tokens       | Ahorra prompt, destruye la trazabilidad              |
 * | Subagentes independientes en serie            | Usa invocaciones paralelas en un mismo turno         |
 *
 * Confusión frecuente: `fork_session` no es lo mismo que spawn paralelo.
 * `fork_session` bifurca el historial de una sesión para exploración divergente;
 * el spawn paralelo son dos tool calls `Task` en la misma respuesta.
 *
 * QUICK REFERENCE — datos de la fuente
 *
 *   Nombre en la guía ....... `Task` (poner "Task" en `allowedTools`)
 *   Nombre actual (v2.1.63+)  `Agent` — emitido en bloques `tool_use`; `Task` sigue
 *                              apareciendo en la lista de tools de `system:init`
 *   AgentDefinition req. ..... `description`, `prompt`
 *   AgentDefinition opc. ..... `tools` (string[]), `model`
 *   Omitir `tools` ........... el subagente recibe TODAS las tools de subagente (no restringe)
 *   Listar `tools` ........... el subagente recibe solo esas
 *   `model` acepta ........... 'fable' | 'opus' | 'sonnet' | 'haiku' | 'inherit' | ID completo;
 *                              default = modelo principal
 *   Tres vías de definir ..... programática (opción `agents`), filesystem (`.claude/agents/`),
 *                              built-in general-purpose
 *   Choque de nombres ........ la definición programática gana a la de filesystem
 *   Selección ................ automática por la `description`; o nombrada explícita en el prompt
 *   Frontera padre→subagente . solo el prompt string de la tool Agent — sin historia de
 *                              conversación, sin system prompt, sin output de otros subagentes
 *   Qué se queda dentro ...... tool calls y results intermedios; solo el mensaje final vuelve
 *   Speed-up paralelo ........ subtareas independientes terminan en el tiempo de la más lenta,
 *                              no en la suma
 *   Por qué es seguro ........ cada uno tiene su propia ventana de contexto aislada
 *   `fork_session` ........... booleano, default false; bifurca a un session ID nuevo en vez de
 *                              continuar el original
 *   Qué preserva el fork ..... copia de la historia hasta el punto de bifurcación; el ID y la
 *                              historia del original no cambian
 *   Resultado del fork ....... dos sesiones reanudables de forma independiente
 *
 * ============================================================================
 * FLUJO DE EJECUCIÓN ESPERADO  (trace ilustrativo — no se ejecuta)
 * ============================================================================
 *
 * coordinatorOptions.allowedTools = ["Agent", "Task", "Read"]   ← gate OK
 *
 * [turno 1] coordinator emite DOS tool calls en una sola respuesta:
 *             {tool_use} Agent(web_search,       "Research ... sources")
 *             {tool_use} Agent(document_analysis,"Research ... page refs")
 *             → corren en paralelo (no secuencial)
 *
 *   web_search        → findings: [
 *                         { claim: "BTC = $64,200",  metadata: {sourceUrl, confidence: "high",
 *                                                               retrievedBy: "web_search"} },
 *                       ]
 *   document_analysis → findings: [
 *                         { claim: "renewables 41%", metadata: {documentName, pageNumber: 87,
 *                                                               confidence: "high",
 *                                                               retrievedBy: "document_analysis"} },
 *                       ]
 *
 * [turno 2] passFindingsToSynthesis([...web, ...doc])
 *             → payload JSON con claim + source_url + document_name + page_number
 *               + confidence + retrieved_by   ← metadata INTACTA
 *
 * [turno 3] synthesis → verifyAttribution()
 *             statements:     [{claim, citation: "Source: https://example.com/..."},
 *                              {claim, citation: "Source: iea-outlook-2025.pdf, p. 87"}]
 *             orphanedClaims: []                     ← 0 claims huérfanos
 *
 * ANTI-PATRÓN (metadata strippeada):
 *   passFindingsToSynthesis = findings.map(f => f.claim)
 *   [turno 3] synthesis → statements: [{claim, citation: "Unknown"}]
 *                        orphanedClaims: ["BTC = $64,200", "renewables 41%"]
 *   Síntoma observado: "el agente de síntesis inventa fuentes"
 *   Causa raíz real:   el coordinator nunca pasó las fuentes
 */

export {};
