// Rendimiento: mediciones para cuantificar el beneficio de los cubos (trabajo futuro del paper).

import { esc, fmt, aviso, descargarArchivo } from '../ui/dom.js';
import { banda, chip, tabla, avisoLinea, figura, leyenda, indicador, bloqueado, bloqueCodigo } from '../ui/componentes.js';
import { barras, lineas } from '../ui/graficos.js';
import { compararEstrategias, medirEscalabilidad, experimentoIncremental, cargaSobreProduccion } from '../motor/rendimiento.js';
import { escribirCSV } from '../motor/csv.js';
import { SQL_REFERENCIA } from '../motor/sql.js';
import { formatoFecha, formatoMarca } from '../motor/fechas.js';

export const titulo = 'Rendimiento';

const ui = {
  corriendo: null,
  repeticiones: 12,
  volumenMax: 100000,
  filasExperimento: 30000,
  carga: { gerentes: 10, interacciones: 20, visuales: 6 },
};

const ejeMs = (v) => (v === 0 ? '0' : fmt.ms(v));

const VOLUMENES = {
  50000: [5000, 10000, 25000, 50000],
  100000: [10000, 25000, 50000, 100000],
  200000: [10000, 50000, 100000, 200000],
};

function progreso(id) {
  return `<div class="progreso" aria-hidden="true"><span id="${id}"></span></div><p class="pequeno muted" id="${id}-texto" role="status">Midiendo…</p>`;
}

function seccionProceso(e) {
  const ultimo = e.dwh.ejecuciones[0];
  if (!ultimo) return '<p class="muted">Todavía no se ejecutó el proceso diario.</p>';
  const pasos = e.dwh.registro.filter((p) => p.id_ejecucion === ultimo.id && p.estado !== 'OMITIDO').sort((a, b) => a.paso - b.paso);
  const historial = e.dwh.ejecuciones.slice(0, 15).reverse();
  const tablaPasos = tabla({
    columnas: [
      { clave: 'objeto', titulo: 'Paso', clase: 'codigo' },
      { clave: 'ms', titulo: 'Duración', num: true, formato: fmt.ms },
      { clave: 'filas', titulo: 'Filas', num: true, formato: (v) => (v == null ? '—' : fmt.entero(v)) },
      { clave: 'estado', titulo: 'Estado', formato: (v) => chip(v) },
    ],
    filas: pasos,
  });
  const tablaHistorial = tabla({
    columnas: [
      { clave: 'id', titulo: 'Proceso', num: true, formato: (v) => `#${v}` },
      { clave: 'inicio', titulo: 'Fecha', formato: (v) => esc(formatoMarca(v)) },
      { clave: 'modo', titulo: 'Carga' },
      { clave: 'ms', titulo: 'Duración total', num: true, formato: fmt.ms },
      { clave: 'estado', titulo: 'Estado', formato: (v) => chip(v) },
    ],
    filas: historial.slice().reverse(),
  });
  return `<div class="grilla-dos">
    ${figura({ id: 'fig-pasos', titulo: `Duración de cada paso del proceso #${ultimo.id}`, subtitulo: `Total: ${fmt.ms(ultimo.ms)}. Carga ${esc(ultimo.modo)}.`, grafico: '<div data-grafico="pasos"></div>', tablaHTML: tablaPasos })}
    ${historial.length >= 2
      ? figura({ id: 'fig-historial', titulo: 'Duración total por ejecución', subtitulo: 'Crece con el volumen de datos: es la limitación del refresco completo.', grafico: '<div data-grafico="historial"></div>', tablaHTML: tablaHistorial })
      : `<div class="tarjeta-plana"><h3>Duración total por ejecución</h3><p>Ejecutá el proceso diario algunas veces (o simulá varios días) para ver cómo evoluciona.</p></div>`}
  </div>`;
}

function seccionEstrategias(ctx) {
  const e = ctx.estado;
  const r = e.rendimiento.estrategias;
  const controles = `<div class="acciones">
    <div class="campo" style="min-width:180px"><label for="rep">Repeticiones por estrategia</label><select id="rep" data-ui="repeticiones">${[5, 12, 25].map((n) => `<option value="${n}" ${n === ui.repeticiones ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    <button type="button" class="boton" data-medir="estrategias" style="align-self:flex-end" ${ui.corriendo ? 'disabled' : ''}>Medir con los datos actuales</button>
  </div>
  ${ui.corriendo === 'estrategias' ? progreso('p-estrategias') : ''}`;
  if (!r) return `${controles}<p class="muted" style="margin-top:14px">Todavía no hay mediciones. La prueba usa los datos actuales de producción y del DWH, sin modificarlos.</p>`;
  const cubo = r.resultados.find((x) => x.id === 'cubo');
  const tablaR = tabla({
    columnas: [
      { clave: 'corto', titulo: 'Estrategia', formato: (v, f) => `<strong>${esc(v ?? f.nombre)}</strong>` },
      { clave: 'procesa', titulo: 'Dónde se procesa' },
      { clave: 'medicion', titulo: 'Mediana', num: true, formato: (v) => fmt.ms(v.mediana) },
      { clave: 'medicion', titulo: 'P95', num: true, formato: (v) => fmt.ms(v.p95) },
      { clave: 'filasLeidas', titulo: 'Filas leídas', num: true, formato: fmt.entero },
      { clave: 'filasModelo', titulo: 'Filas en el modelo', num: true, formato: fmt.entero },
      { clave: 'bytesModelo', titulo: 'Tamaño del modelo', num: true, formato: (v) => (v ? fmt.bytes(v) : '—') },
      { clave: 'consultasProduccion', titulo: 'Consultas a producción', num: true, formato: fmt.entero },
    ],
    filas: r.resultados,
  });
  const imp = r.importacion;
  return `${controles}
    <div style="display:grid;gap:10px;margin:16px 0">
      ${r.coinciden ? avisoLinea('ok', '<p><strong>Las tres estrategias devuelven exactamente el mismo resultado</strong> (importe y cantidad por mes y región): la diferencia está sólo en dónde y cuántas veces se procesa.</p>') : avisoLinea('aviso', '<p>Los resultados no coinciden: el DWH no está al día con producción. Ejecutá el proceso diario y volvé a medir para comparar con los mismos datos.</p>')}
    </div>
    <div class="grilla-dos algo-izq">
      ${figura({ id: 'fig-estrategias', titulo: 'Tiempo por interacción con el tablero', subtitulo: `Mediana de ${r.repeticiones} repeticiones medidas el ${esc(formatoFecha(r.marca))}. Destacada: la solución del paper.`, grafico: '<div data-grafico="estrategias"></div>', tablaHTML: tablaR })}
      <div>
        <div class="indicadores">
          ${indicador({ etiqueta: 'Actualizar el modelo con el detalle', valor: fmt.ms(imp.detalle.medicion.mediana), detalle: `${fmt.entero(imp.detalle.filas)} filas importadas` })}
          ${indicador({ etiqueta: 'Actualizar el modelo con el cubo', valor: fmt.ms(imp.cubo.medicion.mediana), detalle: `${fmt.entero(imp.cubo.filas)} filas importadas` })}
        </div>
        <p class="pequeno" style="margin-top:12px">Con el cubo, el modelo tiene ${fmt.entero(cubo.filasModelo)} filas en lugar de ${fmt.entero(r.resultados[1].filasModelo)} y cada interacción es ${fmt.veces(r.resultados[1].medicion.mediana / Math.max(1e-6, cubo.medicion.mediana))} más rápida que procesando el detalle en Power BI.</p>
      </div>
    </div>
    <ul class="pequeno" style="margin:20px 0 12px;padding-left:1.2em;display:grid;gap:4px">${r.resultados.map((x) => `<li><strong>${esc(x.nombre)}.</strong> ${esc(x.descripcion)}</li>`).join('')}<li>Filas leídas y consultas a producción, por cada interacción con un visual. El tamaño del modelo es aproximado, sin la compresión de Power BI.</li></ul>
    ${tablaR}`;
}

function seccionEscalabilidad(ctx) {
  const r = ctx.estado.rendimiento.escalabilidad;
  const controles = `<div class="acciones">
    <div class="campo" style="min-width:200px"><label for="vol">Volumen máximo</label><select id="vol" data-ui="volumenMax">${Object.keys(VOLUMENES).map((v) => `<option value="${v}" ${Number(v) === ui.volumenMax ? 'selected' : ''}>${fmt.entero(Number(v))} operaciones</option>`).join('')}</select></div>
    <button type="button" class="boton" data-medir="escalabilidad" style="align-self:flex-end" ${ui.corriendo ? 'disabled' : ''}>Medir escalabilidad</button>
  </div>
  ${ui.corriendo === 'escalabilidad' ? progreso('p-escalabilidad') : ''}`;
  if (!r) return `${controles}<p class="muted" style="margin-top:14px">Genera conjuntos de datos aparte, de distinto tamaño, y mide cada uno. Tus datos no se modifican.</p>`;
  const p = r.puntos;
  const tabla1 = tabla({
    columnas: [
      { clave: 'filas', titulo: 'Operaciones', num: true, formato: fmt.entero },
      { clave: 'filasCubo', titulo: 'Filas del cubo', num: true, formato: fmt.entero },
      { clave: 'consultaDetalle', titulo: 'Consulta sobre el detalle', num: true, formato: (v) => fmt.ms(v.mediana) },
      { clave: 'consultaCubo', titulo: 'Consulta sobre el cubo', num: true, formato: (v) => fmt.ms(v.mediana) },
    ],
    filas: p,
  });
  const tabla2 = tabla({
    columnas: [
      { clave: 'filas', titulo: 'Operaciones', num: true, formato: fmt.entero },
      { clave: 'filasNuevas', titulo: 'Filas nuevas del día', num: true, formato: fmt.entero },
      { clave: 'refrescoCompleto', titulo: 'Copia completa', num: true, formato: (v) => fmt.ms(v.mediana) },
      { clave: 'refrescoIncremental', titulo: 'Copia incremental', num: true, formato: (v) => fmt.ms(v.mediana) },
    ],
    filas: p,
  });
  return `${controles}
    <div class="grilla-dos" style="margin-top:18px">
      ${figura({ id: 'fig-esc-consulta', titulo: 'Consulta del tablero según el volumen', subtitulo: 'El detalle crece con las filas; el cubo casi no cambia.', grafico: '<div data-grafico="esc-consulta"></div>', tablaHTML: tabla1, leyenda: leyenda([{ texto: 'Sobre el detalle', color: 'var(--serie-2)', linea: true }, { texto: 'Sobre el cubo', color: 'var(--serie-1)', linea: true }]) })}
      ${figura({ id: 'fig-esc-refresco', titulo: 'Actualización de la copia local según el volumen', subtitulo: 'Un día de operaciones nuevas sobre todo el historial.', grafico: '<div data-grafico="esc-refresco"></div>', tablaHTML: tabla2, leyenda: leyenda([{ texto: 'Completa', color: 'var(--serie-2)', linea: true }, { texto: 'Incremental', color: 'var(--serie-1)', linea: true }]) })}
    </div>`;
}

function seccionIncremental(ctx) {
  const r = ctx.estado.rendimiento.incremental;
  const controles = `<div class="acciones">
    <div class="campo" style="min-width:200px"><label for="filas-exp">Tamaño del historial</label><select id="filas-exp" data-ui="filasExperimento">${[10000, 30000, 100000].map((n) => `<option value="${n}" ${n === ui.filasExperimento ? 'selected' : ''}>${fmt.entero(n)} operaciones</option>`).join('')}</select></div>
    <button type="button" class="boton" data-medir="incremental" style="align-self:flex-end" ${ui.corriendo ? 'disabled' : ''}>Ejecutar el experimento</button>
  </div>
  ${ui.corriendo === 'incremental' ? progreso('p-incremental') : ''}`;
  if (!r) return `${controles}<p class="muted" style="margin-top:14px">Simula un día en el origen: llegan operaciones nuevas, un operador corrige el importe de una operación de hace más de un mes y elimina otra cargada por error. Después compara las dos formas de actualizar la copia.</p>`;
  const tarjeta = (titulo, x, buena) => `<div class="tarjeta-plana">
    <h3>${esc(titulo)}</h3>
    <dl class="datos-vivos">
      <div><dt>Tiempo (mediana)</dt><dd>${fmt.ms(x.medicion.mediana)}</dd></div>
      <div><dt>Filas leídas del origen</dt><dd>${fmt.entero(x.leidas)}</dd></div>
      <div><dt>Filas escritas en la copia</dt><dd>${fmt.entero(x.escritas)}</dd></div>
      <div><dt>Control de calidad</dt><dd>${x.diferencias.coincide ? chip('OK', 'Coincide con el origen') : chip('ADVERTENCIA', `${fmt.entero(Math.abs(x.diferencias.filas))} fila y ${fmt.moneda(Math.abs(x.diferencias.importe))} de diferencia`)}</dd></div>
    </dl>
    <p class="pequeno">${buena}</p>
  </div>`;
  return `${controles}
    <div class="grilla-dos" style="margin-top:18px">
      ${tarjeta('Copia completa (lo que hace la organización)', r.completa, 'Lee y reescribe todo el historial: más lenta, pero la copia queda idéntica al origen.')}
      ${tarjeta('Copia incremental por fecha', r.incremental, `Sólo lee desde la marca de agua (${esc(formatoFecha(r.marcaAgua))}): es ${fmt.veces(r.completa.medicion.mediana / Math.max(1e-6, r.incremental.medicion.mediana))} más rápida, pero no vio la corrección de la operación #${r.editada.id} (${esc(formatoFecha(r.editada.fecha))}, de ${fmt.moneda(r.editada.antes)} a ${fmt.moneda(r.editada.despues)}) ni la eliminación de la #${r.eliminada.id}.`)}
    </div>
    <p class="prosa" style="margin-top:16px">Por eso el paper la plantea como trabajo futuro "a costa de mayor complejidad": para usarla haría falta detectar las modificaciones (por ejemplo, con una columna de última modificación o con la conciliación diaria que muestra este simulador).</p>`;
}

function seccionProteccion(ctx) {
  const e = ctx.estado;
  const medida = e.rendimiento.estrategias?.resultados.find((x) => x.id === 'sin_dwh')?.medicion.mediana ?? null;
  const c = ui.carga;
  const r = cargaSobreProduccion({ ...c, msConsulta: medida, consultasProceso: 3 });
  return `<form id="form-carga" class="barra-herramientas" novalidate>
      <div class="campo"><label for="c-gerentes">Usuarios de gerencia</label><input id="c-gerentes" type="number" min="1" max="500" value="${c.gerentes}" data-carga="gerentes"></div>
      <div class="campo"><label for="c-inter">Interacciones por usuario al día</label><input id="c-inter" type="number" min="1" max="500" value="${c.interacciones}" data-carga="interacciones"></div>
      <div class="campo"><label for="c-vis">Visuales por página</label><input id="c-vis" type="number" min="1" max="30" value="${c.visuales}" data-carga="visuales"></div>
    </form>
    <div class="indicadores">
      ${indicador({ etiqueta: 'Consultas diarias a producción sin DWH', valor: fmt.entero(r.sinDWH), detalle: 'Cada visual de cada interacción consulta la base transaccional.' })}
      ${indicador({ etiqueta: 'Consultas diarias a producción con DWH', valor: fmt.entero(r.conDWH), detalle: 'Una lectura por tabla extraída y una de conciliación.' })}
      ${indicador({ etiqueta: 'Tiempo de cálculo estimado en producción sin DWH', valor: r.msSinDWH == null ? '—' : fmt.ms(r.msSinDWH), detalle: medida == null ? 'Medí primero las estrategias para estimarlo.' : `Con la mediana medida de la consulta directa: ${fmt.ms(medida)}.` })}
    </div>
    <p class="pequeno muted" style="margin-top:10px">En producción ese tiempo competiría con la carga de los operadores. Con el DWH, la operación diaria no se ve afectada por el trabajo analítico.</p>`;
}

export function render(ctx) {
  const e = ctx.estado;
  const encabezado = banda({ titulo: 'Rendimiento', bajada: 'El paper propone medir los tiempos para cuantificar el beneficio de los cubos. Acá se mide, en tu navegador, cada estrategia con los mismos datos.', estado: e });
  if (!ctx.puede('medir')) {
    return `${encabezado}<div class="pagina"><section class="lamina">${bloqueado(ctx.perfil().nombre, 'Las mediciones las realiza el equipo de datos.')}</section></div>`;
  }
  const hayResultados = e.rendimiento.estrategias || e.rendimiento.escalabilidad || e.rendimiento.incremental;
  return `
  ${encabezado}
  <div class="pagina">
    <section class="lamina">
      ${avisoLinea('info', `<p><strong>Cómo se mide.</strong> Cada prueba se repite varias veces y se informa la mediana, menos sensible a interrupciones que el promedio, junto con el percentil 95. Las operaciones muy rápidas se ejecutan en lotes para superar la resolución del reloj del navegador.</p>
        <p style="margin-top:8px">Los tiempos corresponden al motor de simulación en JavaScript: sirven para comparar estrategias con los mismos datos. En PostgreSQL los valores absolutos cambian, pero la relación entre procesar el detalle y leer un cubo pre-calculado se mantiene. Cuando una fila pasa de un servidor a otro (del origen al DWH o del DWH a Power BI) el simulador la serializa, como viajaría por la red. <a href="#/glosario?seccion=sql-medir">Cómo medir en el DWH real</a>.</p>`)}
      ${hayResultados ? '<div class="acciones" style="margin-top:14px"><button type="button" class="boton secundario chico" data-accion="exportar">Descargar los resultados (CSV)</button></div>' : ''}

      <div class="seccion" id="proceso">
        <div class="seccion-cabeza"><div><h2>Tiempos del proceso diario</h2><p>Medidos durante la última ejecución y guardados en el registro de ejecución.</p></div></div>
        ${seccionProceso(e)}
      </div>

      <div class="seccion" id="estrategias">
        <div class="seccion-cabeza"><div><h2>¿Dónde conviene procesar?</h2><p>La misma pregunta del tablero (importe y operaciones por mes y región, últimos 12 meses) respondida de tres formas.</p></div></div>
        ${seccionEstrategias(ctx)}
      </div>

      <div class="seccion" id="escalabilidad">
        <div class="seccion-cabeza"><div><h2>Escalabilidad con el volumen</h2><p>Qué pasa con los tiempos cuando crece la cantidad de operaciones.</p></div></div>
        ${seccionEscalabilidad(ctx)}
      </div>

      <div class="seccion" id="incremental">
        <div class="seccion-cabeza"><div><h2>Carga completa o incremental: qué se gana y qué se pierde</h2><p>El paper propone evaluar la carga incremental por fecha en las tablas de mayor volumen.</p></div></div>
        ${seccionIncremental(ctx)}
      </div>

      <div class="seccion" id="proteccion">
        <div class="seccion-cabeza"><div><h2>Protección de la operación</h2><p>Cuántas consultas recibiría la base transaccional si los tableros la consultaran directamente.</p></div></div>
        ${seccionProteccion(ctx)}
      </div>

      <div class="seccion" id="sql">
        <div class="seccion-cabeza"><div><h2>Medir en el DWH real</h2><p>Consultas para obtener los mismos indicadores en PostgreSQL.</p></div></div>
        ${bloqueCodigo(SQL_REFERENCIA.find((s) => s.id === 'medir').sql)}
      </div>
    </section>
  </div>`;
}

function dibujar(raiz, ctx) {
  const e = ctx.estado;
  const ancho = (el) => Math.max(280, Math.round(el.clientWidth || el.parentElement.clientWidth || 560));
  const ultimo = e.dwh.ejecuciones[0];
  const elPasos = raiz.querySelector('[data-grafico="pasos"]');
  if (elPasos && ultimo) {
    const pasos = e.dwh.registro.filter((p) => p.id_ejecucion === ultimo.id && p.estado !== 'OMITIDO').sort((a, b) => b.ms - a.ms);
    elPasos.innerHTML = barras({
      datos: pasos.map((p) => ({ id: p.objeto, etiqueta: p.objeto.split('.')[1], valor: p.ms, textoValor: fmt.ms(p.ms) })),
      ancho: ancho(elPasos), descripcion: 'Duración de cada paso del proceso diario',
      tooltip: (d) => {
        const p = pasos.find((x) => x.objeto === d.id);
        return { titulo: p.objeto, filas: [['Duración', fmt.ms(p.ms)], ['Filas', p.filas == null ? '—' : fmt.entero(p.filas)], ['Estado', p.estado]] };
      },
    });
  }
  const elHist = raiz.querySelector('[data-grafico="historial"]');
  if (elHist) {
    const h = e.dwh.ejecuciones.slice(0, 15).reverse();
    elHist.innerHTML = lineas({
      x: h.map((_, i) => i), series: [{ nombre: 'Duración total', color: 'var(--serie-1)', valores: h.map((x) => x.ms) }],
      ancho: ancho(elHist), alto: 240, formatoX: (i) => `#${h[i].id}`, formatoY: fmt.ms, formatoEje: ejeMs,
      descripcion: 'Duración total del proceso diario por ejecución',
    });
  }
  const r = e.rendimiento.estrategias;
  const elEst = raiz.querySelector('[data-grafico="estrategias"]');
  if (elEst && r) {
    elEst.innerHTML = barras({
      datos: r.resultados.map((x) => ({ id: x.id, etiqueta: x.nombre, valor: x.medicion.mediana, textoValor: fmt.ms(x.medicion.mediana) })),
      ancho: ancho(elEst), enfasis: 'cubo', anchoEtiqueta: Math.min(250, Math.round(ancho(elEst) * 0.46)), descripcion: 'Tiempo por interacción según la estrategia',
      tooltip: (d) => {
        const x = r.resultados.find((y) => y.id === d.id);
        return { titulo: x.nombre, filas: [['Mediana', fmt.ms(x.medicion.mediana)], ['Percentil 95', fmt.ms(x.medicion.p95)], ['Filas leídas', fmt.entero(x.filasLeidas)]] };
      },
    });
  }
  const esc_ = e.rendimiento.escalabilidad;
  const elC = raiz.querySelector('[data-grafico="esc-consulta"]');
  const elR = raiz.querySelector('[data-grafico="esc-refresco"]');
  if (esc_ && elC && elR) {
    const x = esc_.puntos.map((p) => p.filas);
    const formatoX = (v) => fmt.compacto(v);
    elC.innerHTML = lineas({
      x, ancho: ancho(elC), formatoX, formatoY: fmt.ms, formatoEje: ejeMs, descripcion: 'Consulta del tablero según el volumen',
      series: [
        { nombre: 'Sobre el detalle', color: 'var(--serie-2)', valores: esc_.puntos.map((p) => p.consultaDetalle.mediana) },
        { nombre: 'Sobre el cubo', color: 'var(--serie-1)', valores: esc_.puntos.map((p) => p.consultaCubo.mediana) },
      ],
    });
    elR.innerHTML = lineas({
      x, ancho: ancho(elR), formatoX, formatoY: fmt.ms, formatoEje: ejeMs, descripcion: 'Actualización de la copia local según el volumen',
      series: [
        { nombre: 'Completa', color: 'var(--serie-2)', valores: esc_.puntos.map((p) => p.refrescoCompleto.mediana) },
        { nombre: 'Incremental', color: 'var(--serie-1)', valores: esc_.puntos.map((p) => p.refrescoIncremental.mediana) },
      ],
    });
  }
}

function exportar(e) {
  const filas = [];
  const r = e.rendimiento;
  r.estrategias?.resultados.forEach((x) => filas.push({ prueba: 'Estrategias', caso: x.nombre, filas: x.filasLeidas, mediana_ms: x.medicion.mediana.toFixed(4), p95_ms: x.medicion.p95.toFixed(4), repeticiones: x.medicion.n }));
  if (r.estrategias) {
    filas.push({ prueba: 'Actualización del modelo', caso: 'Importar detalle', filas: r.estrategias.importacion.detalle.filas, mediana_ms: r.estrategias.importacion.detalle.medicion.mediana.toFixed(4), p95_ms: r.estrategias.importacion.detalle.medicion.p95.toFixed(4), repeticiones: r.estrategias.importacion.detalle.medicion.n });
    filas.push({ prueba: 'Actualización del modelo', caso: 'Importar cubo', filas: r.estrategias.importacion.cubo.filas, mediana_ms: r.estrategias.importacion.cubo.medicion.mediana.toFixed(4), p95_ms: r.estrategias.importacion.cubo.medicion.p95.toFixed(4), repeticiones: r.estrategias.importacion.cubo.medicion.n });
  }
  r.escalabilidad?.puntos.forEach((p) => {
    for (const [caso, m] of [['Consulta sobre el detalle', p.consultaDetalle], ['Consulta sobre el cubo', p.consultaCubo], ['Copia completa', p.refrescoCompleto], ['Copia incremental', p.refrescoIncremental]]) {
      filas.push({ prueba: 'Escalabilidad', caso, filas: p.filas, mediana_ms: m.mediana.toFixed(4), p95_ms: m.p95.toFixed(4), repeticiones: m.n });
    }
  });
  if (r.incremental) {
    filas.push({ prueba: 'Completa vs. incremental', caso: 'Copia completa', filas: r.incremental.filas, mediana_ms: r.incremental.completa.medicion.mediana.toFixed(4), p95_ms: r.incremental.completa.medicion.p95.toFixed(4), repeticiones: r.incremental.completa.medicion.n });
    filas.push({ prueba: 'Completa vs. incremental', caso: 'Copia incremental', filas: r.incremental.filas, mediana_ms: r.incremental.incremental.medicion.mediana.toFixed(4), p95_ms: r.incremental.incremental.medicion.p95.toFixed(4), repeticiones: r.incremental.incremental.medicion.n });
  }
  const csv = escribirCSV(filas.map((f) => ({ ...f, mediana_ms: f.mediana_ms.replace('.', ','), p95_ms: f.p95_ms.replace('.', ',') })), ['prueba', 'caso', 'filas', 'mediana_ms', 'p95_ms', 'repeticiones']);
  descargarArchivo(`mediciones_dwh_${e.reloj.fecha}.csv`, `﻿${csv}`);
}

export function montar(raiz, ctx) {
  dibujar(raiz, ctx);
  const avanzar = (id, fraccion, texto) => {
    const barra = document.getElementById(id);
    if (barra) barra.style.width = `${Math.round(fraccion * 100)}%`;
    const t = document.getElementById(`${id}-texto`);
    if (t && texto) t.textContent = texto;
  };

  raiz.addEventListener('change', (ev) => {
    const s = ev.target.closest('[data-ui]');
    if (s) { ui[s.dataset.ui] = Number(s.value); return; }
  });
  raiz.addEventListener('input', (ev) => {
    const c = ev.target.closest('[data-carga]');
    if (!c) return;
    const v = Math.max(1, Math.min(500, Math.round(Number(c.value) || 1)));
    ui.carga[c.dataset.carga] = v;
    const id = c.id;
    clearTimeout(c._t);
    c._t = setTimeout(() => { ctx.refrescar(); const n = document.getElementById(id); n?.focus(); }, 350);
  });

  raiz.addEventListener('click', async (ev) => {
    if (ev.target.closest('[data-accion="exportar"]')) { exportar(ctx.estado); return; }
    const b = ev.target.closest('[data-medir]');
    if (!b || ui.corriendo) return;
    const tipo = b.dataset.medir;
    ui.corriendo = tipo;
    ctx.refrescar();
    try {
      if (tipo === 'estrategias') {
        const r = await compararEstrategias(ctx.estado, { repeticiones: ui.repeticiones, alProgresar: (f) => avanzar('p-estrategias', f, `Midiendo… ${fmt.porcentaje(f)}`) });
        ui.corriendo = null;
        ctx.cambiar((e) => { e.rendimiento.estrategias = r; });
        aviso('Medición terminada.', 'ok');
      } else if (tipo === 'escalabilidad') {
        const r = await medirEscalabilidad({
          volumenes: VOLUMENES[ui.volumenMax], repeticiones: 5, fechaFin: ctx.estado.reloj.fecha,
          alProgresar: (f, filas) => avanzar('p-escalabilidad', f, `Medido el volumen de ${fmt.entero(filas)} operaciones…`),
        });
        ui.corriendo = null;
        ctx.cambiar((e) => { e.rendimiento.escalabilidad = r; });
        aviso('Medición de escalabilidad terminada.', 'ok');
      } else if (tipo === 'incremental') {
        avanzar('p-incremental', 0.3, 'Preparando el historial…');
        await new Promise((res) => setTimeout(res, 30));
        const r = experimentoIncremental({ filas: ui.filasExperimento, fechaFin: ctx.estado.reloj.fecha });
        ui.corriendo = null;
        ctx.cambiar((e) => { e.rendimiento.incremental = r; });
        aviso('Experimento terminado.', 'ok');
      }
    } catch (error) {
      console.error(error);
      ui.corriendo = null;
      ctx.refrescar();
      aviso(`No se pudo completar la medición: ${error.message}`, 'critico');
    }
  });
}
