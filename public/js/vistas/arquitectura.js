// Arquitectura: diagrama interactivo del flujo (Figura 1 del paper), capas, servidores y accesos.

import { esc, fmt, aviso, movimientoReducido, datosDeFormulario } from '../ui/dom.js';
import { banda, chip, claseEstado, tabla, bloqueCodigo, avisoLinea } from '../ui/componentes.js';
import { CAPAS, obtenerDefiniciones, estadoObjeto, almacena } from '../motor/dwh.js';
import { estadoModelo } from '../motor/powerbi.js';
import { PERFILES } from '../motor/catalogos.js';
import { SQL_OBJETOS, SQL_REFERENCIA } from '../motor/sql.js';
import { ejecutarProcesoNocturno, actualizacionProgramadaPowerBI } from '../motor/escenario.js';
import { agregarCuenta, eliminarCuenta } from '../motor/estado.js';
import { formatoMarca } from '../motor/fechas.js';

export const titulo = 'Arquitectura';

const ui = { seleccionado: 'extraccion', animando: false };

const NODOS = [
  { id: 'registro', x: 40, y: 20, w: 520, h: 100, titulo: 'Registro operativo', texto: 'carga manual diaria de datos' },
  { id: 'produccion', x: 40, y: 164, w: 520, h: 100, titulo: 'Base de datos transaccional', texto: 'servidor de producción (origen)', gris: true },
  { id: 'repositorio', x: 600, y: 164, w: 280, h: 100, titulo: 'Repositorio de archivos', texto: 'planillas', gris: true },
  { id: 'extraccion', x: 60, y: 404, w: 480, h: 100, titulo: 'Capa de extracción', texto: 'tablas foráneas → vistas materializadas', gris: true },
  { id: 'calculo', x: 60, y: 544, w: 480, h: 100, titulo: 'Capa de cálculo', texto: 'cálculos intermedios', gris: true },
  { id: 'consumo_agregado', x: 60, y: 688, w: 230, h: 104, titulo: 'Consumo agregado', texto: 'datos agrupados (cubos)', gris: true, angosto: true },
  { id: 'consumo_detalle', x: 310, y: 688, w: 230, h: 104, titulo: 'Consumo de detalle', texto: 'datos en detalle', gris: true, angosto: true },
  { id: 'registro_ejecucion', x: 600, y: 544, w: 230, h: 100, titulo: 'Registro de ejecución', texto: 'diario', angosto: true },
  { id: 'pbi_desktop', x: 40, y: 884, w: 520, h: 100, titulo: 'Power BI Desktop', texto: 'modelo semántico y visualizaciones' },
  { id: 'pbi_service', x: 40, y: 1028, w: 520, h: 100, titulo: 'Power BI Service', texto: 'actualización programada vía gateway' },
  { id: 'sharepoint', x: 40, y: 1172, w: 520, h: 100, titulo: 'SharePoint: gerencias', texto: 'tableros de decisión (sólo lectura)', gris: true },
];

const CONECTORES = [
  { id: 'c-registro', d: 'M300,120 V164', hacia: 'produccion' },
  { id: 'c-extraccion', d: 'M300,264 V330', hacia: 'extraccion', rotulo: { x: 316, y: 303, texto: 'extracción diaria (tablas foráneas)' } },
  { id: 'c-calculo', d: 'M300,504 V544', hacia: 'calculo' },
  { id: 'c-agregado', d: 'M175,644 V688', hacia: 'consumo_agregado' },
  { id: 'c-detalle', d: 'M425,644 V688', hacia: 'consumo_detalle' },
  { id: 'c-log', d: 'M574,594 H600', hacia: 'registro_ejecucion', discontinuo: true },
  { id: 'c-pbi-1', d: 'M175,792 V884', hacia: 'pbi_desktop' },
  { id: 'c-pbi-2', d: 'M425,792 V884', hacia: 'pbi_desktop', rotulo: { x: 441, y: 852, texto: 'sólo lectura' } },
  { id: 'c-repo', d: 'M860,264 V934 H560', hacia: 'pbi_desktop', rotulo: { x: 848, y: 790, texto: 'fuente complementaria', vertical: true } },
  { id: 'c-service', d: 'M300,984 V1028', hacia: 'pbi_service' },
  { id: 'c-sharepoint', d: 'M300,1128 V1172', hacia: 'sharepoint' },
];

const plural = (n, uno, varios) => `${fmt.entero(n)} ${n === 1 ? uno : varios}`;

function peorEstado(codigos) {
  const orden = ['error', 'desactualizado', 'sin_datos', 'actualizado'];
  for (const c of orden) if (codigos.includes(c)) return c;
  return 'actualizado';
}

function objetosDeCapa(e, capa) {
  return obtenerDefiniciones(e).filter((d) => d.capa === capa);
}

function resumenNodo(e, id) {
  const p = e.produccion;
  const filas = (oid) => e.dwh.datos[oid]?.length ?? 0;
  const capa = (c) => {
    const objs = objetosDeCapa(e, c);
    const materializados = objs.filter(almacena);
    const est = peorEstado(materializados.map((d) => estadoObjeto(e, d.id).codigo));
    const total = materializados.reduce((s, d) => s + filas(d.id), 0);
    return { estado: est, dato: `${plural(total, 'fila', 'filas')}, ${plural(objs.length, 'objeto', 'objetos')}` };
  };
  const modelo = estadoModelo(e);
  const ultimoPbi = e.powerbi.historial[0];
  switch (id) {
    case 'registro':
      return { estado: null, dato: p.actividad[0] ? `Última carga: ${formatoMarca(p.actividad[0].marca)}` : 'Sin cargas nuevas desde el último proceso' };
    case 'produccion':
      return { estado: null, dato: `${fmt.entero(p.usuarios.length)} usuarios y ${fmt.entero(p.operaciones.length)} operaciones` };
    case 'repositorio':
      return { estado: null, dato: `${e.repositorio.archivo}, versión ${e.repositorio.version}` };
    case 'extraccion': case 'calculo': case 'consumo_agregado': case 'consumo_detalle':
      return capa(id);
    case 'registro_ejecucion': {
      const u = e.dwh.ejecuciones[0];
      return { estado: u ? (u.estado === 'OK' ? 'actualizado' : u.estado === 'ERROR' ? 'error' : 'desactualizado') : 'sin_datos', dato: u ? `Proceso #${u.id}: ${u.estado}` : 'Sin ejecuciones' };
    }
    case 'pbi_desktop':
      return { estado: modelo.codigo, dato: e.powerbi.meta ? `${fmt.entero(e.powerbi.meta.filas)} filas importadas al modelo` : 'Modelo sin datos' };
    case 'pbi_service':
      return {
        estado: ultimoPbi?.estado === 'ERROR' ? 'error' : modelo.codigo,
        dato: e.config.gatewayCaido ? 'Gateway fuera de línea' : ultimoPbi ? `Última actualización: ${formatoMarca(ultimoPbi.marca)}` : 'Sin actualizaciones',
      };
    case 'sharepoint':
      return { estado: modelo.codigo, dato: 'Publicado con permisos de sólo lectura' };
    default:
      return { estado: null, dato: '' };
  }
}

function svgDiagrama(e) {
  const nodos = NODOS.map((n) => {
    const r = resumenNodo(e, n.id);
    const cx = n.x + n.w / 2;
    return `<g class="nodo${n.gris ? ' gris' : ''}${ui.seleccionado === n.id ? ' seleccionado' : ''}" data-nodo="${n.id}" tabindex="0" role="button" aria-pressed="${ui.seleccionado === n.id}" aria-label="${esc(`${n.titulo}. ${r.dato}`)}">
      <rect class="caja" x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="12"/>
      <text class="titulo-nodo${n.angosto ? ' angosto' : ''}" x="${cx}" y="${n.y + 34}" text-anchor="middle">${esc(n.titulo)}</text>
      <text class="texto-nodo" x="${cx}" y="${n.y + 60}" text-anchor="middle">${esc(n.texto)}</text>
      <text class="dato-nodo" x="${cx}" y="${n.y + n.h - 16}" text-anchor="middle">${esc(r.dato)}</text>
      ${r.estado ? `<circle class="punto-estado ${claseEstado(r.estado)}" cx="${n.x + n.w - 18}" cy="${n.y + n.h - 21}" r="6.5"><title>${esc(r.estado)}</title></circle>` : ''}
    </g>`;
  }).join('');
  const conectores = CONECTORES.map((c) => {
    const rotulo = c.rotulo
      ? `<text class="rotulo-conector" x="${c.rotulo.x}" y="${c.rotulo.y}" ${c.rotulo.vertical ? `transform="rotate(-90 ${c.rotulo.x} ${c.rotulo.y})" text-anchor="middle"` : ''}>${esc(c.rotulo.texto)}</text>` : '';
    return `<path class="conector${c.discontinuo ? ' discontinuo' : ''}" id="${c.id}" d="${c.d}" marker-end="url(#flecha)"/>${rotulo}`;
  }).join('');
  return `<svg viewBox="0 0 900 1292" role="group" aria-label="Diagrama del flujo de información: desde el registro operativo hasta SharePoint">
    <defs><marker id="flecha" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#0c1322"/></marker></defs>
    <rect class="caja-dwh" x="24" y="330" width="550" height="490" rx="4"/>
    <text class="titulo-dwh" x="300" y="364" text-anchor="middle">Data Warehouse en PostgreSQL</text>
    <text class="rotulo-conector" x="300" y="388" text-anchor="middle">(organizado en capas por unidad de negocio)</text>
    ${conectores}
    ${nodos}
  </svg>`;
}

function detalleNodo(e, id) {
  const r = resumenNodo(e, id);
  const p = e.produccion;
  const filas = (oid) => fmt.entero(e.dwh.datos[oid]?.length ?? 0);
  const datos = (pares) => `<dl class="datos-vivos">${pares.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
  const listaObjetos = (capa) => objetosDeCapa(e, capa).map((d) => [d.nombre, `${almacena(d) ? `${filas(d.id)} filas ` : ''}${chip(estadoObjeto(e, d.id).codigo)}`]);
  const ir = (ruta, texto) => `<a class="boton secundario" href="#/${ruta}">${esc(texto)}</a>`;
  const nodo = NODOS.find((n) => n.id === id);
  const contenido = {
    registro: {
      tipo: 'Sistemas de gestión',
      texto: '<p>Los datos de la operación diaria se cargan manualmente y quedan en la base transaccional. En el simulador, esa carga la hacen el generador de usuarios de prueba, el alta manual, la importación CSV y la jornada simulada.</p>',
      vivos: datos([['Última actividad', esc(p.actividad[0]?.texto ?? 'Sin actividad reciente')], ['Cuándo', esc(formatoMarca(p.actividad[0]?.marca))]]),
      accion: ir('datos', 'Cargar usuarios de prueba'),
    },
    produccion: {
      tipo: 'Servidor de producción (origen)',
      texto: '<p>Atiende la operación. Con el DWH, recibe una sola lectura por tabla y por día; el trabajo analítico no compite con los operadores.</p>',
      vivos: datos([['Usuarios', fmt.entero(p.usuarios.length)], ['Operaciones', fmt.entero(p.operaciones.length)], ['Consultas analíticas recibidas hoy', fmt.entero(p.consultasAnaliticas.porDia[e.reloj.fecha] ?? 0)], ['Consultas analíticas en total', fmt.entero(p.consultasAnaliticas.total)]]),
      accion: ir('datos?pestana=usuarios', 'Ver las tablas de producción'),
    },
    repositorio: {
      tipo: 'Fuente complementaria',
      texto: '<p>Centraliza planillas cargadas por las áreas. No pasa por el DWH: Power BI la integra directamente en el modelo semántico.</p>',
      vivos: datos([['Archivo', esc(e.repositorio.archivo)], ['Versión', fmt.entero(e.repositorio.version)], ['Última modificación', esc(formatoMarca(e.repositorio.actualizado))]]),
      accion: ir('datos?pestana=metas', 'Editar la planilla de metas'),
    },
    extraccion: {
      tipo: 'Capa del DWH (esquema extraccion)',
      texto: '<p>Las tablas foráneas se consultan como tablas locales pero no guardan datos: cada consulta viaja al origen a través del <em>foreign data wrapper</em>. Por eso, por cada tabla foránea hay una vista materializada que guarda una copia completa, que se sincroniza una vez por día o bajo demanda.</p>',
      vivos: datos(listaObjetos('extraccion')),
      sql: SQL_OBJETOS['extraccion.mv_operaciones'],
      accion: ir('dwh?objeto=extraccion.mv_operaciones', 'Ver los objetos de extracción'),
    },
    calculo: {
      tipo: 'Capa del DWH (esquema calculo)',
      texto: '<p>Transformaciones en SQL dentro del DWH: depuración de valores, cruces entre tablas, reglas de negocio y agregaciones intermedias. No la consumen los usuarios finales.</p>',
      vivos: datos(listaObjetos('calculo')),
      sql: SQL_OBJETOS['calculo.operaciones_depuradas'],
      accion: ir('dwh?objeto=calculo.operaciones_depuradas', 'Ver los objetos de cálculo'),
    },
    consumo_agregado: {
      tipo: 'Capa del DWH (esquema consumo_agregado)',
      texto: '<p>Cubos: resultados pre-procesados con una granularidad definida, con menos filas que el detalle, aptos para Excel o Power BI. Aquí también vive la consulta de definición que entrega al tablero exactamente lo que necesita.</p>',
      vivos: datos(listaObjetos('consumo_agregado')),
      sql: SQL_OBJETOS['consumo_agregado.cubo_mensual'],
      accion: ir('dwh?objeto=consumo_agregado.cubo_mensual', 'Ver los cubos'),
    },
    consumo_detalle: {
      tipo: 'Capa del DWH (esquema consumo_detalle)',
      texto: '<p>Datos en detalle, de alto volumen, que conservan la granularidad que requieren los análisis más finos en Power BI.</p>',
      vivos: datos(listaObjetos('consumo_detalle')),
      sql: SQL_OBJETOS['consumo_detalle.operaciones_detalle'],
      accion: ir('dwh?objeto=consumo_detalle.operaciones_detalle', 'Ver el detalle'),
    },
    registro_ejecucion: {
      tipo: 'Control del proceso',
      texto: '<p>Al terminar el proceso diario se registra el resultado de cada paso y se notifica al equipo responsable, para corregir fallas antes de que los usuarios vean datos desactualizados.</p>',
      vivos: datos(e.dwh.ejecuciones.slice(0, 4).map((x) => [`#${x.id} ${formatoMarca(x.inicio)}`, chip(x.estado)])),
      sql: SQL_REFERENCIA.find((s) => s.id === 'registro').sql.split('\n\n')[0],
      accion: ir('dwh?pestana=registro', 'Abrir el registro de ejecución'),
    },
    pbi_desktop: {
      tipo: 'Modelo semántico',
      texto: '<p>Los tableros se desarrollan en Power BI Desktop en formato de proyecto. El modelo importa los resultados ya procesados por el DWH y la planilla del repositorio de archivos.</p>',
      vivos: datos([['Estado del modelo', chip(estadoModelo(e).codigo)], ['Filas importadas', fmt.entero(e.powerbi.meta?.filas ?? 0)], ['Modelo actualizado', esc(formatoMarca(e.powerbi.meta?.actualizado))]]),
      accion: ir('powerbi', 'Abrir el tablero'),
    },
    pbi_service: {
      tipo: 'Publicación en la nube',
      texto: '<p>El modelo se publica en un área de trabajo de Power BI Service. Como el DWH está en la infraestructura propia, la actualización programada pasa por un gateway de datos local. Se ejecuta después de que termina el proceso diario.</p>',
      vivos: datos([['Gateway de datos local', e.config.gatewayCaido ? chip('error', 'Fuera de línea') : chip('actualizado', 'En línea')], ['Última actualización', e.powerbi.historial[0] ? `${esc(formatoMarca(e.powerbi.historial[0].marca))} ${chip(e.powerbi.historial[0].estado)}` : '—']]),
      accion: ir('dwh', 'Configurar el gateway y el proceso'),
    },
    sharepoint: {
      tipo: 'Distribución',
      texto: '<p>Los reportes llegan a las gerencias a través de SharePoint, siempre con permisos de sólo lectura.</p>',
      vivos: datos([['Lo que ve la gerencia', chip(estadoModelo(e).codigo)], ['Permisos', 'Sólo lectura']]),
      accion: '<button type="button" class="boton secundario" data-sesion-gerencia>Ver como gerencia</button>',
    },
  }[id];
  return `<div class="detalle-nodo" aria-live="polite">
    <h3>${esc(nodo.titulo)}</h3>
    <p class="tipo">${esc(contenido.tipo)}${r.estado ? ` ${chip(r.estado)}` : ''}</p>
    <div class="prosa">${contenido.texto}</div>
    ${contenido.vivos}
    ${contenido.sql ? bloqueCodigo(contenido.sql) : ''}
    <div class="acciones" style="margin-top:16px">${contenido.accion}</div>
  </div>`;
}

export function render(ctx) {
  const e = ctx.estado;
  const definiciones = obtenerDefiniciones(e);
  const p = e.produccion;
  const filasDWH = definiciones.filter(almacena).reduce((s, d) => s + (e.dwh.datos[d.id]?.length ?? 0), 0);
  const cuenta = ctx.cuenta();
  const filasCapas = CAPAS.map((c) => ({
    capa: c.nombre, contenido: c.contenido, uso: c.uso, esquema: c.id,
    objetos: definiciones.filter((d) => d.capa === c.id).map((d) => d.nombre).join(', '),
    acceso: c.interna ? 'Equipo de datos' : 'Equipo de datos y gerencias (sólo lectura)',
  }));

  return `
  ${banda({ titulo: 'Arquitectura del flujo', bajada: 'Desde la carga manual hasta los tableros de decisión. Tocá un elemento del diagrama para ver qué hace y cómo está ahora.', estado: e })}
  <div class="pagina">
    <section class="lamina" aria-labelledby="diagrama-titulo">
      <div class="seccion-cabeza">
        <div>
          <h2 id="diagrama-titulo">Diagrama del flujo de información</h2>
          <p>Equivale a la Figura 1 del paper. Los datos de cada elemento son los del simulador en este momento.</p>
        </div>
        ${ctx.puede('operar_dwh') ? `<button type="button" class="boton" data-accion="animar" ${ui.animando ? 'disabled' : ''}>Ejecutar y mostrar el proceso diario</button>` : ''}
      </div>
      <div class="arquitectura">
        <div class="diagrama">${svgDiagrama(e)}</div>
        <div id="detalle-nodo">${detalleNodo(e, ui.seleccionado)}</div>
      </div>
    </section>

    <section class="bloque" aria-labelledby="capas-titulo">
      <div class="seccion-cabeza"><div><h2 id="capas-titulo">Organización en capas</h2><p>Cada capa es un esquema de PostgreSQL. La organización repite estas cuatro capas en cada unidad de negocio; el simulador muestra una.</p></div></div>
      ${tabla({
        caption: 'Capas del DWH y su función',
        columnas: [
          { clave: 'capa', titulo: 'Capa', formato: (v) => `<strong>${esc(v)}</strong>` },
          { clave: 'contenido', titulo: 'Contenido' },
          { clave: 'uso', titulo: 'Uso por el usuario final' },
          { clave: 'esquema', titulo: 'Esquema', clase: 'codigo' },
          { clave: 'objetos', titulo: 'Objetos en el simulador', clase: 'codigo' },
          { clave: 'acceso', titulo: 'Quién accede' },
        ],
        filas: filasCapas,
      })}
      <p class="pequeno muted" style="margin-top:12px">La separación ordena el linaje (todo objeto de consumo se rastrea hasta la extracción), facilita los permisos y permite elegir el nivel de detalle para cada consumidor.</p>
    </section>

    <section class="bloque" aria-labelledby="servidores-titulo">
      <div class="seccion-cabeza"><div><h2 id="servidores-titulo">Separación de servidores</h2><p>Es el aspecto central de la arquitectura: cada servidor atiende un tipo de trabajo.</p></div></div>
      <div class="grilla-dos">
        <div class="tarjeta-plana">
          <h3>Servidor de producción</h3>
          <p>Atiende la operación diaria de los sistemas de gestión.</p>
          <dl class="datos-vivos">
            <div><dt>Filas en la base transaccional</dt><dd>${fmt.entero(p.usuarios.length + p.operaciones.length)}</dd></div>
            <div><dt>Consultas analíticas recibidas hoy</dt><dd>${fmt.entero(p.consultasAnaliticas.porDia[e.reloj.fecha] ?? 0)}</dd></div>
            <div><dt>Consultas analíticas desde el inicio</dt><dd>${fmt.entero(p.consultasAnaliticas.total)}</dd></div>
          </dl>
        </div>
        <div class="tarjeta-plana">
          <h3>Servidor del DWH</h3>
          <p>Atiende las consultas analíticas de Power BI y Excel.</p>
          <dl class="datos-vivos">
            <div><dt>Objetos en las cuatro capas</dt><dd>${fmt.entero(definiciones.length)}</dd></div>
            <div><dt>Filas guardadas en vistas materializadas</dt><dd>${fmt.entero(filasDWH)}</dd></div>
            <div><dt>Último proceso diario</dt><dd>${e.dwh.ejecuciones[0] ? `#${e.dwh.ejecuciones[0].id} ${chip(e.dwh.ejecuciones[0].estado)}` : '—'}</dd></div>
          </dl>
        </div>
      </div>
      <div style="margin-top:20px">${bloqueCodigo(SQL_REFERENCIA.find((s) => s.id === 'fdw').sql)}</div>
    </section>

    <section class="bloque" id="accesos" aria-labelledby="accesos-titulo">
      <div class="seccion-cabeza"><div><h2 id="accesos-titulo">Accesos y cuentas de prueba</h2><p>Los usuarios acceden con credenciales nominales y permisos de sólo lectura sobre las capas de consumo; extracción y cálculo quedan reservadas al equipo de datos. Probá cada perfil cambiando de cuenta.</p></div></div>
      ${avisoLinea('info', `<p>Sesión actual: <strong>${esc(cuenta.usuario)}</strong> (${esc(PERFILES[cuenta.perfil].nombre)}). Es una simulación de permisos para la demostración, no un control de seguridad: no hay contraseñas.</p>`)}
      <div class="grilla-dos" style="margin-top:20px">
        <div>
          <h3 style="margin-bottom:12px">Perfiles</h3>
          ${tabla({
            columnas: [
              { clave: 'nombre', titulo: 'Perfil', formato: (v) => `<strong>${esc(v)}</strong>` },
              { clave: 'descripcion', titulo: 'Qué hace' },
              { clave: 've', titulo: 'Qué puede ver' },
            ],
            filas: [
              { nombre: PERFILES.operador.nombre, descripcion: PERFILES.operador.descripcion, ve: 'Datos de prueba (base transaccional).' },
              { nombre: PERFILES.datos.nombre, descripcion: PERFILES.datos.descripcion, ve: 'Todo: las cuatro capas, el proceso, Power BI y las mediciones.' },
              { nombre: PERFILES.gerencia.nombre, descripcion: PERFILES.gerencia.descripcion, ve: 'El tablero publicado y las capas de consumo, sin poder modificarlos.' },
            ],
          })}
        </div>
        <div>
          <h3 style="margin-bottom:12px">Cuentas de prueba</h3>
          ${tabla({
            columnas: [
              { clave: 'usuario', titulo: 'Usuario', clase: 'codigo' },
              { clave: 'nombre', titulo: 'Nombre' },
              { clave: 'perfil', titulo: 'Perfil', formato: (v) => esc(PERFILES[v].nombre) },
              { clave: 'id', titulo: 'Acciones', num: true, formato: (v) => `<div class="acciones-fila">${v === e.sesion ? chip('actualizado', 'En uso') : `<button type="button" class="boton secundario chico" data-usar="${esc(v)}">Usar</button>`}${e.cuentas.length > 1 ? `<button type="button" class="boton peligro chico" data-eliminar-cuenta="${esc(v)}" aria-label="Eliminar la cuenta">Eliminar</button>` : ''}</div>` },
            ],
            filas: e.cuentas,
          })}
          <form class="formulario" id="form-cuenta" style="margin-top:18px" novalidate>
            <div class="fila-campos">
              <div class="campo"><label for="cuenta-usuario">Usuario</label><input id="cuenta-usuario" name="usuario" type="text" placeholder="maria.gerencia" autocomplete="off" required></div>
              <div class="campo"><label for="cuenta-nombre">Nombre</label><input id="cuenta-nombre" name="nombre" type="text" placeholder="María Gómez" autocomplete="off"></div>
              <div class="campo"><label for="cuenta-perfil">Perfil</label><select id="cuenta-perfil" name="perfil">${Object.entries(PERFILES).map(([k, v]) => `<option value="${k}">${esc(v.nombre)}</option>`).join('')}</select></div>
            </div>
            <div class="acciones"><button type="submit" class="boton secundario">Agregar cuenta de prueba</button></div>
          </form>
        </div>
      </div>
      <div style="margin-top:20px">${bloqueCodigo(SQL_REFERENCIA.find((s) => s.id === 'esquemas').sql)}</div>
    </section>
  </div>`;
}

async function animar(ctx) {
  ui.animando = true;
  let proceso;
  let pbi;
  ctx.cambiar((e) => {
    proceso = ejecutarProcesoNocturno(e);
    pbi = actualizacionProgramadaPowerBI(e);
  });
  const secuencia = [
    ['produccion', 'c-extraccion'], ['extraccion', 'c-calculo'], ['calculo', 'c-agregado', 'c-detalle'],
    ['consumo_agregado', 'consumo_detalle', 'c-log'], ['registro_ejecucion', 'c-pbi-1', 'c-pbi-2', 'c-repo'],
    ['pbi_desktop', 'c-service'], ['pbi_service', 'c-sharepoint'], ['sharepoint'],
  ];
  if (!movimientoReducido()) {
    for (const paso of secuencia) {
      for (const id of paso) {
        document.querySelector(`[data-nodo="${id}"]`)?.classList.add('encendido');
        document.getElementById(id)?.classList.add('encendido');
      }
      await new Promise((r) => setTimeout(r, 420));
    }
    await new Promise((r) => setTimeout(r, 900));
  }
  ui.animando = false;
  ctx.refrescar();
  const ok = proceso.resumen.estado === 'OK' && pbi.estado === 'OK';
  aviso(`Proceso #${proceso.resumen.id}: ${proceso.resumen.ok} pasos correctos en ${fmt.ms(proceso.resumen.ms)}. Power BI: ${pbi.estado === 'OK' ? 'modelo actualizado' : pbi.mensaje}`, ok ? 'ok' : 'aviso');
}

export function montar(raiz, ctx) {
  const seleccionar = (id) => {
    ui.seleccionado = id;
    raiz.querySelectorAll('[data-nodo]').forEach((n) => {
      const activo = n.dataset.nodo === id;
      n.classList.toggle('seleccionado', activo);
      n.setAttribute('aria-pressed', String(activo));
    });
    raiz.querySelector('#detalle-nodo').innerHTML = detalleNodo(ctx.estado, id);
  };
  raiz.addEventListener('click', (ev) => {
    const nodo = ev.target.closest('[data-nodo]');
    if (nodo) { seleccionar(nodo.dataset.nodo); return; }
    if (ev.target.closest('[data-accion="animar"]')) { animar(ctx); return; }
    const usar = ev.target.closest('[data-usar]');
    if (usar) {
      ctx.cambiar((e) => { e.sesion = usar.dataset.usar; });
      aviso(`Sesión iniciada como ${ctx.cuenta().usuario}.`, 'info');
      return;
    }
    if (ev.target.closest('[data-sesion-gerencia]')) {
      const g = ctx.estado.cuentas.find((c) => c.perfil === 'gerencia');
      if (!g) { aviso('No hay ninguna cuenta con perfil de gerencia: agregala en "Accesos y cuentas de prueba".', 'aviso'); return; }
      ctx.cambiar((e) => { e.sesion = g.id; });
      ctx.ir('powerbi');
      return;
    }
    const borrar = ev.target.closest('[data-eliminar-cuenta]');
    if (borrar) {
      try {
        ctx.cambiar((e) => eliminarCuenta(e, borrar.dataset.eliminarCuenta));
        aviso('Cuenta eliminada.', 'ok');
      } catch (error) { aviso(error.message, 'critico'); }
    }
  });
  raiz.addEventListener('keydown', (ev) => {
    const nodo = ev.target.closest('[data-nodo]');
    if (nodo && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); seleccionar(nodo.dataset.nodo); }
  });
  raiz.querySelector('#form-cuenta')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    try {
      const c = ctx.cambiar((e) => agregarCuenta(e, datosDeFormulario(ev.target)));
      aviso(`Cuenta ${c.usuario} creada.`, 'ok');
    } catch (error) { aviso(error.message, 'critico'); }
  });
}
