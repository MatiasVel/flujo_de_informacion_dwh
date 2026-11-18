// Componentes de interfaz reutilizables (devuelven HTML como texto).

import { esc, fmt, icono } from './dom.js';
import { formatoFecha, horaTexto, diaDeSemana } from '../motor/fechas.js';

// ---- Estados ----
const ESTADOS = {
  actualizado: { clase: 'ok', texto: 'Actualizado', icono: icono.ok },
  desactualizado: { clase: 'aviso', texto: 'Desactualizado', icono: icono.aviso },
  error: { clase: 'critico', texto: 'Error en la última actualización', icono: icono.critico },
  sin_datos: { clase: 'neutro', texto: 'Sin datos', icono: icono.neutro },
  vivo: { clase: 'vivo', texto: 'En vivo: consulta al origen', icono: icono.vivo },
  OK: { clase: 'ok', texto: 'OK', icono: icono.ok },
  ERROR: { clase: 'critico', texto: 'Error', icono: icono.critico },
  OMITIDO: { clase: 'neutro', texto: 'Omitido', icono: icono.neutro },
  ADVERTENCIA: { clase: 'aviso', texto: 'Advertencia', icono: icono.aviso },
};

export function chip(codigo, texto) {
  const e = ESTADOS[codigo] ?? ESTADOS.sin_datos;
  return `<span class="chip ${e.clase}">${e.icono}<span>${esc(texto ?? e.texto)}</span></span>`;
}

export function claseEstado(codigo) {
  return (ESTADOS[codigo] ?? ESTADOS.sin_datos).clase;
}

export function avisoLinea(tipo, contenidoHTML) {
  const simbolo = { ok: icono.ok, aviso: icono.aviso, critico: icono.critico, info: icono.info }[tipo] ?? icono.info;
  return `<div class="aviso-linea ${tipo}">${simbolo}<div>${contenidoHTML}</div></div>`;
}

// ---- Banda de encabezado de página ----
const CODIGO_FONDO = `CREATE MATERIALIZED VIEW cubo_mensual AS
SELECT
  date_trunc('month', fecha)::date AS mes,
  id_dimension,
  count(*)      AS cantidad,
  sum(medida)   AS total
FROM tabla_hechos
GROUP BY 1, 2;

REFRESH MATERIALIZED VIEW extraccion.mv_operaciones;
SELECT * FROM consumo_agregado.fn_tablero_gerencial(12);`;

export function codigoDeFondo() {
  return `<pre class="codigo-fondo" aria-hidden="true">${esc(CODIGO_FONDO)}</pre>`;
}

export function textoReloj(reloj) {
  return `${diaDeSemana(reloj.fecha)} ${formatoFecha(reloj.fecha)}, ${horaTexto(reloj.minutos)}`;
}

export function banda({ titulo, bajada, estado }) {
  return `
  <section class="banda">
    ${codigoDeFondo()}
    <div class="banda-interior">
      <div>
        <h1>${esc(titulo)}</h1>
        ${bajada ? `<p class="bajada">${bajada}</p>` : ''}
      </div>
      ${estado ? `<div class="reloj" aria-label="Reloj simulado">
        <span>Fecha y hora simuladas</span>
        <strong>${esc(textoReloj(estado.reloj))}</strong>
      </div>` : ''}
    </div>
  </section>`;
}

// ---- Bloqueo por perfil ----
export function bloqueado(perfil, mensaje) {
  return avisoLinea('info', `<p><strong>Tu perfil (${esc(perfil)}) no tiene acceso a esta sección.</strong> ${esc(mensaje)}</p>
    <p class="pequeno muted">Cambiá de cuenta desde el menú de sesión, arriba a la derecha. Es una simulación de permisos: no es un control de seguridad real.</p>`);
}

// ---- Indicadores ----
export function indicador({ etiqueta, valor, detalle = '', heroe = false }) {
  return `<div class="indicador${heroe ? ' heroe' : ''}">
    <div class="etiqueta">${esc(etiqueta)}</div>
    <div class="valor">${valor}</div>
    ${detalle ? `<div class="detalle">${detalle}</div>` : ''}
  </div>`;
}

// ---- Tablas ----
// columnas: [{ clave, titulo, num, formato(valor, fila) -> HTML, clase }]
export function tabla({ columnas, filas, vacio = 'No hay filas para mostrar.', caption = '', claseFila, alta = false }) {
  if (!filas.length) return `<div class="tabla-contenedor"><p class="tabla-vacia">${esc(vacio)}</p></div>`;
  const cabeza = columnas.map((c) => `<th scope="col" class="${c.num ? 'num' : ''}">${esc(c.titulo)}</th>`).join('');
  const cuerpo = filas.map((f) => {
    const celdas = columnas.map((c) => {
      const v = c.formato ? c.formato(f[c.clave], f) : esc(f[c.clave]);
      return `<td class="${[c.num ? 'num' : '', c.clase ?? ''].join(' ').trim()}">${v ?? ''}</td>`;
    }).join('');
    return `<tr class="${claseFila ? claseFila(f) : ''}">${celdas}</tr>`;
  }).join('');
  return `<div class="tabla-contenedor${alta ? ' alta' : ''}"><table class="tabla">${caption ? `<caption class="visualmente-oculto">${esc(caption)}</caption>` : ''}<thead><tr>${cabeza}</tr></thead><tbody>${cuerpo}</tbody></table></div>`;
}

export function paginar(filas, pagina, porPagina = 25) {
  const paginas = Math.max(1, Math.ceil(filas.length / porPagina));
  const actual = Math.min(Math.max(1, pagina), paginas);
  const desde = (actual - 1) * porPagina;
  return { filas: filas.slice(desde, desde + porPagina), pagina: actual, paginas, desde: desde + 1, hasta: Math.min(filas.length, desde + porPagina), total: filas.length };
}

export function paginacion(info, accion) {
  if (info.total === 0) return '';
  return `<div class="paginacion">
    <span>Filas ${fmt.entero(info.desde)} a ${fmt.entero(info.hasta)} de ${fmt.entero(info.total)}</span>
    <div class="acciones">
      <button type="button" class="boton secundario chico" data-accion="${accion}" data-pagina="${info.pagina - 1}" ${info.pagina <= 1 ? 'disabled' : ''}>Anterior</button>
      <span>Página ${info.pagina} de ${info.paginas}</span>
      <button type="button" class="boton secundario chico" data-accion="${accion}" data-pagina="${info.pagina + 1}" ${info.pagina >= info.paginas ? 'disabled' : ''}>Siguiente</button>
    </div>
  </div>`;
}

export function pestanas(lista, activa, accion) {
  return `<div class="pestanas" role="tablist">${lista.map((p) => `
    <button type="button" role="tab" aria-selected="${p.id === activa}" data-accion="${accion}" data-id="${p.id}">${esc(p.texto)}${p.contador != null ? `<span class="contador">${esc(p.contador)}</span>` : ''}</button>`).join('')}
  </div>`;
}

// ---- Código resaltado ----
const PALABRAS = new Set(`SELECT FROM WHERE JOIN LEFT INNER ON GROUP BY ORDER AS AND OR NOT NULL IS CREATE MATERIALIZED VIEW REFRESH TABLE
FOREIGN SERVER OPTIONS INSERT INTO VALUES UPDATE SET DELETE CONFLICT DO EXCLUDED FUNCTION RETURNS LANGUAGE STABLE REPLACE
PROCEDURE DECLARE BEGIN END LOOP FOREACH IN ARRAY EXCEPTION WHEN OTHERS THEN EXECUTE CALL EXTENSION IF EXISTS USER MAPPING
FOR IMPORT SCHEMA LIMIT TO GRANT USAGE ROLE LOGIN NOLOGIN ALL TABLES DISTINCT FILTER CONCURRENTLY UNIQUE INDEX EXPLAIN ANALYZE
BUFFERS USING DEFAULT WITH LET TYPE INTEGER TEXT DATE NUMERIC BIGINT TIMESTAMPTZ SQL PLPGSQL WRAPPER DATA ASC DESC CASE ELSE
SUM DIVIDE DISTINCTCOUNT VALUES SUMX COUNT AVG MAX MIN ROUND`.split(/\s+/));

export function resaltarCodigo(codigo) {
  const re = /(--[^\n]*|\/\/[^\n]*)|('(?:[^'\n]|'')*'|"[^"\n]*")|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)/g;
  let salida = '';
  let ultimo = 0;
  let m;
  while ((m = re.exec(codigo))) {
    salida += esc(codigo.slice(ultimo, m.index));
    if (m[1]) salida += `<span class="sql-com">${esc(m[1])}</span>`;
    else if (m[2]) salida += `<span class="sql-cad">${esc(m[2])}</span>`;
    else if (m[3]) salida += `<span class="sql-num">${esc(m[3])}</span>`;
    else salida += PALABRAS.has(m[4].toUpperCase()) && m[4] === m[4].toUpperCase() ? `<span class="sql-pal">${esc(m[4])}</span>` : esc(m[4]);
    ultimo = re.lastIndex;
  }
  return salida + esc(codigo.slice(ultimo));
}

export function bloqueCodigo(codigo, { etiqueta = 'SQL (PostgreSQL)' } = {}) {
  return `<div class="codigo-bloque" data-codigo="${esc(codigo)}">
    <div class="codigo-cabeza"><span>${esc(etiqueta)}</span><button type="button" class="copiar" data-copiar aria-label="Copiar el código ${esc(etiqueta)}">Copiar</button></div>
    <pre><code>${resaltarCodigo(codigo)}</code></pre>
  </div>`;
}

// ---- Figura: gráfico con su vista de tabla equivalente ----
// Recuerda qué figuras se están viendo como tabla, para conservar la elección al redibujar.
export const tablasVisibles = new Set();

export function figura({ id, titulo, subtitulo = '', grafico, tablaHTML, leyenda = '', verTabla = tablasVisibles.has(id) }) {
  return `<figure class="figura" id="${esc(id)}" data-figura>
    <div class="figura-cabeza">
      <div><h3>${esc(titulo)}</h3>${subtitulo ? `<p>${subtitulo}</p>` : ''}</div>
      <button type="button" class="alternar" data-alternar-figura aria-pressed="${verTabla}">${verTabla ? 'Ver gráfico' : 'Ver como tabla'}</button>
    </div>
    <div class="vista-grafico"${verTabla ? ' hidden' : ''}>${leyenda}<div class="grafico">${grafico}</div></div>
    <div class="vista-tabla"${verTabla ? '' : ' hidden'}>${tablaHTML}</div>
  </figure>`;
}

export function leyenda(items) {
  return `<ul class="leyenda">${items.map((i) => `<li><span class="${i.linea ? 'clave-linea' : 'clave-barra'}" style="background:${i.color}"></span>${esc(i.texto)}</li>`).join('')}</ul>`;
}
