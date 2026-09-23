/**
 * ============================================================================
 * DOMINIO 5 · TASK STATEMENT 5.5 — Human Review & Confidence Calibration
 * ----------------------------------------------------------------------------
 * Objetivo oficial:
 *   Design human review workflows and confidence calibration.
 *
 * Qué evalúa el examen aquí:
 *   La review humana es lo que se interpone entre un sistema de extracción
 *   automática y sus errores. La pregunta evaluable no es SI usar reviewers, sino
 *   cómo gastar una cantidad FIJA de su atención para lograr la mayor accuracy.
 *   Eso depende de tres cosas: desconfiar de los agregados (un 97% global puede
 *   tapar un 45% en formatos internacionales), calibrar la confianza contra sets
 *   etiquetados, y muestrear en estratos — incluido el estrato de alta confianza,
 *   que es el punto ciego.
 *
 * Build Exercise: Build a Confidence-Calibrated Review Router  (Advanced · 50 min)
 * ============================================================================
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tipos de la extracción y del review
// ─────────────────────────────────────────────────────────────────────────────

/** Los cuatro tipos de documento del ejercicio. */
type DocumentType = "invoice" | "receipt" | "scanned_pdf" | "international";

/** Los tres campos extraídos. */
type FieldName = "vendor_name" | "date" | "amount";

/** Los campos, en orden. */
export const FIELD_NAMES: readonly FieldName[] = ["vendor_name", "date", "amount"];

/** Un campo extraído, con su confianza auto-reportada. */
interface FieldExtraction {
  readonly value: string;
  readonly confidence: number;
}

/** Una extracción completa. */
interface Extraction {
  readonly id: string;
  readonly documentType: DocumentType;
  readonly fields: Readonly<Record<FieldName, FieldExtraction>>;
}

/** El ground truth: la extracción correcta, que ya conocemos. */
type GroundTruth = Readonly<Record<string, Readonly<Record<FieldName, string>>>>;

// ─────────────────────────────────────────────────────────────────────────────
// Paso 1 — Extracción mock con confianza por campo
//
// Why: la confianza a nivel de campo es la base del ruteo inteligente. El examen
//      testea que la confianza cruda NO está calibrada y debe validarse contra
//      ground truth antes de usarse.
// You should see: cada campo con su valor y un score 0.0-1.0, en al menos cuatro
//      tipos de documento con distribuciones visiblemente distintas.
// ─────────────────────────────────────────────────────────────────────────────

/** La confianza base por tipo y campo — nota la dispersión entre filas. */
export const CONFIDENCE_BY_TYPE: Readonly<
  Record<DocumentType, Readonly<Record<FieldName, number>>>
> = {
  invoice: { vendor_name: 0.98, date: 0.95, amount: 0.97 },
  receipt: { vendor_name: 0.71, date: 0.6, amount: 0.55 },
  scanned_pdf: { vendor_name: 0.8, date: 0.72, amount: 0.69 },
  international: { vendor_name: 0.63, date: 0.45, amount: 0.52 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Paso 2 — Accuracy por tipo de documento Y campo, no agregada
//
// Why: la trampa de las métricas agregadas es el malentendido más peligroso en
//      producción. Un 97% global puede tapar tasas catastróficas en tipos
//      concretos, porque las facturas estándar dominan el volumen.
// You should see: una tabla con cada combinación tipo×campo por separado; el
//      agregado se ve excelente pese a los números pobres por tipo.
// ─────────────────────────────────────────────────────────────────────────────

/** Accuracy de una combinación documento×campo. */
interface AccuracyCell {
  readonly documentType: DocumentType;
  readonly field: FieldName;
  readonly correct: number;
  readonly total: number;
  readonly accuracy: number;
}

/**
 * Calcula la accuracy por tipo de documento y campo.
 *
 * @param extractions - Las extracciones.
 * @param groundTruth - La verdad conocida.
 * @returns Una celda por combinación.
 */
export function accuracyByTypeAndField(
  extractions: readonly Extraction[],
  groundTruth: GroundTruth,
): readonly AccuracyCell[] {
  const cells: AccuracyCell[] = [];

  for (const documentType of Object.keys(CONFIDENCE_BY_TYPE) as DocumentType[]) {
    for (const field of FIELD_NAMES) {
      const relevant = extractions.filter((item) => item.documentType === documentType);
      const correct = relevant.filter(
        (item) => item.fields[field].value === groundTruth[item.id]?.[field],
      ).length;
      cells.push({
        documentType,
        field,
        correct,
        total: relevant.length,
        accuracy: relevant.length === 0 ? 0 : correct / relevant.length,
      });
    }
  }
  return cells;
}

/**
 * El agregado ponderado por volumen.
 *
 * Un promedio esconde sus peores componentes por construcción: el segmento de
 * alto volumen y alta accuracy tira el promedio hacia arriba.
 *
 * @param cells - Las celdas por segmento.
 * @returns La accuracy agregada.
 */
export function aggregateAccuracy(cells: readonly AccuracyCell[]): number {
  const total = cells.reduce((sum, cell) => sum + cell.total, 0);
  if (total === 0) return 0;
  const correct = cells.reduce((sum, cell) => sum + cell.correct, 0);
  return correct / total;
}

/**
 * Los segmentos que el agregado esconde.
 *
 * @param cells - Las celdas.
 * @param threshold - La accuracy por debajo de la cual el segmento es débil.
 * @returns Las celdas que nadie firmaría si las viera por separado.
 */
export function hiddenWeakSegments(
  cells: readonly AccuracyCell[],
  threshold: number,
): readonly AccuracyCell[] {
  return cells.filter((cell) => cell.total > 0 && cell.accuracy < threshold);
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 3 — Calibrar la confianza contra un set etiquetado
//
// Why: los scores crudos no son tasas de accuracy. Un 0.90 puede ser 94% en fechas
//      y 82% en montos: el mismo score significa cosas distintas según el campo, y
//      por eso un umbral sin calibrar no se puede aplicar entre campos.
// You should see: una curva por tipo×campo que mapea rangos de confianza a la
//      accuracy real.
// ─────────────────────────────────────────────────────────────────────────────

/** Una celda de la curva: banda de confianza → accuracy real. */
interface CalibrationCell {
  readonly documentType: DocumentType;
  readonly field: FieldName;
  readonly band: number;
  readonly accuracy: number;
  readonly total: number;
}

/**
 * La banda de confianza (0.0, 0.1, … 0.9).
 *
 * @param confidence - La confianza reportada.
 * @returns La banda, truncada al décimo.
 */
export function confidenceBand(confidence: number): number {
  return Math.floor(confidence * 10) / 10;
}

/**
 * Construye la curva de calibración.
 *
 * @param extractions - Las extracciones del set etiquetado.
 * @param groundTruth - La verdad conocida.
 * @returns Una celda por tipo×campo×banda.
 */
export function buildCalibration(
  extractions: readonly Extraction[],
  groundTruth: GroundTruth,
): readonly CalibrationCell[] {
  const cells: CalibrationCell[] = [];

  for (const documentType of Object.keys(CONFIDENCE_BY_TYPE) as DocumentType[]) {
    for (const field of FIELD_NAMES) {
      const bands = new Map<number, { correct: number; total: number }>();
      for (const item of extractions) {
        if (item.documentType !== documentType) continue;
        const band = confidenceBand(item.fields[field].confidence);
        const counts = bands.get(band) ?? { correct: 0, total: 0 };
        counts.total += 1;
        if (item.fields[field].value === groundTruth[item.id]?.[field]) counts.correct += 1;
        bands.set(band, counts);
      }
      for (const [band, counts] of bands) {
        cells.push({
          documentType,
          field,
          band,
          accuracy: counts.correct / counts.total,
          total: counts.total,
        });
      }
    }
  }
  return cells;
}

/**
 * Qué significa realmente un score crudo.
 *
 * @param calibration - La curva.
 * @param documentType - El tipo de documento.
 * @param field - El campo.
 * @param rawConfidence - El score reportado.
 * @returns La accuracy real esperada, o el score crudo si no hay datos.
 */
export function calibratedConfidence(
  calibration: readonly CalibrationCell[],
  documentType: DocumentType,
  field: FieldName,
  rawConfidence: number,
): number {
  const band = confidenceBand(rawConfidence);
  const cell = calibration.find(
    (candidate) =>
      candidate.documentType === documentType &&
      candidate.field === field &&
      candidate.band === band,
  );
  return cell?.accuracy ?? rawConfidence;
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 4 — Muestreo estratificado, incluida la alta confianza
//
// Why: las extracciones de alta confianza corren sin review. Si el modelo
//      desarrolla un patrón de error nuevo ahí, solo el muestreo estratificado lo
//      atrapa. Muestrear solo las de baja confianza no enseña nada nuevo, porque
//      un reviewer ya ve cada una de esas.
// You should see: una muestra representativa de CADA estrato (tipo×banda),
//      incluidas las de alta confianza automatizadas.
// ─────────────────────────────────────────────────────────────────────────────

/** Un item muestreado, con su estrato. */
interface SampleItem {
  readonly id: string;
  readonly stratum: string;
}

/**
 * Muestrea por estrato, con un piso por estrato.
 *
 * El piso importa: un tipo de documento con menos del 2% del volumen recibe cero
 * muestras con un muestreo puramente proporcional, así que un error sistemático
 * ahí puede correr seis meses sin detectarse.
 *
 * @param extractions - Las extracciones.
 * @param sampleRate - La tasa proporcional.
 * @param minPerStratum - El mínimo de items por estrato.
 * @returns Los items muestreados.
 */
export function stratifiedSample(
  extractions: readonly Extraction[],
  sampleRate: number,
  minPerStratum: number,
): readonly SampleItem[] {
  const strata = new Map<string, Extraction[]>();
  for (const item of extractions) {
    const band = item.fields.amount.confidence >= 0.8 ? "high" : "low";
    const key = `${item.documentType}-${band}`;
    strata.set(key, [...(strata.get(key) ?? []), item]);
  }

  const sample: SampleItem[] = [];
  for (const [stratum, items] of strata) {
    const count = Math.max(minPerStratum, Math.ceil(items.length * sampleRate));
    sample.push(...items.slice(0, count).map((item) => ({ id: item.id, stratum })));
  }
  return sample;
}

/**
 * ¿El muestreo cubre el estrato de alta confianza?
 *
 * Es el punto ciego: el único lugar donde un patrón de error nuevo puede
 * establecerse sin que nadie lo vea.
 *
 * @param sample - La muestra.
 * @returns `true` si hay al menos un item de un estrato de alta confianza.
 */
export function samplesAutomatedStream(sample: readonly SampleItem[]): boolean {
  return sample.some((item) => item.stratum.endsWith("-high"));
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 5 — Router de review con prioridad por incertidumbre
//
// Why: la capacidad de review es finita y cara. Repartirla por igual gasta
//      atención confirmando lo que el modelo ya hace bien, y el déficit cae justo
//      donde se necesitaba criterio.
// You should see: una cola que ordena por incertidumbre y se reordena al llegar
//      items nuevos; nunca sirve en orden cronológico.
// ─────────────────────────────────────────────────────────────────────────────

/** Un item en la cola de review. */
interface QueuedItem {
  readonly id: string;
  readonly calibratedConfidence: number;
}

/**
 * Encola un item manteniendo el orden por incertidumbre.
 *
 * @param queue - La cola actual.
 * @param item - El item a añadir.
 * @returns La cola reordenada (menor confianza calibrada primero).
 */
export function enqueue(queue: readonly QueuedItem[], item: QueuedItem): readonly QueuedItem[] {
  return [...queue, item].sort((a, b) => a.calibratedConfidence - b.calibratedConfidence);
}

/**
 * Sirve el siguiente item al reviewer.
 *
 * El siguiente item es siempre el más incierto pendiente, no el que llegó primero.
 *
 * @param queue - La cola.
 * @returns El item servido y la cola restante.
 */
export function nextForReview(
  queue: readonly QueuedItem[],
): { readonly item: QueuedItem | undefined; readonly rest: readonly QueuedItem[] } {
  const item = queue[0];
  return { item, rest: queue.slice(1) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Extra — La secuencia de validación antes de automatizar
//
// Why: el orden importa y cada paso existe porque sin él ocurre un fallo concreto.
//      Saltar al último sobre la base de un agregado es la trampa.
// You should see: la secuencia completa y la condición para reducir review.
// ─────────────────────────────────────────────────────────────────────────────

/** Los pasos de la validación, en orden. */
type ValidationStep =
  | "measure_by_type_and_field"
  | "calibrate_confidence"
  | "set_thresholds"
  | "stratified_sampling"
  | "reduce_review";

/** La secuencia completa. */
export const VALIDATION_SEQUENCE: readonly ValidationStep[] = [
  "measure_by_type_and_field",
  "calibrate_confidence",
  "set_thresholds",
  "stratified_sampling",
  "reduce_review",
];

/**
 * ¿Se puede ya reducir la review?
 *
 * Solo tras completar los cuatro pasos previos, y solo en los segmentos cuya
 * accuracy aguantó todo lo anterior.
 *
 * @param completed - Los pasos completados.
 * @returns `true` si el último paso está desbloqueado.
 */
export function canReduceReview(completed: readonly ValidationStep[]): boolean {
  return VALIDATION_SEQUENCE.slice(0, 4).every((step) => completed.includes(step));
}

/**
 * Rutea una extracción según su confianza CALIBRADA.
 *
 * @param input - La confianza calibrada y el umbral.
 * @returns El destino del item.
 */
export function routeExtraction(input: {
  readonly calibratedConfidence: number;
  readonly threshold: number;
}): "automate" | "review" | "review_front_of_queue" {
  if (input.calibratedConfidence >= input.threshold + 0.05) return "automate";
  if (input.calibratedConfidence >= input.threshold) return "review_front_of_queue";
  return "review";
}

/**
 * ============================================================================
 * ✗ ANTI-PATTERN — Los errores que el examen construye
 * ============================================================================
 */

/** ✗ ANTI-PATTERN 1 — Automatizar todo sobre la base del agregado.
 *
 * Un promedio está dominado por lo que lleva el volumen, así que un titular fuerte
 * puede apoyarse en 45% para formatos internacionales y 60% para recibos
 * manuscritos — y esos suelen ser los documentos donde un error cuesta más.
 */
// if (aggregate === 0.97) automateAllHighConfidence();  // esconde 45% en un segmento

/** ✗ ANTI-PATTERN 2 — Muestrear solo las extracciones de baja confianza.
 *
 * Esas ya llegan a un reviewer, así que muestrearlas no enseña nada nuevo. El
 * stream automatizado de alta confianza es el que corre sin observar.
 */
// sample(extractions.filter((e) => e.confidence < 0.8));  // punto ciego intacto

/** ✗ ANTI-PATTERN 3 — Umbral crudo sin calibrar, aplicado entre campos.
 *
 * 0.90 puede significar 94% en fechas y 82% en montos: automatiza uno y sobrerrevisa
 * el otro.
 */
// if (field.confidence >= 0.9) automate();  // mismo score, distinto significado

/** ✗ ANTI-PATTERN 4 — Repartir la capacidad de review por igual.
 *
 * La asignación uniforme gasta tiempo confirmando lo que el modelo ya acierta y
 * deja demasiado poco para los casos inciertos donde un humano cambia el resultado.
 */
// distributeEvenly(reviewers, extractions);  // los inciertos quedan sin revisar

/** ✗ ANTI-PATTERN 5 — Saltar pasos de la secuencia.
 *
 * Cada paso anterior existe porque sin él ocurre un fallo específico — y cada uno
 * es saltable, que es lo que hace tentador el atajo.
 */
// reduceReview();  // sin medir por segmento, ni calibrar, ni muestrear

/** ✗ ANTI-PATTERN 6 — Confiar solo en evals automáticos.
 *
 * "People testing agents find edge cases that evals miss… manual testing remains
 * essential." La auto-evaluación del modelo no sustituye el ground truth verificado
 * por humanos sobre una muestra genuina.
 */
// trustJudgeScore();  // sin sampling humano de la alta confianza

/** ✗ ANTI-PATTERN 7 — Muestreo proporcional sin piso por estrato.
 *
 * Un tipo con menos del 2% del volumen recibe cero muestras, así que un error
 * sistemático ahí corre meses sin detectarse.
 */
// sampleRate * volumePerType;  // el tipo minoritario recibe 0 items

/**
 * ============================================================================
 * EXAM TRAPS — distractores recurrentes y criterio de rechazo
 * ============================================================================
 *
 * | Trampa                                             | Por qué se rechaza                                  |
 * |----------------------------------------------------|-----------------------------------------------------|
 * | Agregado (97%) para automatizar todo                | Esconde 45-60% en tipos que importan                 |
 * | Muestrear solo la baja confianza                    | Esas ya se revisan; el punto ciego es la alta        |
 * | Scores crudos sin calibrar                          | 0.90 = 94% en fechas, 82% en montos                  |
 * | Repartir la capacidad de review por igual           | Gasta atención confirmando lo que ya se hace bien    |
 *
 * QUICK REFERENCE — datos de la fuente
 *
 *   Trampa del agregado ....... 97% global puede tapar 40-60% en tipos concretos
 *   Secuencia de validación ... medir por tipo+campo → calibrar → fijar umbrales →
 *                                muestreo estratificado → recién entonces reducir review
 *   El muestreo DEBE incluir .. extracciones de alta confianza (automatizadas)
 *   Por qué muestrear la alta . es el punto ciego; un patrón nuevo ahí pasa inadvertido
 *   Calibración requiere ...... sets etiquetados (ground truth), mapeando confianza
 *                                reportada a accuracy real
 *   Plantilla LLM-as-judge .... un call, score 0.0-1.0 + pass/fail — lo más consistente a escala
 *   Dimensiones de rúbrica ..... factual accuracy, citation accuracy, completeness,
 *                                source quality, tool efficiency
 *   Rol del testing humano .... atrapa edge cases que los evals y la autoconfianza se pierden
 *   Campo detected_pattern .... etiqueta qué disparó un finding; permite analizar descartes
 *   Regla de capacidad ........ rutea la mayor incertidumbre primero; nunca repartas por igual
 *
 * ============================================================================
 * FLUJO DE EJECUCIÓN ESPERADO  (trace ilustrativo — no se ejecuta)
 * ============================================================================
 *
 * [Paso 1] CONFIDENCE_BY_TYPE
 *   invoice       → vendor 0.98 · date 0.95 · amount 0.97
 *   receipt       → vendor 0.71 · date 0.60 · amount 0.55
 *   scanned_pdf   → vendor 0.80 · date 0.72 · amount 0.69
 *   international → vendor 0.63 · date 0.45 · amount 0.52
 *
 * [Paso 2] aggregateAccuracy(cells) → 0.970
 *          hiddenWeakSegments(cells, 0.7)
 *          → [ international/date 0.452, international/amount 0.521,
 *              receipt/amount 0.553, receipt/date 0.601 ]
 *          ✅ el 97% se apoya en las facturas, que llevan el volumen
 *
 * [Paso 3] calibratedConfidence(calibration, "invoice", "date", 0.90) → 0.94
 *          calibratedConfidence(calibration, "invoice", "amount", 0.90) → 0.82
 *          ✅ mismo score, distinto significado: un umbral único no sirve
 *
 * [Paso 4] stratifiedSample(extractions, 0.05, minPerStratum = 10)
 *   → incluye estratos "…-high" aunque su volumen sea mínimo
 *   samplesAutomatedStream(sample) → true
 *   ✅ el stream automatizado deja de ser un punto ciego
 *
 * [Paso 5] enqueue(queue, { id: "e-7", calibratedConfidence: 0.55 })
 *   → cola ordenada con 0.55 al frente
 *   nextForReview(queue) → { item: el de 0.55, rest: … }
 *   ✅ el siguiente item es el más incierto pendiente, no el que llegó primero
 *
 * canReduceReview([...4 primeros]) → true
 * canReduceReview([aggregateOnly]) → false
 * routeExtraction({ calibratedConfidence: 0.86, threshold: 0.85 }) → "review_front_of_queue"
 * routeExtraction({ calibratedConfidence: 0.55, threshold: 0.85 }) → "review"
 *
 * ANTI-PATRÓN: el pipeline samplea el 5% del stream automatizado en proporción al
 * tipo de documento. Las facturas estándar son el 82% del volumen y los formatos
 * internacionales menos del 2%: seis meses de muestreo no produjeron ningún finding
 * en internacionales, y una auditoría de proveedores acaba de encontrar un error
 * sistemático de formato de fecha corriendo por ahí. El fix no es enrutar todo lo
 * internacional a review ni subir la tasa global al 15%: es poner un PISO por
 * estrato, para que cada tipo de documento aporte un mínimo de items muestreados
 * sea cual sea su parte del volumen.
 */
