# ADR 0005 - El portal es una página estática en Netlify y Apps Script es solo la API

- **Fecha:** 2026-10-04
- **Estado:** Aceptada
- **Ticket:** S8 (#10) del mapa del feedback de la clínica (#1)

## Decisión

1. **`web/index.html` es el portal entero.** Netlify lo publica en
   `https://clinicapiestellercom.netlify.app/`, la misma dirección de siempre, a la que
   lleva el botón de la web de la clínica. Antes ese archivo era solo un marco (`<iframe>`)
   que cargaba la página desde el `doGet` de Apps Script.
2. **Se genera, no se edita a mano:** `npm run web` (`scripts/generar-web.js`) toma
   `src/Index.html` y le añade el idioma, el icono y las etiquetas `og:`.
   `test/web-sync.test.js` falla si los dos archivos dejan de coincidir.
3. **Apps Script solo responde JSON** (`doPost`: `initiateLogin`, `pdfPasaporte`,
   `retrieveCodeByEmail`), igual que ya hacía la página dentro del marco. Las respuestas
   llevan `Access-Control-Allow-Origin: *` (comprobado el 2026-10-04).
4. **`doGet` se queda** como respaldo para quien tenga guardado el enlace largo de
   `script.google.com`.
5. **Publicar el portal = `git push` a `main`.** Netlify está conectado al repo
   (`netlify.toml`, `publish = "web"`).

## Por qué

- Cada visita hacía **tres viajes** a Apps Script: la página (`doGet`), el login y el PDF.
  El primero no aporta nada: la página no usa nada de Apps Script (ni plantillas ni
  `google.script.run`). Además, en frío es el viaje más lento y uno de los que daba la
  página de error de 60 s ("Error de conexión", P5a).
- Fuera del marco, "Ver pasaporte" y "Descargar" (blob y `<a download>`) funcionan sin el
  sandbox de Google, sobre todo en el móvil.
- Se descartó sacar los datos de Apps Script (otra base de datos o un backend propio):
  la clínica quiere seguir con la hoja de Google, y con lo de este ADR más la lectura por
  columna basta para el objetivo.

## Medición (`npm run medir`, 20 logins + 5 PDFs con DEMO2026)

| | Login (mediana / p90 / máx.) | Errores | PDF (mediana) |
|---|---|---|---|
| Antes (@96, 2026-10-04) | 6,06 s / 9,35 s / 15,8 s | 1 de 20 (HTML) | 7,10 s |
| Lectura por columna + filas recortadas (@99) | 4,97 s / 10,2 s / 11,5 s | 0 de 20 | 1,97 s (3 de 5 fallan) |
| Índice de códigos (@100) | 2,26 s / 4,56 s / 4,96 s | 0 de 20 | (ver abajo) |
| PDF hecho en el navegador (@102, Chrome) | 2-4 s, PDF listo +0,5 s | 0 de 8 con peticiones escalonadas | — |

Lo que se aprendió midiendo:

- **La hoja tiene 10.665 implantes reales.** Con ese tamaño, cualquier lectura cuesta unos
  2,5 s, se lea la hoja entera o una sola columna. Por eso el portal usa un **índice de
  códigos** en la memoria del script (CacheService, 1 hora): en qué filas está cada código,
  y solo se leen esas (~0,1 s). Se rehace en cada alta (que ya lee la hoja) y cuando el
  portal lo encuentra desfasado. Lo único que no detecta es una fila añadida a mano a un
  paciente que ya existía: la verá al cabo de una hora como mucho (aceptado).
- **Las respuestas grandes fallan en la redirección de Google.** El PDF hecho (~160 KB, ~210
  KB en base64) fallaba en 3 de cada 6 peticiones; los logins pequeños, en ninguna (en
  ese momento). Por eso el login trae el pasaporte en **HTML** (~9 KB) y el **navegador hace
  el PDF** con html2pdf.js 0.10.1 (cdnjs, con SRI), dentro de un marco invisible. Es el
  mismo HTML que el PDF de la clínica; el PDF del navegador es una imagen del pasaporte
  (~240 KB). `pdfPasaporte` queda de respaldo si el navegador no puede.
- **Google a veces se cuelga 10-40 s** también con respuestas pequeñas. El portal manda las
  peticiones **escalonadas**: si a los 6 s no hay respuesta, sale otra en paralelo (y otra
  a los 12 s), y vale la primera que llega bien.

## Consecuencias

- Hay dos archivos casi iguales: `src/Index.html` es el original y `web/index.html` el
  generado. Se cambia siempre el de `src/` y se ejecuta `npm run web`.
- Un `git push` publica el portal en el momento: hay que hacerlo con los tests en verde.
- La URL de `/exec` está en `src/Index.html` (`API_URL`): nunca se crea un despliegue
  nuevo, siempre se actualiza el mismo deployment ID.
