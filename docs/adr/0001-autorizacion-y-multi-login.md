# ADR 0001 - Tres causas distintas detrás del mismo "Se necesita autorización"

- **Fecha:** 2026-07-28
- **Estado:** Aceptada
- **Contexto previo:** incidentes del 2026-07-09 y del 2026-07-28 con la cuenta
  `clinicapiesteller@gmail.com`

## Problema

El mensaje **"Se necesita autorización para realizar esta acción"** (y sus disfraces:
"Error del Servidor", "Límite alcanzado por hoy") ha aparecido dos veces con **causas
raíz completamente distintas**. Las dos veces el primer instinto fue el mismo -
sospechar de los permisos - y la segunda vez ese instinto habría sido erróneo.

Este ADR fija cómo distinguirlas para que la tercera vez el diagnóstico dure minutos.

## Las tres causas, y el síntoma que las separa

### 1. Cambio de `oauthScopes` (ocurrido el 2026-07-09)

Cualquier edición de la lista `oauthScopes` en `appsscript.json` invalida la
autorización de **cada usuario por separado**. Quien no vuelva a aceptar los permisos
falla, y falla *al instante* (`UrlFetchApp` ni siquiera abre la conexión).

- **Síntoma:** falla **todo** para esa cuenta, siempre, desde el momento del despliegue.
  Otras cuentas que sí re-autorizaron funcionan con normalidad.
- **Comprobación decisiva:** `git log -- src/appsscript.json`. Si no hay commits recientes,
  **no es esto**, por muy convincente que parezca.
- **Solución:** cada cuenta ejecuta `autorizarCuenta()` una vez.

### 2. Cuenta que nunca autorizó

Una persona nueva, o una segunda cuenta del mismo navegador, abre la hoja sin haber
aceptado nunca los permisos.

- **Síntoma:** falla todo, pero **solo** para esa cuenta concreta.
- **Comprobación decisiva:** menú `🩺 Comprobar todo` → primera línea del diagnóstico.
- **Solución:** menú `🔑 Autorizar mi cuenta`. Importante: el diálogo de consentimiento de
  Google **solo lo disparan los elementos de menú**; las llamadas `google.script.run` del
  panel lateral se limitan a devolver el error, y por eso el usuario ve un mensaje críptico
  en vez de una petición de permisos.

### 3. Multi-login (ocurrido el 2026-07-28)

El panel lateral se sirve dentro de un iframe de `googleusercontent.com`. Si el navegador
tiene varias sesiones de Google activas, ese iframe puede autenticarse como una cuenta
distinta de la que tiene abierta la hoja.

- **Síntoma inconfundible:** **incoherencia**. Unas llamadas pasan y otras no en la misma
  sesión. En el incidente real, el escáner IA funcionó (también va por `google.script.run`,
  y usa `UrlFetchApp`) y acto seguido la búsqueda de paciente falló por autorización. Ninguna
  de las otras dos causas puede producir eso: si faltaran permisos, el escáner habría fallado
  también.
- **Comprobación decisiva:** icono de perfil arriba a la derecha en el Sheet - ¿hay más de
  una cuenta listada?
- **Solución:** perfil de navegador dedicado (ver `docs/guia-clinica-acceso.md`). Es la única
  causa que no se arregla desde el código.

## Decisiones

1. **No se toca `oauthScopes`.** Tocarlos desautoriza a todos los usuarios y, como la webapp
   corre con `executeAs: USER_DEPLOYING`, deja además el **portal público de pacientes caído**
   hasta que la cuenta desplegadora vuelva a aceptar. Cualquier mejora que requiera un scope
   nuevo espera a agruparse con otro cambio que ya obligue a re-autorizar.

2. **Consecuencia asumida:** el panel **no puede mostrar con qué cuenta está conectado**, que
   sería el diagnóstico ideal para el multi-login, porque leer el email exige el scope
   `userinfo.email`. Se compensa detectando el fallo y nombrando la causa probable en el
   mensaje.

3. **Descartado: tocar la pantalla de consentimiento de OAuth, pedir la verificación de Google,
   o migrar `GmailApp` → `MailApp` para soltar el scope restringido `https://mail.google.com/`.**
   Se evaluó la hipótesis de que los tokens caducasen a los 7 días por tener la app en modo
   "Prueba", y los hechos la descartan: el escáner funcionaba en la misma sesión en que falló la
   búsqueda. Además, `MailApp` no soporta `from`, y los cuatro envíos del sistema usan
   `from: "clinicapiesteller@gmail.com"`; migrar haría que los correos de OTP y recuperación
   salieran desde la cuenta que despliega. **No volver a evaluar esta vía sin una prueba nueva.**

4. **El menú es el canal de reparación, y es fijo.** Ofrece siempre `🔑 Autorizar mi cuenta`,
   con los mismos ítems y el mismo orden para todas las cuentas.

   Se implementó y se **retiró** una versión que detectaba el estado con
   `ScriptApp.getAuthorizationInfo()` dentro de `onOpen` para avisar por adelantado. Dos motivos:
   (a) `onOpen` corre en `AuthMode.LIMITED` y la llamada devuelve "pendiente" incluso a cuentas
   perfectamente autorizadas - avisaba en falso, y un aviso que miente entrena a la gente a
   ignorarlo; (b) colocaba el ítem de autorizar por encima de `➕ Añadir Implante / Paciente`,
   desplazando el botón que se usa cada día. **No reintroducir esa detección en `onOpen`.**

   El aviso fiable lo da el panel lateral, que detecta el fallo real en el momento en que se va a
   trabajar. Regla general que se mantiene: cualquier lógica futura en `onOpen` va en `try/catch`
   con el menú construido primero, porque una excepción ahí dejaría la hoja **sin menú**, sin
   forma de abrir el panel ni de autorizar.

5. **Fallar pronto, no a media faena.** El panel ya se autodiagnosticaba sin saberlo:
   `loadImplantOptions()` se ejecuta al abrirse. Si falla por autorización, se bloquean escaneo,
   búsqueda y guardado. A media faena, en cambio, **no se bloquea nada y no se vacía el
   formulario**: escanear cuesta 30 segundos de IA y revisión humana, y eso no se tira.

6. **Sin borradores en el navegador.** Nada de `localStorage`/`sessionStorage`: no se escriben
   datos de pacientes en el disco de un ordenador compartido de la clínica.
