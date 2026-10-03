# ADR 0002 - La Cuenta Quartup identifica al paciente, y la hoja se lee por un registro de columnas

- **Fecha:** 2026-10-03
- **Estado:** Aceptada
- **Ticket:** S2 (#2) del mapa del feedback de la clínica (#1)

## Decisión

1. **El identificador del paciente es la Cuenta Quartup**: el número que Quartup muestra
   como "Cuenta" (solo dígitos, 430...). Es obligatorio y único. El DNI pasa a ser un dato
   aparte, y el Codi d'accés de 6 caracteres sigue siendo solo la llave del portal.
2. **Se llama "Cuenta Quartup", en castellano, dentro de una interfaz en catalán**, y con
   el mismo nombre en el código (`cuenta_quartup`), en la cabecera de la hoja y en el
   sidebar. Es la palabra que el personal ve en Quartup, y así sabe qué número copiar.
3. **La hoja "Pacientes" se lee y se escribe solo a través del registro de columnas**
   (`src/PacientModel.js`): clave estable -> cabecera visible + alias. Nunca por índice.

## Por qué

- Hasta ahora el identificador mezclaba Cuentas (pacientes importados de Quartup) y DNIs
  (altas de la auxiliar), y la búsqueda recorría la hoja entera. Una Cuenta obligatoria y
  única, validada al guardar, evita además el paciente duplicado con dos códigos.
- Se descartaron:
  - **"Núm. d'història clínica" / NHC:** suena clínico, pero el personal no lo relaciona
    con Quartup, y se parecía demasiado al antiguo "Nº Historial" impreso en el PDF (que
    en realidad era el Codi d'accés).
  - **`id_quartup`:** "ID" no dice qué número de Quartup es.
  - **"Compte" en catalán:** es ambiguo (banco, cuenta de Google) y no coincide con la
    pantalla de Quartup.
- Las funciones antiguas suponían cada una un índice de columna distinto. Con el registro,
  renombrar o mover una columna no rompe nada, el portal recibe siempre las mismas claves
  y añadir columnas (S3, S4) se reduce a `asegurarColumnas()`, sin migración.

## Consecuencias

- Los alias (`id_quartup`, `Código`, `Posición`...) permiten que el código funcione
  antes y después de la migración. No borrarlos mientras pueda quedar una hoja sin migrar
  (por ejemplo, la "Còpia abans S2").
- Si un día la clínica deja Quartup, el concepto sigue, pero habrá que renombrar la
  cabecera. Es un cambio de una línea en el registro, más una migración de cabeceras.
- Unicidad: se asume que dos pacientes nunca comparten Cuenta en Quartup (así lo entendemos
  nosotros; falta que lo confirme la clínica). Si alguna vez pasa, la regla cambia de
  "bloquear" a "avisar".
