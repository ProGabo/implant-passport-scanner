# ADR 0003 - Al portal se entra solo con el Codi d'accés

- **Fecha:** 2026-10-03
- **Estado:** Aceptada
- **Ticket:** S1 (#3) del mapa del feedback de la clínica (#1)

## Decisión

1. **Se quita el segundo factor** (PIN de 6 cifras por email). El Codi d'accés basta para
   ver el pasaporte, tenga el paciente email o no.
2. **Lo que compensa quitarlo:**
   - **Lista blanca hacia el portal** (`PortalModel.CAMPS_PORTAL`): el servidor solo envía
     nombre y datos de los implantes. Nunca email, Cuenta Quartup ni casillas internas.
   - **DNI parcial**: el DNI sale enmascarado desde el servidor (`***4567**`). Si no hay,
     no sale nada.
   - **Límite global de intentos**: 20 códigos fallidos en 10 minutos pausan el portal
     15 minutos, y la primera vez se avisa al responsable (propiedad `ALERT_EMAIL`).
     Recuperar el código por email también cuenta.
   - **Códigos sin caracteres confusos** (sin O, 0, I, 1 ni L) y comparación tolerante con
     los antiguos (O=0, I=L=1). Si dos códigos quedan iguales al normalizarlos, no entra
     ninguno.
3. **No se regenera ningún código existente**: ya se han entregado.
4. **Las únicas puertas públicas son `doPost` (`initiateLogin`, `retrieveCodeByEmail`) y
   `doGet`.** El web app es anónimo y, desde su página, cualquiera puede llamar con
   `google.script.run` a cualquier función global de `Código.js` que no termine en `_`. Por
   eso las funciones solo del servidor terminan en `_`, y las del panel y del menú empiezan
   por `exigirUsuariIntern_()`, que exige una cuenta de Google identificada: el visitante
   anónimo no la tiene. Esto ya era un agujero antes de S1 (`buscarPacient` devolvía email,
   Cuenta y DNI completo), pero sin PIN pasaba a ser la puerta principal.

## Por qué

- La clínica lo pidió (P5b): mucha gente mayor ya tiene bastante con un código, y lo que se
  busca es que el portal se use. Además, el PIN era la fuente de los errores que vieron
  (P5a): dos peticiones sobrescribían el PIN, la caché caducaba y los emails a Hotmail o
  Yahoo no llegaban.
- Riesgo aceptado: quien consiga o adivine un código ve nombre, DNI parcial e implantes.
  Con unos 900 millones de códigos posibles frente a ~1.000 pacientes y el límite de
  intentos, acertar uno a ciegas cuesta meses de ataque continuo, y el aviso lo haría
  visible el primer día.
- Se descartaron:
  - **Mantener el PIN y arreglarlo:** más fricción para justo el público que queremos.
  - **Límite por código o por IP:** quien ataca prueba códigos distintos, y Apps Script no
    ve la IP. Por eso el límite es global, aunque durante una pausa tampoco entren los
    pacientes legítimos.
  - **DNI completo en el portal:** con nombre + DNI completo se puede suplantar a alguien.

## Consecuencias

- Un dato nuevo del paciente no llega al portal hasta que se añade a `CAMPS_PORTAL`
  (por ejemplo, el pilar estructurado de S4).
- Si algún día se quiere volver a un segundo factor, el código del OTP está en el historial
  de git (antes de S1), pero habría que arreglar sus fallos.
- Si el portal se pausa a menudo sin ataque real (muchos pacientes equivocándose a la vez
  tras un envío masivo), subir `PortalModel.LIMIT.fallits`.
- El límite cuenta por ventanas fijas de 10 minutos: en el cambio de ventana caben hasta
  ~38 intentos seguidos. Se acepta; el aviso al responsable sigue saltando.
- Una función nueva en `Código.js` que el portal no deba poder llamar tiene que terminar
  en `_` o empezar por `exigirUsuariIntern_()`. Hay un test que lo comprueba para las
  funciones existentes.
