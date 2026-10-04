const test = require('node:test');
const assert = require('node:assert/strict');
const PM = require('../src/PacientModel.js');

// Cabeceras de la hoja real antes de S2 (castellano, identificador en `id_quartup`).
const ANTIGUES = ['Código', 'id_quartup', 'Nombre', 'Email', 'Posición', 'Fecha', 'Marca', 'Modelo',
  'Dimensiones', 'Plataforma', 'Conexión', 'Pilar', 'Código de implante', 'Lote'];

function filaAntiga(codi, ident, nom, email, posicio) {
  return [codi, ident, nom, email, posicio, new Date('2026-01-15'), 'Straumann', 'BLT',
    '4.1 x 10 mm', 'RC', 'CrossFit', 'No', '021.5310', 'AB123'];
}

// --- Registro de columnas ---

test('indexarCapcaleres reconoce las cabeceras antiguas por alias', () => {
  const { idx, desconegudes } = PM.indexarCapcaleres(ANTIGUES);
  assert.equal(idx.codi_acces, 0);
  assert.equal(idx.cuenta_quartup, 1);
  assert.equal(idx.nombre, 2);
  assert.equal(idx.posicion, 4);
  assert.equal(idx.fecha_colocacion, 5);
  assert.equal(idx.conexion, 10);
  assert.equal(idx.cod_implante, 12);
  assert.equal(idx.lote, 13);
  assert.deepEqual(desconegudes, []);
});

test('indexarCapcaleres reconoce las cabeceras nuevas en cualquier orden', () => {
  const desordenades = PM.CAPCALERES.slice().reverse().concat(['Notes']);
  const { idx, desconegudes } = PM.indexarCapcaleres(desordenades);
  PM.COLUMNES.forEach(c => {
    assert.equal(desordenades[idx[c.clau]], c.capcalera, c.clau);
  });
  assert.deepEqual(desconegudes, [desordenades.length - 1]);
});

test('filaAObjecte y objecteAFila son inversas sobre las cabeceras canónicas', () => {
  const obj = PM.filaAObjecte(['ABC123', '43001234', 'Anna', 'a@b.cat', false, '12345678Z', false], PM.indexarCapcaleres(PM.CAPCALERES).idx);
  assert.equal(obj.cuenta_quartup, '43001234');
  assert.equal(obj.sense_email, false);
  assert.equal(obj.lote, '');
  const fila = PM.objecteAFila(obj, PM.CAPCALERES);
  assert.equal(fila.length, PM.CAPCALERES.length);
  assert.equal(fila[1], '43001234');
  assert.equal(fila[5], '12345678Z');
});

test('las casillas aceptan TRUE de Sheets en cualquier forma', () => {
  assert.equal(PM.esCert(true), true);
  assert.equal(PM.esCert('TRUE'), true);
  assert.equal(PM.esCert('VERDADERO'), true);
  assert.equal(PM.esCert(false), false);
  assert.equal(PM.esCert(''), false);
});

// --- Clasificación del identificador ---

test('classificarIdentificador separa Cuenta, DNI, NIE y valores raros', () => {
  assert.equal(PM.classificarIdentificador('43001234'), 'cuenta');
  assert.equal(PM.classificarIdentificador(43001234), 'cuenta');
  assert.equal(PM.classificarIdentificador(' 43001234 '), 'cuenta');
  assert.equal(PM.classificarIdentificador('12345678A'), 'dni');
  assert.equal(PM.classificarIdentificador('12345678-a'), 'dni');
  assert.equal(PM.classificarIdentificador('X1234567L'), 'dni');
  assert.equal(PM.classificarIdentificador(''), 'buit');
  assert.equal(PM.classificarIdentificador(null), 'buit');
  assert.equal(PM.classificarIdentificador('abc'), 'revisar');
  assert.equal(PM.classificarIdentificador('4300-12'), 'revisar');
});

// --- Validación al guardar ---

const VALID = { cuenta_quartup: '43001234', nombre: 'Anna Puig', email: 'anna@exemple.cat', sense_email: false, dni: '12345678Z', sense_dni: false, codi_acces: 'GENERAR' };

test('validarPacient acepta un paciente completo', () => {
  assert.deepEqual(PM.validarPacient(VALID, []), { errors: [], avisos: [] });
});

test('validarPacient exige la Cuenta Quartup y rechaza un DNI en su lugar', () => {
  assert.equal(PM.validarPacient({ ...VALID, cuenta_quartup: '' }).errors.length, 1);
  const r = PM.validarPacient({ ...VALID, cuenta_quartup: '12345678Z' });
  assert.match(r.errors[0], /DNI/);
  assert.match(PM.validarPacient({ ...VALID, cuenta_quartup: '4300ab' }).errors[0], /xifres/);
});

test('validarPacient avisa sin bloquear si la Cuenta no empieza por 430', () => {
  const r = PM.validarPacient({ ...VALID, cuenta_quartup: '57000001' });
  assert.deepEqual(r.errors, []);
  assert.equal(r.avisos.length, 1);
});

test('validarPacient bloquea una Cuenta que ya es de otro paciente', () => {
  const existents = [{ cuenta_quartup: '43001234', codi_acces: 'XYZ789', nombre: 'Joan' }];
  const nou = PM.validarPacient(VALID, existents);
  assert.match(nou.errors[0], /Joan/);
  // El mismo paciente (mismo código) puede volver a guardar con su Cuenta.
  assert.deepEqual(PM.validarPacient({ ...VALID, codi_acces: 'xyz789' }, existents).errors, []);
});

test('validarPacient: email y DNI obligatorios salvo con su casilla marcada', () => {
  assert.equal(PM.validarPacient({ ...VALID, email: '' }).errors.length, 1);
  assert.equal(PM.validarPacient({ ...VALID, email: 'no-es-email' }).errors.length, 1);
  assert.deepEqual(PM.validarPacient({ ...VALID, email: '', sense_email: true }).errors, []);
  assert.equal(PM.validarPacient({ ...VALID, dni: '' }).errors.length, 1);
  assert.equal(PM.validarPacient({ ...VALID, dni: '1234' }).errors.length, 1);
  assert.deepEqual(PM.validarPacient({ ...VALID, dni: '', sense_dni: true }).errors, []);
  assert.equal(PM.validarPacient({ ...VALID, nombre: ' ' }).errors.length, 1);
});

// --- Datos de ejemplo con cabeceras antiguas ---

function hojaMixta() {
  return [
    // Importado de Quartup: Cuenta correcta, con email, 2 implantes.
    filaAntiga('AAA111', '43000001', 'Pere Vila', 'pere@x.cat', '11'),
    filaAntiga('AAA111', '43000001', 'Pere Vila', 'pere@x.cat', '21'),
    // Dado de alta por la auxiliar con el DNI, sin email, 3 implantes.
    filaAntiga('BBB222', '12345678Z', 'Maria Roca', '', '36'),
    filaAntiga('BBB222', '12345678Z', 'Maria Roca', '', '46'),
    filaAntiga('BBB222', '12345678Z', 'Maria Roca', '', '47'),
    // NIE.
    filaAntiga('CCC333', 'X1234567L', 'Ahmed Ali', 'ahmed@x.com', '14'),
    // Valor raro.
    filaAntiga('DDD444', 'pendent', 'Lluís Font', 'lluis@x.cat', '24'),
    // Fila vacía (se descarta).
    ['', '', '', '', '', '', '', '', '', '', '', '', '', '']
  ];
}

// --- Aplicar la revisión ---

test('pacientsUnics agrupa las filas-implante por Codi d\'accés', () => {
  const { idx } = PM.indexarCapcaleres(ANTIGUES);
  const ps = PM.pacientsUnics(hojaMixta().map(f => PM.filaAObjecte(f, idx)));
  assert.equal(ps.length, 4);
  assert.equal(ps[1].n_implants, 3);
});

// --- Fusión de fichas y "Sense DNI" ---

// Hoja ya migrada: A = importado con Cuenta y sin DNI; B = la misma persona dada de alta
// por la auxiliar con el DNI (el codi que el paciente ha recibido por email).
function hojaDuplicada() {
  const f = o => PM.objecteAFila(Object.assign({ posicion: '11', marca: 'Straumann' }, o), PM.CAPCALERES);
  return [
    f({ codi_acces: 'AAA111', cuenta_quartup: '43000001', nombre: 'Pere Vila', email: 'pere@x.cat', sense_dni: false, posicion: '11' }),
    f({ codi_acces: 'AAA111', cuenta_quartup: '43000001', nombre: 'Pere Vila', email: 'pere@x.cat', sense_dni: false, posicion: '12' }),
    f({ codi_acces: 'BBB222', nombre: 'PERE VILA', email: '', sense_email: true, dni: '12345678Z', posicion: '36' }),
    f({ codi_acces: 'CCC333', cuenta_quartup: '43000003', nombre: 'Joan Mas', email: 'joan@x.cat', posicion: '21' })
  ];
}

test('planificarFusio une las dos fichas en el codi que se queda y completa los datos', () => {
  const r = PM.planificarFusio(PM.CAPCALERES, hojaDuplicada(), 'bbb222', 'AAA111');
  assert.deepEqual(r.errors, []);
  assert.equal(r.filesMogudes, 2);
  const { idx } = PM.indexarCapcaleres(PM.CAPCALERES);
  const objs = r.files.map(f => PM.filaAObjecte(f, idx));
  const pere = objs.filter(o => o.codi_acces === 'BBB222');
  assert.equal(pere.length, 3);
  assert.ok(pere.every(o => o.cuenta_quartup === '43000001' && o.dni === '12345678Z' && o.email === 'pere@x.cat'));
  assert.ok(pere.every(o => o.sense_email === false), 'ya tiene email: la casilla se desmarca');
  assert.equal(pere[0].nombre, 'PERE VILA', 'se queda el nombre de la ficha que se queda');
  assert.ok(!objs.some(o => o.codi_acces === 'AAA111'));
  assert.equal(objs.find(o => o.codi_acces === 'CCC333').nombre, 'Joan Mas', 'las demás fichas no se tocan');
});

test('planificarFusio se niega si las fichas tienen Cuentes o DNIs distintos', () => {
  const cuentes = PM.planificarFusio(PM.CAPCALERES, hojaDuplicada(), 'AAA111', 'CCC333');
  assert.match(cuentes.errors.join(), /Cuentes diferents/);

  const files = hojaDuplicada();
  const { idx } = PM.indexarCapcaleres(PM.CAPCALERES);
  files[0][idx.dni] = '87654321X';
  const dnis = PM.planificarFusio(PM.CAPCALERES, files, 'BBB222', 'AAA111');
  assert.match(dnis.errors.join(), /DNIs diferents/);
  assert.equal(dnis.files, files, 'sin cambios');

  assert.match(PM.planificarFusio(PM.CAPCALERES, files, 'BBB222', 'ZZZ999').errors.join(), /ZZZ999/);
});

test('planificarCanviCuenta corrige o quita la Cuenta de una ficha y valida', () => {
  const files = hojaDuplicada();
  const { idx } = PM.indexarCapcaleres(PM.CAPCALERES);
  const r = PM.planificarCanviCuenta(PM.CAPCALERES, files, 'aaa111', '43000099');
  assert.deepEqual(r.errors, []);
  assert.equal(r.filesTocades, 2);
  assert.ok(r.files.filter(f => f[idx.codi_acces] === 'AAA111').every(f => f[idx.cuenta_quartup] === '43000099'));
  assert.equal(PM.planificarCanviCuenta(PM.CAPCALERES, files, 'AAA111', '').files[0][idx.cuenta_quartup], '');
  assert.match(PM.planificarCanviCuenta(PM.CAPCALERES, files, 'AAA111', '43000003').errors.join(), /Joan Mas/);
  assert.match(PM.planificarCanviCuenta(PM.CAPCALERES, files, 'AAA111', '12345678Z').errors.join(), /DNI/);
  assert.match(PM.planificarCanviCuenta(PM.CAPCALERES, files, 'ZZZ999', '43000099').errors.join(), /ZZZ999/);
});

// --- S4: posición (fisura pterigoidea) ---

test('normalitzarPosicio reconoce la fisura pterigoidea y su cuadrante, y nunca la convierte en 18/28', () => {
  assert.equal(PM.normalitzarPosicio('25'), '25');
  assert.equal(PM.normalitzarPosicio(' 46 '), '46');
  assert.equal(PM.normalitzarPosicio('Fisura pterigoidea (cuadrante 2)'), 'Fisura pterigoidea (cuadrante 2)');
  assert.equal(PM.normalitzarPosicio('Z(Pterigo) 2n Q.'), 'Fisura pterigoidea (cuadrante 2)');
  assert.equal(PM.normalitzarPosicio('pteriso 1r quadrant'), 'Fisura pterigoidea (cuadrante 1)');
  assert.equal(PM.normalitzarPosicio('terigoidea Q1'), 'Fisura pterigoidea (cuadrante 1)');
  assert.equal(PM.normalitzarPosicio('ptg 2'), 'Fisura pterigoidea (cuadrante 2)');
  // Sin cuadrante, o con los dos: se elige a mano.
  assert.equal(PM.normalitzarPosicio('pterigoideo'), 'No especificado');
  assert.equal(PM.normalitzarPosicio('pterigo 1 o 2'), 'No especificado');
  // Lo que no es pterigoidea se deja tal cual.
  assert.equal(PM.normalitzarPosicio('No especificado'), 'No especificado');
  assert.equal(PM.normalitzarPosicio('interior'), 'interior');
});

test('esPosicioValida acepta 11-48 y las dos pterigoideas, nada más', () => {
  ['11', '18', '28', '48', 'Fisura pterigoidea (cuadrante 1)', 'Fisura pterigoidea (cuadrante 2)'].forEach(v =>
    assert.equal(PM.esPosicioValida(v), true, v));
  ['10', '19', '49', '', 'No especificado', 'Fisura pterigoidea', 'Fisura pterigoidea (cuadrante 3)'].forEach(v =>
    assert.equal(PM.esPosicioValida(v), false, v));
});

test('ordrePosicio pone la pterigoidea justo después del 18 / 28', () => {
  const posicions = ['21', 'Fisura pterigoidea (cuadrante 2)', '28', '11', 'Fisura pterigoidea (cuadrante 1)', '18', '31'];
  const ordenades = posicions.slice().sort((a, b) => PM.ordrePosicio(a) - PM.ordrePosicio(b));
  assert.deepEqual(ordenades, ['11', '18', 'Fisura pterigoidea (cuadrante 1)', '21', '28', 'Fisura pterigoidea (cuadrante 2)', '31']);
  assert.equal(PM.ordrePosicio('No especificado'), 0); // como el portal de antes
});

// --- S4: pilar ---

test('normalitzarTipusPilar lleva el vocabulario antiguo y el de la ficha al tipo canónico', () => {
  assert.equal(PM.normalitzarTipusPilar('NO'), 'Sin pilar');
  assert.equal(PM.normalitzarTipusPilar('No'), 'Sin pilar');
  assert.equal(PM.normalitzarTipusPilar('Sin pilar'), 'Sin pilar');
  assert.equal(PM.normalitzarTipusPilar('Multi-unit 3 mm'), 'Multi-unit');
  assert.equal(PM.normalitzarTipusPilar('+Mt-U 5mm'), 'Multi-unit');
  assert.equal(PM.normalitzarTipusPilar('+ PC 4 (HE41404)'), 'A cabeza de implante');
  assert.equal(PM.normalitzarTipusPilar('Pc5'), 'A cabeza de implante');
  assert.equal(PM.normalitzarTipusPilar('A cabeza de implante'), 'A cabeza de implante');
  assert.equal(PM.normalitzarTipusPilar(''), ''); // vacío = aún no se sabe
  assert.equal(PM.normalitzarTipusPilar('Locator'), 'Locator');
});

test('analitzarTextPilar entiende el texto de Quartup', () => {
  const r = PM.analitzarTextPilar('0196, mult-unit 3mm avinent hexagon externo : 2.00, 25,26');
  assert.deepEqual(r.camps, { pilar: 'Multi-unit', pilar_altura: '3', pilar_marca: 'Avinent', pilar_conexion: 'Externa', pilar_ref: '0196' });
  assert.deepEqual(r.posicions, ['25', '26']);
  assert.equal(r.quantitat, 2);
  assert.equal(r.reconegut, true);
});

test('analitzarTextPilar: angulado "30x5 mm", referencia "ref: 0190" y marca del catálogo', () => {
  assert.deepEqual(PM.analitzarTextPilar('Multi-unit 30x5 mm HE48865').camps,
    { pilar: 'Multi-unit', pilar_angulacion: '30', pilar_altura: '5', pilar_ref: 'HE48865' });
  assert.deepEqual(PM.analitzarTextPilar('multi-unit 1 mm avinent hexagon externo ref: 0190').camps,
    { pilar: 'Multi-unit', pilar_altura: '1', pilar_marca: 'Avinent', pilar_conexion: 'Externa', pilar_ref: '0190' });
  assert.deepEqual(PM.analitzarTextPilar('Multi-unit 1,5mm Dentium int.', ['Dentium']).camps,
    { pilar: 'Multi-unit', pilar_altura: '1.5', pilar_marca: 'Dentium' });
  assert.equal(PM.analitzarTextPilar('MU 2mm hex interna').camps.pilar_conexion, 'Interna');
});

test('analitzarTextPilar: "+PC" es A cabeza de implante y su REF (pilar provisional) no se guarda', () => {
  assert.deepEqual(PM.analitzarTextPilar('+ PC 4 (HE41404)').camps, { pilar: 'A cabeza de implante' });
});

test('analitzarTextPilar no se inventa nada con un texto que no entiende', () => {
  const r = PM.analitzarTextPilar('hola, que tal');
  assert.deepEqual(r.camps, {});
  assert.equal(r.reconegut, false);
  assert.deepEqual(PM.analitzarTextPilar('').camps, {});
  assert.deepEqual(PM.analitzarTextPilar(null).posicions, []);
});

// Casos de la revisión adversarial (2026-10-03)
test('normalitzarPosicio no saca el cuadrante de un diente, unos mm o una fecha', () => {
  assert.equal(PM.normalitzarPosicio('Z(pterigo) 16'), 'No especificado');
  assert.equal(PM.normalitzarPosicio('pterigo 28'), 'No especificado');
  assert.equal(PM.normalitzarPosicio('pterigo Q1 9/2/26'), 'Fisura pterigoidea (cuadrante 1)');
  assert.equal(PM.normalitzarPosicio('Pterigo 2 quadrant 12mm'), 'Fisura pterigoidea (cuadrante 2)');
  assert.equal(PM.normalitzarPosicio('pterigo 1r Q 2026'), 'Fisura pterigoidea (cuadrante 1)');
});

test('analitzarTextPilar: el PC no deja altura, las fechas no son REF ni posición, "MU 0196" -> 0196', () => {
  assert.deepEqual(PM.analitzarTextPilar('+ PC 4 mm').camps, { pilar: 'A cabeza de implante' });
  assert.deepEqual(PM.analitzarTextPilar('+PC 4mm HE41404').camps, { pilar: 'A cabeza de implante' });
  assert.equal(PM.analitzarTextPilar('Multi-unit 3mm Avinent MU 0196').camps.pilar_ref, '0196');
  assert.equal(PM.analitzarTextPilar('multi-unit hex 0196').camps.pilar_ref, '0196');
  const conData = PM.analitzarTextPilar('mult-unit 3mm 12/10/2025 0196');
  assert.equal(conData.camps.pilar_ref, '0196');
  assert.deepEqual(conData.posicions, []);
  assert.equal(PM.analitzarTextPilar('multi-unit 2mm TWADBT2-RP').camps.pilar_ref, 'TWADBT2-RP');
});

test('normalitzarTipusPilar no convierte una negación en Multi-unit', () => {
  assert.equal(PM.normalitzarTipusPilar('no multi unit'), 'no multi unit');
  assert.equal(PM.normalitzarTipusPilar('Sin multi-unit'), 'Sin multi-unit');
});
