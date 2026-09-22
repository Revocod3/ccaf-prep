/**
 * ============================================================================
 * DOMINIO 1 · TASK STATEMENT 1.6 — Task Decomposition Strategies
 * ----------------------------------------------------------------------------
 * Objetivo oficial:
 *   Design task decomposition strategies for complex workflows.
 *
 * Qué evalúa el examen aquí:
 *   Meter 14 archivos en un solo prompt no es un problema de capacidad del
 *   modelo: es un problema de asignación de atención. El presupuesto de atención
 *   se reparte entre todo lo que hay en el contexto, así que los primeros
 *   archivos reciben análisis detallado y los últimos se vuelven superficiales.
 *   El fix es estructural — multi-pass: una pasada por ítem (presupuesto
 *   completo para cada archivo) más una pasada de integración cross-file. La
 *   evidencia más clara del problema son los artefactos: el mismo patrón
 *   flaggeado en un archivo y aprobado sin comentario en otro.
 *
 * Build Exercise: Build a Multi-Pass Code Review Pipeline  (Advanced · 60 min)
 * ============================================================================
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tipos del dominio
// ─────────────────────────────────────────────────────────────────────────────

/** Severidad de un hallazgo, ordenable de menor a mayor. */
type Severity = "info" | "low" | "medium" | "high";

/** Un hallazgo localizado en un archivo concreto. */
interface FileFinding {
  readonly rule: string;
  readonly severity: Severity;
  readonly line: number;
  readonly message: string;
}

/** Resultado del análisis de un único archivo. */
interface FileReview {
  readonly file: string;
  readonly findings: readonly FileFinding[];
  /** Cuánta atención efectiva recibió el archivo, en 0..1. */
  readonly depthScore: number;
}

/** Un problema que solo se ve mirando varios archivos a la vez. */
interface CrossFileFinding {
  readonly kind: "data_flow" | "api_consistency" | "pattern_consistency";
  readonly files: readonly string[];
  readonly message: string;
}

/** Comparación entre la pasada única y el pipeline multi-pass. */
interface ComparisonReport {
  readonly singlePassIssues: number;
  readonly multiPassIssues: number;
  readonly perFileCounts: readonly { readonly file: string; readonly count: number }[];
  readonly crossFileOnly: readonly CrossFileFinding[];
  readonly dilutionArtefacts: readonly string[];
}

/** Puerto al modelo: analiza un prompt y devuelve texto libre. */
interface ReviewModel {
  analyse(prompt: string): Promise<string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Selector de patrón: las dos estrategias de decomposición
//
// Why: la task statement se llama "Task Decomposition *Strategies*", y el examen
//      evalúa elegir entre las dos. Ninguna es la más avanzada: responden a
//      preguntas distintas.
// You should see: pasos conocibles de antemano → pipeline fijo; scope
//      desconocido → decomposición dinámica.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Las dos estrategias examinables.
 *
 * - `fixed_pipeline` (prompt chaining): la ruta se decide en diseño; cada paso
 *   alimenta al siguiente. Reproducible y fácil de depurar, pero nada que se
 *   descubra a mitad de camino puede cambiar el plan. Admite *gates*
 *   (chequeos programáticos) sobre la salida intermedia.
 * - `dynamic_decomposition` (orchestrator-workers): los subtemas se derivan de
 *   lo que aparece durante la ejecución. Trackea el problema en vez de una
 *   suposición, a costa de no poder predecir duración ni coste.
 */
type DecompositionPattern = "fixed_pipeline" | "dynamic_decomposition";

/**
 * Elige el patrón según si los pasos son conocibles de antemano.
 *
 * @param stepsKnownInAdvance - `true` si la ruta se puede enumerar antes de
 *      empezar (review de código, extracción de documentos, compliance).
 * @returns El patrón recomendado.
 */
export function selectDecompositionPattern(stepsKnownInAdvance: boolean): DecompositionPattern {
  return stepsKnownInAdvance ? "fixed_pipeline" : "dynamic_decomposition";
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 1 — Leer un directorio con al menos 10 archivos
//
// Why: el umbral de 10+ archivos es donde la attention dilution se vuelve
//      observable. El examen usa un ejemplo de 14.
// You should see: una función que lee todos los archivos y los prepara para
//      el análisis.
// ─────────────────────────────────────────────────────────────────────────────

/** Un archivo fuente con su contenido. */
interface SourceFile {
  readonly path: string;
  readonly content: string;
}

/** Mínimo de archivos para que el escenario sea representativo. */
const MIN_FILES_FOR_DILUTION = 10;

/**
 * Prepara un conjunto de archivos para el análisis.
 *
 * @param files - Los archivos del directorio.
 * @returns Los archivos listos para procesar.
 * @throws Si hay menos de `MIN_FILES_FOR_DILUTION` archivos.
 */
function loadDirectory(files: readonly SourceFile[]): readonly SourceFile[] {
  if (files.length < MIN_FILES_FOR_DILUTION) {
    throw new Error(
      `${files.length} files loaded; ${MIN_FILES_FOR_DILUTION} required to observe dilution.`,
    );
  }
  return files;
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 2 — Baseline: la pasada única
//
// Why: la pasada única es el baseline que demuestra la dilution. El examen
//      espera que reconozcas los síntomas.
// You should see: feedback detallado para los primeros archivos, cada vez más
//      breve o ausente para los últimos.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Revisa todos los archivos en una sola pasada.
 *
 * El presupuesto de atención se reparte entre todo el contenido, así que el
 * detalle decae a medida que avanza la lista. Se conserva como baseline para la
 * comparación; no es la implementación a usar.
 *
 * @param model - Puerto al modelo.
 * @param files - Los archivos a revisar.
 * @returns Un `FileReview` por archivo, con el `depthScore` observado.
 */
async function singlePassReview(
  model: ReviewModel,
  files: readonly SourceFile[],
): Promise<readonly FileReview[]> {
  const prompt = files
    .map((file) => `// FILE: ${file.path}\n${file.content}`)
    .join("\n\n");
  const raw = await model.analyse(`Review every file and list issues:\n${prompt}`);

  return files.map((file, index) => ({
    file: file.path,
    findings: parseFindings(raw).filter((finding) => finding.rule.startsWith(file.path)),
    // Decaimiento observable: el primer archivo recibe todo, el último casi nada.
    depthScore: Math.max(0, 1 - index / files.length),
  }));
}

/**
 * Extrae findings de la respuesta del modelo.
 *
 * @param raw - Salida en texto del modelo.
 * @returns Los findings parseados.
 */
function parseFindings(raw: string): readonly FileFinding[] {
  return raw
    .split("\n")
    .map((line) => /^(?<rule>\S+)\|(?<severity>info|low|medium|high)\|(?<line>\d+)\|(?<message>.+)$/.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({
      rule: match.groups?.rule ?? "",
      severity: (match.groups?.severity ?? "info") as Severity,
      line: Number(match.groups?.line ?? 0),
      message: match.groups?.message ?? "",
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 3 — Per-file local analysis: una pasada por archivo
//
// Why: la pasada por archivo le da a cada uno el presupuesto de atención
//      completo. Es la primera capa del multi-pass. El examen lo contrasta con la
//      pasada única: la decomposición estructural resuelve la dilution, no un
//      prompt mejor ni una ventana más grande.
// You should see: profundidad de análisis constante. El último archivo recibe el
//      mismo detalle que el primero.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Revisa un archivo con el presupuesto de atención completo.
 *
 * @param model - Puerto al modelo.
 * @param file - El archivo a revisar, ya aislado en su propio prompt.
 * @returns El resultado estructurado de ese archivo.
 */
async function reviewFile(
  model: ReviewModel,
  file: SourceFile,
): Promise<FileReview> {
  const raw = await model.analyse(
    `Review this single file. Output one line per issue as ` +
      `rule|severity|line|message (severity ∈ info|low|medium|high).\n` +
      `// FILE: ${file.path}\n${file.content}`,
  );

  const findings = parseFindings(raw).map((finding) => ({
    ...finding,
    rule: `${file.path}:${finding.rule}`,
  }));

  return { file: file.path, findings, depthScore: 1 };
}

/**
 * Revisa cada archivo en su propia pasada.
 *
 * Los archivos son independientes entre sí, así que las pasadas van en paralelo
 * con `Promise.all` sobre un `map` — nunca `forEach` con `await` dentro.
 *
 * @param model - Puerto al modelo.
 * @param files - Los archivos a revisar.
 * @returns Un `FileReview` por archivo, con profundidad uniforme.
 */
async function perFileReview(
  model: ReviewModel,
  files: readonly SourceFile[],
): Promise<readonly FileReview[]> {
  return Promise.all(files.map((file) => reviewFile(model, file)));
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 4 — Cross-file integration pass
//
// Why: las pasadas por archivo atrapan lo local pero se pierden lo transversal.
//      El examen evalúa si incluyes este pase: batchear sin él sigue dejando
//      fuera data flow y patrones inconsistentes.
// You should see: un análisis separado que toma los resúmenes y busca
//      inconsistencias de API, problemas de data flow y patrones dispares.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Busca problemas que cruzan archivos.
 *
 * Toma los resúmenes (no el contenido completo: la señal transversal ya está en
 * los patrones detectados) y los compara entre sí.
 *
 * @param model - Puerto al modelo.
 * @param reviews - Los resultados de las pasadas por archivo.
 * @returns Los hallazgos cross-file.
 */
async function crossFileIntegrationPass(
  model: ReviewModel,
  reviews: readonly FileReview[],
): Promise<readonly CrossFileFinding[]> {
  const summary = reviews
    .map((review) => `${review.file}: ${review.findings.map((f) => f.rule).join(", ")}`)
    .join("\n");
  const raw = await model.analyse(
    `Given these per-file summaries, report only cross-file issues ` +
      `(data flow, API consistency, pattern consistency):\n${summary}`,
  );
  return parseCrossFileFindings(raw);
}

/**
 * Parseo de hallazgos cross-file.
 *
 * @param raw - Salida del modelo para el pase de integración.
 * @returns Los hallazgos estructurados.
 */
function parseCrossFileFindings(raw: string): readonly CrossFileFinding[] {
  return raw
    .split("\n")
    .map((line) => /^(?<kind>data_flow|api_consistency|pattern_consistency)\|(?<files>[^|]+)\|(?<message>.+)$/.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({
      kind: (match.groups?.kind ?? "pattern_consistency") as CrossFileFinding["kind"],
      files: (match.groups?.files ?? "").split(",").map((f) => f.trim()),
      message: match.groups?.message ?? "",
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Pasos 5 y 6 — Comparar resultados y registrar artefactos de dilution
//
// Why: la comparación demuestra el argumento del examen cuantitativamente. La
//      atención dilution no es un problema de capacidad: el mismo modelo rinde
//      mejor con arquitectura multi-pass.
// You should see: más issues totales con multi-pass, recuentos consistentes
//      entre archivos, y artefactos donde idéntico código fue tratado distinto.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compara la pasada única contra el pipeline multi-pass.
 *
 * @param singlePass - Resultado del baseline.
 * @param multiPass - Resultados de las pasadas por archivo.
 * @param crossFile - Hallazgos del pase de integración.
 * @returns El informe comparativo, incluidos los artefactos de dilution.
 */
function compareResults(
  singlePass: readonly FileReview[],
  multiPass: readonly FileReview[],
  crossFile: readonly CrossFileFinding[],
): ComparisonReport {
  return {
    singlePassIssues: singlePass.reduce((sum, r) => sum + r.findings.length, 0),
    multiPassIssues: multiPass.reduce((sum, r) => sum + r.findings.length, 0),
    perFileCounts: multiPass.map((r) => ({ file: r.file, count: r.findings.length })),
    crossFileOnly: crossFile,
    dilutionArtefacts: findDilutionArtefacts(singlePass),
  };
}

/**
 * Detecta artefactos de attention dilution.
 *
 * Un artefacto es un patrón flaggeado en un archivo y aprobado sin comentario en
 * otro — el ejemplo canónico del examen es `forEach` marcado como ineficiente en
 * File 3 y aprobado en File 11.
 *
 * @param singlePass - Resultado del baseline.
 * @returns Descripciones de los artefactos encontrados.
 */
function findDilutionArtefacts(singlePass: readonly FileReview[]): readonly string[] {
  // En el baseline, los archivos tempranos acumulan reglas y los tardíos no.
  const byRule = new Map<string, string[]>();
  for (const review of singlePass) {
    for (const finding of review.findings) {
      const rule = finding.rule.split(":").at(-1) ?? finding.rule;
      byRule.set(rule, [...(byRule.get(rule) ?? []), review.file]);
    }
  }

  return [...byRule.entries()]
    .filter(([, files]) => files.length === 1)
    .map(
      ([rule, files]) =>
        `"${rule}" flagged only in ${files[0]} — identical usage elsewhere was not reviewed.`,
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Escenario
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Corre el pipeline completo sobre un directorio.
 *
 * @param model - Puerto al modelo.
 * @param files - Los archivos a revisar.
 * @returns El informe comparativo.
 */
export async function runPipeline(
  model: ReviewModel,
  files: readonly SourceFile[],
): Promise<ComparisonReport> {
  const loaded = loadDirectory(files);
  const singlePass = await singlePassReview(model, loaded);
  const multiPass = await perFileReview(model, loaded);
  const crossFile = await crossFileIntegrationPass(model, multiPass);
  return compareResults(singlePass, multiPass, crossFile);
}

/**
 * ============================================================================
 * ✗ ANTI-PATTERN — Batchear sin integración, o "arreglarlo" con prompt/ventana
 * ============================================================================
 */

/** ✗ ANTI-PATTERN 1 — Un solo prompt enorme con todos los archivos.
 *
 * Es el bug original disfrazado de implementación. Más contexto no redistribuye
 * la atención: el último archivo sigue recibiendo las sobras.
 */
// const oneShot = await model.analyse(files.map(f => f.content).join("\n"));

/** ✗ ANTI-PATTERN 2 — Multi-pass sin pase de integración.
 *
 * Cada archivo se analiza bien, pero los problemas que cruzan archivos —data
 * flow, contratos de API rotos, patrones inconsistentes— no viven en ningún
 * archivo individual: nadie los ve.
 */
// for (const file of files) await reviewFile(model, file);  // falta cross-file

/** ✗ ANTI-PATTERN 3 — `forEach` con `await` dentro.
 *
 * `forEach` ignora el valor de retorno del callback async: el loop retorna antes
 * de que termine cualquier análisis, y los errores se pierden. Usa `for...of` o
 * `Promise.all(map(...))`.
 */
// files.forEach(async (file) => { await reviewFile(model, file); });  // no espera

/** ✗ ANTI-PATTERN 4 — Atribuir la dilution a la capacidad del modelo.
 *
 * "Es un modelo chico, necesita uno más grande" es el diagnóstico equivocado. El
 * mismo modelo rinde bien cuando la tarea se decompone estructuralmente.
 */
// model: "claude-opus-5"  // no arregla un problema de asignación de atención

/**
 * ============================================================================
 * EXAM TRAPS
 * ============================================================================
 *
 * | Trampa                                      | Criterio de rechazo                                  |
 * |---------------------------------------------|------------------------------------------------------|
 * | Un archivo gigante de una sola pasada        | Presupuesto de atención repartido ⇒ decaimiento      |
 * | Batching sin pase de integración             | Los problemas cross-file no viven en un archivo      |
 * | "Necesita un modelo más grande"              | Es arquitectura, no capacidad                        |
 * | `forEach` con callback async                 | No espera; secuencia y errores se pierden            |
 * | Ignorar patrones contradictorios             | Es la evidencia más clara de dilution                |
 * | Fixed pipeline para investigación abierta    | La ruta precede a la evidencia que la definiría      |
 * | Decomposición dinámica para trabajo rutinario| Un plan fijo sería más reproducible y barato         |
 *
 * QUICK REFERENCE — los patrones y sus nombres formales
 *
 *   fixed sequential pipeline  → "prompt chaining". La ruta se fija en diseño;
 *     cada LLM call procesa la salida de la anterior. Objetivo: cambiar latencia
 *     por precisión haciendo cada paso más fácil. Admite "gates" (chequeos
 *     programáticos) sobre la salida intermedia.
 *   dynamic adaptive decomposition → "orchestrator-workers". Los subtemas los
 *     determina el orchestrator, no vienen predefinidos.
 *
 *   Selección: pasos conocibles de antemano → fixed pipeline (review multi-file,
 *   extracción de documentos). Scope desconocido → dinámico (explorar un sistema
 *   heredado, auditar seguridad, debugging de código ajeno).
 *
 *   Otros patrones nombrados que el examen puede mencionar:
 *     - Routing: clasifica la entrada y la dirige a un follow-up especializado.
 *     - Parallelization · sectioning: subtareas independientes en paralelo.
 *     - Parallelization · voting: la misma tarea varias veces, salidas diversas.
 *     - Evaluator-optimizer: un call genera, otro evalúa y da feedback en loop.
 *
 *   La decomposición adaptativa necesita: ground truth del entorno en cada paso
 *   (tool results, tests, contenido real) y una stopping condition (p. ej. máximo
 *   de iteraciones) como cota de seguridad, separada de la detección de fin.
 *
 *   Simplicity first: encontrar la solución más simple; un solo LLM call con
 *   retrieval suele bastar. No añadir maquinaria de decomposición sin necesidad.
 *
 * ============================================================================
 * FLUJO DE EJECUCIÓN ESPERADO  (trace ilustrativo — no se ejecuta)
 * ============================================================================
 *
 * loadDirectory(files) → 14 archivos  (≥ MIN_FILES_FOR_DILUTION = 10)
 *
 * ── Baseline: singlePassReview() ─────────────────────────────────────────────
 *   File 1  findings: 5  depth 1.00  ●●●●●   ← detalle con líneas exactas
 *   File 2  findings: 5  depth 0.93  ●●●●●
 *   File 3  findings: 4  depth 0.86  ●●●●    ← flaggea forEach
 *   ...
 *   File 11 findings: 0  depth 0.21  ○○○○○   ← mismo forEach, sin comentario ★
 *   ...
 *   File 14 findings: 0  depth 0.07  ○○○○○
 *   total single-pass issues: 21
 *
 * ── Multi-pass: perFileReview() [paralelo] ───────────────────────────────────
 *   File 1  findings: 5  depth 1.00  ●●●●●
 *   File 2  findings: 5  depth 1.00  ●●●●●
 *   File 3  findings: 5  depth 1.00  ●●●●●
 *   ...
 *   File 11 findings: 5  depth 1.00  ●●●●●   ← mismo forEach, mismo veredicto
 *   ...
 *   File 14 findings: 5  depth 1.00  ●●●●●   ← sin drop-off
 *   total multi-pass issues: 70
 *
 * ── Cross-file: crossFileIntegrationPass() ───────────────────────────────────
 *   data_flow|File 4,File 9|response shape differs between caller and callee
 *   api_consistency|File 2,File 11|v1 and v2 client used for the same service
 *   pattern_consistency|File 3,File 11|identical forEach handled differently  ★
 *
 * ── compareResults() ─────────────────────────────────────────────────────────
 *   singlePassIssues : 21
 *   multiPassIssues  : 70
 *   perFileCounts    : [5,5,5,5,5,5,5,5,5,5,5,5,5,5]   ← plano, sin decaimiento
 *   crossFileOnly    : 3 issues
 *   dilutionArtefacts: ["forEach flagged only in File 3 — identical usage in
 *                       File 11 was not reviewed."]
 *
 * ANTI-PATRÓN (solo per-file, sin integración):
 *   multiPassIssues  : 70
 *   crossFileOnly    : []      ← los 3 problemas transversales no se ven
 *   forEach sigue inconsistente entre File 3 y File 11 en el informe final
 */

export {};
