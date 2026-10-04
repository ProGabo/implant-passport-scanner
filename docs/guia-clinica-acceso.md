# Guía rápida: cómo entrar al Pasaporte Implantológico sin errores

Para la recepción de la clínica. Dos apartados: cómo dejarlo bien configurado una sola vez,
y qué hacer si algún día sale un aviso rojo.

---

## 1. Configuración inicial (se hace una vez, 5 minutos)

El error más habitual de esta herramienta no es un fallo del programa: pasa cuando en el
mismo navegador hay **dos cuentas de Google abiertas a la vez** (por ejemplo, la de la
clínica y una personal). Google se confunde de cuenta y el panel deja de funcionar a
medias, sin decir por qué.

La solución definitiva es dar a la clínica **su propio perfil de Chrome**, separado de todo
lo demás.

1. Abre Chrome.
2. Arriba a la derecha, pulsa el **icono redondo del perfil** → **Añadir** (o *Add*).
3. Elige **Iniciar sesión** y entra con **clinicapiesteller@gmail.com**.
4. Ponle nombre al perfil: **Clínica**. Elige un color que se distinga.
5. Marca la casilla de **crear un acceso directo en el escritorio**.
6. Ya dentro de ese perfil nuevo, abre la hoja del Pasaporte Implantológico y **fija la
   pestaña**: clic derecho sobre la pestaña → **Fijar**.

A partir de ahí:

- Para trabajar con el Pasaporte, se abre **siempre** el acceso directo "Clínica" del
  escritorio.
- El correo personal, o cualquier otra cuenta, se abre en el perfil de siempre. Aunque
  alguien inicie sesión con otra cuenta, cae en otro perfil y **no puede interferir**.

> Regla de oro: dentro del perfil "Clínica" no se inicia sesión con ninguna otra cuenta de
> Google. Nunca.

---

## 2. Si aparece un aviso

### Autorizar una cuenta nueva

Cuando alguien usa la herramienta por primera vez con su cuenta, Google le pide permiso. Se
hace sola en 20 segundos, sin llamar a nadie:

1. Menú **Pasaport Implantològic 🦷** (arriba, junto a Archivo, Editar, Ver...).
2. Pulsa **🔑 Autoritzar el meu compte**.
3. Google enseñará una pantalla de permisos. Acepta.
   - Si sale un aviso de "Google no ha verificado esta aplicación", pulsa **Configuración
     avanzada** → **Ir a Pasaporte Implantológico**. Es normal: es una herramienta interna de
     la clínica, no una app publicada en internet.
4. Cuando salga **"Compte autoritzat ✅"**, ya está.

### Recuadro rojo en el panel lateral: "Aquest panell no pot connectar amb la fulla"

Casi siempre es el problema de las dos cuentas.

1. Comprueba el **icono de perfil** arriba a la derecha en la hoja: si aparece más de una
   cuenta de Google, ciérralas todas menos la de la clínica.
   - Atajo si tienes prisa: abre la hoja en una **ventana de incógnito** (Ctrl+Mayús+N) y
     entra solo con la cuenta de la clínica.
2. Por si acaso, en el menú **Pasaport Implantològic 🦷** pulsa **🔑 Autoritzar el meu compte** y
   acepta los permisos.
3. Cierra el panel lateral y vuelve a abrirlo desde **Pasaport Implantològic 🦷 → ➕ Afegir
   implant / pacient**.

**Importante:** si estabas a media faena y ya habías escaneado una hoja de cirugía, **no
cierres el panel**. Tus datos siguen en pantalla. Arregla la cuenta en otra pestaña y vuelve
a pulsar **💾 Desar-ho tot**.

### Cualquier otro error

Menú **Pasaport Implantològic 🦷** → **⚙️ Manteniment** → **🩺 Comprovar-ho tot**. Sale una lista con un ✅ o un ❌
por cada parte del sistema. Manda una captura de esa lista a Gabriel: con eso se sabe qué
falla sin tener que adivinar.

---

## 3. El paciente y su pasaporte

### Cómo entra el paciente

Solo con su **Codi d'accés** (6 caracteres), sin ningún segundo código por email. Para
comprobar que un código funciona, basta con abrir el portal y escribirlo. Da igual si el
paciente confunde la O con el 0 o la I con el 1: el portal lo entiende.

### Paciente sin email

Al marcar **Sense email** aparece la casilla **Avisar la secretària**, ya marcada. Al pulsar
**💾 Desar-ho tot**, la secretaria recibe en `consulta@doctorpiurgell.com` un email con:

- quién es el paciente (nombre, Cuenta Quartup y DNI), para encontrarlo en los contactos;
- el mensaje ya escrito, con el código y el enlace, y un botón **Enviar per WhatsApp**: se
  pulsa, se elige el contacto del paciente y se envía;
- el pasaporte en **PDF**, por si se quiere imprimir.

### "A este paciente no le ha llegado el email"

1. Mira la pestaña **Registre d'enviaments** de la hoja: cada envío sale con su fecha, el
   email y si fue **OK** o **ERROR**.
2. Lanza **⚙️ Manteniment → 🩺 Comprovar-ho tot**: al final avisa de los emails que han **rebotado** en los
   últimos 30 días (direcciones mal escritas o que no existen) y de los códigos que hay que
   revisar.
3. Si el email está bien y no llega, pídele que mire la carpeta de **correo no deseado**
   (pasa a veces con Hotmail y Yahoo).

---

## 4. Fichas que se completan en la 2ª visita (pendientes)

### Marcar un implante como pendiente

- **Al escanear la ficha:** cada implante tiene la casilla **⏳ Pendent**. Sale desmarcada,
  porque lo normal es que no quede nada pendiente; márcala si ese implante aún espera algo
  (por ejemplo, el pilar definitivo tras un "+PC" provisional). Si quieres, escribe en **Què falta** qué le falta ("canvi de
  pilars en 4 mesos"). Si algo queda pendiente, la casilla de enviar el pasaporte se
  desmarca: se enviará al completarlo.
- **Después, en la hoja:** marca o desmarca la casilla de la columna **Pendent** de la fila.

Mientras está marcada, **la fila sale en naranja**. La pestaña **Pendents** lista todos los
implantes pendientes, con un enlace **Anar-hi** que lleva a su fila.

### Completar en la 2ª visita (sin volver a escanear)

Dos maneras, las dos valen:

1. **Escribir directamente en las celdas** de la fila (por ejemplo, el pilar: la columna
   Pilar tiene un desplegable).
2. **Seleccionar la fila** y pulsar **Pasaport Implantològic 🦷 → ✏️ Completar i enviar**
   (o el botón que hay encima de la hoja). Se abre un panel con los implantes pendientes de
   ese paciente, con el pilar y el enlace **📋 Enganxa els detalls del pilar de Quartup**
   (al pulsarlo se abre la caja para pegar el texto de Quartup).

En el panel:

- **💾 Desar**: guarda y deja la marca de pendiente como esté.
- **✅ Completar i enviar**: guarda, quita la marca de pendiente (y el naranja) y envía el
  pasaporte por email. El resultado del envío sale arriba del panel; si falla, pulsa
  **🔁 Tornar a enviar**. Con la casilla **Avisar també la secretària** también le llega el
  aviso. Si el paciente no tiene email, el botón dice **Completar i avisar la secretària**.
- Si la fila ya se completó a mano en las celdas, el panel solo ofrece **📨 Enviar el
  pasaport**.
- Si cambias de fila con el panel abierto, pulsa el enlace **↻ He canviat de fila: tornar a
  carregar**, al final del panel.

### Borrar un implante o un paciente

Selecciona sus filas en la hoja y **borra el contenido** (tecla Supr). No hace falta
eliminar la fila: una fila vacía no cuenta para nada y el hueco puede quedarse. También
vale clic derecho → **Eliminar fila**.

### ¿Reenviar a un paciente que ya existe?

Al buscar un paciente que ya existe, la casilla de enviar sale **desmarcada** y debajo pone
cuándo se le envió el pasaporte por última vez. Márcala solo si se lo quieres volver a
enviar.
