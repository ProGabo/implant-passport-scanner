// ==========================================
//  ScanEngine — shared AI-scan prompt/parsing/provider logic
// ==========================================
// Plain JS, no SpreadsheetApp/PropertiesService/UrlFetchApp references in this file.
// Runs both as a GAS global (Código.js calls ScanEngine.scanPassport(...)) and as a
// Node require()'d module (test harness). API keys and HTTP transport are injected via
// `deps`, never read from globals here, so this file has no runtime-specific dependencies.
// Its only project dependency is PacientModel (clinical vocabulary: positions, pilar).

var ScanEngine = (function () {

  /**
   * nDocs > 1 (S7): varios archivos del MISMO paciente en una sola petición (ahorra cuota
   * gratuita: 3 documentos = 1 petición). La salida es un objeto con los implantes y las
   * indicaciones de seguimiento (P10d), no un array: parseResponse acepta las dos formas.
   */
  function buildPrompt(nDocs) {
    const n = nDocs > 1 ? nDocs : 1;
    const varios = n === 1 ? '' : `
      VARIOS DOCUMENTOS: Recibes ${n} documentos (archivos separados) del MISMO paciente, por ejemplo la ficha de la cirugía en dos hojas escaneadas por separado. Reúne en una sola lista los implantes de TODOS los documentos. Si la MISMA pegatina (misma REF y mismo LOT) aparece en más de un documento (una copia o la misma hoja escaneada dos veces), devuélvela UNA sola vez. Pero dos pegatinas iguales en la misma hoja, cada una con su propia anotación de posición, son implantes distintos.
`;
    return `
      Actúa como una secretaria experta en trazabilidad quirúrgica. Analiza ${n === 1 ? 'el documento' : 'los documentos'} con la ficha de implantes.
${varios}
      OBJETIVO: Extraer datos EXCLUSIVAMENTE de las pegatinas de IMPLANTES DENTALES.

      INSTRUCCIONES DE SEGURIDAD (CRÍTICO):
      1. AISLAMIENTO DE FICHA: Cada pegatina es una isla independiente. NUNCA asignes el Lote, la Referencia NI la POSICIÓN de una pegatina a la de al lado, ni siquiera si dos pegatinas son del mismo modelo/lote (esto pasa a menudo cuando se colocan varios implantes iguales en la misma cita). Antes de repetir una posición en dos implantes, vuelve a mirar la anotación manuscrita más cercana a CADA pegatina por separado: dos implantes casi nunca comparten la misma posición de diente. Si una pegatina no tiene lote impreso, déjalo VACÍO ("").
      2. BASURA: Ignora completamente "Abutment", "Healing Cap", "Cuff", "Membrane", "Sutura". Si la referencia empieza por "MC-M", "AMCZ", "HMC", "B-", o también si ves que o bien no hay dimensiones o bien la longitud es demasiado pequeña para ser un implante (6 mm o menos), IGNÓRALO, no es un implante. Las REF que empiezan por "HE" (ej: "HE41404", "HE 48865") escritas a mano junto a "+PC" o "+Mt-U" son del PILAR, nunca del implante.
      3. LOGICA VISUAL Y MANUSCRITA:
         - FECHA: Busca la fecha manuscrita en la parte superior izquierda de la página donde está la pegatina (ej: "9-9-24" o "09/09/2024" o variaciones). OBLIGATORIO: Traduce y formatea SIEMPRE esta fecha al formato estricto YYYY-MM-DD. Por ejemplo, si lees "9-9-24", debes transformarlo a "2024-09-09".. Añade este valor exacto en el campo 'fecha' para TODOS los implantes encontrados.
         - POSICIÓN: El texto manuscrito al lado de la ficha que empieza por la letra 'Z' (ej: "Z:25", "Z (14)") suele indicar la POSICIÓN del diente y está escrito AL LADO de la pegatina correspondiente. Busca esta anotación de forma individual para CADA pegatina, incluso si dos pegatinas son visualmente casi idénticas. Si no encuentras ninguna anotación clara y fiable para una pegatina concreta, NUNCA la dejes vacía ni copies la de otra pegatina: asigna el valor "No especificado" ÚNICAMENTE en el campo posicion. Esta opción de "No especificado" es EXCLUSIVA del campo posicion: para el resto de campos (marca, modelo, conexión, plataforma, etc.) sigue las reglas de deducción de abajo y da siempre tu mejor respuesta razonada, nunca escribas "No especificado" en ningún otro campo.
         - FISURA PTERIGOIDEA: a veces la anotación de zona no lleva número sino la palabra "pterigo" o una variante (ej: "Z(Pterigo)", "Z(pteriso)", "Z (pterig.)", "terigoidea", "ptg"), y muy cerca, normalmente justo debajo, el CUADRANTE escrito a mano (ej: "2n Q.", "1r quadrant", "1er cuadrante", "Q1", "2ºC" sin ningún plazo detrás). Entonces la posicion es EXACTAMENTE "Fisura pterigoidea (cuadrante 1)" o "Fisura pterigoidea (cuadrante 2)" según ese cuadrante. NUNCA la conviertas en 18 ni en 28. El cuadrante suele estar escrito en letra MÁS PEQUEÑA, a veces torcido, justo debajo o pegado a la "Z(...)": míralo con atención antes de rendirte (ej: un "1r quadrant" diminuto bajo "Z(pteriso)"). Solo si de verdad no hay ningún cuadrante legible junto a esa nota, usa "No especificado".
           * El cuadrante es SOLO el que está escrito junto a la nota "pterigo". NO lo saques de la cabecera: "1ºC" o "1rC" al lado de la fecha (ej: "3/3/26 1ºC 3 impl. SUP") es otra cosa, no el cuadrante.
         - TRAMPAS DE POSICIÓN: las listas de extracciones ("+EXO 24,25,26,28", "EXO de 17") son dientes extraídos, NO posiciones de implantes. El plan de tratamiento o los informes (ej: "Deixar implants posició 17,16,11..., pterigoideu", "Als 6 mesos col·locació 2 implants") hablan de implantes existentes o futuros, NO de los de las pegatinas. Las páginas siguientes (historial de Quartup con "/2/Z-36,37", emails, radiografías) pueden tener información, pero la posición y el pilar de cada pegatina salen SOLO de las anotaciones manuscritas junto a esa pegatina.
         - CONEXIÓN: Si ves una pegatina que pone "Ref ZYGAN" y mide más de 30mm, el Modelo es "ExHex Zygan" (Cigomático). Si ves "Int Hex" o referencias que empiezan por "I" o "IM", el Modelo es "Internal Hex".
         - PILAR: Busca notas manuscritas junto a cada pegatina que empiecen por un símbolo "+".
           * MULTI-UNIT: "+" seguido (a veces) de una cantidad, unas siglas de Multi-Unit ("Mt-U", "Mt. U", "MI.U", "MIU") y una altura en "mm" (ej: "+ 2 Mt.U 3 mm", "+ (1) Mt.U 1.5 mm", "+Mt-U 5mm HE48805"). Asigna pilar = "Multi-unit" y pilar_altura = la altura en mm (solo el número, ej "5"). Si pone dos números como "30x5mm" o "30º 5mm", el primero es la ANGULACIÓN en grados (pilar_angulacion = "30") y el segundo la altura (pilar_altura = "5"). Si debajo hay una referencia (ej: "HE 48865"), ponla en pilar_ref sin espacios ("HE48865").
           * PILAR DE CICATRIZACIÓN: "+PC" o "+ PC 4 (HE41404)" o "+ Pc5 HE 41405" significa pilar de cicatrización: asigna pilar = "A cabeza de implante". Su número (4, 5) y su REF (HE41404) son del pilar provisional: NO los pongas en ningún campo (ni pilar_altura, ni pilar_ref, ni en las medidas o la REF del implante).
           * Si la nota indica una cantidad mayor a 1 (ej: "+ 2..."), aplica este mismo pilar a esa cantidad de implantes MÁS CERCANOS a la nota.
           * Si no hay ninguna nota de pilar cerca de la pegatina, o tiene otras siglas que no reconoces, asigna pilar = "Sin pilar" y deja vacíos los demás campos del pilar.
         - SEGUIMIENTO: además de las pegatinas, copia en "seguiment" cada indicación manuscrita de cuándo tiene que volver el paciente o de la próxima intervención, con su plazo, tal cual está escrita (ej: "Control: 15 dies", "Control + S.P: 15 dies", "2ªC: 4 meses", "canvi de pilars en 4 mesos", "Ctrol + Rx final: 3 meses", "Comp. impl: 4 meses", "Ctrol 25 semanas"). Una entrada por indicación. "2ªC" o "2ºC" seguido de un plazo (meses, mesos, dies, días, semanas, setmanes) es la 2ª cirugía, NO un cuadrante ni una posición. Solo indicaciones con un plazo; no inventes ninguna. Ignora la medicación, el historial de Quartup y los informes de otros médicos. Si no hay ninguna, "seguiment": [].

      INSTRUCCIONES DE LÓGICA DENTAL (CALCULA ESTOS CAMPOS):
      A. PLATAFORMA (Basada estrictamente en el Diámetro):
         - Si Diámetro <= 3.3 mm  -> "NP (Narrow)"
         - Si Diámetro > 3.3 mm Y < 5.0 mm -> "RP (Regular)"
         - Si Diámetro >= 5.0 mm -> "WP (Wide)"

      B. CONEXIÓN (Deduce basada en Marca y Modelo):
         - Southern "ExHex", "Zygan" o "Co-Axis (ExHex)" -> "Hexágono Externo"
         - Southern "Int Hex", "Internal Hex", "M-Series" o REF empieza por "I" -> "Hexágono Interno"
         - Southern "Deep Conical" -> "Cónico Interno"
         - Southern "Tri-Nex" -> "Trilobular"
         - Ticare "Inhex" -> "Hexágono Interno"
         - Ticare "Osseous" -> "Hexágono Externo"
         - Elité Medica "Fastite" -> "Hexágono Interno"
         - Si no estás segura, usa tu conocimiento general sobre la marca + modelo para deducirlo!

      EXTRAE ESTOS DATOS PARA CADA IMPLANTE (Longitud > 6mm):
      - fecha_colocacion: (Fecha superior izquierda, Formato estricto YYYY-MM-DD, ej "2024-09-09")
      - marca: (Southern Implants, Ticare, etc. Mira el logo)
      - modelo: (ExHex Zygan, Internal Hex, Co-Axis, Inhex, etc. lo pone en la ficha)
      - conexion: (OBLIGATORIO, deducida con la regla B de arriba, ej "Hexágono Externo").
      - plataforma: (OBLIGATORIO, calculada con la regla A de arriba a partir del diámetro, ej "RP (Regular)").
      - referencia: (REF). Cuidado: NO confundir con la REF del pilar/implante vecino (si hay).
      - lote: (LOT).
      - diametro: (Diámetro. Número decimal, ej 4.3. La clave del JSON es "diametro", sin acento)
      - longitud: (Número > 6, ej 13, 47.5)
      - posicion: (Número de diente 11-48, busca anotaciones a mano cercanas después de la letra zeta 'Z' o CUADRANTES; o "Fisura pterigoidea (cuadrante 1)" / "Fisura pterigoidea (cuadrante 2)" según la regla de la fisura pterigoidea. Si no hay anotación fiable para esta pegatina en concreto, usa "No especificado" — nunca la dejes vacía ni la copies de otra pegatina).
      - pilar: ("Multi-unit", "A cabeza de implante" o "Sin pilar" según la regla del pilar).
      - pilar_altura: (altura del pilar en mm, solo el número, ej "3" o "1.5"; "" si no está escrita).
      - pilar_angulacion: (grados del pilar angulado, ej "30"; "" si no está escrita).
      - pilar_ref: (REF del pilar escrita a mano, ej "HE48865"; "" si no está o si es la de un pilar de cicatrización).

      Salida OBLIGATORIA: Un objeto JSON puro con "implantes" (un elemento por implante) y "seguiment". Ejemplo:
      {"implantes":[{"fecha_colocacion":"2024-09-09","marca":"Southern Implants","modelo":"ExHex Zygan","conexion":"Hexágono Externo","plataforma":"RP (Regular)","referencia":"ZYGAN-47.5","lote":"085003","diametro":4.3,"longitud":47.5,"posicion":"25","pilar":"Multi-unit","pilar_altura":"1.5","pilar_angulacion":"","pilar_ref":""}],"seguiment":[{"text":"2ªC: 4 meses"}]}
    `;
  }

  /**
   * Splits a `data:<mime>;base64,<data>` URL into its parts. Falls back to
   * application/pdf only if the string isn't a proper data URL (defensive, not
   * expected in practice since the client always sends a data URL).
   */
  function parseDataUrl(dataUrl) {
    const commaIndex = dataUrl.indexOf(',');
    if (commaIndex === -1) {
      return { mimeType: 'application/pdf', base64Data: dataUrl };
    }
    const header = dataUrl.slice(0, commaIndex);
    const base64Data = dataUrl.slice(commaIndex + 1);
    const match = /^data:([^;]+);base64$/.exec(header);
    return {
      mimeType: match ? match[1] : 'application/pdf',
      base64Data: base64Data
    };
  }

  function cleanJson(text) {
    return text.replace(/```json/g, "").replace(/```/g, "").trim();
  }

  /**
   * Pure mapping from the model's raw JSON to the fields the rest of the app uses.
   * `referencia` -> `cod_implante` here (single source of truth for that rename —
   * previously done client-side in SidebarForm.html). diametro/longitud stay separate
   * (not combined into a `dimensiones` string) since the UI has independently editable
   * Ø/L inputs for correcting a misread handwritten measurement.
   */
  function parseResponse(raw) {
    return parseResponseFull(raw).implantes;
  }

  /**
   * Como parseResponse, más las indicaciones de seguimiento (P10d). Acepta el objeto
   * {implantes, seguiment} del prompt actual, el array plano de antes (fixtures antiguos)
   * y un implante suelto.
   * @returns {{implantes: object[], seguiment: {text: string}[]}}
   */
  function parseResponseFull(raw) {
    const results = JSON.parse(cleanJson(raw));
    const esObjecte = results && typeof results === 'object' && !Array.isArray(results);
    const items = Array.isArray(results) ? results
      : esObjecte && Array.isArray(results.implantes) ? results.implantes
      : [results];
    return { implantes: mapImplants(items), seguiment: mapSeguiment(esObjecte ? results.seguiment : null) };
  }

  /** [{text}] o ['texto'] -> [{text}] sin vacíos ni repetidos (como mucho 10). */
  function mapSeguiment(llista) {
    const vistos = {};
    return (Array.isArray(llista) ? llista : [])
      .map(function (s) { return String(s && typeof s === 'object' ? (s.text || '') : (s || '')).trim().slice(0, 200); })
      .filter(function (t) { if (!t || vistos[t.toLowerCase()]) return false; vistos[t.toLowerCase()] = true; return true; })
      .slice(0, 10)
      .map(function (t) { return { text: t }; });
  }

  function mapImplants(items) {
    const model = pacientModel();
    const text = function (v) { return v === undefined || v === null ? '' : String(v).trim(); };
    return items
      .filter(function (item) { return item && typeof item === 'object'; })
      .map(function (item) {
        // Vocabulario canónico (PacientModel): "pterigo 2n Q" -> "Fisura pterigoidea
        // (cuadrante 2)", "NO" -> "Sin pilar", "Multi-unit 3 mm" -> "Multi-unit" + 3.
        const pilarCru = text(item.pilar);
        const pilar = model.normalitzarTipusPilar(pilarCru) || 'Sin pilar';
        let altura = text(item.pilar_altura);
        if (!altura && pilar === 'Multi-unit') {
          const m = pilarCru.match(/(\d+(?:[.,]\d+)?)\s*mm/i);
          if (m) altura = m[1].replace(',', '.');
        }
        // "Sin pilar" no tiene detalles, y "A cabeza de implante" en una ficha es el "+PC":
        // su altura y su REF son del pilar provisional (no se guardan aunque la IA las dé).
        const senseDetalls = pilar === 'Sin pilar' || pilar === 'A cabeza de implante';
        return {
          fecha_colocacion: item.fecha_colocacion,
          marca: item.marca,
          modelo: item.modelo,
          conexion: item.conexion,
          plataforma: item.plataforma,
          cod_implante: item.referencia,
          lote: item.lote,
          // A veces el modelo copia la etiqueta del prompt con acento ("diámetro").
          diametro: item.diametro !== undefined ? item.diametro : item['diámetro'],
          longitud: item.longitud,
          posicion: model.normalitzarPosicio(item.posicion),
          pilar: pilar,
          pilar_altura: senseDetalls ? '' : altura,
          pilar_angulacion: senseDetalls ? '' : text(item.pilar_angulacion),
          pilar_ref: senseDetalls ? '' : text(item.pilar_ref).replace(/\s+/g, '').toUpperCase()
        };
      });
  }

  // En GAS, PacientModel es un global (otro archivo del proyecto); en Node, un módulo.
  // Se resuelve al usarlo, no al cargar, porque el orden de carga de GAS no está garantizado.
  function pacientModel() {
    if (typeof PacientModel !== 'undefined') return PacientModel;
    return require('./PacientModel.js');
  }

  // Ordered by preference, not by whatever order the API happens to return models in.
  // Gemini's /models endpoint currently lists 19+ "flash"-named models, including
  // image-generation, text-to-speech, and preview variants — matching on "flash" alone
  // (the old behavior) could silently pick a wildly different model per call, since the
  // API's list order isn't a documented stable contract. Pinning to a short, curated list
  // keeps model selection deterministic while still degrading gracefully if a specific
  // model is later deprecated.
  const PREFERRED_MODELS = [
    "models/gemini-2.5-flash",
    "models/gemini-2.0-flash",
    "models/gemini-flash-latest"
  ];

  function getBestAvailableModel(httpFetch, apiKey) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey.trim()}`;
      const res = httpFetch(url, { method: 'get' });
      if (res.status !== 200) return PREFERRED_MODELS[0];
      const json = JSON.parse(res.text);
      const available = new Set(
        json.models
          .filter(function (m) {
            return m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent");
          })
          .map(function (m) { return m.name; })
      );
      const found = PREFERRED_MODELS.find(function (name) { return available.has(name); });
      return found || PREFERRED_MODELS[0];
    } catch (e) {
      return PREFERRED_MODELS[0];
    }
  }

  /** Un documento (base64, mime) o ya una lista [{base64Data, mimeType}] -> lista. */
  function comoDocs(base64OrDocs, mimeType) {
    return Array.isArray(base64OrDocs) ? base64OrDocs : [{ base64Data: base64OrDocs, mimeType: mimeType }];
  }

  function callGeminiApi(httpFetch, modelPath, docs, prompt, apiKey) {
    const url = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent?key=${apiKey.trim()}`;
    const parts = [{ text: prompt }];
    docs.forEach(function (d, i) {
      if (docs.length > 1) parts.push({ text: 'Documento ' + (i + 1) + ' de ' + docs.length + ':' });
      parts.push({ inline_data: { mime_type: d.mimeType, data: d.base64Data } });
    });
    const payload = {
      contents: [{ parts: parts }],
      generationConfig: { response_mime_type: "application/json", temperature: 0 }
    };
    const res = httpFetch(url, {
      method: 'post',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.status !== 200) {
      const err = new Error("Error API: " + res.status);
      err.status = res.status;
      throw err;
    }
    const json = JSON.parse(res.text);
    return json.candidates[0].content.parts[0].text;
  }

  /**
   * deps: { httpFetch: (url, {method, headers, body}) -> {status, text}, geminiApiKey: string }
   * httpFetch must be synchronous in both runtimes (GAS's UrlFetchApp is inherently
   * synchronous, and google.script.run is not reliably async-safe for server functions).
   */
  function geminiProvider(base64Data, mimeType, promptText, deps) {
    // Un solo modelo para toda la petición, aunque lleve varios documentos.
    const modelName = getBestAvailableModel(deps.httpFetch, deps.geminiApiKey);
    return callGeminiApi(deps.httpFetch, modelName, comoDocs(base64Data, mimeType), promptText, deps.geminiApiKey);
  }

  // Hard-pinned fallback model — never built from a variable or taken from any response.
  // PAID, and deliberately so (decided 2026-07-09): every free OpenRouter model was
  // benchmarked against the golden PDFs and none is usable (Gemma variants permanently
  // 429, Nemotron variants blow past the 60s GAS UrlFetchApp limit and misread stickers).
  // gemini-2.5-flash via OpenRouter is the same model as the primary path, reads PDFs
  // natively, answered in 4-14s, and costs ~$0.0005-0.003 per scan — charged only when
  // the free direct-Gemini path is already down, against PREPAID OpenRouter credits
  // (worst case is an honest 402, never a surprise bill).
  const OPENROUTER_MODEL = "google/gemini-2.5-flash";

  /**
   * PDF parsing is pinned to the "native" engine: gemini-2.5-flash reads the PDF pages
   * visually itself (no parsing surcharge, and crucially no OCR middleman — the free
   * "cloudflare-ai" engine started delivering empty pages, "pdf-text" can never work on
   * the clinic's scanned PDFs, and any text-based OCR loses the sticker layout and
   * handwriting the prompt depends on). Pinned explicitly rather than omitted so a future
   * model change can't silently fall back to the paid-per-page "mistral-ocr" default.
   * Images skip the file-parser plugin entirely: vision models take them natively.
   */
  const OPENROUTER_PDF_ENGINE = "native";

  function callOpenRouterApi(httpFetch, docs, prompt, apiKey) {
    if (!apiKey) throw new Error("falta la clau d'OpenRouter");
    const content = [{ type: 'text', text: prompt }];
    let algunPdf = false;
    docs.forEach(function (d, i) {
      const isImage = d.mimeType.indexOf('image/') === 0;
      if (!isImage) algunPdf = true;
      if (docs.length > 1) content.push({ type: 'text', text: 'Documento ' + (i + 1) + ' de ' + docs.length + ':' });
      content.push(isImage
        ? { type: 'image_url', image_url: { url: `data:${d.mimeType};base64,${d.base64Data}` } }
        : { type: 'file', file: { filename: docs.length > 1 ? 'scan-' + (i + 1) + '.pdf' : 'scan.pdf', file_data: `data:${d.mimeType};base64,${d.base64Data}` } });
    });

    const payload = {
      model: OPENROUTER_MODEL,
      temperature: 0,
      messages: [{
        role: 'user',
        content: content
      }]
    };
    if (algunPdf) {
      payload.plugins = [{ id: 'file-parser', pdf: { engine: OPENROUTER_PDF_ENGINE } }];
    }

    const res = httpFetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'post',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`
      },
      body: JSON.stringify(payload)
    });
    if (res.status !== 200) {
      const err = new Error("Error API OpenRouter: " + res.status);
      err.status = res.status;
      throw err;
    }
    const json = JSON.parse(res.text);
    return json.choices[0].message.content;
  }

  /**
   * deps: { httpFetch, openRouterApiKey: string } — same synchronous httpFetch contract as
   * geminiProvider.
   */
  function openRouterProvider(base64Data, mimeType, promptText, deps) {
    return callOpenRouterApi(deps.httpFetch, comoDocs(base64Data, mimeType), promptText, deps.openRouterApiKey);
  }

  /**
   * GAS authorization failures (user hasn't accepted the script's scopes) throw from
   * UrlFetchApp itself, before any HTTP response exists — so they have no `status` and
   * must be recognized by message. They are per-user and fixable only by re-authorizing,
   * so they must escape scanPassport instead of being reported as a provider failure.
   */
  function isAuthError(e) {
    return !!(e && e.message && /script\.external_request|PERMISSION|autorizaci/i.test(e.message));
  }

  function errorDetail(e) {
    if (e && e.status !== undefined) return "HTTP " + e.status;
    return (e && e.message) ? e.message : String(e);
  }

  /**
   * Single entry point: buildPrompt -> try geminiProvider, on any failure (network/HTTP
   * error or malformed JSON) fall back to openRouterProvider; if that also fails,
   * classify honestly instead of blaming quota for everything: auth errors are rethrown
   * (Código.js's processImplantFile catch turns them into re-authorization instructions),
   * the daily-limit message appears only when BOTH providers returned 429, and anything
   * else surfaces each provider's real failure. Spend is bounded and deliberate: the
   * fallback model is paid but pinned, cents-per-scan, prepaid, and only reached when
   * the free primary path already failed (see the OPENROUTER_MODEL note).
   */
  function scanPassport(base64Data, mimeType, deps) {
    return scanDocuments([{ base64Data: base64Data, mimeType: mimeType }], deps);
  }

  /**
   * S7: varios documentos del mismo paciente en UNA petición (una sola de la cuota
   * gratuita), con el mismo fallback que un documento. `limit: true` = los dos proveedores
   * sin cuota (el sidebar no reintenta uno a uno: sería gastar más).
   * @param docs [{base64Data, mimeType}]
   * @returns {{ok, data?, seguiment?, count?, provider?, nDocs?, message?, limit?}}
   */
  function scanDocuments(docs, deps) {
    const promptText = buildPrompt(docs.length);
    let full;
    let provider;
    try {
      full = parseResponseFull(geminiProvider(docs, null, promptText, deps));
      provider = 'gemini';
    } catch (geminiError) {
      if (isAuthError(geminiError)) throw geminiError;
      try {
        full = parseResponseFull(openRouterProvider(docs, null, promptText, deps));
        provider = 'openrouter';
      } catch (openRouterError) {
        if (isAuthError(openRouterError)) throw openRouterError;
        if (geminiError.status === 429 && openRouterError.status === 429) {
          return { ok: false, limit: true, message: "Límite alcanzado por hoy. Inténtelo de nuevo mañana." };
        }
        return {
          ok: false,
          message: "Error de lectura (Gemini: " + errorDetail(geminiError) +
            "; OpenRouter: " + errorDetail(openRouterError) + "). Si se repite, avisa a Gabriel."
        };
      }
    }
    const fields = full.implantes;
    if (!fields || fields.length === 0) {
      return { ok: false, seguiment: full.seguiment, message: "La IA no detectó pegatinas. Asegúrate de que la foto esté bien iluminada y las pegatinas se vean claras." };
    }
    return { ok: true, data: fields, seguiment: full.seguiment, count: fields.length, provider: provider, nDocs: docs.length };
  }

  return {
    buildPrompt: buildPrompt,
    parseDataUrl: parseDataUrl,
    cleanJson: cleanJson,
    parseResponse: parseResponse,
    parseResponseFull: parseResponseFull,
    geminiProvider: geminiProvider,
    openRouterProvider: openRouterProvider,
    OPENROUTER_MODEL: OPENROUTER_MODEL,
    OPENROUTER_PDF_ENGINE: OPENROUTER_PDF_ENGINE,
    isAuthError: isAuthError,
    scanPassport: scanPassport,
    scanDocuments: scanDocuments
  };

})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ScanEngine;
}
