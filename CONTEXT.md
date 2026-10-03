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
Los 6 caracteres que el paciente usa para entrar al portal y ver su pasaporte. Lo genera el sistema.
_Avoid_: Nº Historial, código de paciente, historial

**Sense email / Sense DNI**:
Marca de que el paciente confirmadamente no tiene ese dato. Es distinto de que el dato **falte** (vacío y sin marcar), que significa que aún no se ha rellenado.
_Avoid_: email vacío como sinónimo de "no tiene"

## Pasaporte

**Pasaporte**:
El conjunto de implantes de un paciente, tal como lo ve en el portal y en el PDF.
_Avoid_: informe, ficha (en la interfaz del paciente)

**Implante**:
Una pieza colocada en una posición dental. En la hoja, cada fila es un implante, y los datos del paciente se repiten en todas sus filas.

## Personas

**Auxiliar**:
La persona que rellena el pasaporte en el sidebar: escanea la hoja de cirugía, revisa y guarda.
_Avoid_: secretaria (cuando se habla de quien rellena)

**Secretària**:
La persona que tiene el contacto de los pacientes y les hace llegar las cosas (por ejemplo, el pasaporte de un paciente sin email).

**Paciente**:
La persona con implantes. Consulta su pasaporte en el portal con su Codi d'accés.
