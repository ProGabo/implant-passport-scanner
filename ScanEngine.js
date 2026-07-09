// ==========================================
//  ScanEngine — shared AI-scan prompt/parsing/provider logic
// ==========================================
// Plain JS, no SpreadsheetApp/PropertiesService/UrlFetchApp references in this file.
// Runs both as a GAS global (Código.js calls ScanEngine.scanPassport(...)) and as a
// Node require()'d module (test harness). API keys and HTTP transport are injected via
// `deps`, never read from globals here, so this file has no runtime-specific dependencies.

var ScanEngine = (function () {

  function buildPrompt() {
    return `
      Actúa como una secretaria experta en trazabilidad quirúrgica. Analiza la imagen del pasaporte de implantes.

      OBJETIVO: Extraer datos EXCLUSIVAMENTE de las pegatinas de IMPLANTES DENTALES.

      INSTRUCCIONES DE SEGURIDAD (CRÍTICO):
      1. AISLAMIENTO DE FICHA: Cada pegatina es una isla independiente. NUNCA asignes el Lote, la Referencia NI la POSICIÓN de una pegatina a la de al lado, ni siquiera si dos pegatinas son del mismo modelo/lote (esto pasa a menudo cuando se colocan varios implantes iguales en la misma cita). Antes de repetir una posición en dos implantes, vuelve a mirar la anotación manuscrita más cercana a CADA pegatina por separado: dos implantes casi nunca comparten la misma posición de diente. Si una pegatina no tiene lote impreso, déjalo VACÍO ("").
      2. BASURA: Ignora completamente "Abutment", "Healing Cap", "Cuff", "Membrane", "Sutura". Si la referencia empieza por "MC-M", "AMCZ", "HMC", "B-", o también si ves que o bien no hay dimensiones o bien las dimensiones de longitud son demasiado pequeñas (mayor a 6 mm) como para ser un implante, IGNÓRALO, no es un implante.
      3. LOGICA VISUAL Y MANUSCRITA:
         - FECHA: Busca la fecha manuscrita en la parte superior izquierda de la página (ej: "9-9-24" o "09/09/2024" o variaciones). OBLIGATORIO: Traduce y formatea SIEMPRE esta fecha al formato estricto YYYY-MM-DD. Por ejemplo, si lees "9-9-24", debes transformarlo a "2024-09-09".. Añade este valor exacto en el campo 'fecha' para TODOS los implantes encontrados.
         - POSICIÓN: El texto manuscrito al lado de la ficha que empieza por la letra 'Z' (ej: "Z:25", "Z (14)") suele indicar la POSICIÓN del diente y está escrito AL LADO de la pegatina correspondiente. Busca esta anotación de forma individual para CADA pegatina, incluso si dos pegatinas son visualmente casi idénticas. Si no encuentras ninguna anotación clara y fiable para una pegatina concreta, NUNCA la dejes vacía ni copies la de otra pegatina: asigna el valor "No especificado" ÚNICAMENTE en el campo posicion. Esta opción de "No especificado" es EXCLUSIVA del campo posicion: para el resto de campos (marca, modelo, conexión, plataforma, etc.) sigue las reglas de deducción de abajo y da siempre tu mejor respuesta razonada, nunca escribas "No especificado" en ningún otro campo.
         - CONEXIÓN: Si ves una pegatina que pone "Ref ZYGAN" y mide más de 30mm, el Modelo es "ExHex Zygan" (Cigomático). Si ves "Int Hex" o referencias que empiezan por "I" o "IM", el Modelo es "Internal Hex".
         - PILAR MULTI-UNIT : Busca notas manuscritas cerca de las fichas que empiecen por un símbolo "+" seguido de una cantidad, unas siglas (como "Mt. U" o similares de "MI.U", "MIU") y una altura en "mm" (ej: "+ 2 Mt.U 3 mm" o "+ (1) Mt.U 1.5 mm").
           * Si identificas estas siglas como Multi-Unit, extrae la altura y asigna al campo 'pilar' el valor "Multi-unit [altura] mm" (ej: "Multi-unit 3 mm").
           * Si la nota indica una cantidad mayor a 1 (ej: "+ 2..."), aplica este mismo pilar a esa cantidad de implantes MÁS CERCANOS a la nota.
           * Si la nota manuscrita tiene otras siglas que no son Multi-Unit, o si simplemente no hay ninguna nota de pilar cerca, asigna al campo 'pilar' el valor "NO"

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
      - referencia: (REF). Cuidado: NO confundir con la REF del pilar/implante vecino (si hay).
      - lote: (LOT).
      - diámetro: (Número decimal, ej 4.3)
      - longitud: (Número > 6, ej 13, 47.5)
      - posicion: (Número de diente 11-48, busca anotaciones a mano cercanas después de la letra zeta 'Z' o CUADRANTES. Si no hay anotación fiable para esta pegatina en concreto, usa "No especificado" — nunca la dejes vacía ni la copies de otra pegatina).
      - pilar: ("Multi-unit [altura] mm" o "NO" según la regla manuscrita).

      Salida OBLIGATORIA: Un array JSON puro. Ejemplo:
      [{"fecha_colocacion":"2024-09-09","marca":"Southern Implants","modelo":"ExHex Zygan","conexion":"Hexágono Externo","plataforma":"RP (Regular)","referencia":"ZYGAN-47.5","lote":"085003","diametro":4.3,"longitud":47.5,"posicion":"25","pilar":"Multi-unit 1.5 mm"}]
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
    const jsonString = cleanJson(raw);
    const results = JSON.parse(jsonString);
    const items = Array.isArray(results) ? results : [results];
    return items
      .filter(function (item) { return item && typeof item === 'object'; })
      .map(function (item) {
        return {
          fecha_colocacion: item.fecha_colocacion,
          marca: item.marca,
          modelo: item.modelo,
          conexion: item.conexion,
          plataforma: item.plataforma,
          cod_implante: item.referencia,
          lote: item.lote,
          diametro: item.diametro,
          longitud: item.longitud,
          posicion: item.posicion,
          pilar: item.pilar
        };
      });
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

  function callGeminiApi(httpFetch, modelPath, base64Data, mimeType, prompt, apiKey) {
    const url = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent?key=${apiKey.trim()}`;
    const payload = {
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mimeType, data: base64Data } }
        ]
      }],
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
    const modelName = getBestAvailableModel(deps.httpFetch, deps.geminiApiKey);
    return callGeminiApi(deps.httpFetch, modelName, base64Data, mimeType, promptText, deps.geminiApiKey);
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

  function callOpenRouterApi(httpFetch, base64Data, mimeType, prompt, apiKey) {
    const isImage = mimeType.indexOf('image/') === 0;
    const filePart = isImage
      ? { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}` } }
      : { type: 'file', file: { filename: 'scan.pdf', file_data: `data:${mimeType};base64,${base64Data}` } };

    const payload = {
      model: OPENROUTER_MODEL,
      temperature: 0,
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: prompt }, filePart]
      }]
    };
    if (!isImage) {
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
    return callOpenRouterApi(deps.httpFetch, base64Data, mimeType, promptText, deps.openRouterApiKey);
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
    const promptText = buildPrompt();
    let fields;
    let provider;
    try {
      fields = parseResponse(geminiProvider(base64Data, mimeType, promptText, deps));
      provider = 'gemini';
    } catch (geminiError) {
      if (isAuthError(geminiError)) throw geminiError;
      try {
        fields = parseResponse(openRouterProvider(base64Data, mimeType, promptText, deps));
        provider = 'openrouter';
      } catch (openRouterError) {
        if (isAuthError(openRouterError)) throw openRouterError;
        if (geminiError.status === 429 && openRouterError.status === 429) {
          return { ok: false, message: "Límite alcanzado por hoy. Inténtelo de nuevo mañana." };
        }
        return {
          ok: false,
          message: "Error de lectura (Gemini: " + errorDetail(geminiError) +
            "; OpenRouter: " + errorDetail(openRouterError) + "). Si se repite, avisa a Gabriel."
        };
      }
    }
    if (!fields || fields.length === 0) {
      return { ok: false, message: "La IA no detectó pegatinas. Asegúrate de que la foto esté bien iluminada y las pegatinas se vean claras." };
    }
    return { ok: true, data: fields, count: fields.length, provider: provider };
  }

  return {
    buildPrompt: buildPrompt,
    parseDataUrl: parseDataUrl,
    cleanJson: cleanJson,
    parseResponse: parseResponse,
    geminiProvider: geminiProvider,
    openRouterProvider: openRouterProvider,
    OPENROUTER_MODEL: OPENROUTER_MODEL,
    OPENROUTER_PDF_ENGINE: OPENROUTER_PDF_ENGINE,
    isAuthError: isAuthError,
    scanPassport: scanPassport
  };

})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ScanEngine;
}
