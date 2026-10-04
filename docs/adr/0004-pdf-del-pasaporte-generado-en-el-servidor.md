# ADR 0004 - El PDF del pasaporte se genera en el servidor

- **Fecha:** 2026-10-04
- **Estado:** Aceptada
- **Ticket:** S5 (#6) del mapa del feedback de la clínica (#1)

## Decisión

1. **Un único renderer:** `PortalModel.htmlPasaporte`. Lo usan la Vista prèvia del panel,
   su botón Imprimir, su botón Descarregar PDF, el PDF del portal y el adjunto del Avís a
   la secretària. El paciente y la clínica ven el mismo documento.
2. **El PDF lo hace Apps Script**, con `Utilities.newBlob(html, 'text/html').getAs('application/pdf')`
   (`pdfPasaport_` en `Código.js`). Ya no se usa html2pdf en el navegador, porque daba
   texto borroso y columnas mal ordenadas. Este conversor funciona **sin el scope `drive`**
   (comprobado en vivo en @91).
3. **El portal pide el PDF en segundo plano nada más entrar** (`doPost` con la acción
   `pdfPasaporte`). Esa acción lleva las mismas protecciones que `initiateLogin`: resolver
   el código, el límite de fallos y la lista blanca. Si el paciente pulsa Descargar antes
   de que llegue, ve "Preparando…".

## Cómo se consigue que sean idénticos

- **El conversor es un Chrome imprimiendo** (en el PDF pone `Creator: Chromium`). Imprime
  con los fondos apagados: sin más, pierde todos los `background` y aclara el texto blanco.
- **La raíz del pasaporte (`.psp`) lleva `print-color-adjust: exact`.** Con eso, el
  conversor pinta fondos, texto blanco, bordes redondeados y las fuentes de Google
  (Playfair Display e Inter) igual que el navegador. Lo comprueba un test
  (`test/s5-renderer.test.js`). Las pruebas del 2026-10-03, que concluían que "no pinta
  fondos", se hicieron sin esa propiedad y eran erróneas.
- **Márgenes de 15 mm en los tres:**
  - el PDF los recibe del conversor;
  - la ventana de la Vista prèvia lleva `padding: 15mm`;
  - al imprimir, el margen va dentro de la hoja (`@page { margin: 0 }`, más un `padding`
    con `box-decoration-break: clone`). Desde el diálogo de Sheets, Chrome no respetaba el
    `@page` del iframe y la impresión salía pegada a los bordes.
- Cada implante es un `<tbody>` con `page-break-inside: avoid` y el `thead` se repite:
  con muchos implantes, el corte de página nunca parte una tarjeta.

## Por qué

- La clínica pedía ver, imprimir y descargar **exactamente** lo que recibirá el paciente
  (P2a-d). Con dos renderers (html2pdf en el portal y otro en el servidor) se acabarían
  separando.
- La alternativa era imprimir con CSS en cada navegador. Se descartó porque el paciente
  descarga un PDF, y el adjunto del aviso también tiene que serlo.

## Consecuencias

- El portal tarda un poco más en tener el PDF (lo hace el servidor). Se tapa pidiéndolo
  al entrar.
- Si un día Google no carga las fuentes web, el PDF sale con Georgia y Helvetica: cambia
  la letra, pero no el diseño.
- Cambiar el diseño se hace en un único sitio (`htmlPasaporte`), y hay que comprobarlo con
  un PDF real del conversor, no solo en el navegador.
