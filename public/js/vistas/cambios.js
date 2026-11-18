// Cambios: editar un dato en producción y seguirlo capa por capa hasta el tablero.

import { esc, fmt, aviso, datosDeFormulario, mostrarErrores } from '../ui/dom.js';
import { banda, chip, avisoLinea, bloqueado } from '../ui/componentes.js';
import { obtenerDefiniciones, estadoObjeto, almacena, ordenDeActualizacion, refrescarObjeto, diferenciasPendientes } from '../motor/dwh.js';
import { actualizarModelo, estadoModelo } from '../motor/powerbi.js';
import { editarUsuario, editarOperacion, ErrorValidacion } from '../motor/estado.js';
import { REGIONES, SEGMENTOS, NOMBRE_SERVICIO, normalizarRegion, normalizarSegmento, normalizarEstadoUsuario } from '../motor/catalogos.js';
import { formatoFecha, formatoMarca, etiquetaMes, sumarDias } from '../motor/fechas.js';

export const titulo = 'Cambios';

const ui = { tipo: null, id: null };

const ETAPAS = [
  { id: 'extraccion', nombre: 'Extracción', capas: ['extraccion'] },
  { id: 'calculo', nombre: 'Cálculo', capas: ['calculo'] },
  { id: 'consumo', nombre: 'Consumo (cubos y detalle)', capas: ['consumo_agregado', 'consumo_detalle'] },
];

function peor(codigos) {
  for (const c of ['error', 'desactualizado', 'sin_datos']) if (codigos.includes(c)) return c;
  return 'actualizado';
}

function estadoEtapa(e, capas) {
  const objs = obtenerDefiniciones(e).filter((d) => capas.includes(d.capa) && almacena(d));
  const marcas = objs.map((d) => e.dwh.meta[d.id]?.actualizado).filter(Boolean).sort();
  return { codigo: peor(objs.map((d) => estadoObjeto(e, d.id).codigo)), marca: marcas.at(-1) ?? null };
}

function registroPorDefecto(e) {
  let mejor = null;
  for (const u of e.produccion.usuarios) if (!mejor || u._v > mejor.v) mejor = { tipo: 'usuario', id: u.id_usuario, v: u._v };
  for (const o of e.produccion.operaciones) if (!mejor || o._v > mejor.v) mejor = { tipo: 'operacion', id: o.id_operacion, v: o._v };
  return mejor ?? { tipo: 'operacion', id: 1 };
}

const marcaOk = (ok, textoOk = 'Refleja producción', textoNo = 'Pendiente') =>
  (ok == null ? '<span class="muted">No aplica</span>' : ok ? chip('actualizado', textoOk) : chip('desactualizado', textoNo));

// Valor que debería tener una celda agregada si el DWH estuviera al día con producción.
function agregadoEsperado(e, filtro) {
  const usuarios = new Map(e.produccion.usuarios.map((u) => [u.id_usuario, u]));
  let cantidad = 0;
  let importe = 0;
  for (const o of e.produccion.operaciones) {
    if (o.estado !== 'confirmada' || !(o.importe > 0)) continue;
    if (filtro.mes && o.fecha.slice(0, 8) + '01' !== filtro.mes) continue;
    if (filtro.tipo && o.tipo_servicio !== filtro.tipo) continue;
    const u = usuarios.get(o.id_usuario);
    if (!u) continue;
    if (filtro.region && normalizarRegion(u.region) !== filtro.region) continue;
    if (filtro.segmento && normalizarSegmento(u.segmento) !== filtro.segmento) continue;
    cantidad++;
    importe += o.importe;
  }
  return { cantidad, importe: Math.round(importe * 100) / 100 };
}

function sumar(filas, filtro) {
  let cantidad = 0;
  let importe = 0;
  for (const f of filas) {
    if (filtro.mes && f.mes !== filtro.mes) continue;
    if (filtro.region && f.region !== filtro.region) continue;
    if (filtro.segmento && f.segmento !== filtro.segmento) continue;
    if (filtro.tipo && f.tipo_servicio !== filtro.tipo) continue;
    cantidad += f.cantidad;
    importe += f.importe_total;
  }
  return { cantidad, importe: Math.round(importe * 100) / 100 };
}

const iguales = (a, b) => a.cantidad === b.cantidad && Math.abs(a.importe - b.importe) < 0.01;

function filasOperacion(e, id) {
  const prod = e.produccion.operaciones.find((o) => o.id_operacion === id);
  const copia = (e.dwh.datos['extraccion.mv_operaciones'] ?? []).find((o) => o.id_operacion === id);
  const dep = (e.dwh.datos['calculo.operaciones_depuradas'] ?? []).find((o) => o.id_operacion === id);
  const det = (e.dwh.datos['consumo_detalle.operaciones_detalle'] ?? []).find((o) => o.id_operacion === id);
  const meta = (oid) => e.dwh.meta[oid]?.actualizado ?? null;
  const u = prod ? e.produccion.usuarios.find((x) => x.id_usuario === prod.id_usuario) : null;
  const valido = prod && u && prod.estado === 'confirmada' && prod.importe > 0;
  const region = u ? normalizarRegion(u.region) : null;
  const segmento = u ? normalizarSegmento(u.segmento) : null;
  const texto = (o) => `${fmt.monedaDecimal(o.importe)}, ${o.estado ?? 'confirmada'}, ${formatoFecha(o.fecha)}, ${NOMBRE_SERVICIO[o.tipo_servicio] ?? o.tipo_servicio}`;

  const filas = [];
  filas.push({ capa: 'Producción', objeto: 'operaciones', valor: prod ? esc(texto(prod)) : '<em>Eliminada del origen</em>', marca: prod?._t, ok: null, nota: 'Fuente de verdad.' });
  filas.push({ capa: 'Extracción', objeto: 'ft_operaciones', valor: '<span class="muted">Lee en vivo del origen: siempre igual a producción.</span>', marca: null, ok: null, nota: 'No guarda datos.' });
  let okCopia;
  let notaCopia = '';
  if (prod && copia) { okCopia = copia._v === prod._v; notaCopia = okCopia ? '' : 'La copia tiene una versión anterior de la fila.'; }
  else if (prod && !copia) { okCopia = false; notaCopia = 'Todavía no se extrajo.'; }
  else if (!prod && copia) { okCopia = false; notaCopia = 'Se eliminó en el origen pero sigue en la copia.'; }
  else okCopia = true;
  const marcaAgua = e.dwh.meta['extraccion.mv_operaciones']?.marcaAgua;
  if (!okCopia && prod && copia && e.config.modoExtraccion === 'incremental' && marcaAgua && prod.fecha < marcaAgua) {
    notaCopia += ` Con carga incremental no se vuelve a leer: su fecha (${formatoFecha(prod.fecha)}) es anterior a la marca de agua (${formatoFecha(marcaAgua)}).`;
  }
  filas.push({ capa: 'Extracción', objeto: 'mv_operaciones', valor: copia ? esc(texto(copia)) : '<em>No está en la copia</em>', marca: meta('extraccion.mv_operaciones'), ok: okCopia, nota: notaCopia });

  const okDep = valido ? Boolean(dep && dep.importe === prod.importe && dep.region === region && dep.segmento === segmento) : !dep;
  filas.push({
    capa: 'Cálculo', objeto: 'operaciones_depuradas',
    valor: dep ? esc(`${fmt.monedaDecimal(dep.importe)}, región ${dep.region}, segmento ${dep.segmento}`) : `<em>${prod && prod.estado === 'anulada' ? 'Excluida: está anulada' : 'No figura'}</em>`,
    marca: meta('calculo.operaciones_depuradas'), ok: okDep,
    nota: valido ? '' : 'Las operaciones anuladas o con importe inválido se descartan.',
  });
  const okDet = valido ? Boolean(det && det.importe === prod.importe && det.region === region) : !det;
  filas.push({ capa: 'Consumo de detalle', objeto: 'operaciones_detalle', valor: det ? esc(`${fmt.monedaDecimal(det.importe)}, ${det.nombre_servicio}, ${det.region}`) : '<em>No figura</em>', marca: meta('consumo_detalle.operaciones_detalle'), ok: okDet, nota: '' });

  if (prod && u) {
    const celda = { mes: prod.fecha.slice(0, 8) + '01', region, segmento, tipo: prod.tipo_servicio };
    const esperado = agregadoEsperado(e, celda);
    const enCubo = sumar(e.dwh.datos['consumo_agregado.cubo_mensual'] ?? [], celda);
    const nombreCelda = `${etiquetaMes(celda.mes, { largo: true })}, ${region}, ${segmento}, ${NOMBRE_SERVICIO[celda.tipo]}`;
    filas.push({
      capa: 'Consumo agregado', objeto: 'cubo_mensual',
      valor: `${esc(nombreCelda)}: <strong>${fmt.moneda(enCubo.importe)}</strong> en ${fmt.entero(enCubo.cantidad)} operaciones`,
      marca: meta('consumo_agregado.cubo_mensual'), ok: iguales(enCubo, esperado),
      nota: iguales(enCubo, esperado) ? '' : `Según producción debería ser ${fmt.moneda(esperado.importe)} en ${fmt.entero(esperado.cantidad)} operaciones.`,
    });
    const modelo = e.powerbi.modelo;
    const enVentana = modelo && modelo.hechos.some((f) => f.mes === celda.mes);
    const enModelo = modelo ? sumar(modelo.hechos, celda) : null;
    filas.push({
      capa: 'Power BI', objeto: 'modelo semántico (hechos)',
      valor: modelo ? (enVentana ? `${esc(nombreCelda)}: <strong>${fmt.moneda(enModelo.importe)}</strong>` : '<em>Fuera de los 12 meses del tablero</em>') : '<em>Modelo sin datos</em>',
      marca: e.powerbi.meta?.actualizado, ok: modelo && enVentana ? iguales(enModelo, esperado) : null,
      nota: modelo && enVentana && !iguales(enModelo, esperado) ? 'El modelo conserva lo que importó en su última actualización.' : '',
    });
    if (modelo && enVentana) {
      const visual = sumar(modelo.hechos, { mes: celda.mes, region });
      const esperadoVisual = agregadoEsperado(e, { mes: celda.mes, region });
      filas.push({
        capa: 'Tablero publicado', objeto: 'Importe por mes y región',
        valor: `${esc(`${etiquetaMes(celda.mes, { largo: true })} en ${region}`)}: <strong>${fmt.moneda(visual.importe)}</strong>`,
        marca: e.powerbi.meta?.actualizado, ok: iguales(visual, esperadoVisual),
        nota: iguales(visual, esperadoVisual) ? 'Es lo que ve la gerencia.' : `Lo que ve la gerencia. Con los datos de hoy sería ${fmt.moneda(esperadoVisual.importe)}.`,
      });
    }
  }
  return { filas, prod, u };
}

function filasUsuario(e, id) {
  const prod = e.produccion.usuarios.find((u) => u.id_usuario === id);
  const copia = (e.dwh.datos['extraccion.mv_usuarios'] ?? []).find((u) => u.id_usuario === id);
  const vig = (e.dwh.datos['calculo.usuarios_vigentes'] ?? []).find((u) => u.id_usuario === id);
  const meta = (oid) => e.dwh.meta[oid]?.actualizado ?? null;
  const texto = (u) => `región "${u.region}", segmento ${u.segmento}, estado ${u.estado}`;
  const filas = [];
  filas.push({ capa: 'Producción', objeto: 'usuarios', valor: prod ? esc(texto(prod)) : '<em>Eliminado del origen</em>', marca: prod?._t, ok: null, nota: 'Fuente de verdad.' });
  filas.push({ capa: 'Extracción', objeto: 'ft_usuarios', valor: '<span class="muted">Lee en vivo del origen: siempre igual a producción.</span>', marca: null, ok: null, nota: 'No guarda datos.' });
  const okCopia = prod ? Boolean(copia && copia._v === prod._v) : !copia;
  filas.push({ capa: 'Extracción', objeto: 'mv_usuarios', valor: copia ? esc(texto(copia)) : '<em>No está en la copia</em>', marca: meta('extraccion.mv_usuarios'), ok: okCopia, nota: okCopia ? '' : prod && !copia ? 'Todavía no se extrajo.' : 'La copia tiene una versión anterior.' });
  const activo = prod && normalizarEstadoUsuario(prod.estado) === 'activo';
  const region = prod ? normalizarRegion(prod.region) : null;
  const segmento = prod ? normalizarSegmento(prod.segmento) : null;
  const okVig = activo ? Boolean(vig && vig.region === region && vig.segmento === segmento) : !vig;
  filas.push({
    capa: 'Cálculo', objeto: 'usuarios_vigentes',
    valor: vig ? esc(`región ${vig.region}, segmento ${vig.segmento} (depurados)`) : `<em>${prod && !activo ? 'Excluido: está dado de baja' : 'No figura'}</em>`,
    marca: meta('calculo.usuarios_vigentes'), ok: okVig,
    nota: prod && region !== prod.region ? `La depuración convierte "${prod.region}" en "${region}".` : '',
  });
  if (prod && activo) {
    const esperado = e.produccion.usuarios.filter((u) => normalizarEstadoUsuario(u.estado) === 'activo' && normalizarRegion(u.region) === region && normalizarSegmento(u.segmento) === segmento).length;
    const celda = (e.dwh.datos['consumo_agregado.cubo_usuarios_region'] ?? []).find((f) => f.region === region && f.segmento === segmento);
    const actual = celda?.usuarios_vigentes ?? 0;
    filas.push({ capa: 'Consumo agregado', objeto: 'cubo_usuarios_region', valor: `${esc(`${region}, ${segmento}`)}: <strong>${fmt.entero(actual)}</strong> usuarios vigentes`, marca: meta('consumo_agregado.cubo_usuarios_region'), ok: actual === esperado, nota: actual === esperado ? '' : `Según producción deberían ser ${fmt.entero(esperado)}.` });
    const modelo = e.powerbi.modelo;
    const enModelo = modelo?.usuarios.find((f) => f.region === region && f.segmento === segmento)?.usuarios_vigentes ?? 0;
    filas.push({ capa: 'Power BI', objeto: 'modelo semántico (usuarios)', valor: modelo ? `${esc(`${region}, ${segmento}`)}: <strong>${fmt.entero(enModelo)}</strong>` : '<em>Modelo sin datos</em>', marca: e.powerbi.meta?.actualizado, ok: modelo ? enModelo === esperado : null, nota: '' });
    if (modelo) {
      const totalRegion = modelo.usuarios.filter((f) => f.region === region).reduce((s, f) => s + f.usuarios_vigentes, 0);
      const esperadoRegion = e.produccion.usuarios.filter((u) => normalizarEstadoUsuario(u.estado) === 'activo' && normalizarRegion(u.region) === region).length;
      filas.push({ capa: 'Tablero publicado', objeto: 'Usuarios vigentes', valor: `${esc(region)}: <strong>${fmt.entero(totalRegion)}</strong>`, marca: e.powerbi.meta?.actualizado, ok: totalRegion === esperadoRegion, nota: totalRegion === esperadoRegion ? 'Es lo que ve la gerencia.' : `Lo que ve la gerencia. Con los datos de hoy serían ${fmt.entero(esperadoRegion)}.` });
    }
  }
  return { filas, prod };
}

function formularioEdicion(ctx, tipo, prod) {
  if (!prod || !ctx.puede('editar_datos')) return '';
  if (tipo === 'usuario') {
    return `<form id="form-cambio" class="tarjeta-plana formulario" novalidate>
      <div><h3>Editar en producción</h3><p>Cambiá un atributo y mirá cómo el cambio avanza (o no) por las capas.</p></div>
      <div class="fila-campos">
        <div class="campo"><label for="cam-region">Región</label><input id="cam-region" name="region" type="text" list="lista-regiones-c" value="${esc(prod.region)}" autocomplete="off"></div>
        <div class="campo"><label for="cam-segmento">Segmento</label><input id="cam-segmento" name="segmento" type="text" list="lista-segmentos-c" value="${esc(prod.segmento)}" autocomplete="off"></div>
        <div class="campo"><label for="cam-estado">Estado</label><select id="cam-estado" name="estado"><option value="activo" ${prod.estado === 'activo' ? 'selected' : ''}>Activo</option><option value="baja" ${prod.estado === 'baja' ? 'selected' : ''}>Baja</option></select></div>
      </div>
      <datalist id="lista-regiones-c">${REGIONES.map((r) => `<option value="${esc(r)}"></option>`).join('')}</datalist>
      <datalist id="lista-segmentos-c">${SEGMENTOS.map((s) => `<option value="${esc(s)}"></option>`).join('')}</datalist>
      <div class="acciones"><button type="submit" class="boton">Guardar en producción</button></div>
    </form>`;
  }
  return `<form id="form-cambio" class="tarjeta-plana formulario" novalidate>
    <div><h3>Editar en producción</h3><p>Corregí el importe o anulá la operación y seguí el cambio hasta el tablero.</p></div>
    <div class="fila-campos">
      <div class="campo"><label for="cam-importe">Importe ($)</label><input id="cam-importe" name="importe" type="number" min="0" step="0.01" value="${esc(prod.importe)}"></div>
      <div class="campo"><label for="cam-estado-op">Estado</label><select id="cam-estado-op" name="estado"><option value="confirmada" ${prod.estado === 'confirmada' ? 'selected' : ''}>Confirmada</option><option value="anulada" ${prod.estado === 'anulada' ? 'selected' : ''}>Anulada</option></select></div>
    </div>
    <div class="acciones"><button type="submit" class="boton">Guardar en producción</button></div>
  </form>`;
}

export function render(ctx) {
  const e = ctx.estado;
  const encabezado = banda({ titulo: 'Seguimiento de cambios', bajada: 'Editá un dato en producción y seguilo capa por capa. Así se ve por qué un tablero trabaja con la información al cierre del último proceso.', estado: e });
  if (!ctx.puede('ver_datos') && !ctx.puede('ver_dwh_interno')) {
    return `${encabezado}<div class="pagina"><section class="lamina">${bloqueado(ctx.perfil().nombre, 'El seguimiento de cambios recorre la base transaccional y las capas internas del DWH.')}</section></div>`;
  }
  const p = ctx.parametros;
  if (p.get('tipo') && p.get('id')) { ui.tipo = p.get('tipo') === 'usuario' ? 'usuario' : 'operacion'; ui.id = Number(p.get('id')); }
  if (!ui.tipo || !ui.id) Object.assign(ui, registroPorDefecto(e));

  const dif = diferenciasPendientes(e);
  const pendientesProd = dif.usuarios.total + dif.operaciones.total;
  const etapas = ETAPAS.map((x) => ({ ...x, ...estadoEtapa(e, x.capas) }));
  const modelo = estadoModelo(e);
  const siguiente = etapas.findIndex((x) => x.codigo !== 'actualizado');
  // Con carga incremental, la extracción puede figurar al día aunque la copia difiera del origen.
  const conDiferencias = etapas[0].codigo === 'actualizado' && pendientesProd > 0;
  const pasoSugerido = conDiferencias ? 0 : siguiente >= 0 ? siguiente : modelo.codigo !== 'actualizado' ? 3 : -1;

  const recorrido = `<ol class="recorrido" aria-label="Estado de cada etapa">
    <li><div class="paso-nombre">Producción</div><div class="paso-estado">${pendientesProd ? chip('desactualizado', `${fmt.entero(pendientesProd)} ${pendientesProd === 1 ? 'cambio' : 'cambios'} sin extraer`) : chip('actualizado', 'Todo extraído')}</div><div class="paso-marca">${fmt.entero(dif.usuarios.nuevos + dif.operaciones.nuevos)} filas nuevas, ${fmt.entero(dif.operaciones.modificados + dif.usuarios.modificados)} modificadas, ${fmt.entero(dif.operaciones.eliminados + dif.usuarios.eliminados)} eliminadas</div></li>
    ${etapas.map((x, i) => {
      // Con carga incremental la extracción puede creerse al día aunque la copia difiera del origen.
      const difiere = i === 0 && conDiferencias;
      return `<li><div class="paso-nombre">${esc(x.nombre)}</div><div class="paso-estado">${difiere ? chip('desactualizado', 'Difiere del origen') : chip(x.codigo)}</div><div class="paso-marca">${esc(difiere ? 'La marca de agua dejó filas sin releer' : x.marca ? formatoMarca(x.marca) : 'Sin actualizar')}</div></li>`;
    }).join('')}
    <li><div class="paso-nombre">Modelo de Power BI</div><div class="paso-estado">${chip(modelo.codigo)}</div><div class="paso-marca">${esc(formatoMarca(e.powerbi.meta?.actualizado))}</div></li>
    <li><div class="paso-nombre">Tablero publicado</div><div class="paso-estado">${chip(modelo.codigo, modelo.codigo === 'actualizado' ? 'Muestra lo último' : 'Datos anteriores')}</div><div class="paso-marca">Lo que ve la gerencia</div></li>
  </ol>`;

  const operar = ctx.puede('operar_dwh');
  const botones = [
    { accion: 'extraer', texto: 'Extraer del origen' },
    { accion: 'calcular', texto: 'Recalcular la capa de cálculo' },
    { accion: 'consumir', texto: 'Actualizar cubos y detalle' },
    { accion: 'modelo', texto: 'Actualizar el modelo de Power BI' },
  ];
  const pasos = `<div class="tarjeta-plana">
      <h3>Propagar el cambio</h3>
      <p class="pequeno">${operar ? 'Paso a paso, en el orden de dependencias. El botón destacado es el siguiente que hace falta.' : 'Estos pasos los ejecuta el equipo de datos.'}</p>
      <ol class="pasos-verticales">${botones.map((b, i) => `<li><button type="button" class="boton ${i === pasoSugerido ? '' : 'secundario'}" data-paso="${b.accion}" ${operar ? '' : 'disabled'}>${esc(b.texto)}</button></li>`).join('')}</ol>
      <p class="pequeno muted" style="margin:12px 0 0">O todo junto: <a href="#/dwh">ejecutar el proceso diario completo</a>.</p>
    </div>`;

  const seguimiento = ui.tipo === 'usuario' ? filasUsuario(e, ui.id) : filasOperacion(e, ui.id);
  const existe = Boolean(seguimiento.prod) || seguimiento.filas.some((f) => f.ok === false);
  const tablaSeguimiento = `<div class="tabla-contenedor"><table class="tabla">
    <caption class="visualmente-oculto">Valor del registro en cada capa</caption>
    <thead><tr><th scope="col">Capa</th><th scope="col">Objeto</th><th scope="col">Valor</th><th scope="col">Actualizado</th><th scope="col">Estado</th></tr></thead>
    <tbody>${seguimiento.filas.map((f) => `<tr>
      <td><strong>${esc(f.capa)}</strong></td>
      <td class="codigo">${esc(f.objeto)}</td>
      <td>${f.valor}${f.nota ? `<div class="pequeno muted" style="margin-top:4px">${esc(f.nota)}</div>` : ''}</td>
      <td style="white-space:nowrap">${esc(formatoMarca(f.marca))}</td>
      <td>${marcaOk(f.ok)}</td>
    </tr>`).join('')}</tbody></table></div>`;

  return `
  ${encabezado}
  <div class="pagina">
    <section class="lamina">
      <div class="seccion-cabeza"><div><h2>Qué falta propagar</h2><p>Cada etapa refleja la versión del origen que tenía cuando se actualizó por última vez.</p></div></div>
      ${recorrido}
      ${conDiferencias ? `<div style="margin-top:14px">${avisoLinea('aviso', `<p><strong>La copia del DWH difiere del origen aunque la extracción figure al día.</strong> ${e.config.modoExtraccion === 'incremental' ? 'Con la carga incremental, las filas con fecha anterior a la marca de agua no se vuelven a leer: extraer de nuevo no alcanza.' : 'La última extracción incremental dejó filas sin releer: una extracción completa las trae.'}</p>${ctx.puede('operar_dwh') && e.config.modoExtraccion === 'incremental' ? '<div class="acciones"><button type="button" class="boton secundario chico" data-accion="modo-completo">Cambiar a carga completa</button></div>' : ''}`)}</div>` : ''}

      <div class="seccion">
        <div class="seccion-cabeza">
          <div><h2>Seguir un registro</h2><p>Elegí un usuario o una operación de producción. El valor de cada capa se compara con lo que debería mostrar si estuviera al día.</p></div>
        </div>
        <form id="form-seguir" class="barra-herramientas" novalidate>
          <div class="control-grupo"><span class="etiqueta" id="tipo-etiqueta">Tipo de registro</span>
            <div class="segmentado" role="group" aria-labelledby="tipo-etiqueta">
              <button type="button" data-tipo="operacion" aria-pressed="${ui.tipo === 'operacion'}">Operación</button>
              <button type="button" data-tipo="usuario" aria-pressed="${ui.tipo === 'usuario'}">Usuario</button>
            </div>
          </div>
          <div class="campo"><label for="seguir-id">ID</label><input id="seguir-id" name="id" type="number" min="1" step="1" value="${esc(ui.id)}"></div>
          <button type="submit" class="boton secundario">Seguir</button>
          <button type="button" class="enlace-boton" data-accion="ultimo">Último registro modificado</button>
          <button type="button" class="enlace-boton" data-accion="vieja">Una operación de hace más de un mes</button>
        </form>
        <h3 style="margin:8px 0 12px">${ui.tipo === 'usuario' ? 'Usuario' : 'Operación'} #${esc(ui.id)}</h3>
        ${existe ? '' : avisoLinea('aviso', `<p>No existe ${ui.tipo === 'usuario' ? 'el usuario' : 'la operación'} #${esc(ui.id)} en producción ni en las copias del DWH.</p>`)}
        <div class="seguimiento">
          ${tablaSeguimiento}
          <div class="lateral">
            ${formularioEdicion(ctx, ui.tipo, seguimiento.prod)}
            ${pasos}
            <div class="tarjeta-plana">
              <h3>Por qué el cambio no se ve enseguida</h3>
              <ul class="pequeno" style="padding-left:1.2em;margin:8px 0 0;display:grid;gap:6px">
                <li>Las vistas materializadas guardan una copia: se sincronizan una vez por día o bajo demanda.</li>
                <li>Cada capa se calcula a partir de la anterior: hay que respetar el orden de dependencias.</li>
                <li>Power BI en modo importación guarda su propia copia; se actualiza después del proceso diario.</li>
                <li>Con carga incremental, una corrección sobre una fila vieja no se vuelve a leer.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>`;
}

function refrescarCapas(e, capas) {
  const ids = ordenDeActualizacion(e).filter((id) => capas.includes(id.split('.')[0]));
  const resultados = ids.map((id) => ({ id, ...refrescarObjeto(e, id) }));
  return { resultados, ms: resultados.reduce((s, r) => s + r.ms, 0), fallo: resultados.find((r) => !r.ok) };
}

export function montar(raiz, ctx) {
  const fijar = (tipo, id) => {
    ui.tipo = tipo;
    ui.id = id;
    history.replaceState(null, '', `#/cambios?tipo=${tipo}&id=${id}`);
    ctx.refrescar();
  };

  raiz.addEventListener('click', (ev) => {
    const t = ev.target;
    const tipo = t.closest('[data-tipo]');
    if (tipo) {
      const e = ctx.estado;
      const nuevo = tipo.dataset.tipo;
      const lista = nuevo === 'usuario' ? e.produccion.usuarios : e.produccion.operaciones;
      const clave = nuevo === 'usuario' ? 'id_usuario' : 'id_operacion';
      const existe = lista.some((f) => f[clave] === ui.id);
      fijar(nuevo, existe ? ui.id : lista.at(-1)?.[clave] ?? 1);
      return;
    }
    const accion = t.closest('[data-accion]')?.dataset.accion;
    if (accion === 'modo-completo') {
      ctx.cambiar((e) => { e.config.modoExtraccion = 'completa'; });
      aviso('Carga completa activada: la próxima extracción vuelve a leer todo el origen.', 'info');
      return;
    }
    if (accion === 'ultimo') { const r = registroPorDefecto(ctx.estado); fijar(r.tipo, r.id); return; }
    if (accion === 'vieja') {
      const e = ctx.estado;
      const limite = sumarDias(e.reloj.fecha, -35);
      const candidatas = e.produccion.operaciones.filter((o) => o.estado === 'confirmada' && o.fecha < limite);
      if (!candidatas.length) { aviso('No hay operaciones de hace más de un mes.', 'aviso'); return; }
      const o = candidatas[Math.floor(Math.random() * candidatas.length)];
      fijar('operacion', o.id_operacion);
      return;
    }
    const paso = t.closest('[data-paso]')?.dataset.paso;
    if (!paso) return;
    if (paso === 'extraer') {
      const r = ctx.cambiar((e) => refrescarCapas(e, ['extraccion']));
      aviso(r.fallo ? `La extracción falló: ${r.fallo.error}` : `Extracción terminada en ${fmt.ms(r.ms)}: la copia local ya tiene los cambios del origen.`, r.fallo ? 'critico' : 'ok');
    } else if (paso === 'calcular') {
      const r = ctx.cambiar((e) => refrescarCapas(e, ['calculo']));
      aviso(r.fallo ? `Falló el cálculo: ${r.fallo.error}` : `Capa de cálculo recalculada en ${fmt.ms(r.ms)}.`, r.fallo ? 'critico' : 'ok');
    } else if (paso === 'consumir') {
      const r = ctx.cambiar((e) => refrescarCapas(e, ['consumo_agregado', 'consumo_detalle']));
      aviso(r.fallo ? `Falló la actualización: ${r.fallo.error}` : `Cubos y detalle actualizados en ${fmt.ms(r.ms)}.`, r.fallo ? 'critico' : 'ok');
    } else if (paso === 'modelo') {
      const r = ctx.cambiar((e) => actualizarModelo(e));
      aviso(r.estado === 'OK' ? `Modelo de Power BI actualizado en ${fmt.ms(r.ms)}.` : r.mensaje, r.estado === 'OK' ? 'ok' : 'critico');
    }
  });

  raiz.querySelector('#form-seguir')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const id = Number(ev.target.elements.id.value);
    if (!Number.isInteger(id) || id < 1) { aviso('Ingresá un ID válido.', 'aviso'); return; }
    fijar(ui.tipo, id);
  });

  raiz.querySelector('#form-cambio')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    try {
      const datos = datosDeFormulario(ev.target);
      const r = ctx.cambiar((e) => (ui.tipo === 'usuario' ? editarUsuario(e, ui.id, datos) : editarOperacion(e, ui.id, datos)));
      aviso(r.modificados.length ? 'Cambio guardado en producción. Fijate qué capas quedaron pendientes.' : 'No hubo cambios para guardar.', r.modificados.length ? 'ok' : 'info');
    } catch (error) {
      if (error instanceof ErrorValidacion) mostrarErrores(ev.target, error.campos);
      aviso(error.message, 'critico');
    }
  });
}
