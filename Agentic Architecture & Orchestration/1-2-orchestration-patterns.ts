/**
 * ============================================================================
 * DOMINIO 1 · TASK STATEMENT 1.2 — Multi-Agent Orchestration
 * ----------------------------------------------------------------------------
 * Objetivo oficial:
 *   Orchestrate multi-agent systems with coordinator-subagent patterns.
 *
 * Qué evalúa el examen aquí:
 *   En hub-and-spoke toda la comunicación pasa por el coordinator, que es dueño
 *   de tres cosas: la decomposición de la tarea, la selección de subagentes y
 *   la agregación de resultados. Los subagentes no ven la conversación del
 *   coordinator ni entre ellos: su único contexto es lo que el coordinator
 *   escribe en el prompt. Por eso, cuando la salida es pobre o incompleta, el
 *   diagnóstico correcto es la decomposición del coordinator, nunca el
 *   subagente.
 *
 * Build Exercise: Build a Hub-and-Spoke Research Coordinator  (Intermediate · 60 min)
 * ============================================================================
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tipos del dominio
// ─────────────────────────────────────────────────────────────────────────────

/** Subagente especializado que el coordinator puede invocar. */
type SubagentKind = "web_search" | "document_analysis";

/** Un subagente con su rol, su prompt de sistema y la frontera de su tarea. */
interface SubagentDefinition {
  readonly kind: SubagentKind;
  readonly description: string;
  /** System prompt del subagente. El campo del SDK se llama `prompt`. */
  readonly prompt: string;
  /** Formato de salida esperado: una línea por finding. */
  readonly outputFormat: string;
  /** Fuentes y límites: sin esto, el trabajo se solapa con el de otro agente. */
  readonly boundaries: string;
}

/**
 * Una unidad de trabajo delegada.
 *
 * Todo lo que el subagente necesita saber viaja aquí: no hereda nada del
 * coordinator. `scope` es la porción concreta que le toca — dos subagentes sobre
 * el mismo subtema no deben recibir la misma porción.
 */
interface TaskAssignment {
  readonly subagent: SubagentKind;
  readonly subtopic: string;
  /** Porción distinta asignada a este subagente (scope partitioning). */
  readonly scope: string;
  /** Objetivo global, para que el subagente entienda su parte en el todo. */
  readonly researchGoal: string;
  /** Hallazgos ya obtenidos que el subagente necesita para no repetir trabajo. */
  readonly priorContext: string;
}

/** Resultado crudo que un subagente devuelve al coordinator. */
interface SubagentResult {
  readonly subagent: SubagentKind;
  readonly subtopic: string;
  readonly findings: readonly string[];
}

/** Veredicto de cobertura por subtema. */
type CoverageLevel = "well_covered" | "partial" | "missing";

interface CoverageAssessment {
  readonly subtopic: string;
  readonly level: CoverageLevel;
  readonly rationale: string;
}

/** Informe final que el coordinator devuelve al caller. */
interface ResearchReport {
  readonly topic: string;
  readonly sections: readonly { readonly subtopic: string; readonly body: string }[];
  readonly coverage: readonly CoverageAssessment[];
  readonly completeness: number;
  readonly iterations: number;
}

/**
 * Puerto al modelo.
 *
 * El coordinator usa este cliente tanto para decomponer/agregar como para
 * representar la invocación de un subagente (en el Agent SDK real esto es una
 * tool call `Task`/`Agent`).
 */
interface AgentClient {
  /** `userPrompt` es el turno del usuario; `system` es el system prompt. */
  complete(userPrompt: string, system: string): Promise<string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 1 — El coordinator como hub central
//
// Why: el coordinator es el hub de hub-and-spoke. El examen evalúa que sepas
//      que él — y no los subagentes — es dueño de la decomposición, la
//      selección y la agregación.
// You should see: una función que acepta un topic y devuelve un informe
//      estructurado, con un system prompt que define su rol de hub.
// ─────────────────────────────────────────────────────────────────────────────

/** System prompt que fija el rol del coordinator dentro de la arquitectura. */
const COORDINATOR_SYSTEM_PROMPT = `You are the coordinator of a research system.
You own three responsibilities and delegate none of them:
1. Decompose the topic into subtopics that cover its full breadth.
2. Select and invoke subagents, passing every piece of context explicitly.
3. Aggregate results and assess coverage, re-delegating on gaps.
Subagents share no memory with you. If you do not put it in the prompt, it does not exist.`;

/**
 * Coordina la investigación completa de un topic.
 *
 * @param client - Puerto al modelo.
 * @param topic - Tema amplio a investigar.
 * @returns El informe final con su evaluación de cobertura.
 */
async function createCoordinator(
  client: AgentClient,
  topic: string,
): Promise<ResearchReport> {
  const subtopics = await decomposeTopic(client, topic);
  return runRefinementLoop(client, topic, subtopics);
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 2 — Decomposición amplia (el fallo de narrow decomposition)
//
// Why: la decomposición estrecha es un patrón de fallo específico del examen.
//      El coordinator que solo asigna solar y wind para "renewable energy"
//      deja categorías enteras fuera.
// You should see: 5+ subtemas para cualquier topic amplio.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parte un topic amplio en subtemas que cubren toda su amplitud.
 *
 * @param client - Puerto al modelo.
 * @param topic - Tema a decomponer.
 * @returns La lista de subtemas, con un mínimo de cinco.
 * @throws Si el modelo devuelve menos de cinco subtemas.
 */
async function decomposeTopic(
  client: AgentClient,
  topic: string,
): Promise<readonly string[]> {
  const raw = await client.complete(
    `Decompose "${topic}" into subtopics covering its full breadth. ` +
      `List every major category, not the two most obvious ones. ` +
      `Return one subtopic per line.`,
    COORDINATOR_SYSTEM_PROMPT,
  );

  const subtopics = raw
    .split("\n")
    .map((line) => line.replace(/^[-*\d.\s]+/, "").trim())
    .filter((line) => line.length > 0);

  if (subtopics.length < 5) {
    throw new Error(
      `Narrow decomposition: ${subtopics.length} subtopics returned, 5 required.`,
    );
  }
  return subtopics;
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 3 — Spawn de subagentes con contexto explícito
//
// Why: los subagentes están aislados — sin memoria compartida y sin contexto
//      heredado. Si un subagente da malos resultados, revisa si el coordinator
//      le dio contexto suficiente, no si el subagente es defectuoso. Y antes de
//      pasar el contexto: selecciona qué subagentes hacen falta y reparte
//      porciones que no solapen.
// You should see: cada invocación recibe subtema, scope, objetivo, formato de
//      salida, límites y contexto previo — todo explícito en el prompt.
// ─────────────────────────────────────────────────────────────────────────────

/** Los dos subagentes del ejercicio, cada uno con su rol acotado. */
const subagents: readonly SubagentDefinition[] = [
  {
    kind: "web_search",
    description: "Finds current facts and figures from the open web.",
    prompt: "You search the web and return sourced facts. Be concise.",
    outputFormat: "One finding per line, ending with the source URL.",
    boundaries: "Open-web sources only. Do not analyse uploaded documents.",
  },
  {
    kind: "document_analysis",
    description: "Analyses internal documents for depth and caveats.",
    prompt: "You analyse documents and return detailed findings.",
    outputFormat: "One finding per line, ending with document name and page.",
    boundaries: "Uploaded documents only. Do not search the open web.",
  },
];

/**
 * Selección dinámica de subagentes para un subtema.
 *
 * El coordinator NO manda todo por el pipeline completo: escala el esfuerzo al
 * tipo de consulta. Un dato factual se resuelve con web search solo; un subtema
 * que pide profundidad o caveats necesita además análisis documental. Enviar
 * siempre los dos paga el sobrecoste de tokens (~15× vs chat) sin ganar nada.
 *
 * @param subtopic - El subtema a cubrir.
 * @returns Los subagentes que ese subtema necesita realmente.
 */
function selectSubagents(subtopic: string): readonly SubagentKind[] {
  // Heurística ilustrativa: en producción la decide el propio coordinator.
  const needsDepth = /geothermal|tidal|fusion|caveat|outlook|policy/i.test(subtopic);
  return needsDepth ? ["web_search", "document_analysis"] : ["web_search"];
}

/**
 * Partitioning: da a cada subagente una porción distinta del subtema.
 *
 * Sin porciones separadas, dos subagentes sobre la misma fuente devuelven el
 * mismo finding dos veces mientras las fuentes no asignadas quedan sin leer.
 *
 * @param kind - El subagente al que se asigna la porción.
 * @param subtopic - El subtema compartido.
 * @returns La porción concreta, sin solape con el otro subagente.
 */
function partitionScope(kind: SubagentKind, subtopic: string): string {
  return kind === "web_search"
    ? `${subtopic} — news coverage and current figures`
    : `${subtopic} — internal documents, caveats and depth`;
}

/**
 * Invoca un subagente con contexto completo y explícito.
 *
 * Aquí se materializa la regla de aislamiento: el prompt contiene el subtema,
 * el objetivo global y el contexto previo. Nada se hereda implícitamente.
 *
 * @param client - Puerto al modelo.
 * @param assignment - La unidad de trabajo con todo su contexto.
 * @returns El resultado crudo del subagente.
 */
async function spawnSubagent(
  client: AgentClient,
  assignment: TaskAssignment,
): Promise<SubagentResult> {
  const definition = subagents.find((s) => s.kind === assignment.subagent);
  if (definition === undefined) {
    throw new Error(`Unknown subagent: ${assignment.subagent}`);
  }

  const prompt = [
    `Subagent role: ${definition.description}`,
    `Overall goal: ${assignment.researchGoal}`,
    `Your subtopic: ${assignment.subtopic}`,
    `Your scope: ${assignment.scope}`,
    `Output format: ${definition.outputFormat}`,
    `Boundaries: ${definition.boundaries}`,
    `Context from prior work: ${assignment.priorContext}`,
  ].join("\n");

  const raw = await client.complete(prompt, definition.prompt);
  return {
    subagent: assignment.subagent,
    subtopic: assignment.subtopic,
    findings: raw.split("\n").filter((line) => line.trim().length > 0),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 4 — Agregación y evaluación de cobertura
//
// Why: el coordinator debe evaluar si los resultados combinados cubren toda la
//      amplitud del topic original. Aquí arranca el iterative refinement: los
//      gaps detectados disparan re-delegación.
// You should see: una evaluación que marca cada subtema como well_covered,
//      partial o missing.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evalúa qué subtemas quedaron cubiertos por los resultados recibidos.
 *
 * @param subtopics - Los subtemas que el coordinator decompuso.
 * @param results - Los resultados devueltos por los subagentes.
 * @returns La evaluación de cobertura, un veredicto por subtema.
 */
function aggregateResults(
  subtopics: readonly string[],
  results: readonly SubagentResult[],
): readonly CoverageAssessment[] {
  const covered = new Map<string, number>();
  for (const result of results) {
    covered.set(result.subtopic, (covered.get(result.subtopic) ?? 0) + result.findings.length);
  }

  return subtopics.map((subtopic) => {
    const hitCount = covered.get(subtopic) ?? 0;
    if (hitCount >= 2) {
      return { subtopic, level: "well_covered", rationale: `${hitCount} findings` };
    }
    if (hitCount === 1) {
      return { subtopic, level: "partial", rationale: "Single finding, needs corroboration" };
    }
    return { subtopic, level: "missing", rationale: "No findings returned" };
  });
}

/** Gaps que justifican otra ronda de delegación. */
const findGaps = (coverage: readonly CoverageAssessment[]): readonly string[] =>
  coverage
    .filter((entry) => entry.level !== "well_covered")
    .map((entry) => entry.subtopic);

// ─────────────────────────────────────────────────────────────────────────────
// Paso 5 — Iterative refinement loop
//
// Why: delegación de un solo tiro no basta. El coordinator debe evaluar la
//      salida y re-delegar los gaps — eso lo distingue de un simple dispatcher.
// You should see: un loop que evalúa cobertura, manda queries dirigidas por los
//      subtemas faltantes y re-evalúa hasta llegar al umbral.
// ─────────────────────────────────────────────────────────────────────────────

/** Rondas máximas de refinamiento. Cota de seguridad, no condición de parada. */
const MAX_REFINEMENT_ROUNDS = 4;

/** Cobertura mínima aceptable para cerrar la investigación. */
const COVERAGE_TARGET = 1.0;

/**
 * Refina la investigación hasta cubrir todo el topic.
 *
 * El criterio de salida es la cobertura alcanzada; el máximo de rondas es solo
 * una red de seguridad contra el runaway.
 *
 * @param client - Puerto al modelo.
 * @param topic - El topic original.
 * @param subtopics - La decomposición inicial.
 * @returns El informe final.
 */
async function runRefinementLoop(
  client: AgentClient,
  topic: string,
  subtopics: readonly string[],
): Promise<ResearchReport> {
  const results: SubagentResult[] = [];
  let coverage: readonly CoverageAssessment[] = [];
  let round = 0;

  while (round < MAX_REFINEMENT_ROUNDS) {
    round += 1;

    const gaps = round === 1 ? subtopics : findGaps(coverage);
    if (gaps.length === 0) break;

    const assignments: readonly TaskAssignment[] = gaps.flatMap((subtopic) =>
      selectSubagents(subtopic).map((kind) => ({
        subagent: kind,
        subtopic,
        scope: partitionScope(kind, subtopic),
        researchGoal: `Produce a complete research report on ${topic}.`,
        priorContext: results
          .filter((r) => r.subtopic === subtopic)
          .flatMap((r) => r.findings)
          .join(" ")
          || "No prior findings on this subtopic.",
      })),
    );

    // Subagentes independientes entre sí: se invocan en paralelo.
    const roundResults = await Promise.all(
      assignments.map((assignment) => spawnSubagent(client, assignment)),
    );
    results.push(...roundResults);

    coverage = aggregateResults(subtopics, results);
    const completeness = coverage.filter((e) => e.level === "well_covered").length / subtopics.length;
    if (completeness >= COVERAGE_TARGET) break;
  }

  const covered = coverage.filter((entry) => entry.level === "well_covered").length;
  return {
    topic,
    sections: subtopics.map((subtopic) => ({
      subtopic,
      body: results
        .filter((r) => r.subtopic === subtopic)
        .flatMap((r) => r.findings)
        .join(" "),
    })),
    coverage,
    completeness: subtopics.length === 0 ? 0 : covered / subtopics.length,
    iterations: round,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 6 — Escenario: renewable energy technologies
//
// Why: mapea al patrón de narrow decomposition del examen. Si la salida solo
//      cubre solar y wind, la causa raíz está en la decomposición del
//      coordinator — el diagnóstico exacto que el examen espera.
// You should see: secciones sustantivas sobre solar, wind, geothermal, tidal,
//      biomass y fusion, con cobertura al 100%.
// ─────────────────────────────────────────────────────────────────────────────

/** Corre el escenario del examen. */
export async function runScenario(client: AgentClient): Promise<void> {
  const report = await createCoordinator(client, "renewable energy technologies");
  console.log(`Completeness: ${(report.completeness * 100).toFixed(0)}%`);
  for (const section of report.sections) {
    console.log(`- ${section.subtopic}: ${section.body.slice(0, 80)}…`);
  }
}

/**
 * ============================================================================
 * ✗ ANTI-PATTERN — Delegar sin contexto o sin evaluar cobertura
 * ============================================================================
 */

/** ✗ ANTI-PATTERN 1 — Delegación estrecha.
 *
 * Decomponer "renewable energy" en ["solar", "wind"] porque son los dos
 * primeros que aparecen. La salida incompleta se atribuye erróneamente al
 * subagente, cuando la causa raíz es la decomposición del coordinator.
 */
// const subtopics = ["solar", "wind"];

/** ✗ ANTI-PATTERN 2 — Confiar en memoria compartida.
 *
 * Pasar solo el subtema y asumir que el subagente "ya sabe" el objetivo o los
 * hallazgos previos. No hay memoria compartida: lo que no esté en el prompt no
 * existe para el subagente.
 */
// const prompt = assignment.subtopic; // falta goal y priorContext

/** ✗ ANTI-PATTERN 3 — Dispatcher de un solo tiro.
 *
 * Invocar los subagentes una vez y devolver lo que llegue, sin evaluar
 * cobertura ni re-delegar. Eso es un dispatcher, no un coordinator.
 */
// for (const subtopic of subtopics) await spawnSubagent(client, { subtopic });

/** ✗ ANTI-PATTERN 4 — Mandar todo por el pipeline completo.
 *
 * Invocar siempre los dos subagentes para cada subtema, aunque sea un dato
 * factual. Escalar el esfuerzo al tipo de consulta es responsabilidad del
 * coordinator; el pipeline completo paga el 15× de tokens sin mejorar nada.
 */
// const assignments = gaps.flatMap((s) => subagents.map(...));  // sin selectSubagents

/** ✗ ANTI-PATTERN 5 — Descripciones de tarea vagas → trabajo duplicado.
 *
 * Sin objetivo, formato de salida, fuentes y límites, dos subagentes exploran lo
 * mismo y dejan el resto sin cubrir. El ejemplo de la fuente: uno investiga la
 * crisis de chips de 2021 mientras dos duplican las cadenas de suministro de 2025.
 */
// spawnSubagent(client, { subtopic });  // falta scope/outputFormat/boundaries

/** ✗ ANTI-PATTERN 6 — Subagente que habla con otro subagente.
 *
 * El atajo directo se salta al hub: queda sin registrar, sin la política de
 * errores y sin el control de qué ve cada subagente. La topología pasa a mesh y
 * las tres garantías dejan de valer.
 */
// searchAgent.call(docAnalysisAgent, context);  // hop que salta el coordinator

/**
 * ============================================================================
 * EXAM TRAPS
 * ============================================================================
 *
 * | Trampa                                    | Criterio de rechazo                                     |
 * |-------------------------------------------|---------------------------------------------------------|
 * | Culpar al subagente por salida pobre      | Revisa el contexto que le pasó el coordinator           |
 * | Decomposición estrecha (2-3 subtemas)     | Traza la causa raíz al coordinator, no al modelo        |
 * | Delegación en serie de tareas independientes | Desperdicia latencia; usa invocaciones paralelas      |
 * | Un solo round de delegación               | El coordinator debe evaluar y re-delegar gaps           |
 * | Añadir más subagentes para tapar un gap   | Reproducen la misma asignación estrecha                 |
 * | Mandar todo por el pipeline completo      | Escala el esfuerzo al tipo de consulta                  |
 * | Descripciones de tarea vagas              | Trabajo duplicado + categorías sin cubrir               |
 * | Subagente que habla con otro subagente    | Topología mesh; pierde las tres garantías del hub       |
 *
 * QUICK REFERENCE — coste y alcance (datos de la fuente)
 *
 * Nombre formal del patrón: orchestrator-workers. El rasgo que lo distingue de
 * parallelization es que los subtemas los determina el orchestrator, no vienen
 * predefinidos.
 *
 *   Agentes vs chat ............... ~4× tokens
 *   Multi-agente vs chat .......... ~15× tokens
 *   Uplift medido ................. 90.2%  (lead Opus 4 + subagentes Sonnet 4)
 *   Varianza explicada por tokens .. 80%
 *   Effort scaling ................ 1 agente / 3-10 calls    (factual)
 *                                   2-4 subagentes / 10-15   (comparación)
 *                                   10+ subagentes           (research complejo)
 *   Paralelización ................ nivel 1: 3-5 subagentes en paralelo
 *                                   nivel 2: 3+ tools en paralelo por subagente
 *
 * Las cuatro responsabilidades del coordinator: (1) selección dinámica de
 * subagentes, (2) research scope partitioning, (3) iterative refinement loops,
 * (4) centralised communication routing.
 *
 * Cuándo multi-agente es la opción EQUIVOCADA: dominios donde todos los agentes
 * comparten contexto o hay muchas dependencias (la mayoría de tareas de coding),
 * y la coordinación cross-agent en tiempo real. Encaja cuando hay paralelización
 * fuerte, información que excede una sola ventana de contexto, o tools complejas.
 *
 * ============================================================================
 * FLUJO DE EJECUCIÓN ESPERADO  (trace ilustrativo — no se ejecuta)
 * ============================================================================
 *
 * topic = "renewable energy technologies"
 *
 * [Paso 2] decomposeTopic() → 6 subtemas:
 *          ["solar", "wind", "geothermal", "tidal", "biomass", "fusion"]
 *
 * [round 1] gaps = 6 subtemas
 *           selectSubagents() por subtema  ← selección dinámica
 *             solar, wind, biomass       → web_search only            (3)
 *             geothermal, tidal, fusion  → web_search + document_analysis (6)
 *           partitionScope() → porciones sin solape
 *           assignments = 9 invocaciones (no 12: no se manda el pipeline completo)
 *           Promise.all([...]) → 9 resultados (paralelo)
 *           aggregateResults() → coverage:
 *             solar      well_covered (2 findings)   ✓
 *             wind       well_covered (2 findings)   ✓
 *             geothermal partial      (1 finding)    △
 *             tidal      missing      (0 findings)   ✗
 *             biomass    partial      (1 finding)    △
 *             fusion     missing      (0 findings)   ✗
 *           completeness = 2/6 = 33%  → sigue
 *
 * [round 2] gaps = ["geothermal", "tidal", "biomass", "fusion"]
 *           → queries dirigidas, con priorContext de cada subtema
 *           aggregateResults()
 *             geothermal well_covered ✓
 *             tidal      well_covered ✓
 *             biomass    well_covered ✓
 *             fusion     partial      △
 *           completeness = 5/6 = 83%  → sigue
 *
 * [round 3] gaps = ["fusion"] → re-delegación dirigida
 *           completeness = 6/6 = 100% → COVERAGE_TARGET alcanzado → EXIT
 *           (rounds used: 3 of MAX_REFINEMENT_ROUNDS = 4 → cap NEVER hit)
 *
 * Output:
 *   Completeness: 100%
 *   - solar: ...
 *   - wind: ...
 *   - geothermal: ...
 *   - tidal: ...
 *   - biomass: ...
 *   - fusion: ...
 *
 * ANTI-PATRÓN (decomposición estrecha):
 *   subtopics = ["solar", "wind"]
 *   Completeness: 100%    ← engañoso: 100% de DOS subtemas, no del topic
 *   - solar: ...
 *   - wind: ...
 *   (geothermal, tidal, biomass, fusion nunca existieron en el informe)
 */

export {};
