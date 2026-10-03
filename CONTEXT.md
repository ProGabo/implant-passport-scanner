# Pasaporte Implantológico

Registro de los implantes dentales de cada paciente de la clínica Drs. Pi i Esteller. El personal lo rellena desde el sidebar de la hoja de Google, y el paciente lo consulta en el portal web.

## Identidad del paciente

**Cuenta Quartup**:
El identificador único del paciente: el número que Quartup (el programa de gestión de la clínica) muestra como "Cuenta". Solo dígitos, normalmente empieza por 430. Se escribe en castellano a propósito, para que coincida con lo que se ve en Quartup.
_Avoid_: id_quartup, ID de Quartup, NHC, número de historia clínica, cuenta contable, compte

**DNI**:
El documento de identidad del paciente (DNI o NIE). Siempre acaba en letra. Es un dato del paciente, no su identificador.
_Avoid_: NIF, identificador

**Codi d'accés**:
Los 6 caracteres que el paciente usa para entrar al portal y ver su pasaporte. Lo genera el sistema. Basta él solo para entrar: no hay segundo código por email.
_Avoid_: Nº Historial, código de paciente, historial, PIN

**Sense email**:
Marca de que el paciente no tiene email. Es distinto de que el email **falte** (vacío y sin marcar), que significa que aún no se ha rellenado.
_Avoid_: email vacío como sinónimo de "no tiene"

**Sense DNI**:
Marca de que **no tenemos** el DNI del paciente (porque no lo tiene o porque nunca nos llegó, como los pacientes importados de Quartup). No se pide mientras esté marcada; si el DNI llega, se pone y la marca desaparece.

**Ficha**:
Todo lo que la hoja tiene de un paciente bajo un mismo Codi d'accés. Una persona debería tener una sola ficha.

**Unir fichas**:
Cuando dos fichas resultan ser la misma persona (típicamente, una importada con su Cuenta Quartup y otra dada de alta por la Auxiliar con el DNI), se convierten en una sola. Se queda el Codi d'accés que el paciente ya ha recibido, y el otro deja de existir.
_Avoid_: fusionar pacientes, duplicado

## Pasaporte

**Pasaporte**:
El conjunto de implantes de un paciente, tal como lo ve en el portal y en el PDF.
_Avoid_: informe, ficha (en la interfaz del paciente)

**Implante**:
Una pieza colocada en una posición dental. En la hoja, cada fila es un implante, y los datos del paciente se repiten en todas sus filas.

**DNI parcial**:
El DNI con la mayoría de cifras tapadas (`***4567**`) que el paciente ve en el portal y en el pasaporte, para reconocerse. El DNI completo nunca sale hacia el paciente.

## Envíos

**Avís a la secretària**:
El email que recibe la Secretària cuando se guarda un paciente Sense email: quién es, el mensaje ya escrito para reenviárselo (por WhatsApp) y el pasaporte en PDF para imprimir.
_Avoid_: notificación, aviso WhatsApp

**Registre d'enviaments**:
La pestaña de la hoja donde queda cada email enviado o fallido (pasaporte, recuperación de código, avís a la secretària, alerta). Sirve para responder a "a este paciente no le ha llegado".
_Avoid_: log

## Personas

**Auxiliar**:
La persona que rellena el pasaporte en el sidebar: escanea la hoja de cirugía, revisa y guarda.
_Avoid_: secretaria (cuando se habla de quien rellena)

**Secretària**:
La persona que tiene el contacto de los pacientes y les hace llegar las cosas (por ejemplo, el pasaporte de un paciente sin email).

**Paciente**:
La persona con implantes. Consulta su pasaporte en el portal con su Codi d'accés.
