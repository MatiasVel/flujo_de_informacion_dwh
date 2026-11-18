// Datos de prueba: la base transaccional (servidor de producción).
// Carga masiva de usuarios de prueba, alta manual, importación CSV, edición y planilla de metas.

import { esc, fmt, aviso, abrirDialogo, confirmar, datosDeFormulario, mostrarErrores, descargarArchivo } from '../ui/dom.js';
import { banda, tabla, paginar, paginacion, pestanas, indicador, avisoLinea, bloqueado } from '../ui/componentes.js';
import {
  cargarUsuariosDePrueba, agregarUsuario, editarUsuario, eliminarUsuario, agregarOperacion, editarOperacion,
  eliminarOperacion, importarUsuariosCSV, editarMeta, simularJornada, ErrorValidacion,
} from '../motor/estado.js';
import { PLANTILLA_USUARIOS } from '../motor/csv.js';
import { REGIONES, SEGMENTOS, TIPOS_SERVICIO, NOMBRE_SERVICIO, normalizarRegion, normalizarSegmento } from '../motor/catalogos.js';
import { diferenciasPendientes } from '../motor/dwh.js';
import { formatoFecha, formatoMarca } from '../motor/fechas.js';
import { LIMITES } from '../motor/generador.js';

export const titulo = 'Datos de prueba';

const ui = {
  pestana: 'cargar',
  paginaU: 1,
  paginaO: 1,
  filtroU: { texto: '', region: '', estado: '' },
  filtroO: { texto: '', tipo: '', estado: '' },
  generador: { usuarios: '300', promedioOperaciones: '14', mesesHistoria: '12', semilla: '', modo: 'agregar', metas: true },
  ultimaCarga: null,
  resultadoCSV: null,
};

const PESTANAS = ['cargar', 'usuarios', 'operaciones', 'metas'];

function mapaVersiones(filas, clave) {
  const m = new Map();
  for (const f of filas) m.set(f[clave], f._v);
  return m;
}

function marcaPendiente(fila, copia, clave) {
  const v = copia.get(fila[clave]);
  if (v === undefined) return '<span class="marca-cambio" title="Todavía no está en la copia del DWH"><svg viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="4" fill="currentColor"/></svg>Nuevo, sin extraer</span>';
  if (v !== fila._v) return '<span class="marca-cambio" title="La copia del DWH tiene una versión anterior"><svg viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="4" fill="currentColor"/></svg>Modificado, sin extraer</span>';
  return '';
}

function opcionesLista(lista, actual, todas = 'Todas') {
  return `<option value="">${esc(todas)}</option>${lista.map((v) => `<option value="${esc(v)}" ${v === actual ? 'selected' : ''}>${esc(v)}</option>`).join('')}`;
}

function datalists() {
  return `<datalist id="lista-regiones">${REGIONES.map((r) => `<option value="${esc(r)}"></option>`).join('')}</datalist>
    <datalist id="lista-segmentos">${SEGMENTOS.map((s) => `<option value="${esc(s)}"></option>`).join('')}</datalist>`;
}

function formUsuario(u, fechaMax, prefijo) {
  return `<div class="fila-campos">
      <div class="campo"><label for="${prefijo}-nombre">Nombre y apellido</label><input id="${prefijo}-nombre" name="nombre" type="text" value="${esc(u.nombre ?? '')}" autocomplete="off" required></div>
      <div class="campo"><label for="${prefijo}-email">Email</label><input id="${prefijo}-email" name="email" type="email" value="${esc(u.email ?? '')}" autocomplete="off" placeholder="nombre@ejemplo.test" required></div>
    </div>
    <div class="fila-campos">
      <div class="campo"><label for="${prefijo}-region">Región</label><input id="${prefijo}-region" name="region" type="text" list="lista-regiones" value="${esc(u.region ?? '')}" autocomplete="off" required><span class="ayuda">Se guarda tal como se escribe.</span></div>
      <div class="campo"><label for="${prefijo}-segmento">Segmento</label><input id="${prefijo}-segmento" name="segmento" type="text" list="lista-segmentos" value="${esc(u.segmento ?? '')}" autocomplete="off" required></div>
    </div>
    <div class="fila-campos">
      <div class="campo"><label for="${prefijo}-estado">Estado</label><select id="${prefijo}-estado" name="estado"><option value="activo" ${u.estado !== 'baja' ? 'selected' : ''}>Activo</option><option value="baja" ${u.estado === 'baja' ? 'selected' : ''}>Baja</option></select></div>
      <div class="campo"><label for="${prefijo}-alta">Fecha de alta</label><input id="${prefijo}-alta" name="fecha_alta" type="date" value="${esc(u.fecha_alta ?? fechaMax)}" max="${esc(fechaMax)}" required></div>
    </div>`;
}

function formOperacion(o, fechaMax, prefijo) {
  return `<div class="fila-campos">
      <div class="campo"><label for="${prefijo}-usuario">ID de usuario</label><input id="${prefijo}-usuario" name="id_usuario" type="number" min="1" step="1" value="${esc(o.id_usuario ?? '')}" required></div>
      <div class="campo"><label for="${prefijo}-fecha">Fecha</label><input id="${prefijo}-fecha" name="fecha" type="date" value="${esc(o.fecha ?? fechaMax)}" max="${esc(fechaMax)}" required></div>
    </div>
    <div class="fila-campos">
      <div class="campo"><label for="${prefijo}-tipo">Tipo de servicio</label><select id="${prefijo}-tipo" name="tipo_servicio">${TIPOS_SERVICIO.map((t) => `<option value="${t.codigo}" ${t.codigo === o.tipo_servicio ? 'selected' : ''}>${esc(t.nombre)}</option>`).join('')}</select></div>
      <div class="campo"><label for="${prefijo}-importe">Importe ($)</label><input id="${prefijo}-importe" name="importe" type="number" min="0" step="0.01" value="${esc(o.importe ?? '')}" required></div>
      <div class="campo"><label for="${prefijo}-estado">Estado</label><select id="${prefijo}-estado" name="estado"><option value="confirmada" ${o.estado !== 'anulada' ? 'selected' : ''}>Confirmada</option><option value="anulada" ${o.estado === 'anulada' ? 'selected' : ''}>Anulada</option></select></div>
    </div>`;
}

function vistaCargar(ctx) {
  const e = ctx.estado;
  const g = ui.generador;
  const puede = ctx.puede('editar_datos');
  const dis = puede ? '' : 'disabled';
  const resultado = ui.ultimaCarga
    ? avisoLinea('ok', `<p>Se cargaron <strong>${fmt.entero(ui.ultimaCarga.usuarios)} usuarios</strong> y <strong>${fmt.entero(ui.ultimaCarga.operaciones)} operaciones</strong> en ${fmt.ms(ui.ultimaCarga.ms)} (semilla ${esc(ui.ultimaCarga.semilla)}). El DWH todavía no los ve: se extraen en el próximo proceso diario.</p>`)
    : '';
  const csv = ui.resultadoCSV;
  return `
  <div class="grilla-tres">
    <form class="tarjeta-plana formulario" id="form-generador" novalidate>
      <div><h3>Generar usuarios de prueba</h3><p>Crea usuarios ficticios con sus operaciones de los últimos meses. Con la misma semilla se obtienen los mismos datos.</p></div>
      <div class="campo"><label for="gen-usuarios">Cantidad de usuarios</label>
        <input id="gen-usuarios" name="usuarios" type="number" min="1" max="${LIMITES.usuariosPorCarga}" step="1" value="${esc(g.usuarios)}" data-borrador="usuarios" ${dis}>
        <div class="acciones">${[100, 1000, 5000, 15000].map((n) => `<button type="button" class="boton secundario chico" data-cantidad="${n}" ${dis}>${fmt.entero(n)}</button>`).join('')}</div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label for="gen-promedio">Operaciones por usuario al año</label><input id="gen-promedio" name="promedioOperaciones" type="number" min="0" max="${LIMITES.promedioOperaciones}" step="1" value="${esc(g.promedioOperaciones)}" data-borrador="promedioOperaciones" ${dis}></div>
        <div class="campo"><label for="gen-meses">Meses de historia</label><input id="gen-meses" name="mesesHistoria" type="number" min="1" max="${LIMITES.mesesHistoria}" step="1" value="${esc(g.mesesHistoria)}" data-borrador="mesesHistoria" ${dis}></div>
      </div>
      <div class="campo"><label for="gen-semilla">Semilla (opcional)</label><input id="gen-semilla" name="semilla" type="number" step="1" value="${esc(g.semilla)}" placeholder="Al azar" data-borrador="semilla" ${dis}></div>
      <fieldset class="campo" style="border:0;padding:0;margin:0">
        <legend class="etiqueta">Qué hacer con los datos actuales</legend>
        <label class="casilla"><input type="radio" name="modo" value="agregar" ${g.modo !== 'reemplazar' ? 'checked' : ''} data-borrador="modo" ${dis}>Agregarlos a los existentes</label>
        <label class="casilla"><input type="radio" name="modo" value="reemplazar" ${g.modo === 'reemplazar' ? 'checked' : ''} data-borrador="modo" ${dis}>Reemplazar todos los datos</label>
      </fieldset>
      <label class="casilla"><input type="checkbox" name="metas" ${g.metas ? 'checked' : ''} data-casilla="metas" ${dis}><span>Recalcular la planilla de metas<small>Promedio mensual de los datos cargados más un 8 %, para que el cumplimiento tenga sentido con el nuevo volumen.</small></span></label>
      <div class="acciones"><button type="submit" class="boton" ${dis}>Generar y cargar</button></div>
      ${resultado}
    </form>

    <div class="tarjeta-plana">
      <form class="formulario" id="form-alta" novalidate>
        <div><h3>Alta manual</h3><p>Como lo haría un operador en el sistema de gestión.</p></div>
        ${formUsuario({}, e.reloj.fecha, 'alta')}
        <div class="acciones"><button type="submit" class="boton secundario" ${dis}>Registrar usuario</button></div>
      </form>
      <form class="formulario" id="form-operacion" novalidate style="margin-top:28px;padding-top:24px;border-top:1px solid var(--linea)">
        <div><h3>Registrar una operación</h3></div>
        ${formOperacion({ id_usuario: e.produccion.usuarios.at(-1)?.id_usuario ?? '' }, e.reloj.fecha, 'op')}
        <div class="acciones"><button type="submit" class="boton secundario" ${dis}>Registrar operación</button></div>
      </form>
    </div>

    <form class="tarjeta-plana formulario" id="form-csv" novalidate>
      <div><h3>Importar desde CSV</h3><p>Columnas: nombre, email, region, segmento, estado, fecha_alta. Acepta coma o punto y coma como separador.</p></div>
      <div class="campo"><label for="csv-archivo">Archivo</label><input id="csv-archivo" name="archivo" type="file" accept=".csv,text/csv" ${dis}></div>
      <div class="acciones">
        <button type="submit" class="boton secundario" ${dis}>Importar usuarios</button>
        <button type="button" class="enlace-boton" data-accion="plantilla">Descargar la plantilla</button>
      </div>
      ${csv ? avisoLinea(csv.errores.length ? 'aviso' : 'ok', `<p>${fmt.entero(csv.agregados)} usuarios importados${csv.errores.length ? ` y ${fmt.entero(csv.errores.length)} filas rechazadas:` : '.'}</p>
        ${csv.errores.length ? `<ul class="pequeno">${csv.errores.slice(0, 8).map((x) => `<li>Línea ${esc(x.linea)}: ${esc(x.mensaje)}</li>`).join('')}</ul>` : ''}`) : ''}
      <p class="pequeno muted">La plantilla trae regiones escritas de distintas formas (" norte", "REGION SUR") para ver cómo las corrige la capa de cálculo.</p>
    </form>
  </div>

  <div class="seccion">
    <div class="seccion-cabeza">
      <div><h3>Jornada operativa</h3><p>Simula el trabajo de los operadores durante el día de hoy: operaciones nuevas, algunas altas, una corrección retroactiva y un cambio de región.</p></div>
      <button type="button" class="boton secundario" data-accion="jornada" ${dis}>Simular la jornada de hoy</button>
    </div>
    ${tabla({
      caption: 'Actividad reciente en producción',
      columnas: [{ clave: 'marca', titulo: 'Fecha y hora', formato: (v) => esc(formatoMarca(v)) }, { clave: 'texto', titulo: 'Actividad' }],
      filas: e.produccion.actividad.slice(0, 8),
      vacio: 'Sin actividad desde que se preparó el escenario.',
    })}
  </div>
  ${datalists()}`;
}

function vistaUsuarios(ctx) {
  const e = ctx.estado;
  const f = ui.filtroU;
  const texto = f.texto.trim().toLowerCase();
  const copia = mapaVersiones(e.dwh.datos['extraccion.mv_usuarios'] ?? [], 'id_usuario');
  let filas = e.produccion.usuarios.filter((u) =>
    (!texto || String(u.id_usuario) === texto || u.nombre.toLowerCase().includes(texto) || u.email.toLowerCase().includes(texto))
    && (!f.region || normalizarRegion(u.region) === f.region)
    && (!f.estado || u.estado === f.estado));
  filas = filas.slice().reverse();
  const info = paginar(filas, ui.paginaU);
  ui.paginaU = info.pagina;
  const puede = ctx.puede('editar_datos');
  return `
  <div class="barra-herramientas">
    <div class="campo ancho"><label for="filtro-u-texto">Buscar por ID, nombre o email</label><input id="filtro-u-texto" type="search" value="${esc(f.texto)}" data-filtro-u="texto"></div>
    <div class="campo"><label for="filtro-u-region">Región (depurada)</label><select id="filtro-u-region" data-filtro-u="region">${opcionesLista([...REGIONES, 'Sin asignar'], f.region)}</select></div>
    <div class="campo"><label for="filtro-u-estado">Estado</label><select id="filtro-u-estado" data-filtro-u="estado">${opcionesLista(['activo', 'baja'], f.estado, 'Todos')}</select></div>
  </div>
  ${tabla({
    caption: 'Tabla usuarios del servidor de producción',
    columnas: [
      { clave: 'id_usuario', titulo: 'ID', num: true },
      { clave: 'nombre', titulo: 'Nombre' },
      { clave: 'email', titulo: 'Email' },
      { clave: 'region', titulo: 'Región', formato: (v) => (normalizarRegion(v) !== v ? `<span class="codigo">"${esc(v)}"</span>` : esc(v)) },
      { clave: 'segmento', titulo: 'Segmento', formato: (v) => (normalizarSegmento(v) !== v ? `<span class="codigo">"${esc(v)}"</span>` : esc(v)) },
      { clave: 'estado', titulo: 'Estado', formato: (v) => (v === 'activo' ? 'Activo' : 'Baja') },
      { clave: 'fecha_alta', titulo: 'Alta', formato: (v) => esc(formatoFecha(v)) },
      { clave: '_t', titulo: 'Última modificación', formato: (v, fila) => `${esc(formatoMarca(v))} ${marcaPendiente(fila, copia, 'id_usuario')}` },
      {
        clave: 'id_usuario', titulo: 'Acciones', num: true,
        formato: (v) => `<div class="acciones-fila">
          <a class="boton secundario chico" href="#/cambios?tipo=usuario&id=${v}">Seguir</a>
          ${puede ? `<button type="button" class="boton secundario chico" data-editar-usuario="${v}">Editar</button><button type="button" class="boton peligro chico" data-eliminar-usuario="${v}">Eliminar</button>` : ''}
        </div>`,
      },
    ],
    filas: info.filas,
    vacio: 'No hay usuarios que coincidan con el filtro.',
  })}
  ${paginacion(info, 'pagina-u')}`;
}

function vistaOperaciones(ctx) {
  const e = ctx.estado;
  const f = ui.filtroO;
  const texto = f.texto.trim();
  const copia = mapaVersiones(e.dwh.datos['extraccion.mv_operaciones'] ?? [], 'id_operacion');
  let filas = e.produccion.operaciones.filter((o) =>
    (!texto || String(o.id_operacion) === texto || String(o.id_usuario) === texto)
    && (!f.tipo || o.tipo_servicio === f.tipo)
    && (!f.estado || o.estado === f.estado));
  filas = filas.slice().reverse();
  const info = paginar(filas, ui.paginaO);
  ui.paginaO = info.pagina;
  const puede = ctx.puede('editar_datos');
  return `
  <div class="barra-herramientas">
    <div class="campo ancho"><label for="filtro-o-texto">Buscar por ID de operación o de usuario</label><input id="filtro-o-texto" type="search" inputmode="numeric" value="${esc(f.texto)}" data-filtro-o="texto"></div>
    <div class="campo"><label for="filtro-o-tipo">Tipo de servicio</label><select id="filtro-o-tipo" data-filtro-o="tipo"><option value="">Todos</option>${TIPOS_SERVICIO.map((t) => `<option value="${t.codigo}" ${f.tipo === t.codigo ? 'selected' : ''}>${esc(t.nombre)}</option>`).join('')}</select></div>
    <div class="campo"><label for="filtro-o-estado">Estado</label><select id="filtro-o-estado" data-filtro-o="estado">${opcionesLista(['confirmada', 'anulada'], f.estado, 'Todos')}</select></div>
  </div>
  ${tabla({
    caption: 'Tabla operaciones del servidor de producción',
    columnas: [
      { clave: 'id_operacion', titulo: 'ID', num: true },
      { clave: 'id_usuario', titulo: 'Usuario', num: true },
      { clave: 'fecha', titulo: 'Fecha', formato: (v) => esc(formatoFecha(v)) },
      { clave: 'tipo_servicio', titulo: 'Tipo', formato: (v) => esc(NOMBRE_SERVICIO[v] ?? v) },
      { clave: 'importe', titulo: 'Importe', num: true, formato: (v) => fmt.monedaDecimal(v) },
      { clave: 'estado', titulo: 'Estado', formato: (v) => (v === 'confirmada' ? 'Confirmada' : 'Anulada') },
      { clave: '_t', titulo: 'Última modificación', formato: (v, fila) => `${esc(formatoMarca(v))} ${marcaPendiente(fila, copia, 'id_operacion')}` },
      {
        clave: 'id_operacion', titulo: 'Acciones', num: true,
        formato: (v) => `<div class="acciones-fila">
          <a class="boton secundario chico" href="#/cambios?tipo=operacion&id=${v}">Seguir</a>
          ${puede ? `<button type="button" class="boton secundario chico" data-editar-operacion="${v}">Editar</button><button type="button" class="boton peligro chico" data-eliminar-operacion="${v}">Eliminar</button>` : ''}
        </div>`,
      },
    ],
    filas: info.filas,
    vacio: 'No hay operaciones que coincidan con el filtro.',
  })}
  ${paginacion(info, 'pagina-o')}`;
}

function vistaMetas(ctx) {
  const e = ctx.estado;
  const puede = ctx.puede('editar_datos');
  return `
  ${avisoLinea('info', `<p>Esta planilla vive en el <strong>repositorio institucional de archivos</strong> (${esc(e.repositorio.archivo)}). No pasa por el DWH: Power BI la importa directamente. Un cambio se ve en el tablero recién cuando se actualiza el modelo.</p>`)}
  <form id="form-metas" class="formulario" style="margin-top:20px;max-width:640px" novalidate>
    ${tabla({
      caption: 'Meta mensual de importe por región',
      columnas: [
        { clave: 'region', titulo: 'Región', formato: (v) => `<strong>${esc(v)}</strong>` },
        { clave: 'meta_mensual', titulo: 'Meta mensual ($)', num: true, formato: (v, f) => `<input type="number" min="0" step="1000" name="${esc(f.region)}" value="${esc(v)}" aria-label="Meta mensual de ${esc(f.region)}" style="max-width:200px;text-align:right" ${puede ? '' : 'disabled'}>` },
      ],
      filas: e.repositorio.metas,
    })}
    <p class="pequeno muted">Versión ${fmt.entero(e.repositorio.version)}. Última modificación: ${esc(formatoMarca(e.repositorio.actualizado))}.</p>
    <div class="acciones"><button type="submit" class="boton" ${puede ? '' : 'disabled'}>Guardar la planilla</button></div>
  </form>`;
}

export function render(ctx) {
  const e = ctx.estado;
  const pestanaUrl = ctx.parametros.get('pestana');
  if (pestanaUrl && PESTANAS.includes(pestanaUrl)) ui.pestana = pestanaUrl;
  if (!ctx.puede('ver_datos')) {
    return `${banda({ titulo: 'Datos de prueba', bajada: 'La base transaccional del servidor de producción.', estado: e })}
      <div class="pagina"><section class="lamina">${bloqueado(ctx.perfil().nombre, 'Las gerencias no acceden a la base transaccional: trabajan sólo con información ya procesada en las capas de consumo.')}</section></div>`;
  }
  const dif = diferenciasPendientes(e);
  const ultima = [...e.produccion.actividad][0];
  const cuerpo = { cargar: vistaCargar, usuarios: vistaUsuarios, operaciones: vistaOperaciones, metas: vistaMetas }[ui.pestana](ctx);
  return `
  ${banda({ titulo: 'Datos de prueba', bajada: 'La base transaccional del servidor de producción, donde los operadores cargan la operación diaria.', estado: e })}
  <div class="pagina">
    <section class="lamina">
      <div class="indicadores" style="margin-bottom:28px">
        ${indicador({ etiqueta: 'Usuarios', valor: fmt.entero(e.produccion.usuarios.length), detalle: `${fmt.entero(e.produccion.usuarios.filter((u) => u.estado === 'activo').length)} activos` })}
        ${indicador({ etiqueta: 'Operaciones', valor: fmt.entero(e.produccion.operaciones.length), detalle: `${fmt.entero(e.produccion.operaciones.filter((o) => o.estado === 'anulada').length)} anuladas` })}
        ${indicador({ etiqueta: 'Cambios que el DWH todavía no extrajo', valor: fmt.entero(dif.usuarios.total + dif.operaciones.total), detalle: `${fmt.entero(dif.usuarios.nuevos + dif.operaciones.nuevos)} nuevos, ${fmt.entero(dif.usuarios.modificados + dif.operaciones.modificados)} modificados, ${fmt.entero(dif.usuarios.eliminados + dif.operaciones.eliminados)} eliminados` })}
        ${indicador({ etiqueta: 'Última actividad', valor: `<span style="font-size:20px">${esc(ultima ? formatoMarca(ultima.marca) : '—')}</span>`, detalle: ultima ? esc(ultima.texto) : 'Sin actividad reciente' })}
      </div>
      ${ctx.puede('editar_datos') ? '' : avisoLinea('info', '<p>Tu perfil puede ver los datos pero no modificarlos.</p>')}
      ${pestanas([
        { id: 'cargar', texto: 'Cargar usuarios de prueba' },
        { id: 'usuarios', texto: 'Usuarios', contador: fmt.entero(e.produccion.usuarios.length) },
        { id: 'operaciones', texto: 'Operaciones', contador: fmt.entero(e.produccion.operaciones.length) },
        { id: 'metas', texto: 'Planilla de metas' },
      ], ui.pestana, 'pestana')}
      ${cuerpo}
    </section>
  </div>`;
}

function errorEnFormulario(form, error) {
  if (error instanceof ErrorValidacion) {
    mostrarErrores(form, error.campos);
    aviso(error.message, 'critico');
  } else {
    console.error(error);
    aviso(`No se pudo completar la acción: ${error.message}`, 'critico');
  }
}

function abrirEdicionUsuario(ctx, id) {
  const u = ctx.estado.produccion.usuarios.find((x) => x.id_usuario === id);
  if (!u) return;
  const d = abrirDialogo({
    titulo: `Editar usuario #${id}`,
    cuerpo: `<form id="form-editar-usuario" class="formulario" novalidate>${formUsuario(u, ctx.estado.reloj.fecha, 'ed')}${datalists()}<p class="pequeno muted">El cambio se guarda en producción. El DWH lo verá en la próxima extracción.</p></form>`,
    pie: '<button type="button" class="boton secundario" data-cerrar>Cancelar</button><button type="submit" class="boton" form="form-editar-usuario">Guardar en producción</button>',
  });
  d.querySelector('form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    try {
      const r = ctx.cambiar((e) => editarUsuario(e, id, datosDeFormulario(ev.target)));
      d.close();
      aviso(r.modificados.length ? `Usuario #${id} actualizado en producción. Seguí el cambio en la sección Cambios.` : 'No hubo cambios para guardar.', r.modificados.length ? 'ok' : 'info');
    } catch (error) { errorEnFormulario(ev.target, error); }
  });
}

function abrirEdicionOperacion(ctx, id) {
  const o = ctx.estado.produccion.operaciones.find((x) => x.id_operacion === id);
  if (!o) return;
  const d = abrirDialogo({
    titulo: `Editar operación #${id}`,
    cuerpo: `<form id="form-editar-operacion" class="formulario" novalidate>${formOperacion(o, ctx.estado.reloj.fecha, 'edo')}<p class="pequeno muted">Si la fecha es anterior a la última extracción y el modo es incremental, el DWH no va a ver esta corrección.</p></form>`,
    pie: '<button type="button" class="boton secundario" data-cerrar>Cancelar</button><button type="submit" class="boton" form="form-editar-operacion">Guardar en producción</button>',
  });
  d.querySelector('form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    try {
      const r = ctx.cambiar((e) => editarOperacion(e, id, datosDeFormulario(ev.target)));
      d.close();
      aviso(r.modificados.length ? `Operación #${id} actualizada en producción.` : 'No hubo cambios para guardar.', r.modificados.length ? 'ok' : 'info');
    } catch (error) { errorEnFormulario(ev.target, error); }
  });
}

export function montar(raiz, ctx) {
  const irAPestana = (id) => {
    ui.pestana = id;
    history.replaceState(null, '', `#/datos?pestana=${id}`);
    ctx.refrescar();
  };

  raiz.addEventListener('click', async (ev) => {
    const t = ev.target;
    const pest = t.closest('[data-accion="pestana"]');
    if (pest) { irAPestana(pest.dataset.id); return; }
    const pag = t.closest('[data-accion="pagina-u"], [data-accion="pagina-o"]');
    if (pag) {
      if (pag.dataset.accion === 'pagina-u') ui.paginaU = Number(pag.dataset.pagina); else ui.paginaO = Number(pag.dataset.pagina);
      ctx.refrescar();
      return;
    }
    const cantidad = t.closest('[data-cantidad]');
    if (cantidad) {
      ui.generador.usuarios = cantidad.dataset.cantidad;
      raiz.querySelector('#gen-usuarios').value = cantidad.dataset.cantidad;
      return;
    }
    if (t.closest('[data-accion="plantilla"]')) { descargarArchivo('plantilla_usuarios.csv', `﻿${PLANTILLA_USUARIOS}`); return; }
    if (t.closest('[data-accion="jornada"]')) {
      const r = ctx.cambiar((e) => simularJornada(e));
      aviso(`Jornada simulada: ${r.operacionesNuevas} operaciones, ${r.usuariosNuevos} altas y ${r.correcciones.length} correcciones. Todavía no llegaron al DWH.`, 'ok');
      return;
    }
    const eu = t.closest('[data-editar-usuario]');
    if (eu) { abrirEdicionUsuario(ctx, Number(eu.dataset.editarUsuario)); return; }
    const eo = t.closest('[data-editar-operacion]');
    if (eo) { abrirEdicionOperacion(ctx, Number(eo.dataset.editarOperacion)); return; }
    const bu = t.closest('[data-eliminar-usuario]');
    if (bu) {
      const id = Number(bu.dataset.eliminarUsuario);
      if (!(await confirmar({ titulo: `Eliminar el usuario #${id}`, mensaje: 'Se elimina de la base transaccional. Si tiene operaciones, la base lo impide por la restricción de clave foránea.', aceptar: 'Eliminar', peligro: true }))) return;
      try { ctx.cambiar((e) => eliminarUsuario(e, id)); aviso(`Usuario #${id} eliminado de producción.`, 'ok'); } catch (error) { aviso(error.message, 'critico'); }
      return;
    }
    const bo = t.closest('[data-eliminar-operacion]');
    if (bo) {
      const id = Number(bo.dataset.eliminarOperacion);
      if (!(await confirmar({ titulo: `Eliminar la operación #${id}`, mensaje: 'Se elimina de la base transaccional. La copia del DWH la conserva hasta la próxima extracción completa.', aceptar: 'Eliminar', peligro: true }))) return;
      try { ctx.cambiar((e) => eliminarOperacion(e, id)); aviso(`Operación #${id} eliminada de producción.`, 'ok'); } catch (error) { aviso(error.message, 'critico'); }
    }
  });

  // Borradores del generador: se conservan aunque la página se redibuje.
  raiz.addEventListener('input', (ev) => {
    const campo = ev.target.closest('[data-borrador]');
    if (campo) ui.generador[campo.dataset.borrador] = campo.value;
    const casilla = ev.target.closest('[data-casilla]');
    if (casilla) ui.generador[casilla.dataset.casilla] = casilla.checked;
  });

  let temporizador;
  raiz.addEventListener('input', (ev) => {
    const fu = ev.target.closest('[data-filtro-u="texto"], [data-filtro-o="texto"]');
    if (!fu) return;
    clearTimeout(temporizador);
    temporizador = setTimeout(() => {
      if (fu.dataset.filtroU) { ui.filtroU.texto = fu.value; ui.paginaU = 1; } else { ui.filtroO.texto = fu.value; ui.paginaO = 1; }
      const id = fu.id;
      const pos = fu.selectionStart;
      ctx.refrescar();
      const nuevo = document.getElementById(id);
      if (nuevo) { nuevo.focus(); nuevo.setSelectionRange(pos, pos); }
    }, 280);
  });
  raiz.addEventListener('change', (ev) => {
    const s = ev.target.closest('select[data-filtro-u], select[data-filtro-o]');
    if (!s) return;
    if (s.dataset.filtroU) { ui.filtroU[s.dataset.filtroU] = s.value; ui.paginaU = 1; } else { ui.filtroO[s.dataset.filtroO] = s.value; ui.paginaO = 1; }
    ctx.refrescar();
  });

  raiz.querySelector('#form-generador')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const datos = datosDeFormulario(ev.target);
    try {
      const r = ctx.cambiar((e) => cargarUsuariosDePrueba(e, { ...datos, reemplazar: datos.modo === 'reemplazar', recalcularMetas: Boolean(datos.metas) }));
      ui.ultimaCarga = r;
      ctx.refrescar();
      aviso(`Carga terminada: ${fmt.entero(r.usuarios)} usuarios y ${fmt.entero(r.operaciones)} operaciones en ${fmt.ms(r.ms)}.`, 'ok');
    } catch (error) { errorEnFormulario(ev.target, error); }
  });

  raiz.querySelector('#form-alta')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    try {
      const u = ctx.cambiar((e) => agregarUsuario(e, datosDeFormulario(ev.target)));
      aviso(`Usuario #${u.id_usuario} registrado en producción.`, 'ok');
    } catch (error) { errorEnFormulario(ev.target, error); }
  });

  raiz.querySelector('#form-operacion')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    try {
      const o = ctx.cambiar((e) => agregarOperacion(e, datosDeFormulario(ev.target)));
      aviso(`Operación #${o.id_operacion} registrada en producción.`, 'ok');
    } catch (error) { errorEnFormulario(ev.target, error); }
  });

  raiz.querySelector('#form-csv')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const archivo = ev.target.elements.archivo.files[0];
    if (!archivo) { aviso('Elegí un archivo CSV para importar.', 'aviso'); return; }
    if (archivo.size > 5 * 1024 * 1024) { aviso('El archivo supera los 5 MB. Dividilo en partes más chicas.', 'aviso'); return; }
    const texto = await archivo.text();
    const r = ctx.cambiar((e) => importarUsuariosCSV(e, texto));
    ui.resultadoCSV = { agregados: r.agregados.length, errores: r.errores };
    ctx.refrescar();
    aviso(`${r.agregados.length} usuarios importados${r.errores.length ? `, ${r.errores.length} filas rechazadas` : ''}.`, r.errores.length ? 'aviso' : 'ok');
  });

  raiz.querySelector('#form-metas')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    try {
      const valores = datosDeFormulario(ev.target);
      const cambios = ctx.cambiar((e) => Object.entries(valores).filter(([region, v]) => editarMeta(e, region, v)).length);
      aviso(cambios ? `Planilla guardada: ${cambios} metas modificadas. Se verán en Power BI al actualizar el modelo.` : 'No hubo cambios en la planilla.', cambios ? 'ok' : 'info');
    } catch (error) { aviso(error.message, 'critico'); }
  });
}
