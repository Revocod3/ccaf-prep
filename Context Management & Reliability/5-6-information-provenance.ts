/**
 * ============================================================================
 * DOMINIO 5 · TASK STATEMENT 5.6 — Information Provenance & Multi-Source Synthesis
 * ----------------------------------------------------------------------------
 * Objetivo oficial:
 *   Preserve information provenance and handle uncertainty in multi-source
 *   synthesis.
 *
 * Qué evalúa el examen aquí:
 *   La provenance —saber de dónde vino un claim y cuánto peso aguanta— es lo que
 *   separa un sistema de investigación confiable de uno que produce ficción
 *   convincente. El examen testea si la atribución sobrevive a un pipeline
 *   multi-agente (el paso 3, la síntesis, es donde suele morir), cómo tratar
 *   fuentes que se contradicen (**anotar ambos valores, nunca elegir**), y por qué
 *   las fechas evitan contradicciones falsas: 8% y 12% dejan de ser un desacuerdo
 *   y pasan a ser una tendencia cuando sabes que se midieron con un año de
 *   diferencia.
 *
 * Build Exercise: Build a Provenance-Preserving Synthesis Pipeline
 *                 (Advanced · 60 min)
 * ============================================================================
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tipos del mapeo claim-source
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Un finding con su provenance completa.
 *
 * Todos los campos son REQUERIDOS: un `sourceUrl` opcional es como la atribución
 * desaparece en silencio tres etapas más abajo.
 */
interface ClaimSourceMapping {
  readonly claim: string;
  readonly sourceUrl: string;
  readonly documentName: string;
  readonly relevantExcerpt: string;
  readonly publicationDate: string;
}

/** Los cinco campos del mapeo. */
export const MAPPING_FIELDS: readonly (keyof ClaimSourceMapping)[] = [
  "claim",
  "sourceUrl",
  "documentName",
  "relevantExcerpt",
  "publicationDate",
];

// ─────────────────────────────────────────────────────────────────────────────
// Paso 1 — El schema de cinco campos, todos requeridos
//
// Why: cada finding debe llevar su provenance. Sin mapeos estructurados, la
//      atribución muere durante la summarisation y el output se vuelve texto
//      plausible sin fuentes verificables.
// You should see: los cinco campos requeridos, no opcionales.
// ─────────────────────────────────────────────────────────────────────────────

/** El finding del ejercicio. */
export const DEMO_FINDING: ClaimSourceMapping = {
  claim: "Global renewable energy investment reached $495 billion in 2023",
  sourceUrl: "https://example.com/iea-report-2024",
  documentName: "IEA World Energy Investment Report 2024",
  relevantExcerpt:
    "Total investment in renewable energy technologies reached approximately $495 billion in calendar year 2023.",
  publicationDate: "2024-06-15",
};

/**
 * ¿El finding trae su provenance completa?
 *
 * @param mapping - El finding.
 * @returns `true` si los cinco campos tienen contenido.
 */
export function hasFullProvenance(mapping: ClaimSourceMapping): boolean {
  return MAPPING_FIELDS.every((field) => mapping[field].trim().length > 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 2 — Dos subagentes de investigación que emiten el schema
//
// Why: los subagentes deben emitir en el formato estructurado desde el principio.
//      Si devuelven prosa, la atribución ya se perdió antes de que empiece la
//      síntesis.
// You should see: cada subagente devuelve mapeos con los cinco campos poblados,
//      incluidas las fechas de publicación.
// ─────────────────────────────────────────────────────────────────────────────

/** El foco de cada subagente del ejercicio. */
export interface ResearchFocus {
  readonly subagent: string;
  readonly focus: string;
}

/** Los dos focos de investigación. */
export const RESEARCH_FOCUSES: readonly ResearchFocus[] = [
  { subagent: "market-data", focus: "market data and investment figures" },
  { subagent: "regulatory", focus: "regulatory developments and policy" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Paso 3 — La síntesis preserva los mapeos explícitamente
//
// Why: el paso 3 es el punto de pérdida de atribución más común. El agente de
//      síntesis comprime y parafrasea por naturaleza, destruyendo los mapeos salvo
//      que se le instruya explícitamente preservarlos.
// You should see: cada claim trazable a su fuente, con citas inline o una sección
//      de referencias.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compone el prompt de síntesis.
 *
 * La preservación solo ocurre porque el prompt dice que debe ocurrir: sin la
 * instrucción, la compresión elimina los específicos primero.
 *
 * @param findings - Los findings a sintetizar.
 * @returns El prompt con el requisito de trazabilidad.
 */
export function synthesisPrompt(findings: readonly ClaimSourceMapping[]): string {
  return [
    "Synthesise these research findings into a coherent report.",
    "",
    "CRITICAL: Every claim in your synthesis MUST include an inline citation [n] linking to the source.",
    "Preserve all source URLs, document names, and publication dates.",
    "Do NOT paraphrase away attribution. Do NOT say \"research shows\" without citing which research.",
    "",
    `Findings:\n${JSON.stringify(findings, null, 2)}`,
  ].join("\n");
}

/**
 * Verifica que la atribución sobrevivió a la síntesis.
 *
 * @param synthesis - El texto sintetizado.
 * @param findings - Los findings originales.
 * @returns Conteo de citas y claims, y la tasa de preservación.
 */
export function verifyProvenance(
  synthesis: string,
  findings: readonly ClaimSourceMapping[],
): { readonly citationCount: number; readonly claimCount: number; readonly preservationRate: number } {
  const citationCount = synthesis.match(/\[\d+\]/g)?.length ?? 0;
  const claimCount = findings.length;
  return {
    citationCount,
    claimCount,
    preservationRate: claimCount === 0 ? 1 : citationCount / claimCount,
  };
}

/**
 * Cuenta cuántas fuentes independientes sostienen un claim.
 *
 * Un finding que tres fuentes independientes acuerdan no es lo mismo que uno que
 * descansa en un solo reporte.
 *
 * @param findings - Los findings.
 * @param claim - El claim a medir.
 * @returns El número de documentos distintos que lo sostienen.
 */
export function independentSupport(
  findings: readonly ClaimSourceMapping[],
  claim: string,
): number {
  const documents = findings
    .filter((finding) => finding.claim === claim)
    .map((finding) => finding.documentName);
  return new Set(documents).size;
}

/**
 * ¿El claim está bien establecido?
 *
 * @param findings - Los findings.
 * @param claim - El claim.
 * @param threshold - El mínimo de fuentes independientes.
 * @returns `true` si supera el umbral.
 */
export function isWellEstablished(
  findings: readonly ClaimSourceMapping[],
  claim: string,
  threshold = 3,
): boolean {
  return independentSupport(findings, claim) >= threshold;
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 4 — Conflictos: anotar ambos valores, nunca elegir
//
// Why: cuando dos fuentes creíbles reportan cifras distintas, elegir una destruye
//      información y presenta falsa certeza. El examen testea que lo correcto es
//      anotar ambos con su atribución y dejar que el consumidor decida.
// You should see: un handler que detecta claims solapados con valores distintos,
//      preserva ambos con atribución completa y añade una posible explicación.
// ─────────────────────────────────────────────────────────────────────────────

/** Un valor en conflicto, con su contexto. */
interface ConflictValue {
  readonly value: string;
  readonly documentName: string;
  readonly publicationDate: string;
  /** El contexto que hace tratable el conflicto: auditado vs preliminar, etc. */
  readonly context: string;
}

/** Un grupo de claims sobre el mismo tema, con o sin conflicto. */
interface ConflictGroup {
  readonly topic: string;
  readonly conflictDetected: boolean;
  readonly values: readonly ConflictValue[];
  readonly possibleExplanation: string | null;
}

/**
 * Agrupa findings por tema y anota los conflictos.
 *
 * Nunca elige un valor en silencio: el análisis termina con el conflicto INTACTO y
 * anotado, y la resolución pertenece al coordinator o al lector, que tienen
 * contexto que el agente de análisis no tiene.
 *
 * @param findings - Los findings.
 * @param topicOf - Cómo derivar el tema de un finding.
 * @returns Los grupos, con su conflicto anotado donde corresponda.
 */
export function handleConflicts(
  findings: readonly ClaimSourceMapping[],
  topicOf: (finding: ClaimSourceMapping) => string,
): readonly ConflictGroup[] {
  const byTopic = new Map<string, ClaimSourceMapping[]>();
  for (const finding of findings) {
    const topic = topicOf(finding);
    byTopic.set(topic, [...(byTopic.get(topic) ?? []), finding]);
  }

  return [...byTopic.entries()].map(([topic, claims]) => {
    const values = claims.map((claim) => ({
      value: claim.claim,
      documentName: claim.documentName,
      publicationDate: claim.publicationDate,
      context: claim.relevantExcerpt,
    }));
    const distinctValues = new Set(claims.map((claim) => claim.claim));

    if (distinctValues.size <= 1) {
      return { topic, conflictDetected: false, values, possibleExplanation: null };
    }

    const detail = claims
      .map((claim) => `${claim.documentName} (${claim.publicationDate}): ${claim.claim}`)
      .join(" vs ");
    return {
      topic,
      conflictDetected: true,
      values,
      possibleExplanation: `Values differ. ${detail}. Difference may reflect different reporting periods or methodologies.`,
    };
  });
}

/** Cómo se leen dos cifras distintas. */
type TemporalReading = "consistent" | "trend" | "contradiction";

/**
 * Interpreta dos cifras según sus fechas.
 *
 * Números que difieren porque se midieron en momentos distintos NO están en
 * conflicto: 8% en 2023 y 12% en 2024 son crecimiento acelerando, no un
 * desacuerdo. Sin fechas, un agente no puede distinguir una tendencia de un
 * problema de calidad de dato.
 *
 * @param a - La primera cifra y su fecha.
 * @param b - La segunda cifra y su fecha.
 * @returns La lectura temporal.
 */
export function temporalReading(
  a: { readonly value: number; readonly date: string },
  b: { readonly value: number; readonly date: string },
): TemporalReading {
  if (a.value === b.value) return "consistent";
  return a.date === b.date ? "contradiction" : "trend";
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 5 — Render apropiado al contenido
//
// Why: la síntesis NO debe aplanar todo a un formato uniforme. Forzar uno solo
//      cuesta comprensión en cualquier dirección que te equivoques: una tabla
//      financiera en prosa esconde la comparación; una narrativa en bullets pierde
//      la causación.
// You should see: datos financieros en tablas, noticias en prosa, hallazgos
//      técnicos en listas.
// ─────────────────────────────────────────────────────────────────────────────

/** El tipo de contenido de una sección. */
type ContentType = "financial" | "news" | "technical";

/**
 * Detecta el tipo de contenido de un conjunto de claims.
 *
 * @param claims - Los claims de la sección.
 * @returns El tipo de contenido.
 */
export function detectContentType(claims: readonly ClaimSourceMapping[]): ContentType {
  const hasNumbers = claims.some((claim) => /[$]|\d+%|\d+\.\d+/.test(claim.claim));
  const hasTechnical = claims.some((claim) => /API|architecture|pattern|config/i.test(claim.claim));
  if (hasNumbers) return "financial";
  if (hasTechnical) return "technical";
  return "news";
}

/**
 * Renderiza una sección en el formato que su contenido pide.
 *
 * La atribución no cambia con el formato: cada render sigue ligando el claim a su
 * fuente.
 *
 * @param contentType - El tipo de contenido.
 * @param claims - Los claims.
 * @returns La sección renderizada.
 */
export function renderSection(
  contentType: ContentType,
  claims: readonly ClaimSourceMapping[],
): string {
  switch (contentType) {
    case "financial": {
      const rows = claims.map(
        (claim) =>
          `| ${claim.publicationDate.slice(0, 4)} | ${claim.claim} | ${claim.documentName} |`,
      );
      return ["| Year | Value | Source |", "|---|---|---|", ...rows].join("\n");
    }
    case "news":
      return claims
        .map((claim) => `${claim.claim} (${claim.documentName}, ${claim.publicationDate}).`)
        .join(" ");
    case "technical":
      return claims.map((claim) => `- ${claim.claim} [Source: ${claim.documentName}]`).join("\n");
    default: {
      const exhaustive: never = contentType;
      return exhaustive;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Extra — Las etapas del pipeline y dónde muere la atribución
//
// Why: la atribución tiene que sobrevivir CADA paso, y el paso 3 es donde suele
//      caer. La arquitectura de producción le da a la atribución su propio agente.
// You should see: las cuatro etapas y su riesgo.
// ─────────────────────────────────────────────────────────────────────────────

/** Las etapas del pipeline de síntesis. */
type PipelineStage = "research" | "analysis" | "synthesis" | "report_generation";

/** La descripción de cada etapa. */
export const PIPELINE_STAGES: readonly { readonly stage: PipelineStage; readonly role: string }[] = [
  { stage: "research", role: "Collects findings with claim-source mappings." },
  { stage: "analysis", role: "Evaluates findings and adds assessment, preserving the mappings." },
  { stage: "synthesis", role: "Combines findings from multiple agents, merging mappings." },
  { stage: "report_generation", role: "Produces the final output with inline citations." },
];

/**
 * ¿Es esta la etapa donde la atribución suele morir?
 *
 * El paso de síntesis es el más común: combinar y parafrasear es precisamente la
 * operación que descarta los específicos. Por eso el CitationAgent de producción
 * corre DESPUÉS de la síntesis y se dedica solo a localizar citas.
 *
 * @param stage - La etapa.
 * @returns `true` solo para la síntesis.
 */
export function isAttributionLossPoint(stage: PipelineStage): boolean {
  switch (stage) {
    case "synthesis":
      return true;
    case "research":
    case "analysis":
    case "report_generation":
      return false;
    default: {
      const exhaustive: never = stage;
      return exhaustive;
    }
  }
}

/**
 * ============================================================================
 * ✗ ANTI-PATTERN — Los errores que el examen construye
 * ============================================================================
 */

/** ✗ ANTI-PATTERN 1 — Dejar `sourceUrl` y `publicationDate` opcionales.
 *
 * Un campo opcional es como la atribución desaparece en silencio: el 40% de los
 * findings llega sin ninguno de los dos.
 */
// required: ["claim", "documentName"]  // sourceUrl opcional ⇒ se pierde

/** ✗ ANTI-PATTERN 2 — Dejar que la síntesis parafrasee sin preservar los mapeos.
 *
 * La compresión elimina los específicos primero, así que la cifra, la fuente y la
 * fecha se van antes que el claim general. Queda "investment has grown
 * significantly", y nada en eso se puede verificar.
 */
// "research shows investment grew"  // sin cifra, sin fuente, sin fecha

/** ✗ ANTI-PATTERN 3 — Elegir la fuente más reciente ante un conflicto.
 *
 * La recencia es una regla arbitraria más, junto a promediar y deferir al nombre
 * más prestigioso. Cada una descarta una medición real.
 */
// pick(newestSource);  // "a real measurement, discarded"

/** ✗ ANTI-PATTERN 4 — Asumir que números distintos son contradicciones.
 *
 * 8% y 12% parecen un desacuerdo hasta que las fechas muestran que uno midió un
 * año después del otro: ahí son una tendencia.
 */
// if (a !== b) flagConflict();  // sin fechas, una tendencia parece un problema

/** ✗ ANTI-PATTERN 5 — Renderizar todo en un formato uniforme.
 *
 * Una tabla financiera escrita en prosa esconde la comparación para la que las
 * cifras existen; una narrativa partida en bullets pierde la causación.
 */
// renderEverythingAsProse();  // la comparación y la causación se pierden

/** ✗ ANTI-PATTERN 6 — Que el análisis RESUELVA el conflicto.
 *
 * La resolución pertenece al coordinator o al lector, que tienen contexto que el
 * agente de análisis no tiene.
 */
// analysis.resolve(conflict);  // se pierde el contexto de ambas cifras

/** ✗ ANTI-PATTERN 7 — Un recovery step que re-atribuye después de la síntesis.
 *
 * Buscar una fuente que "matchee" cada claim sin atribuir y adjuntarle la que
 * encuentre es inventar provenance — el fix va en el schema, no en la recuperación.
 */
// attachBestGuessSource(claim);  // atribución inventada

/**
 * ============================================================================
 * EXAM TRAPS — distractores recurrentes y criterio de rechazo
 * ============================================================================
 *
 * | Trampa                                             | Por qué se rechaza                                  |
 * |----------------------------------------------------|-----------------------------------------------------|
 * | Elegir la fuente más reciente ante un conflicto     | Descarta una medición real con falsa certeza        |
 * | Asumir que números distintos son contradicciones    | Las fechas suelen explicarlos como tendencia        |
 * | Parafrasear sin preservar los mapeos                | La compresión elimina cifra, fuente y fecha primero |
 * | Renderizar todo en un formato uniforme              | Cada dirección pierde algo específico               |
 *
 * QUICK REFERENCE — datos de la fuente
 *
 *   Cinco campos del mapeo ... claim · source URL · document name · relevant excerpt ·
 *                              publication date
 *   Punto de pérdida más común  el paso 3 (síntesis) — la compresión descarta los
 *                              mapeos salvo que se exija preservarlos
 *   CitationAgent ............ etapa dedicada post-síntesis cuyo único trabajo es
 *                              localizar citas
 *   Source quality heuristics  guardrails a nivel de prompt contra content farms SEO
 *                              superando a fuentes autoritativas
 *   Artifact/filesystem ...... outputs de subagentes que bypassan al coordinator para
 *                              resultados grandes — preserva fidelidad, corta tokens
 *   Regla de conflicto ....... anotar ambos valores con atribución — nunca elegir
 *   Regla temporal ........... fechas distintas pueden explicar números distintos
 *                              como tendencia, no contradicción
 *   `conflict_detected` ...... campo de schema que marca un valor en conflicto, distinto
 *                              de un campo null/ausente
 *   Render apropiado ......... financiero → tablas · noticias → prosa · técnico → listas
 *   Separación de datos ...... contenido y metadata como campos distintos, no prosa
 *                              mezclada, para sobrevivir los hand-offs
 *
 * ============================================================================
 * FLUJO DE EJECUCIÓN ESPERADO  (trace ilustrativo — no se ejecuta)
 * ============================================================================
 *
 * [Paso 1] DEMO_FINDING
 *   hasFullProvenance(DEMO_FINDING) → true
 *   ✅ los cinco campos, requeridos, no opcionales
 *
 * [Paso 2] RESEARCH_FOCUSES → market-data · regulatory
 *   Cada subagente emite mapeos con fecha, no prosa
 *
 * [Paso 3] synthesisPrompt(findings)
 *   → "…CRITICAL: Every claim in your synthesis MUST include an inline citation [n]…"
 *   verifyProvenance("investment reached $495B in 2023 [1] …", [f1, f2])
 *   → { citationCount: 2, claimCount: 2, preservationRate: 1 }
 *   Sin la instrucción: "investment has grown significantly" ⇒ rate 0
 *   independentSupport(findings, claim) → 3 · isWellEstablished(findings, claim) → true
 *   ✅ un claim que tres fuentes independientes acuerdan no se presenta igual que uno solo
 *
 * [Paso 4] handleConflicts(findings, topicOf)
 *   → { topic: "market growth", conflictDetected: true,
 *       values: [ { value: "12%", documentName: "IEA World Energy Report",
 *                   publicationDate: "2024-06", context: "…" },
 *                 { value: "8%", documentName: "Bloomberg NEF Annual Review",
 *                   publicationDate: "2024-03", context: "…" } ],
 *       possibleExplanation: "…different reporting periods or methodologies." }
 *   temporalReading({ value: 8, date: "2023" }, { value: 12, date: "2024" }) → "trend"
 *   temporalReading({ value: 8, date: "2024" }, { value: 12, date: "2024" }) → "contradiction"
 *   ✅ ambos valores sobreviven; nada se elige en silencio
 *
 * [Paso 5] detectContentType([invest figures]) → "financial"
 *          renderSection("financial", claims)
 *   → "| Year | Value | Source |\n|---|---|---|\n| 2023 | … | IEA … |"
 *   detectContentType([policy news]) → "news"      → prosa
 *   detectContentType([API pattern]) → "technical" → lista
 *   ✅ el formato lo elige el contenido, no el reporte
 *
 * isAttributionLossPoint("synthesis") → true
 * isAttributionLossPoint("research")  → false
 *
 * ANTI-PATRÓN: los subagentes emiten contra un schema donde `sourceUrl` y
 * `publicationDate` son opcionales, y ~40% de los findings llegan sin ninguno. Un
 * colega propone un recovery step post-síntesis que busca una fuente que matchee
 * cada claim y le adjunta la que encuentre. Eso es inventar provenance. El fix no
 * es descartar findings ni instruir a la síntesis a preservar campos que nunca
 * llegaron: es hacer los CINCO campos requeridos en el schema de salida del
 * subagente, para que un finding no pueda emitirse sin la fuente de la que vino.
 */
