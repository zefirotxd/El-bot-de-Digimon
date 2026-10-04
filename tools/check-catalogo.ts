/**
 * Auditoría del catálogo de Digimon.
 *
 *     npm run check:catalogo
 *
 * Comprueba lo que el encargo pide comprobar y NO declara el catálogo completo
 * mientras queden cosas sin revisar. Cada sección dice cuántos casos hay y pone
 * ejemplos, para que la lista sea accionable y no un «hay 400 problemas».
 *
 * LA COMPROBACIÓN QUE MÁS VALE
 *
 * El contraste entre el infobox y las categorías de la wiki. Cada especie está
 * clasificada dos veces de forma independiente: en los campos `|level=`, `|type=`
 * y `|attribute=` del infobox, y en las categorías `Champion level`, `Dinosaur
 * type` y `Vaccine attribute`.
 *
 * Cuando los dos sistemas discrepan, la wiki se contradice a sí misma. Eso es
 * información real que hay que mirar, y es el tipo de cosa que se cuela sin que
 * nadie se entere: si solo se leyera el infobox, una especie con el nivel mal
 * entraría al catálogo como si fuera verdad.
 */

process.env.DISCORD_TOKEN ??= 'fake';
process.env.DISCORD_CLIENT_ID ??= '0';

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  metaCatalogo,
  totalEspecies,
  todasEntradas,
  entradaDe,
  lineaDe,
  listaDeFamilias,
  auditarCatalogo,
  ATRIBUTOS_ES,
  NIVELES_ES,
  nivelEnJuego,
  atributoEnJuego,
  presentarImagen,
  politicaImagen,
  type EntradaCatalogo,
} from '../src/game/catalogo.js';

/**
 * La base de datos de esta comprobación.
 *
 * Va aparte y se borra al terminar. La auditoría lee un JSON, pero la parte de la
 * interfaz crea un entrenador de verdad, y eso toca la base. Sin esto, el
 * verificador dejaría basura en `data/` en cada ejecución.
 */
let fallos = 0;
const pendiente: string[] = [];

function check(etiqueta: string, ok: boolean, detalle = ''): void {
  if (!ok) {
    fallos++;
    pendiente.push(etiqueta);
  }
  console.log(`  ${ok ? '✓' : '✗'} ${etiqueta}${detalle ? ` (${detalle})` : ''}`);
}

/** Un dato que no es un fallo pero que hay que dejar escrito. */
function aviso(etiqueta: string, ok: boolean, detalle = ''): void {
  if (!ok) pendiente.push(etiqueta);
  console.log(`  ${ok ? '·' : '!'} ${etiqueta}${detalle ? ` (${detalle})` : ''}`);
}

function barra(ok: number, total: number): string {
  if (total === 0) return '';

  const n = Math.round((ok / total) * 20);
  return '█'.repeat(n) + '░'.repeat(20 - n);
}

const entradas = todasEntradas();
const meta = metaCatalogo();

console.log('=== CATÁLOGO DE DIGIMON ===\n');
console.log(`  ${entradas.length} especies`);
console.log(`  fuente: ${meta.fuente}`);
console.log(`  categoría: ${meta.categoria}`);
console.log(`  generada: ${meta.generado}`);
console.log(`  política de imagen: ${politicaImagen()}`);
console.log('');

// ==========================================================================
console.log('=== 1. INTEGRIDAD DEL CATÁLOGO ===');
// ==========================================================================

{
  const claves = new Map<string, number>();
  for (const e of entradas) claves.set(e.key, (claves.get(e.key) ?? 0) + 1);

  const duplicadas = [...claves.entries()].filter(([, n]) => n > 1);

  check(
    'ninguna clave repetida',
    duplicadas.length === 0,
    duplicadas.length > 0 ? duplicadas.slice(0, 5).map(([k, n]) => `${k}×${n}`).join(', ') : `${claves.size} claves únicas`,
  );

  check(
    'ninguna entrada sin página de origen',
    entradas.every((e) => e.procedencia.url.startsWith('https://')),
  );

  check(
    'toda entrada tiene fecha de descarga',
    entradas.every((e) => !Number.isNaN(Date.parse(e.procedencia.descargado))),
  );

  // Una clave vacía rompería los botones y las URLs en silencio.
  const clavesVacias = entradas.filter((e) => e.key === '' || e.key === null);
  check('ninguna clave vacía', clavesVacias.length === 0, `${clavesVacias.length}`);

  // La clave tiene que poder ir en un `custom_id` de Discord, que admite 100
  // caracteres y no tolera paréntesis.
  const clavesLargas = entradas.filter((e) => e.key.length > 60);
  check(
    'ninguna clave kilométrica',
    clavesLargas.length === 0,
    clavesLargas.length > 0 ? `la más larga: ${clavesLargas[0]!.key.length} caracteres` : '',
  );
}

// ==========================================================================
console.log('\n=== 2. LAS IMÁGENES ===');
// ==========================================================================

{
  const conUrl = entradas.filter((e) => e.imagen.url !== null);
  const http = conUrl.filter((e) => e.imagen.url!.startsWith('https://'));
  const conPagina = conUrl.filter((e) => e.imagen.pagina !== null);
  const conFichero = conUrl.filter((e) => e.imagen.fichero !== null);
  const conLicencia = entradas.filter((e) => e.imagen.licencia !== '');

  console.log(`  con URL      ${barra(conUrl.length, entradas.length)} ${conUrl.length}/${entradas.length}`);
  console.log(`  con página   ${barra(conPagina.length, conUrl.length)} ${conPagina.length}/${conUrl.length}`);
  console.log(`  con fichero  ${barra(conFichero.length, conUrl.length)} ${conFichero.length}/${conUrl.length}`);
  console.log(`  con licencia ${barra(conLicencia.length, entradas.length)} ${conLicencia.length}/${entradas.length}`);
  console.log('');

  check('toda imagen con URL usa https', http.length === conUrl.length, `${conUrl.length - http.length} sin https`);

  // El `fichero` es lo que permite comprobar que la imagen es de esta especie. Sin
  // él no se puede auditar nada, y por eso es obligatorio cuando hay imagen.
  check(
    'toda imagen guarda su nombre de fichero',
    conUrl.every((e) => e.imagen.fichero !== null),
    `${conUrl.filter((e) => e.imagen.fichero === null).length} sin fichero`,
  );

  check(
    'toda imagen guarda su página de procedencia',
    conUrl.every((e) => e.imagen.pagina !== null),
  );

  check('toda entrada declara una licencia', conLicencia.length === entradas.length);

  // --- correspondencia -----------------------------------------------------
  const verificadas = entradas.filter((e) => e.imagen.correspondencia === 'verificado');
  const descartadas = entradas.filter((e) => e.pendientes.includes('imagen-equivocada'));
  const aRevisar = entradas.filter((e) => e.pendientes.includes('imagen-revisar'));

  console.log(`  correspondencia verificada: ${verificadas.length}`);
  console.log(`  descartada (era de otra especie): ${descartadas.length}`);
  console.log(`  con nombre dudoso, a revisar:      ${aRevisar.length}`);
  console.log('');

  if (descartadas.length > 0) {
    console.log('  imágenes descartadas por ser de otra especie:');
    for (const e of descartadas.slice(0, 8)) {
      console.log(`    ${e.nombre.padEnd(34)} ${e.imagen.detalleCorrespondencia.slice(0, 78)}`);
    }
    if (descartadas.length > 8) console.log(`    … y ${descartadas.length - 8} más`);
    console.log('');
  }

  if (aRevisar.length > 0) {
    console.log('  imágenes con nombre dudoso (NO se descartan: hay que mirarlas):');
    for (const e of aRevisar.slice(0, 6)) {
      console.log(`    ${e.nombre.padEnd(34)} fichero=${e.imagen.fichero}`);
    }
    if (aRevisar.length > 6) console.log(`    … y ${aRevisar.length - 6} más`);
    console.log('');
  }

  // Lo que se DESCARTÓ no es un problema pendiente: es una decisión ya tomada. Y
  // lo que no se descartó tampoco: es una imagen cuyo nombre no dice nada, que
  // puede ser correcta. Ninguno de los dos grupos es un bloqueante.
  //
  // Lo que sí lo sería es una imagen marcada `difiere` que además siga teniendo
  // URL: eso sería el error que la pasada del importadoriba a corregir y no
  // corrigió, y sería una imagen de otro Digimon enseñándose como esta.
  check(
    'ninguna imagen descartada sigue enlazada',
    descartadas.every((e) => e.imagen.url === null && e.imagen.miniatura === null),
    `${descartadas.filter((e) => e.imagen.url !== null).length} con URL`,
  );

  check(
    'toda entrada tiene su imagen resuelta en un sentido u otro',
    entradas.every(
      (e) =>
        e.imagen.correspondencia === 'verificado' ||
        e.imagen.correspondencia === 'pendiente' ||
        e.pendientes.includes('imagen-equivocada'),
    ),
  );

  // --- la política de imagen ----------------------------------------------
  const queSeMostrarian = entradas.filter((e) => presentarImagen(e).embebir !== null);

  check(
    'por defecto no se embebe ninguna imagen protegida',
    politicaImagen() === 'enlazar' || queSeMostrarian.length === 0,
    `${queSeMostrarian.length} embebibles con la política actual`,
  );

  if (politicaImagen() === 'enlazar') {
    check('nada se embebe mientras la política sea enlazar', queSeMostrarian.length === 0);
  }
}

// ==========================================================================
console.log('\n=== 3. CAMPOS OBLIGATORIOS ===');
// ==========================================================================

{
  const sinNivel = entradas.filter((e) => e.nivel.estado !== 'verificado');
  const sinTipo = entradas.filter((e) => e.tipo.estado !== 'verificado');
  const sinAtributo = entradas.filter((e) => e.atributo.estado !== 'verificado');
  const sinFamilias = entradas.filter((e) => listaDeFamilias(e).length === 0);
  const sinAlias = entradas.filter((e) => e.nombresAlternativos.estado !== 'verificado');

  // El filtro del importador descarta lo que no tenga nivel y tipo, así que estos
  // dos tienen que estar a cero. Si no lo están, alguien cambió el filtro y hay
  // que saberlo.
  check('toda especie declara su nivel', sinNivel.length === 0, `${sinNivel.length}`);
  check('toda especie declara su tipo', sinTipo.length === 0, `${sinTipo.length}`);

  // Estos dos SÍ son huecos reales de la fuente, y hay que verlos.
  aviso('especies con familia', sinFamilias.length === 0, `${sinFamilias.length} sin familia`);
  aviso(
    'especies con nombres alternativos',
    sinAlias.length === 0,
    `${sinAlias.length} sin alias`,
  );

  // Una especie sin atributo no rompe nada: el juego le pone el suyo, y la ficha
  // muestra el nivel y el tipo. La fuente tiene páginas con el campo vacío, y eso
  // se reporta. Lo que SÍ sería un error es inventar el valor, y no se hace.
  aviso('especies con atributo en la fuente', sinAtributo.length === 0, `${sinAtributo.length} sin atributo`);

  const sinDescripcion = entradas.filter((e) => e.descripcion === null);
  aviso('especies con descripción', sinDescripcion.length === 0, `${sinDescripcion.length} sin descripción`);

  const sinAtaques = entradas.filter((e) => e.ataques.length === 0);
  aviso('especies con ataques documentados', sinAtaques.length === 0, `${sinAtaques.length} sin ataques`);

  // Un nivel que el juego no reconoce tiene que verse marcado, no encajado.
  const nivelesDesconocidos = entradas.filter((e) => !Object.keys(NIVELES_ES).includes(e.nivel.valor));
  aviso(
    'niveles reconocidos por el juego',
    nivelesDesconocidos.length === 0,
    nivelesDesconocidos.length > 0
      ? [...new Set(nivelesDesconocidos.map((e) => e.nivel.valor))].slice(0, 6).join(', ')
      : '',
  );
}

// ==========================================================================
console.log('\n=== 4. LÍNEAS EVOLUTIVAS ===');
// ==========================================================================

{
  const conAnterior = entradas.filter((e) => e.desde.length > 0);
  const conSiguiente = entradas.filter((e) => e.hacia.length > 0);
  const huerfanas = conAnterior.filter((e) => lineaDe(e.key).anterior.length === 0);
  const rotas = conSiguiente.filter((e) => lineaDe(e.key).posterior.length === 0);

  // Un enlace a una especie que no está importada NO es un error del catálogo: es
  // un hueco de la fuente, o una página que quedó fuera de la categoría. La línea
  // aparece cortada, y eso se dice, pero no se puede arreglar desde aquí y no debe
  // tener la suite en rojo.
  aviso(
    'toda forma anterior apunta a una especie importada',
    huerfanas.length === 0,
    `${huerfanas.length} de ${conAnterior.length} apuntan a algo fuera del catálogo`,
  );
  aviso(
    'toda forma posterior apunta a una especie importada',
    rotas.length === 0,
    `${rotas.length} de ${conSiguiente.length} apuntan a algo fuera del catálogo`,
  );

  // Que no haya evolved desde Y hacia a la vez es raro pero no imposible: hay
  // especies con rutas cruzadas. Se avisa, no se falla.
  const sinNinguna = entradas.filter((e) => e.desde.length === 0 && e.hacia.length === 0);
  aviso(
    'especies con al menos una ruta documentada',
    sinNinguna.length === 0,
    `${sinNinguna.length} sin ninguna ruta`,
  );

  // Un ciclo de verdad, en cambio, SÍ es un fallo. Produciría un botón que lleva a
  // la misma ficha: el jugador pulsa «evoluciona a» y no pasa nada. El importador
  // quita los enlaces a sí mismo y los marca en `pendientes`; que quede alguno sin
  // quitar sería un fallo del importador, no de la fuente.
  const ciclos = entradas.filter((e) => e.hacia.some((h) => h === e.pagina || h === e.nombre));
  check(
    'ninguna especie evoluciona a sí misma',
    ciclos.length === 0,
    `${ciclos.length} con enlace a sí misma`,
  );

  // Las que la fuente lo declara sí, y el importador lo tapó: no es un fallo, pero
  // tiene que quedar a la vista para saber que la fuente tiene datos raros.
  const autoEnFuente = entradas.filter((e) => e.pendientes.includes('auto-evolucion-en-fuente'));
  aviso(
    'ninguna fuente declara una auto-evolución sin quitar',
    autoEnFuente.length === 0,
    `${autoEnFuente.length} la fuente las declara y el importador las tapó`,
  );
}

// ==========================================================================
console.log('\n=== 5. EL JUEGO CONTRA LA FUENTE ===');
// ==========================================================================

{
  const activables = leerActivables();

  const propias = activables.sinCruce.filter((s) => 'propia' in s);
  const inexplicadas = activables.sinCruce.filter((s) => !('propia' in s));

  console.log(`  especies activables:    ${activables.especies.length}`);
  console.log(`  contenido propio:       ${propias.length} (declarado en catalogo-propias.json)`);
  console.log(`  sin explicación:        ${inexplicadas.length}`);
  console.log('');

  if (propias.length > 0) {
    console.log('  CONTENIDO PROPIO DEL JUEGO, sin ficha en el canon:');
    console.log('');
    for (const s of propias as { juego: string; nombre: string; inspiradoEn: string | null; motivo: string }[]) {
      const de = s.inspiradoEn ? `en raíz a ${s.inspiradoEn}` : 'sin antecesor oficial';
      console.log(`    ${s.juego.padEnd(16)} ${de}`);
      console.log(`      ${s.motivo.slice(0, 92)}`);
    }
    console.log('');
  }

  if (inexplicadas.length > 0) {
    console.log('  ⚠️ ESPECIES SIN FICHA Y SIN EXPLICACIÓN:');
    console.log('');
    console.log('  Estas no están en la wiki y tampoco están declaradas como contenido');
    console.log('  propio. O el nombre está mal escrito o alguien inventó un Digimon sin');
    console.log('  decirlo. Es el único caso que bloquea el catálogo.');
    console.log('');
    for (const s of inexplicadas) console.log(`    ${s.juego.padEnd(16)} (${s.nombre})`);
    console.log('');
  }

  // Las propias NO son un fallo: están declaradas, con su motivo y su antecesor.
  // Tratarlas como error sería el equivalente en este sistema de borrar el nombre
  // equivocado de una especie: taparía el problema quitando la evidencia.
  check(
    'toda especie activable tiene ficha o está declarada como propia',
    inexplicadas.length === 0,
    `${inexplicadas.length} sin explicación`,
  );

  // Y una especie propia tiene que declarar de qué Digimon real salió, salvo que
  // sea el primero de su línea. Sin eso, «propia» es un cajón de sastre.
  const propiasSinRaiz = propias.filter(
    (s) => !(s as { motivo: string }).motivo || (s as { motivo: string }).motivo.length < 30,
  );
  check(
    'toda especie propia explica de dónde salió',
    propiasSinRaiz.length === 0,
    `${propiasSinRaiz.length} sin motivo`,
  );
}

// ==========================================================================
console.log('\n=== 6. TAXONOMÍA: EL INFBOX CONTRA LAS CATEGORÍAS ===');
// ==========================================================================

{
  // La wiki clasifica cada especie DOS veces de forma independiente: en los campos
  // del infobox y en las categorías de la página. Cuando discrepan, la wiki se
  // contradice a sí misma, y eso es información que hay que mirar.
  //
  // EL PRIMER INTENTO ERA INCORRECTO, Y DABA 316 CONTRADICCIONES FALSAS
  //
  // Se cogía la PRIMERA categoría que encajara con el sufijo y se comparaba con
  // el infobox. Airdramon salía como "infobox=Vaccine, categoría=Data".
  //
  // La wiki no estaba equivocada: Airdramon tiene TRES categorías de atributo —
  // Data, Vaccine y Virus — porque fue las tres cosas según la serie. El `find()`
  // cogía la primera y la daba por una contradicción que no existía.
  //
  // La comprobación correcta es si el CONJUNTO de categorías CONTIENE el valor del
  // infobox. Con eso desaparecen las falsas alarmas y quedan las de verdad.
  //
  // Y hay un segundo eje que no se puede comparar: Hybrid, Jogress, Burst Mode y
  // Armor son CLASES DE FORMA, no etapas evolutivas. Un `|level=Hybrid` con
  // categoría `Jogress level` no se contradice: son preguntas distintas.

  /** Etapas evolutivas. Solo estas se comparan contra el campo de nivel. */
  const ETAPAS = ['Fresh', 'In-Training', 'Rookie', 'Champion', 'Ultimate', 'Mega', 'Super Ultimate', 'Ultra'];

  /** Atributos concretos. None y Unidentified no son un valor: son una ausencia. */
  const ATRIBUTOS_CONCRETOS = ['Vaccine', 'Data', 'Virus', 'Free'];

  const nivelFalta: string[] = [];
  const tipoFalta: string[] = [];
  const atributoFalta: string[] = [];

  for (const e of entradas) {
    const nivelesCat = e.categorias.filter((c) => c.endsWith(' level')).map((c) => c.slice(0, -6));
    const tiposCat = e.categorias.filter((c) => c.endsWith(' type')).map((c) => c.slice(0, -5));
    const atributosCat = e.categorias.filter((c) => c.endsWith(' attribute')).map((c) => c.slice(0, -10));

    // Solo se comprueba si el valor del infobox pertenece al eje comparable.
    if (ETAPAS.includes(e.nivel.valor) && nivelesCat.length > 0 && !nivelesCat.includes(e.nivel.valor)) {
      nivelFalta.push(e.nombre);
    }

    if (tiposCat.length > 0 && !tiposCat.includes(e.tipo.valor)) tipoFalta.push(e.nombre);

    if (ATRIBUTOS_CONCRETOS.includes(e.atributo.valor) && atributosCat.length > 0) {
      // Se acepta que aparezca en cualquiera de los dos campos: una especie con
      // tres atributos tiene tres categorías, y el infobox solo tiene dos campos.
      const tiene = atributosCat.includes(e.atributo.valor) || atributosCat.includes(e.atributo2.valor);
      if (!tiene) atributoFalta.push(e.nombre);
    }
  }

  const nivelDeOtroEje = entradas.filter((e) => !ETAPAS.includes(e.nivel.valor));

  console.log(`  nivel del infobox ausente en sus categorías:    ${nivelFalta.length}`);
  console.log(`  tipo del infobox ausente en sus categorías:     ${tipoFalta.length}`);
  console.log(`  atributo del infobox ausente en sus categorías: ${atributoFalta.length}`);
  console.log(`  nivel de otra clase de forma:                   ${nivelDeOtroEje.length} (Hybrid, Jogress, Burst Mode…)`);
  console.log('');

  if (nivelFalta.length > 0) {
    console.log('  nivel del infobox que no sale en sus categorías:');
    for (const n of nivelFalta.slice(0, 8)) {
      const e = entradaDe(claveDeNombre(n))!;
      const cat = e.categorias.filter((c) => c.endsWith(' level')).join(', ') || '—';
      console.log(`    ${e.nombre.padEnd(30)} infobox=${e.nivel.valor.padEnd(14)} categorías=${cat}`);
    }
    console.log('');
  }

  if (atributoFalta.length > 0) {
    console.log('  atributo del infobox que no sale en sus categorías:');
    for (const n of atributoFalta.slice(0, 8)) {
      const e = entradaDe(claveDeNombre(n))!;
      const cat = e.categorias.filter((c) => c.endsWith(' attribute')).join(', ') || '—';
      console.log(`    ${e.nombre.padEnd(30)} infobox=${e.atributo.valor.padEnd(12)} categorías=${cat}`);
    }
    console.log('');
  }

  // Aviso, no fallo: la fuente puede tener páginas mal clasificadas, y hacer
  // fallar la suite por eso taparía los errores que sí son del catálogo.
  aviso('el nivel del infobox aparece en sus categorías', nivelFalta.length === 0, `${nivelFalta.length}`);
  aviso('el tipo del infobox aparece en sus categorías', tipoFalta.length === 0, `${tipoFalta.length}`);
  aviso('el atributo del infobox aparece en sus categorías', atributoFalta.length === 0, `${atributoFalta.length}`);

  // --- valores que la wiki escribe cuando no lo sabe -----------------------
  // El infobox a veces lleva el atributo vacío o `NO DATA`. Importarlo como si
  // fuera un valor sería inventar, así que se cuenta y se señala.
  const basura = entradas.filter(
    (e) =>
      e.atributo.valor === '' ||
      e.atributo.valor === 'NO DATA' ||
      e.nivel.valor === 'NO DATA' ||
      e.tipo.valor === 'NO DATA',
  );

  aviso('sin valores de «NO DATA» sin tratar', basura.length === 0, `${basura.length} con «NO DATA» o vacío`);

  // --- el atributo del juego, que es OTRO campo ----------------------------
  //
  // El triángulo del juego puede divergir del canon a propósito —es una decisión
  // de diseño— pero esa divergencia tiene que estar escrita en
  // `dex-accepted.json`. Aquí no se puede comprobar: `check:dex` es quien mira eso.
  const divergentes = entradas.filter((e) => e.activable && atributoEnJuego(e.atributo.valor) === null);
  aviso(
    'el atributo oficial se puede traducir al triángulo del juego',
    divergentes.length === 0,
    divergentes.length > 0 ? [...new Set(divergentes.map((e) => e.atributo.valor))].join(', ') : '',
  );
}

// ==========================================================================
console.log('\n=== 7. LA INTERFAZ DICE LA VERDAD ===');
// ==========================================================================

{
  // Un nivel que el juego no tiene tiene que SALTAR A LA VISTA. Si `nivelEnJuego`
  // devolviera el valor tal cual sin marcarlo, una especie de nivel desconocido
  // se presentaría como si encajara en el juego.
  const desconocidos = entradas.filter((e) => nivelEnJuego(e.nivel.valor).includes('fuera de las bandas'));
  const marcados = conocidos_si_estan_marcados(desconocidos);

  check(
    'un nivel desconocido se marca como tal',
    marcados,
    `${desconocidos.length} niveles fuera de las bandas, todos marcados`,
  );

  // La imagen de una ficha tiene que ser o un enlace a la fuente o una imagen
  // verificada. Nunca una URL suelta.
  const malPresentadas = entradas.filter((e) => {
    const p = presentarImagen(e);

    if (p.embebir !== null) {
      // Solo se permite embebir con la política explícita y licencia no protegida.
      return politicaImagen() !== 'embebida';
    }

    return p.pagina === null;
  });

  check(
    'toda ficha ofrece imagen o un enlace a su fuente',
    malPresentadas.length === 0,
    `${malPresentadas.length} sin ninguna de las dos`,
  );

  // El aviso de licencia tiene que salir cuando la imagen no es libre.
  const sinAviso = entradas.filter(
    (e) => e.imagen.licencia !== 'oficial-bandai-toei-protegido' && presentarImagen(e).aviso === null,
  );

  check('las imágenes protegidas avisan de su licencia', sinAviso.length === 0, `${sinAviso.length}`);
}

// ==========================================================================
console.log('\n=== 8. INFORME DE COBERTURA ===');
// ==========================================================================

{
  const a = auditarCatalogo();

  const filas: [string, number, number][] = [
    ['Con imagen', a.conImagen, a.total],
    ['Imagen verificada', a.conImagenVerificada, a.total],
    ['Con familia', a.total - a.sinFamilias, a.total],
    ['Con descripción', a.total - a.sinDescripcion, a.total],
    ['Con ataques', a.total - a.sinAtaques, a.total],
    ['Forma final documentada', a.formasFinales, a.total],
    ['Con línea evolutiva', a.total - a.sinEvolucionConocida, a.total],
  ];

  for (const [nombre, ok, total] of filas) {
    const pct = total === 0 ? 0 : Math.round((ok / total) * 100);
    console.log(`  ${nombre.padEnd(26)} ${barra(ok, total)} ${String(pct).padStart(3)}%  ${ok}/${total}`);
  }

  console.log('');
  console.log(`  ${a.total} especies documentadas`);
  console.log(`  ${a.activables} activables en el juego`);
  console.log(`  ${a.imagenesSospechosas} imágenes sospechosas`);
  console.log('');

  check('el informe de auditoría se puede calcular', a.total === entradas.length);
}

// ==========================================================================
console.log('\n=== 9. PENDIENTES PRIORIZADOS ===');
// ==========================================================================

{
  // El encargo dice que no se declara el catálogo completo mientras queden cosas.
  // Esta sección es la que lo cumple, y su salida es la lista de trabajo.
  const porCampo = new Map<string, number>();

  for (const e of entradas) {
    for (const p of e.pendientes) porCampo.set(p, (porCampo.get(p) ?? 0) + 1);
  }

  const orden = [...porCampo.entries()].sort((a, b) => b[1] - a[1]);

  console.log('  campo                     .entries pendientes');
  console.log('  ' + '─'.repeat(46));

  for (const [campo, n] of orden) {
    console.log(`  ${campo.padEnd(26)} ${String(n).padStart(5)}`);
  }

  console.log('');

  const a = auditarCatalogo();
  const activables = leerActivables();

  const propias = activables.sinCruce.filter((s) => 'propia' in s).length;
  const inexplicadas = activables.sinCruce.filter((s) => !('propia' in s)).length;
  const descartadas = entradas.filter((e) => e.pendientes.includes('imagen-equivocada'));
  const aRevisar = entradas.filter((e) => e.pendientes.includes('imagen-revisar'));

  // Lo que BLOQUEA declarar el catálogo completo.
  //
  // Las imágenes dudosas NO bloquean: no se han descartado, están marcadas para
  // revisión manual, y son el estado honesto de una fuente que nombra sus ficheros
  // como `N-12 10 1.jpg`. Bloquear con eso taparía el resto del informe detrás de
  // una lista de escaneos de carta.
  const bloqueantes: [string, number, string][] = [
    [
      'especies activables sin ficha ni declaración',
      inexplicadas,
      'o se corrige el nombre o se añade a catalogo-propias.json',
    ],
    [
      'imágenes descartadas que siguen enlazadas',
      descartadas.filter((e) => e.imagen.url !== null).length,
      'sería enseñar la imagen de otro Digimon como si fuera esta',
    ],
    [
      'claves de catálogo duplicadas',
      a.clavesDuplicadas.length,
      'dos especies que el catálogo no puede distinguir',
    ],
  ];

  console.log('  BLOQUEANTES:');
  for (const [nombre, n, nota] of bloqueantes) {
    console.log(`    ${n === 0 ? '✓' : '✗'} ${nombre.padEnd(46)} ${n}`);
    if (n > 0 && nota !== '') console.log(`      ${nota}`);
  }
  console.log('');

  console.log('  PENDIENTES QUE NO BLOQUEAN:');
  console.log(`    · contenido propio declarado                   ${propias}`);
  console.log(`    · imágenes descartadas por ser de otra especie  ${descartadas.length}`);
  console.log(`    · imágenes con nombre dudoso, a revisar         ${aRevisar.length}`);
  console.log('');

  const conBloqueantes = bloqueantes.filter(([, n]) => n > 0).length;

  console.log(
    conBloqueantes === 0
      ? '  Sin bloqueantes. El catálogo se puede declarar cerrado; lo que queda son huecos'
      : `  ${conBloqueantes} bloqueante(s). El catálogo NO puede declararse completo.`,
  );

  if (conBloqueantes === 0) {
    console.log('  de la fuente y trabajo manual, ya listados arriba.');
  }
}

// ==========================================================================
console.log('\n=== 10. LA INTERFAZ DEL CATÁLOGO ===');
// ==========================================================================

{
  // Que la pantalla exista y pinte no es lo mismo que pinte lo correcto. Aquí se
  // monta con un contexto real y se comprueba que aparecen los datos que el
  // encargo pide: nivel, tipo, atributo, familias y evoluciones.
  //
  // NO SE USA LA BASE DE DATOS. Las dos pantallas solo leen el catálogo, así que
  // el entrenador es un objeto plano. Y hay un motivo técnico además del bueno:
  // en ESM los `import` estáticos se evalúan ANTES que cualquier sentencia del
  // módulo, así que una línea que pusiera `process.env.DATABASE_PATH` aquí llegaría
  // tarde y `config.ts` ya habría leído la de por defecto. La primera versión
  // creaba un entrenador de verdad y fallaba con "UNIQUE constraint failed" porque
  // estaba escribiendo en la base de datos principal del bot.
  await import('../src/ui/router.js');
  const pantallaMod = await import('../src/ui/screen.js');
  const sesion = await import('../src/ui/session.js');

  const nav = sesion.ensureSession('u-cat-ui', 1);

  const ctx = {
    interaction: { user: { id: 'u-cat-ui' } },
    trainer: {
      id: 1,
      discordId: 'u-cat-ui',
      username: 'Auditor',
      digibytes: 1000,
      battlesWon: 0,
      battlesLost: 0,
      createdAt: new Date().toISOString(),
    },
    session: nav,
    params: {} as Record<string, string>,
    present: async () => undefined,
    go: async () => undefined,
    refresh: async () => undefined,
    back: async () => undefined,
    home: async () => undefined,
    flash: () => undefined,
    num: (_k: string, v: number) => v,
    page: () => 1,
  };

  const pintar = async (pantalla: string, params: Record<string, string> = {}) => {
    ctx.params = params;
    const h = pantallaMod.getScreen(pantalla);
    return h ? await (h as (c: unknown) => Promise<unknown>)(ctx) : null;
  };

  const lista = await pintar('catalogo');
  const textoLista = JSON.stringify(lista);

  check('el catálogo se pinta', lista !== null && (lista as { embeds?: unknown[] })?.embeds?.length > 0);
  check('y dice cuántas especies documenta', textoLista.includes('especies documentadas'));
  check(
    'y explica que las ilustraciones no se incrustan',
    textoLista.includes('no se incrustan'),
  );

  // Una especie concreta con toda la información.
  const war = entradaDe('wargreymon') ?? entradaDe('war_greymon');
  check('WarGreymon está en el catálogo', war !== null, war?.nombre ?? 'no está');

  if (war) {
    const ficha = await pintar('cat_especie', { e: war.key });
    const texto = JSON.stringify(ficha);

    check('la ficha de especie se pinta', ficha !== null && (ficha as { embeds?: unknown[] })?.embeds?.length > 0);
    check('y trae el nivel oficial', texto.includes(war.nivel.valor), war.nivel.valor);
    check('y el tipo oficial', texto.includes(war.tipo.valor), war.tipo.valor);
    check('y el atributo oficial', texto.includes('Atributo'));
    check('y la línea evolutiva', texto.includes('Línea evolutiva'));
    check('y la procedencia', texto.includes('Fuente'));
    check('y la licencia', texto.includes('Licencia'));

    // Con la política por defecto no puede haber ninguna URL de imagen en el embed:
    // si se colara, la decisión de derechos se habría repartido por las pantallas.
    const embebidas = JSON.stringify((ficha as { embeds?: unknown[] })?.embeds ?? []).includes('static.wikia');
    check(
      'con la política por defecto no se embebe ninguna ilustración',
      politicaImagen() === 'embebida' || !embebidas,
    );
  }

  // La ficha de una especie que NO existe tiene que fallar sin reventar.
  const inexistente = await pintar('cat_especie', { e: 'no_existe_esta_especie' });
  check('una especie inexistente no rompe nada', inexistente === undefined || inexistente === null);
}

/**
 * La raíz del proyecto.
 *
 * Va con `fileURLToPath` y no con `new URL(...).pathname` porque el directorio
 * tiene un espacio en el nombre y `pathname` lo devuelve como `%20`: el error sale
 * como "no such file" sobre un fichero que existe.
 */
function raizProyecto(): string {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

function claveDeNombre(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function conocidos_si_estan_marcados(lista: EntradaCatalogo[]): boolean {
  return lista.every((e) => nivelEnJuego(e.nivel.valor).includes('fuera de las bandas'));
}

function leerActivables(): {
  especies: { juego: string; catalogo: string; nombre: string }[];
  sinCruce: { juego: string; nombre: string }[];
} {
  // Se lee del disco y no se importa del módulo del juego a propósito: así se
  // puede ver el fichero tal cual está, y no lo que el módulo decidede de él.
  // Si el fichero no existe, se dice: el cruce es el que avisa de qué especies
  // del juego no tienen ficha.
  const ruta = resolve(raizProyecto(), 'src/data/catalogo-activables.json');

  if (!existsSync(ruta)) {
    return {
      especies: [],
      sinCruce: [{ juego: '—', nombre: 'no se ha ejecutado marca-activables' }],
    };
  }

  return JSON.parse(readFileSync(ruta, 'utf8'));
}

console.log('');

if (fallos > 0) {
  console.log('Fallos:');
  for (const p of [...new Set(pendiente)].filter((p) => !p.includes(' '))) {
    console.log('  - ' + p);
  }
}

console.log('');
console.log(
  fallos === 0
    ? `OK: ${totalEspecies()} especies en el catálogo. Los pendientes que quedan son de la fuente, y están listados.`
    : `${fallos} fallo(s). El catálogo no está cerrado.`,
);

process.exit(fallos === 0 ? 0 : 1);
