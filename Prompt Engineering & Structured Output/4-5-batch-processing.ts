/**
 * ============================================================================
 * DOMINIO 4 · TASK STATEMENT 4.5 — Batch Processing Strategies
 * ----------------------------------------------------------------------------
 * Objetivo oficial:
 *   Design efficient batch processing strategies.
 *
 * Qué evalúa el examen aquí:
 *   La Message Batches API compra throughput con descuento, sujeto a límites que
 *   no se negocian. La skill evaluable es reconocer qué workloads caben dentro de
 *   esos límites y cuáles no. El más testeado es la **regla de emparejamiento**:
 *   la API síncrona para todo lo que se espera, batch para lo que se consume en el
 *   horario de otro. El ahorro del 50% es real y **no aplica al trabajo que
 *   bloquea a una persona**. Y aparte: los resultados no vuelven en orden, así que
 *   siempre se empareja por `custom_id`.
 *
 * Build Exercise: Design a Batch Processing Strategy  (Intermediate · 45 min)
 * ============================================================================
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tipos del contrato de batch
// ─────────────────────────────────────────────────────────────────────────────

/** Las dos vías: la síncrona que responde ya, la batch que responde en un día. */
type ApiChoice = "synchronous" | "batch";

/** Cómo se clasifica un workflow de la organización. */
interface Workflow {
  readonly name: string;
  readonly api: ApiChoice;
  readonly reason: string;
}

/** Un documento a procesar. */
interface BatchDocument {
  readonly id: string;
  readonly type: string;
  readonly content: string;
}

/** Una entrada de un batch. */
interface BatchRequest {
  readonly custom_id: string;
  readonly params: {
    readonly model: string;
    readonly max_tokens: number;
    readonly messages: readonly { readonly role: "user"; readonly content: string }[];
  };
}

/** Los cuatro tipos de resultado; solo uno se cobra. */
type BatchResultType = "succeeded" | "errored" | "canceled" | "expired";

/** Una entrada del archivo de resultados. */
interface BatchResultEntry {
  readonly custom_id: string;
  readonly result: BatchResultType;
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 1 — Clasificar 5 workflows: bloqueante vs tolerante a latencia
//
// Why: la regla de emparejamiento es el concepto más testeado de la task
//      statement. El examen propone mover TODO a batch para capturar el ahorro, y
//      la respuesta que puntúa mantiene lo bloqueante en síncrono.
// You should see: una tabla con 5 workflows, cada uno con su justificación.
// ─────────────────────────────────────────────────────────────────────────────

/** La clasificación del ejercicio. */
export const WORKFLOW_CLASSIFICATION: readonly Workflow[] = [
  {
    name: "Pre-merge code review",
    api: "synchronous",
    reason: "A developer is blocked pending merge approval.",
  },
  {
    name: "Weekly technical debt report",
    api: "batch",
    reason: "Consumed Monday morning, no real-time dependency.",
  },
  {
    name: "Real-time customer support",
    api: "synchronous",
    reason: "A customer is waiting for the response.",
  },
  {
    name: "Nightly test generation",
    api: "batch",
    reason: "Results are consumed the next business day.",
  },
  {
    name: "Overnight document extraction",
    api: "batch",
    reason: "Results feed a morning batch process.",
  },
];

/**
 * Elige la vía según quién espera.
 *
 * La pregunta que divide es si una persona o un merge está bloqueado en la
 * respuesta — **incluido un job automatizado con cutoff fijo**. Si además la
 * corrida necesita ejecutar una tool a mitad y continuar, ni siquiera es un
 * candidato: el batch no puede.
 *
 * @param input - Si algo aguas abajo espera, y si hace falta una client tool mid-request.
 * @returns La vía correcta.
 */
export function chooseApi(input: {
  readonly downstreamWaits: boolean;
  readonly needsClientToolMidRequest: boolean;
}): ApiChoice {
  if (input.needsClientToolMidRequest) return "synchronous";
  return input.downstreamWaits ? "synchronous" : "batch";
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 2 — Un batch de 20 documentos con `custom_id` únicos
//
// Why: los `custom_id` son el mecanismo para correlacionar request y response.
//      Sin identificadores únicos no puedes determinar qué documentos fallaron, y
//      el manejo de fallos se vuelve imposible.
// You should see: un batch con 20 entradas, cada una con su `custom_id`, modelo,
//      `max_tokens` y el contenido del documento.
// ─────────────────────────────────────────────────────────────────────────────

/** Formato del `custom_id`: 1-64 caracteres alfanuméricos, guiones o underscores. */
export const CUSTOM_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/** Cap de un batch: 100.000 requests O 256 MB, lo primero que se alcance. */
export const BATCH_MAX_REQUESTS = 100_000;

/** Cap de tamaño; superarlo devuelve un 413 `request_too_large`. */
export const BATCH_MAX_BYTES = 256 * 1024 * 1024;

/**
 * Construye las entradas del batch.
 *
 * @param documents - Los documentos a procesar.
 * @returns Las entradas, con `custom_id` que codifica tipo e índice.
 */
export function buildBatchRequests(documents: readonly BatchDocument[]): readonly BatchRequest[] {
  return documents.map((document, index) => ({
    custom_id: `${document.id}-${index.toString().padStart(3, "0")}`,
    params: {
      model: "claude-sonnet-5",
      max_tokens: 4096,
      messages: [{ role: "user", content: document.content }],
    },
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 3 — Manejo de fallos: solo los fallidos, con su modificación
//
// Why: reenviar solo los fallos con una modificación dirigida es el patrón
//      correcto. Reenviar todo paga dos veces por lo que ya funcionó. El examen
//      testea que entiendas la correlación por `custom_id` y el retry dirigido.
// You should see: el handler que filtra por estado, extrae los `custom_id`
//      fallidos, busca los documentos y arma un retry con `max_tokens` mayor o
//      contenido troceado.
// ─────────────────────────────────────────────────────────────────────────────

/** El estado de procesamiento de un batch. */
type ProcessingStatus = "in_progress" | "canceling" | "ended";

/** Los tres estados, en el orden documentado. */
export const PROCESSING_STATUSES: readonly ProcessingStatus[] = [
  "in_progress",
  "canceling",
  "ended",
];

/** Parámetros que el batch RECHAZA con un error de validación. */
export const REJECTED_BATCH_PARAMS: readonly string[] = [
  "stream: true",
  "Threads store",
  "previous_thread_event_id",
];

/**
 * Los `custom_id` de las entradas que fallaron.
 *
 * @param entries - Las entradas del archivo de resultados.
 * @returns Los identificadores a reintentar.
 */
export function failedIds(entries: readonly BatchResultEntry[]): readonly string[] {
  return entries
    .filter((entry) => entry.result === "errored")
    .map((entry) => entry.custom_id);
}

/**
 * Empareja resultados por `custom_id`, nunca por posición.
 *
 * Los resultados pueden volver en cualquier orden y no necesariamente coinciden
 * con el orden de los requests. Emparejar por posición asocia doc-001 con el
 * resultado de doc-003 — una mala atribución silenciosa.
 *
 * @param entries - Las entradas del archivo de resultados.
 * @returns El mapa id → resultado.
 */
export function matchById(
  entries: readonly BatchResultEntry[],
): ReadonlyMap<string, BatchResultType> {
  return new Map(entries.map((entry) => [entry.custom_id, entry.result]));
}

/**
 * ¿El resultado se cobra?
 *
 * Solo `succeeded` se factura; `errored`, `canceled` y `expired` explícitamente no.
 *
 * @param type - El tipo de resultado.
 * @returns `true` solo para `succeeded`.
 */
export function isBilled(type: BatchResultType): boolean {
  return type === "succeeded";
}

/**
 * Construye el batch de retry: solo los fallidos, con `max_tokens` mayor.
 *
 * @param ids - Los `custom_id` fallidos.
 * @param documents - Los documentos originales, indexados por id.
 * @returns Las entradas del retry.
 */
export function buildRetryBatch(
  ids: readonly string[],
  documents: ReadonlyMap<string, BatchDocument>,
): readonly BatchRequest[] {
  return ids.flatMap((id) => {
    const document = documents.get(id);
    if (document === undefined) return [];
    return [
      {
        custom_id: `${id}-retry-1`,
        params: {
          model: "claude-sonnet-5",
          // Subido para documentos que se pasaron del contexto.
          max_tokens: 8192,
          messages: [{ role: "user", content: document.content }],
        },
      },
    ];
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 4 — Calcular la cadencia contra un SLA de 30 horas
//
// Why: el cálculo del SLA con la ventana de 24 horas es un punto de examen
//      directo. Hay que trabajar hacia atrás desde el deadline, contando el
//      procesamiento máximo más el margen.
// You should see: 30 − 24 = 6 horas de buffer; último batch ≥24h antes del
//      deadline; envíos cada 4-6h para que uno esté siempre en vuelo.
// ─────────────────────────────────────────────────────────────────────────────

/** El plan de envíos contra un SLA. */
interface SlaPlan {
  readonly slaHours: number;
  readonly maxProcessingHours: number;
  /** Horas de margen para reunir, validar y absorber problemas. */
  readonly bufferHours: number;
  /** Cuántas horas antes del deadline debe salir el último batch. */
  readonly latestSubmissionHoursBeforeDeadline: number;
  readonly submissionIntervalHours: number;
}

/**
 * Planifica los envíos contra el PEOR caso de procesamiento.
 *
 * Se diseña contra el techo de 24 horas, no contra el caso común de menos de una
 * hora: si el diseño asume lo típico, falla la vez que la ventana se usa de verdad.
 *
 * @param slaHours - El compromiso de entrega, en horas.
 * @param submissionIntervalHours - Cada cuántas horas se envía.
 * @returns El plan completo.
 */
export function planBatchSchedule(slaHours: number, submissionIntervalHours: number): SlaPlan {
  return {
    slaHours,
    maxProcessingHours: 24,
    bufferHours: slaHours - 24,
    latestSubmissionHoursBeforeDeadline: 24,
    submissionIntervalHours,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Paso 5 — Muestrear y refinar el prompt antes del batch completo
//
// Why: refinar el prompt sobre un sample set antes de enviar es la estrategia más
//      rentable. 90% de first-pass ⇒ ~100 fallos de 1.000; 60% ⇒ ~400, cuatro
//      veces el volumen de reenvío.
// You should see: un sample que cubre el rango de tipos y edge cases, 2-3
//      iteraciones y un first-pass alto en el batch completo.
// ─────────────────────────────────────────────────────────────────────────────

/** Proyección de reenvíos para un volumen y una tasa de first-pass. */
interface FirstPassProjection {
  readonly documents: number;
  readonly firstPassRate: number;
  readonly failures: number;
}

/**
 * Proyecta cuántos documentos habrá que reenviar.
 *
 * @param documents - El volumen total.
 * @param firstPassRate - La tasa de acierto al primer intento.
 * @returns La proyección.
 */
export function projectResubmission(
  documents: number,
  firstPassRate: number,
): FirstPassProjection {
  return {
    documents,
    firstPassRate,
    failures: Math.round(documents * (1 - firstPassRate)),
  };
}

/**
 * ¿Hay que seguir iterando el prompt sobre el sample?
 *
 * Se corta cuando el sample supera el 90% de accuracy.
 *
 * @param sampleAccuracy - La accuracy medida en el sample.
 * @returns `true` si conviene otra iteración.
 */
export function needsAnotherIteration(sampleAccuracy: number): boolean {
  return sampleAccuracy < 0.9;
}

/**
 * ============================================================================
 * ✗ ANTI-PATTERN — Los errores que el examen construye
 * ============================================================================
 */

/** ✗ ANTI-PATTERN 1 — Mover todo a batch por el ahorro.
 *
 * El ahorro es real y no aplica al trabajo que bloquea a alguien. Un check
 * pre-merge o un review en vivo detienen a un desarrollador, y no hay plazo que
 * puedas exigirle al batch.
 */
// moveAllToBatch();  // el developer espera hasta 24h

/** ✗ ANTI-PATTERN 2 — Asumir que el batch vuelve rápido porque suele volver rápido.
 *
 * Lo típico no es garantía, y no hay SLA al que apelar cuando un batch se toma la
 * ventana entera. Diseñar contra lo observado significa fallar justo la vez que la
 * ventana se usa.
 */
// if (tookUnderAnHourBefore) assumeItWillAgain();  // diseña contra 24h

/** ✗ ANTI-PATTERN 3 — Un workflow con multi-turn tool calling en batch.
 *
 * Un item de batch es un solo turno: ninguna tool puede ejecutarse a mitad y
 * devolver su resultado para que el modelo continúe. Todo lo que tenga un agentic
 * loop dentro va a la API síncrona.
 */
// batches.create([{ params: { tools, … } }]);  // no puede ejecutar la tool mid-request

/** ✗ ANTI-PATTERN 4 — Emparejar por posición.
 *
 * Los resultados vuelven en cualquier orden: doc-001 termina pareado con el
 * resultado de doc-003, y la mala atribución es silenciosa.
 */
// results[i] ↔ documents[i]  // mal atribuido en silencio

/** ✗ ANTI-PATTERN 5 — Reenviar el batch completo ante fallos.
 *
 * Paga una segunda vez por los que ya funcionaron. Solo se reenvía lo que falló,
 * con la modificación que su fallo pide.
 */
// resubmitAll(originalBatch);  // doble coste por lo ya resuelto

/** ✗ ANTI-PATTERN 6 — Saltarse el sample set.
 *
 * Un prompt sin refinar baja el first-pass a ~60%: cuatro veces más reenvíos, más
 * el coste de procesar esos retries.
 */
// batches.create(allDocuments);  // sin probar el prompt en 5-10 docs primero

/** ✗ ANTI-PATTERN 7 — Meter `stream: true` o Threads en un batch.
 *
 * Los dos se rechazan con error de validación: los resultados de batch vuelven en
 * un archivo, no en un stream, y Threads es stateful mientras el batch no lo es.
 */
// { params: { stream: true } }  // error de validación

/**
 * ============================================================================
 * EXAM TRAPS — distractores recurrentes y criterio de rechazo
 * ============================================================================
 *
 * | Trampa                                             | Por qué se rechaza                                  |
 * |----------------------------------------------------|-----------------------------------------------------|
 * | Cambiar todos los workflows a batch por coste       | El ahorro no aplica a lo que bloquea a alguien      |
 * | Asumir que los resultados llegan rápido             | Lo típico no es garantía; no hay SLA                |
 * | Usar batch con multi-turn tool calling              | Un item es un solo turno; no ejecuta tools          |
 *
 * QUICK REFERENCE — datos de la fuente
 *
 *   Descuento ................ 50% de los precios estándar, incondicional
 *   Tiempo típico ............ menos de 1 hora para la mayoría de batches
 *   Ventana máxima ........... 24 horas (duro)
 *   Garantía de latencia ..... ninguna — best-effort, más lento con demanda alta
 *   Límite de tamaño ......... 100.000 requests O 256 MB, lo primero
 *   Error por tamaño ......... 413 `request_too_large`
 *   Formato de custom_id ..... `^[a-zA-Z0-9_-]{1,64}$`, 1-64 caracteres
 *   Emparejamiento ........... siempre por `custom_id` — los resultados NO van en orden
 *   processing_status ........ `in_progress` → `canceling` → `ended`
 *   Cuatro tipos de resultado  `succeeded`, `errored`, `canceled`, `expired`
 *   Resultados facturados .... solo `succeeded`; los otros tres son gratis
 *   Archivo de resultados .... `.jsonl` en `results_url`, poblado solo al terminar
 *   Ventana de descarga ...... 29 días desde `created_at` (no desde `ended_at`)
 *   Descarga recomendada ..... stream, no descargar todo de golpe
 *   Params rechazados ........ `stream: true`; Threads `store` / `previous_thread_event_id`
 *   Validación de params ..... asíncrona — los errores aparecen tras terminar el batch
 *   Chequeo pre-envío ........ dry-run de un request contra la Messages API síncrona
 *   Cache tip ................ usar el TTL de 1 hora para batches (suelen pasar de 5 min)
 *   Server tools en batch .... corren su loop agentic server-side completo dentro del worker
 *   Client tool / continuación NO posible mid-request; `pause_turn` exige un nuevo request
 *   Blocking (pre-merge) ..... API síncrona
 *   Tolerante (overnight) .... Batch API
 *   SLA de 30h ............... último batch ≥24h antes del deadline; los 6h restantes son
 *                              buffer — enviar cada 4-6h para que uno esté siempre en vuelo
 *
 * ============================================================================
 * FLUJO DE EJECUCIÓN ESPERADO  (trace ilustrativo — no se ejecuta)
 * ============================================================================
 *
 * [Paso 1] chooseApi({ downstreamWaits: true,  needsClientToolMidRequest: false })
 *   → "synchronous"    ← un dev esperando el pre-merge
 *   chooseApi({ downstreamWaits: false, needsClientToolMidRequest: false })
 *   → "batch"          ← el reporte de deuda que se lee por la mañana
 *   chooseApi({ downstreamWaits: false, needsClientToolMidRequest: true })
 *   → "synchronous"    ← un agentic loop no cabe en un item de batch
 *
 * [Paso 2] buildBatchRequests(documents) → 20 entradas con custom_id
 *   custom_id "doc-invoice-000" … "doc-receipt-019"
 *
 * [Paso 3] entries = [ { custom_id: "doc-003", result: "errored" },
 *                      { custom_id: "doc-001", result: "succeeded" }, … ]
 *   ← el orden NO coincide con el de envío
 *   failedIds(entries) → ["doc-003"]
 *   matchById(entries).get("doc-001") → "succeeded"
 *   isBilled("errored") → false · isBilled("succeeded") → true
 *   buildRetryBatch(["doc-003"], docs) → [{ custom_id: "doc-003-retry-1",
 *                                           params: { max_tokens: 8192, … } }]
 *   ✅ solo el fallido, con su modificación
 *
 * [Paso 4] planBatchSchedule(30, 4)
 *   → { slaHours: 30, maxProcessingHours: 24, bufferHours: 6,
 *       latestSubmissionHoursBeforeDeadline: 24, submissionIntervalHours: 4 }
 *   ✅ último batch por domingo 09:00 para un deadline de lunes 09:00
 *
 * [Paso 5] projectResubmission(1000, 0.9) → { failures: 100 }
 *          projectResubmission(1000, 0.6) → { failures: 400 }   ← 4× el volumen
 *   needsAnotherIteration(0.82) → true · needsAnotherIteration(0.93) → false
 *   ✅ refinar en 5-10 docs antes de enviar el batch grande
 *
 * ANTI-PATRÓN: la extracción nocturna de 2.000 facturas "suele" volver en 40
 * minutos, y un martes tardó 19 horas. El fix no es alertar al on-call a las 05:00
 * ni trocear en diez batches: es enviar el batch completo 24 horas antes del
 * cutoff de las 06:00 — la ventana es un techo contra el que se planifica, no un
 * tiempo típico.
 */
