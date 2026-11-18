// Power BI: tablero gerencial simulado, alimentado por el modelo semántico importado.

import { esc, fmt, aviso } from '../ui/dom.js';
import { banda, chip, tabla, avisoLinea, bloqueCodigo, figura, leyenda, indicador, bloqueado } from '../ui/componentes.js';
import { columnas, barras, segmentada, medidor } from '../ui/graficos.js';
import { consultarTablero, estadoModelo, actualizarModelo } from '../motor/powerbi.js';
import { REGIONES, SEGMENTOS } from '../motor/catalogos.js';
import { POWER_QUERY, DAX_MEDIDAS } from '../motor/sql.js';
import { formatoMarca, etiquetaMes } from '../motor/fechas.js';

export const titulo = 'Power BI';

const ui = { filtros: { meses: 12, region: 'todas', segmento: 'todos' } };
const COLORES_SEGMENTO = { Residencial: 'var(--serie-1)', Comercial: 'var(--serie-2)', Corporativo: '#1baf7a' };

function opciones(lista, actual) {
  return lista.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(actual) ? 'selected' : ''}>${esc(t)}</option>`).join('');
}

function motivoTexto(est) {
  if (est.motivo === 'dwh') return 'Hay cambios en producción que todavía no llegaron al DWH. Se verán después del próximo proceso diario y de la actualización del modelo.';
  if (est.motivo === 'modelo') return 'El DWH ya tiene datos nuevos, pero el modelo todavía no se actualizó. La actualización programada corre a las 06:00, después del proceso diario.';
  if (est.motivo === 'repositorio') return 'La planilla de metas cambió en el repositorio de archivos. El cambio se verá cuando se actualice el modelo.';
  return '';
}

export function render(ctx) {
  const e = ctx.estado;
  const encabezado = banda({ titulo: 'Tablero gerencial en Power BI', bajada: 'Publicado en Power BI Service y distribuido por SharePoint con permisos de sólo lectura. Los cálculos pesados ya los hizo el DWH.', estado: e });
  if (!ctx.puede('ver_powerbi')) {
    return `${encabezado}<div class="pagina"><section class="lamina">${bloqueado(ctx.perfil().nombre, 'El tablero se distribuye a las gerencias y al equipo de datos.')}</section></div>`;
  }
  const modelo = e.powerbi.modelo;
  const meta = e.powerbi.meta;
  const est = estadoModelo(e);
  const puedeActualizar = ctx.puede('actualizar_powerbi');
  const error = e.powerbi.ultimoError;

  if (!modelo) {
    return `${encabezado}<div class="pagina"><section class="lamina">${avisoLinea('info', `<p><strong>El modelo todavía no tiene datos.</strong> Ejecutá el proceso diario del DWH y después actualizá el modelo.</p>${puedeActualizar ? '<div class="acciones"><button type="button" class="boton" data-accion="actualizar">Actualizar el modelo</button></div>' : ''}`)}</section></div>`;
  }

  const f = ui.filtros;
  const t = consultarTablero(modelo, f);
  const regiones = [...new Set([...REGIONES, ...modelo.hechos.map((h) => h.region)])];
  const conMeta = f.segmento === 'todos';

  const cabeza = `<div class="informe-cabeza">
    <div class="meta-modelo">
      <span><strong>Tablero gerencial</strong></span>
      <span>Modo de almacenamiento: <strong>Importación</strong></span>
      <span>Modelo actualizado: <strong>${esc(formatoMarca(meta.actualizado))}</strong></span>
      <span>Datos del origen al: <strong>${esc(formatoMarca(modelo.datosAl))}</strong></span>
    </div>
    <div class="acciones">
      ${chip(est.codigo)}
      ${e.config.gatewayCaido ? chip('error', 'Gateway fuera de línea') : chip('actualizado', 'Gateway en línea')}
      ${puedeActualizar ? '<button type="button" class="boton secundario chico" data-accion="actualizar">Actualizar ahora</button>' : ''}
    </div>
  </div>`;

  const avisos = [
    est.codigo === 'desactualizado' ? avisoLinea('aviso', `<p>${esc(motivoTexto(est))}</p>`) : '',
    error ? avisoLinea('critico', `<p><strong>La última actualización falló (${esc(formatoMarca(error.marca))}):</strong> ${esc(error.mensaje)} El tablero sigue mostrando los datos de la última actualización correcta.</p>`) : '',
    puedeActualizar ? '' : avisoLinea('info', '<p>Estás viendo el tablero como gerencia: sólo lectura.</p>'),
  ].filter(Boolean).join('');

  const filtros = `<div class="filtros" role="group" aria-label="Filtros del tablero">
    <div class="campo"><label for="f-meses">Período</label><select id="f-meses" data-filtro="meses">${opciones([[3, 'Últimos 3 meses'], [6, 'Últimos 6 meses'], [12, 'Últimos 12 meses']], f.meses)}</select></div>
    <div class="campo"><label for="f-region">Región</label><select id="f-region" data-filtro="region">${opciones([['todas', 'Todas'], ...regiones.map((r) => [r, r])], f.region)}</select></div>
    <div class="campo"><label for="f-segmento">Segmento</label><select id="f-segmento" data-filtro="segmento">${opciones([['todos', 'Todos'], ...SEGMENTOS.map((s) => [s, s])], f.segmento)}</select></div>
  </div>`;

  const k = t.kpis;
  const kpis = `<div class="indicadores">
    ${indicador({ etiqueta: 'Importe del período', valor: fmt.moneda(k.importe), detalle: `${esc(etiquetaMes(t.meses[0], { largo: true }))} a ${esc(etiquetaMes(t.meses.at(-1), { largo: true }))}`, heroe: true })}
    ${indicador({ etiqueta: 'Operaciones', valor: fmt.entero(k.operaciones) })}
    ${indicador({ etiqueta: 'Ticket promedio', valor: fmt.moneda(k.ticket) })}
    ${indicador({ etiqueta: 'Usuarios vigentes', valor: fmt.entero(k.usuariosVigentes), detalle: `${fmt.entero(k.altas30)} altas en los últimos 30 días` })}
    ${indicador({
      etiqueta: 'Cumplimiento de la meta',
      valor: conMeta ? fmt.porcentaje(k.cumplimiento) : '—',
      detalle: conMeta ? `${medidor(k.cumplimiento)}<div style="margin-top:6px">Meta del período: ${fmt.moneda(k.metaPeriodo)}</div>` : 'La meta es por región: quitá el filtro de segmento.',
    })}
  </div>`;

  const tablaMes = tabla({
    columnas: [
      { clave: 'mes', titulo: 'Mes', formato: (v) => esc(etiquetaMes(v, { largo: true })) },
      { clave: 'importe', titulo: 'Importe', num: true, formato: fmt.moneda },
      { clave: 'operaciones', titulo: 'Operaciones', num: true, formato: fmt.entero },
      ...(conMeta ? [{ clave: 'meta', titulo: 'Meta mensual', num: true, formato: fmt.moneda }] : []),
    ],
    filas: t.porMes,
  });
  const tablaRegion = tabla({
    columnas: [
      { clave: 'region', titulo: 'Región' },
      { clave: 'importe', titulo: 'Importe', num: true, formato: fmt.moneda },
      { clave: 'operaciones', titulo: 'Operaciones', num: true, formato: fmt.entero },
      { clave: 'ticket', titulo: 'Ticket promedio', num: true, formato: fmt.moneda },
      { clave: 'meta', titulo: 'Meta del período', num: true, formato: (v) => (v == null ? '—' : fmt.moneda(v)) },
      { clave: 'cumplimiento', titulo: 'Cumplimiento', num: true, formato: (v) => (v == null ? '—' : fmt.porcentaje(v)) },
    ],
    filas: t.porRegion,
  });
  const tablaTipo = tabla({
    columnas: [
      { clave: 'nombre', titulo: 'Tipo de servicio' },
      { clave: 'operaciones', titulo: 'Operaciones', num: true, formato: fmt.entero },
      { clave: 'importe', titulo: 'Importe', num: true, formato: fmt.moneda },
    ],
    filas: t.porTipo,
  });
  const tablaSegmento = tabla({
    columnas: [{ clave: 'segmento', titulo: 'Segmento' }, { clave: 'usuarios', titulo: 'Usuarios vigentes', num: true, formato: fmt.entero }],
    filas: t.porSegmento,
  });

  const graficos = `<div class="rejilla-graficos">
    <div class="ancho-completo">${figura({
      id: 'fig-mes', titulo: 'Importe por mes', subtitulo: conMeta ? 'Columnas: importe facturado; el último mes está en curso. Línea: meta mensual de la planilla del repositorio.' : 'Importe facturado por mes; el último mes está en curso.',
      grafico: '<div data-grafico="mes"></div>', tablaHTML: tablaMes,
      leyenda: conMeta ? leyenda([{ texto: 'Importe', color: 'var(--serie-1)' }, { texto: 'Meta mensual', color: 'var(--serie-2)', linea: true }]) : '',
    })}</div>
    ${figura({ id: 'fig-region', titulo: 'Importe por región', subtitulo: 'Ordenado de mayor a menor.', grafico: '<div data-grafico="region"></div>', tablaHTML: tablaRegion })}
    ${figura({ id: 'fig-tipo', titulo: 'Operaciones por tipo de servicio', subtitulo: 'Cantidad de operaciones del período.', grafico: '<div data-grafico="tipo"></div>', tablaHTML: tablaTipo })}
    <div class="ancho-completo">${figura({
      id: 'fig-segmento', titulo: 'Usuarios vigentes por segmento', subtitulo: `${fmt.entero(k.usuariosVigentes)} usuarios en total.`,
      grafico: '<div data-grafico="segmento"></div>', tablaHTML: tablaSegmento,
      leyenda: leyenda(SEGMENTOS.map((s) => ({ texto: `${s}: ${fmt.entero(t.porSegmento.find((x) => x.segmento === s)?.usuarios ?? 0)}`, color: COLORES_SEGMENTO[s] }))),
    })}</div>
  </div>`;

  const historial = tabla({
    columnas: [
      { clave: 'marca', titulo: 'Fecha y hora', formato: (v) => esc(formatoMarca(v)) },
      { clave: 'estado', titulo: 'Estado', formato: (v) => chip(v) },
      { clave: 'ms', titulo: 'Duración', num: true, formato: (v, fila) => (fila.estado === 'OK' ? fmt.ms(v) : '—') },
      { clave: 'filas', titulo: 'Filas importadas', num: true, formato: (v, fila) => (fila.estado === 'OK' ? fmt.entero(v) : '—') },
      { clave: 'mensaje', titulo: 'Detalle' },
    ],
    filas: e.powerbi.historial.slice(0, 10),
  });

  return `
  ${encabezado}
  <div class="pagina">
    <section class="lamina">
      ${avisos ? `<div style="display:grid;gap:10px;margin-bottom:18px">${avisos}</div>` : ''}
      <div class="informe">
        ${cabeza}
        ${filtros}
        <div class="informe-cuerpo">
          ${kpis}
          <div class="bloque-informe">${graficos}</div>
          <div class="bloque-informe"><h3 style="margin-bottom:12px">Resumen por región</h3>${tablaRegion}</div>
        </div>
      </div>
    </section>

    <section class="bloque" aria-labelledby="construccion-titulo">
      <div class="seccion-cabeza"><div><h2 id="construccion-titulo">Cómo está construido el tablero</h2><p>El modelo semántico combina dos fuentes: el DWH (a través del gateway de datos local) y una planilla del repositorio de archivos, que no pasa por el DWH.</p></div></div>
      <div class="grilla-tres">
        <div class="tarjeta-plana"><h3>Consulta de definición</h3><p><span class="codigo-en-linea">consumo_agregado.fn_tablero_gerencial(12)</span> entrega los últimos 12 meses del cubo mensual: ${fmt.entero(modelo.hechos.length)} filas.</p></div>
        <div class="tarjeta-plana"><h3>Cubo de usuarios</h3><p><span class="codigo-en-linea">consumo_agregado.cubo_usuarios_region</span>: ${fmt.entero(modelo.usuarios.length)} filas con usuarios vigentes por región y segmento.</p></div>
        <div class="tarjeta-plana"><h3>Planilla de metas</h3><p><span class="codigo-en-linea">metas_mensuales.xlsx</span> del repositorio de archivos: ${fmt.entero(modelo.metas.length)} filas, una por región.</p></div>
      </div>
      <p class="pequeno muted" style="margin-top:14px">Tamaño aproximado del modelo sin comprimir: ${fmt.bytes(meta.bytes)}. Importó ${fmt.entero(meta.filas)} filas en ${fmt.ms(meta.ms)}.</p>
      <div class="grilla-dos" style="margin-top:18px">
        <div><h3 style="margin-bottom:10px">Power Query (M)</h3>${bloqueCodigo(POWER_QUERY, { etiqueta: 'Power Query' })}</div>
        <div><h3 style="margin-bottom:10px">Medidas DAX</h3>${bloqueCodigo(DAX_MEDIDAS, { etiqueta: 'DAX' })}</div>
      </div>
      <h3 style="margin:24px 0 10px">Historial de actualizaciones en Power BI Service</h3>
      ${historial}
    </section>
  </div>`;
}

export function montar(raiz, ctx) {
  const e = ctx.estado;
  const modelo = e.powerbi.modelo;
  if (modelo) {
    const t = consultarTablero(modelo, ui.filtros);
    const ancho = (el) => Math.max(280, Math.round(el.clientWidth || el.parentElement.clientWidth || 600));
    const mes = raiz.querySelector('[data-grafico="mes"]');
    if (mes) {
      const metaMensual = ui.filtros.segmento === 'todos' ? t.porMes[0]?.meta : null;
      mes.innerHTML = columnas({
        datos: t.porMes, ancho: ancho(mes), alto: 280,
        etiquetaX: (d) => etiquetaMes(d.mes), valor: (d) => d.importe,
        formatoEje: fmt.monedaCompacta, referencia: metaMensual, nombreReferencia: 'Meta',
        descripcion: 'Importe por mes',
        tooltip: (d) => ({
          titulo: `${etiquetaMes(d.mes, { largo: true })}${d.mes === t.meses.at(-1) ? ' (mes en curso, parcial)' : ''}`,
          filas: [['Importe', fmt.moneda(d.importe), 'var(--serie-1)'], ['Operaciones', fmt.entero(d.operaciones)], ...(metaMensual ? [['Meta mensual', fmt.moneda(metaMensual), 'var(--serie-2)']] : [])],
        }),
      });
    }
    const region = raiz.querySelector('[data-grafico="region"]');
    if (region) {
      region.innerHTML = barras({
        datos: t.porRegion.map((r) => ({ id: r.region, etiqueta: r.region, valor: r.importe, textoValor: fmt.monedaCompacta(r.importe) })),
        ancho: ancho(region), descripcion: 'Importe por región',
        tooltip: (d) => {
          const r = t.porRegion.find((x) => x.region === d.id);
          return { titulo: d.etiqueta, filas: [['Importe', fmt.moneda(r.importe)], ['Operaciones', fmt.entero(r.operaciones)], ['Cumplimiento', r.cumplimiento == null ? '—' : fmt.porcentaje(r.cumplimiento)]] };
        },
      });
    }
    const tipo = raiz.querySelector('[data-grafico="tipo"]');
    if (tipo) {
      tipo.innerHTML = barras({
        datos: [...t.porTipo].sort((x, y) => y.operaciones - x.operaciones).map((x) => ({ id: x.tipo, etiqueta: x.nombre, valor: x.operaciones })),
        ancho: ancho(tipo), descripcion: 'Operaciones por tipo de servicio',
        tooltip: (d) => {
          const x = t.porTipo.find((y) => y.tipo === d.id);
          return { titulo: d.etiqueta, filas: [['Operaciones', fmt.entero(x.operaciones)], ['Importe', fmt.moneda(x.importe)]] };
        },
      });
    }
    const seg = raiz.querySelector('[data-grafico="segmento"]');
    if (seg) {
      seg.innerHTML = segmentada({ partes: t.porSegmento.map((s) => ({ nombre: s.segmento, valor: s.usuarios, color: COLORES_SEGMENTO[s.segmento] })), ancho: ancho(seg) });
    }
  }

  raiz.addEventListener('change', (ev) => {
    const s = ev.target.closest('[data-filtro]');
    if (!s) return;
    ui.filtros[s.dataset.filtro] = s.dataset.filtro === 'meses' ? Number(s.value) : s.value;
    ctx.refrescar();
    document.getElementById(s.id)?.focus();
  });
  raiz.addEventListener('click', (ev) => {
    if (!ev.target.closest('[data-accion="actualizar"]')) return;
    const r = ctx.cambiar((est) => actualizarModelo(est));
    aviso(r.estado === 'OK' ? `Modelo actualizado: ${fmt.entero(r.filas)} filas importadas en ${fmt.ms(r.ms)}.` : r.mensaje, r.estado === 'OK' ? 'ok' : 'critico');
  });
}
