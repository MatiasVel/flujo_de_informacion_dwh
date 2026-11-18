// DWH: proceso diario, capas y objetos, registro de ejecución y laboratorio de cubos.

import { esc, fmt, aviso, confirmar } from '../ui/dom.js';
import { banda, chip, tabla, pestanas, avisoLinea, bloqueCodigo, bloqueado } from '../ui/componentes.js';
import {
  CAPAS, TIPOS, obtenerDefiniciones, definicion, estadoObjeto, almacena, dependientesDe, refrescarObjeto,
  refrescarConDependencias, resumirDetalle, vistaPrevia, nombresOcupados,
} from '../motor/dwh.js';
import { DIMENSIONES, MEDIDAS, validarCubo, calcularCubo, sqlDeCubo } from '../motor/cubos.js';
import { SQL_REFERENCIA } from '../motor/sql.js';
import { ejecutarProcesoNocturno, actualizacionProgramadaPowerBI, simularDiaCompleto } from '../motor/escenario.js';
import { ejecutarProcesoDiario } from '../motor/dwh.js';
import { formatoMarca } from '../motor/fechas.js';

export const titulo = 'DWH';

const ui = {
  pestana: 'capas',
  seleccionado: 'extraccion.mv_operaciones',
  previaForanea: null,
  cubo: { nombre: 'cubo_region_mes', dimensiones: ['region', 'mes'], medidas: ['cantidad', 'importe_total'] },
};
const PESTANAS = ['capas', 'registro', 'laboratorio'];

function formatoCelda(v, columna) {
  if (v == null) return '<span class="muted">null</span>';
  if (typeof v === 'number') {
    if (columna.startsWith('id_')) return String(v); // los identificadores no llevan separador de miles
    return Number.isInteger(v) ? fmt.entero(v) : fmt.decimal(v);
  }
  return esc(v);
}

function tablaPrevia(previa) {
  return tabla({
    columnas: previa.columnas.map((c) => ({ clave: c, titulo: c, num: previa.filas.some((f) => typeof f[c] === 'number'), formato: (v) => formatoCelda(v, c) })),
    filas: previa.filas,
    vacio: 'El objeto no tiene filas.',
  });
}

function tarjetaObjeto(e, d, puedeVer) {
  const est = estadoObjeto(e, d.id);
  const meta = e.dwh.meta[d.id];
  const filas = almacena(d) ? `${fmt.entero(e.dwh.datos[d.id]?.length ?? 0)} filas` : TIPOS[d.tipo].almacena ? '' : 'No almacena datos';
  return `<button type="button" class="objeto" data-objeto="${esc(d.id)}" aria-pressed="${ui.seleccionado === d.id}" ${puedeVer ? '' : 'disabled'}>
    <div class="nombre-objeto">${esc(d.nombre)}</div>
    <div class="tipo-objeto">${esc(TIPOS[d.tipo].nombre)}${d.personalizado ? ', creado en el laboratorio' : ''}</div>
    <div class="pie-objeto">${chip(est.codigo)}<span>${esc(filas)}</span></div>
    ${meta?.actualizado ? `<div class="pie-objeto" style="margin-top:6px"><span>Actualizado ${esc(formatoMarca(meta.actualizado))}</span><span>${fmt.ms(meta.ms)}</span></div>` : ''}
  </button>`;
}

function panelObjeto(ctx, id) {
  const e = ctx.estado;
  const d = definicion(e, id);
  if (!d) return '';
  const est = estadoObjeto(e, id);
  const meta = e.dwh.meta[id];
  const operar = ctx.puede('operar_dwh');
  const deps = d.deps.map((x) => (x.startsWith('produccion.') || x.startsWith('repositorio.') ? `<span>${esc(x)}</span>` : `<button type="button" data-objeto="${esc(x)}">${esc(x)}</button>`)).join('');
  const hijos = dependientesDe(e, id).map((x) => `<button type="button" data-objeto="${esc(x)}">${esc(x)}</button>`).join('') || '<span>Ninguno</span>';
  let estadoTexto = '';
  if (est.codigo === 'desactualizado') {
    estadoTexto = est.bloqueantes?.length
      ? avisoLinea('aviso', `<p>Está desactualizado y además depende de objetos desactualizados: <span class="codigo">${esc(est.bloqueantes.join(', '))}</span>. Si lo actualizás solo, va a seguir mostrando datos viejos. Actualizá con dependencias o ejecutá el proceso diario.</p>`)
      : avisoLinea('aviso', '<p>Sus dependencias ya tienen datos nuevos: al actualizarlo queda al día.</p>');
  } else if (est.codigo === 'error') {
    estadoTexto = avisoLinea('critico', `<p><strong>La última actualización falló:</strong> ${esc(est.mensaje)}. Se conserva la copia anterior.</p>`);
  }
  let previa;
  let notaPrevia = '';
  if (d.tipo === 'tabla_foranea') {
    previa = ui.previaForanea?.id === id ? ui.previaForanea.previa : null;
    notaPrevia = previa
      ? '<p class="pequeno muted">Esta vista previa envió una consulta al servidor de producción.</p>'
      : `<p class="pequeno">Una tabla foránea no guarda datos: para mostrarla hay que consultar al servidor de producción.</p>${operar ? '<button type="button" class="boton secundario chico" data-accion="consultar-foranea">Consultar el origen</button>' : ''}`;
  } else {
    previa = vistaPrevia(e, id, 8);
  }
  const datosMeta = almacena(d)
    ? `<dl class="datos-vivos">
        <div><dt>Última actualización</dt><dd>${esc(formatoMarca(meta?.actualizado))}</dd></div>
        <div><dt>Duración medida</dt><dd>${fmt.ms(meta?.ms)}</dd></div>
        <div><dt>Filas</dt><dd>${fmt.entero(e.dwh.datos[id]?.length ?? 0)}</dd></div>
        <div><dt>Actualizaciones</dt><dd>${fmt.entero(meta?.actualizaciones ?? 0)}</dd></div>
        ${meta?.marcaAgua ? `<div><dt>Marca de agua (fecha máxima copiada)</dt><dd>${esc(meta.marcaAgua)}</dd></div>` : ''}
        ${meta?.detalle ? `<div><dt>Detalle</dt><dd style="text-align:left;font-weight:400">${esc(resumirDetalle(meta.detalle))}</dd></div>` : ''}
      </dl>`
    : '';
  return `<section class="panel-objeto" aria-labelledby="panel-objeto-titulo">
    <div class="panel-objeto-cabeza">
      <div>
        <h3 id="panel-objeto-titulo">${esc(d.id)}</h3>
        <p class="pequeno muted" style="margin:4px 0 8px">${esc(TIPOS[d.tipo].nombre)}</p>
        ${chip(est.codigo)}
      </div>
      ${operar && almacena(d) ? `<div class="acciones">
        <button type="button" class="boton secundario" data-accion="refrescar">Actualizar ahora</button>
        <button type="button" class="boton" data-accion="refrescar-deps">Actualizar con dependencias</button>
        ${d.personalizado ? '<button type="button" class="boton peligro" data-accion="eliminar-cubo">Eliminar cubo</button>' : ''}
      </div>` : ''}
    </div>
    <div class="panel-objeto-cuerpo">
      <div>
        <p>${esc(d.descripcion)}</p>
        ${estadoTexto}
        <h4 style="margin-top:16px">Depende de</h4>
        <div class="dependencias">${deps}</div>
        <h4>Lo usan</h4>
        <div class="dependencias">${hijos}</div>
        ${datosMeta}
      </div>
      <div>${bloqueCodigo(d.sql)}</div>
    </div>
    <div style="padding:0 20px 20px">
      <h4 style="margin-bottom:8px">Vista previa${previa ? `: primeras ${fmt.entero(previa.filas.length)} de ${fmt.entero(previa.total)} filas` : ''}</h4>
      ${previa ? tablaPrevia(previa) : ''}
      ${notaPrevia}
    </div>
  </section>`;
}

function vistaCapas(ctx) {
  const e = ctx.estado;
  const interno = ctx.puede('ver_dwh_interno');
  const defs = obtenerDefiniciones(e);
  if (!interno && definicion(e, ui.seleccionado)?.capa && CAPAS.find((c) => c.id === definicion(e, ui.seleccionado).capa)?.interna) {
    ui.seleccionado = 'consumo_agregado.cubo_mensual';
  }
  const columnas = CAPAS.map((c) => {
    const visible = interno || !c.interna;
    const objetos = defs.filter((d) => d.capa === c.id);
    return `<div class="capa${visible ? '' : ' bloqueada'}">
      <div class="capa-cabeza"><h3>${esc(c.nombre)}</h3><p>Esquema <span class="codigo">${esc(c.id)}</span>. ${esc(c.uso)}</p></div>
      ${visible ? objetos.map((d) => tarjetaObjeto(e, d, true)).join('') : `<p class="pequeno muted">Reservada al equipo de datos. Los usuarios finales trabajan sólo con información ya procesada.</p>`}
    </div>`;
  }).join('');
  return `<div class="capas">${columnas}</div>${panelObjeto(ctx, ui.seleccionado)}`;
}

function vistaRegistro(ctx) {
  const e = ctx.estado;
  const ejecuciones = e.dwh.ejecuciones.slice(0, 20);
  const lista = ejecuciones.map((x, i) => {
    const pasos = e.dwh.registro.filter((p) => p.id_ejecucion === x.id).sort((a, b) => a.paso - b.paso);
    return `<details class="ejecucion" ${i === 0 ? 'open' : ''}>
      <summary>${chip(x.estado)}<span><strong>Proceso #${x.id}</strong> (${esc(x.tipo)}, carga ${esc(x.modo)}) del ${esc(formatoMarca(x.inicio))}</span><span class="num">${fmt.ms(x.ms)}</span></summary>
      <div class="contenido">${tabla({
        columnas: [
          { clave: 'paso', titulo: 'Paso', num: true },
          { clave: 'objeto', titulo: 'Objeto', clase: 'codigo' },
          { clave: 'accion', titulo: 'Acción', clase: 'codigo' },
          { clave: 'ms', titulo: 'Duración', num: true, formato: (v, f) => (f.estado === 'OMITIDO' ? '—' : fmt.ms(v)) },
          { clave: 'filas', titulo: 'Filas', num: true, formato: (v) => (v == null ? '—' : fmt.entero(v)) },
          { clave: 'estado', titulo: 'Estado', formato: (v) => chip(v) },
          { clave: 'detalle', titulo: 'Detalle' },
        ],
        filas: pasos,
      })}</div>
    </details>`;
  }).join('');
  const notificaciones = e.dwh.notificaciones.slice(0, 8).map((n) => `<li>${chip(n.estado)}<div><strong>${esc(formatoMarca(n.marca))}</strong><br>${esc(n.texto)}</div></li>`).join('');
  return `<div class="grilla-dos mas-izq">
    <div>
      <h3 style="margin-bottom:12px">Ejecuciones</h3>
      <div class="lista-ejecuciones">${lista || '<p class="muted">Todavía no hay ejecuciones.</p>'}</div>
    </div>
    <div>
      <h3 style="margin-bottom:12px">Notificaciones al equipo de datos</h3>
      <ul class="notificaciones">${notificaciones || '<li>Sin notificaciones.</li>'}</ul>
      <h3 style="margin:24px 0 12px">Cómo se registra en PostgreSQL</h3>
      ${bloqueCodigo(SQL_REFERENCIA.find((s) => s.id === 'registro').sql)}
    </div>
  </div>`;
}

function previaCubo(ctx) {
  const e = ctx.estado;
  const errores = validarCubo(ui.cubo, nombresOcupados(e));
  if (errores.length) return avisoLinea('aviso', `<ul style="margin:0;padding-left:1.2em">${errores.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`);
  const depuradas = e.dwh.datos['calculo.operaciones_depuradas'] ?? [];
  const t0 = performance.now();
  const filas = calcularCubo(ui.cubo, depuradas);
  const ms = performance.now() - t0;
  const reduccion = depuradas.length ? 1 - filas.length / depuradas.length : 0;
  return `${avisoLinea('ok', `<p>Se puede construir reutilizando <span class="codigo">calculo.operaciones_depuradas</span>: no hace falta extraer nada nuevo del origen.</p>`)}
    <div class="indicadores" style="margin:16px 0">
      <div class="indicador"><div class="etiqueta">Filas del cubo</div><div class="valor">${fmt.entero(filas.length)}</div><div class="detalle">de ${fmt.entero(depuradas.length)} filas de detalle</div></div>
      <div class="indicador"><div class="etiqueta">Reducción</div><div class="valor">${fmt.porcentaje(reduccion, 1)}</div><div class="detalle">menos filas para Power BI</div></div>
      <div class="indicador"><div class="etiqueta">Tiempo de construcción</div><div class="valor">${fmt.ms(ms)}</div><div class="detalle">medido en este navegador</div></div>
    </div>
    ${bloqueCodigo(sqlDeCubo(ui.cubo))}
    <h4 style="margin:16px 0 8px">Vista previa</h4>
    ${tablaPrevia({ filas: filas.slice(0, 6), columnas: filas.length ? Object.keys(filas[0]) : [], total: filas.length })}`;
}

function vistaLaboratorio(ctx) {
  const e = ctx.estado;
  const propios = e.dwh.cubosUsuario;
  return `<div class="laboratorio">
    <form id="form-cubo" class="formulario" novalidate>
      <div class="prosa"><p>Ante un requerimiento nuevo, primero se verifica si los datos ya están en el DWH. Sólo si falta una tabla de origen se la incorpora a la extracción: <strong>reutilizar antes de extraer</strong> evita duplicar datos y consultas sobre el origen.</p></div>
      <div class="campo"><label for="cubo-nombre">Nombre del cubo</label><input id="cubo-nombre" name="nombre" type="text" value="${esc(ui.cubo.nombre)}" autocomplete="off" spellcheck="false"><span class="ayuda">Se crea como <span class="codigo">consumo_agregado.${esc(ui.cubo.nombre || '…')}</span></span></div>
      <fieldset><legend>Dimensiones (definen la granularidad)</legend>
        ${DIMENSIONES.map((d) => `<label class="casilla" ${d.disponible ? '' : 'aria-disabled="true"'}><input type="checkbox" name="dimension" value="${d.id}" ${ui.cubo.dimensiones.includes(d.id) ? 'checked' : ''}><span>${esc(d.nombre)}${d.disponible ? '' : `<small>No disponible: ${esc(d.motivo)}</small>`}</span></label>`).join('')}
      </fieldset>
      <fieldset><legend>Medidas</legend>
        ${MEDIDAS.map((m) => `<label class="casilla"><input type="checkbox" name="medida" value="${m.id}" ${ui.cubo.medidas.includes(m.id) ? 'checked' : ''}>${esc(m.nombre)}</label>`).join('')}
      </fieldset>
      <div class="acciones"><button type="submit" class="boton">Crear el cubo e integrarlo al proceso diario</button></div>
      ${propios.length ? `<div><h4 style="margin:12px 0 8px">Cubos creados en el laboratorio</h4>${tabla({
        columnas: [
          { clave: 'nombre', titulo: 'Cubo', clase: 'codigo' },
          { clave: 'dimensiones', titulo: 'Granularidad', formato: (v) => esc(v.map((x) => DIMENSIONES.find((d) => d.id === x)?.nombre ?? x).join(' × ')) },
          { clave: 'nombre', titulo: '', num: true, formato: (v) => `<button type="button" class="boton secundario chico" data-objeto="consumo_agregado.${esc(v)}" data-ir-capas>Ver</button>` },
        ],
        filas: propios,
      })}</div>` : ''}
    </form>
    <div id="previa-cubo" aria-live="polite">${previaCubo(ctx)}</div>
  </div>`;
}

export function render(ctx) {
  const e = ctx.estado;
  const p = ctx.parametros;
  if (p.get('pestana') && PESTANAS.includes(p.get('pestana'))) ui.pestana = p.get('pestana');
  if (p.get('objeto') && definicion(e, p.get('objeto'))) ui.seleccionado = p.get('objeto');
  if (!definicion(e, ui.seleccionado)) ui.seleccionado = 'extraccion.mv_operaciones';
  const encabezado = banda({ titulo: 'Proceso diario del DWH', bajada: 'Extracción, cálculo y consumo, actualizados en el orden de sus dependencias, con registro de ejecución y control de calidad.', estado: e });
  if (!ctx.puede('ver_consumo') && !ctx.puede('ver_dwh_interno')) {
    return `${encabezado}<div class="pagina"><section class="lamina">${bloqueado(ctx.perfil().nombre, 'Los operadores cargan datos en los sistemas de gestión; el DWH lo administra el equipo de datos.')}</section></div>`;
  }
  const operar = ctx.puede('operar_dwh');
  if (!operar && ui.pestana !== 'capas') ui.pestana = 'capas';
  const c = e.config;
  const controles = operar ? `
    <div class="acciones">
      <button type="button" class="boton" data-accion="proceso">Ejecutar el proceso diario (02:00)</button>
      <button type="button" class="boton secundario" data-accion="powerbi">Actualizar Power BI (06:00)</button>
      <button type="button" class="boton secundario" data-accion="ahora">Ejecutar ahora, bajo demanda</button>
      <button type="button" class="boton secundario" data-accion="dia">Simular un día completo</button>
    </div>
    <div class="controles">
      <div class="control-grupo"><span class="etiqueta" id="modo-etiqueta">Carga de la extracción</span>
        <div class="segmentado" role="group" aria-labelledby="modo-etiqueta">
          <button type="button" data-modo="completa" aria-pressed="${c.modoExtraccion === 'completa'}">Completa</button>
          <button type="button" data-modo="incremental" aria-pressed="${c.modoExtraccion === 'incremental'}">Incremental por fecha</button>
        </div>
      </div>
      <label class="interruptor"><input type="checkbox" data-config="fallaOrigen" ${c.fallaOrigen ? 'checked' : ''}><span class="pista"></span>Simular falla del servidor de producción</label>
      <label class="interruptor"><input type="checkbox" data-config="gatewayCaido" ${c.gatewayCaido ? 'checked' : ''}><span class="pista"></span>Gateway de datos local fuera de línea</label>
    </div>
    ${c.modoExtraccion === 'incremental' ? `<div style="margin-top:14px">${avisoLinea('aviso', '<p><strong>Modo incremental:</strong> la extracción de operaciones sólo lee filas con fecha igual o posterior a la marca de agua. Una corrección sobre una operación más vieja no llega al DWH; el control de calidad lo detecta.</p>')}</div>` : ''}
    ${c.fallaOrigen ? `<div style="margin-top:14px">${avisoLinea('critico', '<p><strong>El servidor de producción no responde.</strong> La extracción va a fallar, los pasos que dependen de ella se omiten y los tableros siguen con los datos anteriores.</p>')}</div>` : ''}
    ${c.gatewayCaido ? `<div style="margin-top:14px">${avisoLinea('critico', '<p><strong>Gateway fuera de línea.</strong> Power BI Service no puede actualizar el modelo desde el DWH.</p>')}</div>` : ''}`
    : avisoLinea('info', '<p>Estás viendo las capas de consumo con permisos de sólo lectura. Extracción y cálculo están reservadas al equipo de datos.</p>');
  const cuerpo = { capas: vistaCapas, registro: vistaRegistro, laboratorio: vistaLaboratorio }[ui.pestana](ctx);
  return `
  ${encabezado}
  <div class="pagina">
    <section class="lamina">
      ${controles}
      <div style="margin-top:28px">
        ${operar ? pestanas([
          { id: 'capas', texto: 'Capas y objetos' },
          { id: 'registro', texto: 'Registro de ejecución', contador: fmt.entero(e.dwh.ejecuciones.length) },
          { id: 'laboratorio', texto: 'Laboratorio de cubos' },
        ], ui.pestana, 'pestana') : ''}
        ${cuerpo}
      </div>
    </section>
  </div>`;
}

function avisoProceso(r) {
  const x = r.resumen;
  const tipo = x.estado === 'OK' ? 'ok' : x.estado === 'ADVERTENCIA' ? 'aviso' : 'critico';
  const texto = x.estado === 'OK'
    ? `Proceso #${x.id} terminado: ${x.ok} pasos correctos en ${fmt.ms(x.ms)}.`
    : x.estado === 'ADVERTENCIA'
      ? `Proceso #${x.id} terminado con advertencias: el control de calidad encontró diferencias entre el origen y la copia.`
      : `Proceso #${x.id} con errores: ${x.errores} pasos fallaron y ${x.omitidos} se omitieron.`;
  aviso(texto, tipo);
}

export function montar(raiz, ctx) {
  const actualizarPrevia = () => {
    const contenedor = raiz.querySelector('#previa-cubo');
    if (contenedor) contenedor.innerHTML = previaCubo(ctx);
  };

  raiz.addEventListener('click', async (ev) => {
    const t = ev.target;
    const pest = t.closest('[data-accion="pestana"]');
    if (pest) {
      ui.pestana = pest.dataset.id;
      history.replaceState(null, '', `#/dwh?pestana=${ui.pestana}`);
      ctx.refrescar();
      return;
    }
    const obj = t.closest('[data-objeto]');
    if (obj) {
      ui.seleccionado = obj.dataset.objeto;
      ui.pestana = 'capas';
      history.replaceState(null, '', `#/dwh?pestana=capas&objeto=${encodeURIComponent(ui.seleccionado)}`);
      ctx.refrescar();
      raiz.ownerDocument.querySelector('.panel-objeto')?.scrollIntoView({ block: 'nearest' });
      return;
    }
    const modo = t.closest('[data-modo]');
    if (modo) {
      ctx.cambiar((e) => { e.config.modoExtraccion = modo.dataset.modo; });
      aviso(modo.dataset.modo === 'incremental' ? 'Extracción incremental por fecha activada para las operaciones.' : 'Extracción completa activada.', 'info');
      return;
    }
    const accion = t.closest('[data-accion]')?.dataset.accion;
    if (!accion) return;
    if (accion === 'proceso') {
      avisoProceso(ctx.cambiar((e) => ejecutarProcesoNocturno(e)));
    } else if (accion === 'ahora') {
      avisoProceso(ctx.cambiar((e) => ejecutarProcesoDiario(e, { tipo: 'bajo demanda' })));
    } else if (accion === 'powerbi') {
      const r = ctx.cambiar((e) => actualizacionProgramadaPowerBI(e));
      aviso(r.estado === 'OK' ? `Modelo de Power BI actualizado: ${fmt.entero(r.filas)} filas importadas en ${fmt.ms(r.ms)}.` : r.mensaje, r.estado === 'OK' ? 'ok' : 'critico');
    } else if (accion === 'dia') {
      const r = ctx.cambiar((e) => simularDiaCompleto(e));
      aviso(`Día simulado: ${r.jornada.operacionesNuevas} operaciones nuevas; proceso #${r.proceso.resumen.id} ${r.proceso.resumen.estado}; Power BI ${r.powerbi.estado}.`, r.proceso.resumen.estado === 'OK' && r.powerbi.estado === 'OK' ? 'ok' : 'aviso');
    } else if (accion === 'refrescar' || accion === 'refrescar-deps') {
      const id = ui.seleccionado;
      if (accion === 'refrescar') {
        const r = ctx.cambiar((e) => refrescarObjeto(e, id));
        if (!r.ok) { aviso(`Falló la actualización de ${id}: ${r.error}`, 'critico'); return; }
        const est = estadoObjeto(ctx.estado, id);
        aviso(est.codigo === 'actualizado'
          ? `${id} actualizado en ${fmt.ms(r.ms)}: ${fmt.entero(r.filas)} filas.`
          : `${id} se recalculó en ${fmt.ms(r.ms)}, pero sigue desactualizado porque sus dependencias tienen datos viejos.`, est.codigo === 'actualizado' ? 'ok' : 'aviso');
      } else {
        const pasos = ctx.cambiar((e) => refrescarConDependencias(e, id));
        const fallo = pasos.find((x) => !x.ok);
        aviso(fallo ? `Falló ${fallo.id}: ${fallo.error}` : `Se actualizaron ${pasos.length} objetos en orden: ${pasos.map((x) => x.id.split('.')[1]).join(', ')}.`, fallo ? 'critico' : 'ok');
      }
    } else if (accion === 'consultar-foranea') {
      try {
        let previa;
        ctx.cambiar((e) => { previa = vistaPrevia(e, ui.seleccionado, 8); });
        ui.previaForanea = { id: ui.seleccionado, previa };
        ctx.refrescar();
      } catch (error) { aviso(error.message, 'critico'); }
    } else if (accion === 'eliminar-cubo') {
      const id = ui.seleccionado;
      if (!(await confirmar({ titulo: 'Eliminar el cubo', mensaje: `Se elimina ${id} del DWH y deja de ejecutarse en el proceso diario.`, aceptar: 'Eliminar', peligro: true }))) return;
      ctx.cambiar((e) => {
        const nombre = id.split('.')[1];
        e.dwh.cubosUsuario = e.dwh.cubosUsuario.filter((c) => c.nombre !== nombre);
        delete e.dwh.datos[id];
        delete e.dwh.meta[id];
      });
      ui.seleccionado = 'consumo_agregado.cubo_mensual';
      ctx.refrescar();
      aviso('Cubo eliminado.', 'ok');
    }
  });

  raiz.addEventListener('change', (ev) => {
    const cfg = ev.target.closest('[data-config]');
    if (cfg) {
      ctx.cambiar((e) => { e.config[cfg.dataset.config] = cfg.checked; });
      return;
    }
    const form = ev.target.closest('#form-cubo');
    if (form) {
      ui.cubo.dimensiones = [...form.querySelectorAll('input[name="dimension"]:checked')].map((x) => x.value);
      ui.cubo.medidas = [...form.querySelectorAll('input[name="medida"]:checked')].map((x) => x.value);
      actualizarPrevia();
    }
  });

  raiz.addEventListener('input', (ev) => {
    if (ev.target.id === 'cubo-nombre') {
      ui.cubo.nombre = ev.target.value.trim();
      const ayuda = ev.target.parentElement.querySelector('.ayuda .codigo');
      if (ayuda) ayuda.textContent = `consumo_agregado.${ui.cubo.nombre || '…'}`;
      actualizarPrevia();
    }
  });

  raiz.querySelector('#form-cubo')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const errores = validarCubo(ui.cubo, nombresOcupados(ctx.estado));
    if (errores.length) { aviso(errores[0], 'critico'); return; }
    const spec = { ...ui.cubo, dimensiones: [...ui.cubo.dimensiones], medidas: [...ui.cubo.medidas] };
    const id = `consumo_agregado.${spec.nombre}`;
    const r = ctx.cambiar((e) => {
      e.dwh.cubosUsuario.push(spec);
      return refrescarObjeto(e, id);
    });
    ui.seleccionado = id;
    ui.pestana = 'capas';
    ui.cubo = { ...ui.cubo, nombre: `${spec.nombre}_2` };
    history.replaceState(null, '', `#/dwh?pestana=capas&objeto=${encodeURIComponent(id)}`);
    ctx.refrescar();
    aviso(`Cubo ${id} creado con ${fmt.entero(r.filas)} filas e integrado al proceso diario.`, 'ok');
  });
}
