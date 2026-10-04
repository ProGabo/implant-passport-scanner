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
| Después | _(pendiente del despliegue)_ | | |

El "antes" también incluía leer la hoja entera en cada login (unas 16000 filas, por las
casillas "Pendent" hasta el final). Eso lo arregla S8 aparte: lectura por columna del Codi
d'accés y casillas solo con 200 filas de margen.

## Consecuencias

- Hay dos archivos casi iguales: `src/Index.html` es el original y `web/index.html` el
  generado. Se cambia siempre el de `src/` y se ejecuta `npm run web`.
- Un `git push` publica el portal en el momento: hay que hacerlo con los tests en verde.
- La URL de `/exec` está en `src/Index.html` (`API_URL`): nunca se crea un despliegue
  nuevo, siempre se actualiza el mismo deployment ID.
