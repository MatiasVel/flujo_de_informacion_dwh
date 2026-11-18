// Gráficos SVG livianos y accesibles: columnas, barras horizontales, líneas y barra segmentada.
// Reglas aplicadas: marcas finas (barras de hasta 24 px con extremo redondeado de 4 px),
// líneas de 2 px, grilla en línea fina, leyenda para dos o más series, rótulos selectivos,
// tooltip al pasar el puntero o enfocar con teclado, y siempre una vista de tabla equivalente.

import { esc, fmt } from './dom.js';

const ALTO_BANDA_X = 34;

export function ticks(max, cantidad = 4) {
  if (!(max > 0)) return [0, 1];
  const bruto = max / cantidad;
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  const r = bruto / potencia;
  const paso = (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * potencia;
  const tope = Math.ceil(max / paso - 1e-9) * paso;
  const lista = [];
  for (let v = 0; v <= tope + paso / 1e6; v += paso) lista.push(Math.round(v * 1e6) / 1e6);
  return lista;
}

function datosTooltip(titulo, filas) {
  return esc(JSON.stringify({ t: titulo, f: filas }));
}

// Barra vertical con extremo de datos redondeado y base recta.
function caminoColumna(x, y, ancho, alto) {
  if (alto <= 0) return '';
  const r = Math.min(4, ancho / 2, alto);
  const base = y + alto;
  return `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + ancho - r}Q${x + ancho},${y} ${x + ancho},${y + r}V${base}Z`;
}

// Barra horizontal con extremo de datos redondeado a la derecha.
function caminoBarra(x, y, largo, alto) {
  if (largo <= 0) return '';
  const r = Math.min(4, alto / 2, largo);
  return `M${x},${y}H${x + largo - r}Q${x + largo},${y} ${x + largo},${y + r}V${y + alto - r}Q${x + largo},${y + alto} ${x + largo - r},${y + alto}H${x}Z`;
}

// ---- Columnas (una serie) con línea de referencia opcional en la misma escala ----
export function columnas({ datos, ancho = 640, alto = 260, formatoEje = fmt.compacto, etiquetaX, valor, tooltip, referencia = null, nombreReferencia = 'Meta', descripcion = '' }) {
  const margen = { izq: 62, der: referencia != null ? 52 : 12, arr: 14, aba: ALTO_BANDA_X };
  const anchoPlot = Math.max(120, ancho - margen.izq - margen.der);
  const altoPlot = alto - margen.arr - margen.aba;
  const max = Math.max(1, ...datos.map(valor), referencia ?? 0);
  const marcas = ticks(max);
  const tope = marcas[marcas.length - 1];
  const y = (v) => margen.arr + altoPlot - (v / tope) * altoPlot;
  const banda = anchoPlot / Math.max(1, datos.length);
  const anchoBarra = Math.min(24, banda * 0.62);
  const saltoEtiqueta = banda < 38 ? Math.ceil(38 / banda) : 1;

  const grilla = marcas.map((m) => `<line x1="${margen.izq}" x2="${margen.izq + anchoPlot}" y1="${y(m)}" y2="${y(m)}" stroke="var(--grafico-grilla)" stroke-width="1"/>
    <text x="${margen.izq - 8}" y="${y(m) + 4}" text-anchor="end" font-size="12" fill="var(--grafico-texto)">${esc(formatoEje(m))}</text>`).join('');
  const barras = datos.map((d, i) => {
    const cx = margen.izq + banda * i + banda / 2;
    const v = valor(d);
    const yTop = y(v);
    const etiqueta = i % saltoEtiqueta === 0 || i === datos.length - 1
      ? `<text x="${cx}" y="${margen.arr + altoPlot + 20}" text-anchor="middle" font-size="12" fill="var(--grafico-texto)">${esc(etiquetaX(d))}</text>` : '';
    const tt = tooltip ? tooltip(d) : { titulo: etiquetaX(d), filas: [['Valor', String(v)]] };
    return `<path class="marca-grafico" d="${caminoColumna(cx - anchoBarra / 2, yTop, anchoBarra, margen.arr + altoPlot - yTop)}" fill="var(--serie-1)"/>
      ${etiqueta}
      <rect class="zona" x="${margen.izq + banda * i}" y="${margen.arr}" width="${banda}" height="${altoPlot}" tabindex="0" role="img" aria-label="${esc(`${tt.titulo}: ${tt.filas.map((f) => `${f[0]} ${f[1]}`).join(', ')}`)}" data-tt="${datosTooltip(tt.titulo, tt.filas)}"/>`;
  }).join('');
  const lineaRef = referencia != null && referencia > 0
    ? `<line x1="${margen.izq}" x2="${margen.izq + anchoPlot}" y1="${y(referencia)}" y2="${y(referencia)}" stroke="var(--serie-2)" stroke-width="2"/>
       <text x="${margen.izq + anchoPlot + 6}" y="${y(referencia) + 4}" font-size="12" fill="var(--tinta-2)">${esc(nombreReferencia)}</text>` : '';
  return `<svg viewBox="0 0 ${ancho} ${alto}" role="group" aria-label="${esc(descripcion)}">
    ${grilla}
    <line x1="${margen.izq}" x2="${margen.izq + anchoPlot}" y1="${margen.arr + altoPlot}" y2="${margen.arr + altoPlot}" stroke="var(--grafico-eje)" stroke-width="1"/>
    ${barras}
    ${lineaRef}
  </svg>`;
}

// ---- Barras horizontales ordenadas (una serie; énfasis opcional en una barra) ----
export function barras({ datos, ancho = 560, formatoValor = fmt.entero, tooltip, enfasis = null, descripcion = '', anchoEtiqueta }) {
  const alto = 22;
  const separacion = 12;
  const maxCaracteres = Math.max(...datos.map((d) => String(d.etiqueta).length), 4);
  const izq = anchoEtiqueta ?? Math.min(Math.round(ancho * 0.42), Math.max(70, maxCaracteres * 7 + 12));
  const anchoTexto = 76;
  const anchoPlot = Math.max(60, ancho - izq - anchoTexto);
  const max = Math.max(...datos.map((d) => d.valor), 0) || 1;
  const altoTotal = datos.length * (alto + separacion) + 4;
  const filas = datos.map((d, i) => {
    const y0 = i * (alto + separacion) + 2;
    const largo = Math.max(d.valor > 0 ? 2 : 0, (d.valor / max) * anchoPlot);
    const color = enfasis == null ? 'var(--serie-1)' : d.id === enfasis ? 'var(--serie-1)' : 'var(--grafico-gris)';
    const tt = tooltip ? tooltip(d) : { titulo: d.etiqueta, filas: [['Valor', formatoValor(d.valor)]] };
    return `<text x="${izq - 10}" y="${y0 + alto / 2 + 4}" text-anchor="end" font-size="13" fill="var(--tinta-2)">${esc(d.etiqueta)}</text>
      <path class="marca-grafico" d="${caminoBarra(izq, y0, largo, alto)}" fill="${color}"/>
      <text x="${izq + largo + 8}" y="${y0 + alto / 2 + 4}" font-size="13" fill="var(--tinta)" font-weight="600">${esc(d.textoValor ?? formatoValor(d.valor))}</text>
      <rect class="zona" x="0" y="${y0 - separacion / 2}" width="${ancho}" height="${alto + separacion}" tabindex="0" role="img" aria-label="${esc(`${tt.titulo}: ${tt.filas.map((f) => `${f[0]} ${f[1]}`).join(', ')}`)}" data-tt="${datosTooltip(tt.titulo, tt.filas)}"/>`;
  }).join('');
  return `<svg viewBox="0 0 ${ancho} ${altoTotal}" role="group" aria-label="${esc(descripcion)}">
    <line x1="${izq}" x2="${izq}" y1="0" y2="${altoTotal}" stroke="var(--grafico-eje)" stroke-width="1"/>
    ${filas}
  </svg>`;
}

// ---- Líneas (una o dos series) con cruz que sigue al puntero ----
export function lineas({ x, series, ancho = 640, alto = 260, formatoX = String, formatoY = fmt.entero, formatoEje = fmt.compacto, descripcion = '', id }) {
  const margen = { izq: 62, der: 96, arr: 14, aba: ALTO_BANDA_X };
  const anchoPlot = Math.max(120, ancho - margen.izq - margen.der);
  const altoPlot = alto - margen.arr - margen.aba;
  const max = Math.max(1e-9, ...series.flatMap((s) => s.valores.filter((v) => v != null)));
  const marcas = ticks(max);
  const tope = marcas[marcas.length - 1];
  const minX = Math.min(...x);
  const maxX = Math.max(...x);
  const px = (v) => margen.izq + (maxX === minX ? anchoPlot / 2 : ((v - minX) / (maxX - minX)) * anchoPlot);
  const py = (v) => margen.arr + altoPlot - (v / tope) * altoPlot;

  const grilla = marcas.map((m) => `<line x1="${margen.izq}" x2="${margen.izq + anchoPlot}" y1="${py(m)}" y2="${py(m)}" stroke="var(--grafico-grilla)" stroke-width="1"/>
    <text x="${margen.izq - 8}" y="${py(m) + 4}" text-anchor="end" font-size="12" fill="var(--grafico-texto)">${esc(formatoEje(m))}</text>`).join('');
  const etiquetasX = x.map((v) => `<text x="${px(v)}" y="${margen.arr + altoPlot + 20}" text-anchor="middle" font-size="12" fill="var(--grafico-texto)">${esc(formatoX(v))}</text>`).join('');

  const finales = series.map((s) => ({ s, y: py(s.valores[s.valores.length - 1] ?? 0) }));
  const separadas = finales.length < 2 || Math.abs(finales[0].y - finales[1].y) >= 16;
  const trazos = series.map((s) => {
    const puntos = s.valores.map((v, i) => (v == null ? null : `${px(x[i])},${py(v)}`)).filter(Boolean);
    const marcadores = s.valores.map((v, i) => (v == null ? '' : `<circle cx="${px(x[i])}" cy="${py(v)}" r="4" fill="${s.color}" stroke="var(--blanco)" stroke-width="2"/>`)).join('');
    const ultimo = s.valores.length - 1;
    const rotulo = separadas && s.valores[ultimo] != null
      ? `<text x="${px(x[ultimo]) + 10}" y="${py(s.valores[ultimo]) + 4}" font-size="12" fill="var(--tinta-2)">${esc(s.nombre)}</text>` : '';
    return `<polyline points="${puntos.join(' ')}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${marcadores}${rotulo}`;
  }).join('');

  const datos = esc(JSON.stringify({
    x: x.map((v) => px(v)), etiquetas: x.map(formatoX),
    series: series.map((s) => ({ nombre: s.nombre, color: s.color, valores: s.valores.map((v) => (v == null ? '—' : formatoY(v))) })),
  }));
  return `<svg viewBox="0 0 ${ancho} ${alto}" role="group" aria-label="${esc(descripcion)}" data-lineas="${datos}" ${id ? `id="${esc(id)}"` : ''}>
    ${grilla}
    <line x1="${margen.izq}" x2="${margen.izq + anchoPlot}" y1="${margen.arr + altoPlot}" y2="${margen.arr + altoPlot}" stroke="var(--grafico-eje)" stroke-width="1"/>
    ${etiquetasX}
    <line class="cruz" x1="0" x2="0" y1="${margen.arr}" y2="${margen.arr + altoPlot}" stroke="var(--tinta-3)" stroke-width="1" visibility="hidden"/>
    ${trazos}
    <rect class="zona capa-lineas" x="${margen.izq - 10}" y="${margen.arr}" width="${anchoPlot + 20}" height="${altoPlot}" tabindex="0" aria-label="Recorrer los valores con las flechas izquierda y derecha"/>
  </svg>`;
}

// ---- Barra segmentada alta (una totalidad dividida en partes) ----
export function segmentada({ partes, ancho = 560, formato = fmt.entero }) {
  const total = partes.reduce((s, p) => s + p.valor, 0);
  if (!total) return '<p class="muted pequeno">Sin datos para mostrar.</p>';
  const bloques = partes.filter((p) => p.valor > 0).map((p) => {
    const proporcion = p.valor / total;
    const texto = `${fmt.porcentaje(proporcion)}`;
    const cabe = proporcion * ancho >= texto.length * 8 + 18;
    const tt = datosTooltip(p.nombre, [['Cantidad', formato(p.valor)], ['Proporción', fmt.porcentaje(proporcion, 1)]]);
    return `<div class="marca-grafico" style="flex:${proporcion} 1 0;background:${p.color}" tabindex="0" role="img" aria-label="${esc(`${p.nombre}: ${formato(p.valor)} (${fmt.porcentaje(proporcion, 1)})`)}" data-tt="${tt}">${cabe ? esc(texto) : ''}</div>`;
  }).join('');
  return `<div class="segmentada">${bloques}</div>`;
}

export function medidor(proporcion) {
  const p = Math.max(0, Math.min(1, proporcion ?? 0));
  return `<div class="medidor" role="img" aria-label="${esc(fmt.porcentaje(proporcion ?? 0))}"><span style="width:${(p * 100).toFixed(1)}%"></span></div>`;
}

// ---- Interacción: tooltips y cruz de las líneas ----

function pintarTooltip(contenido) {
  const tt = document.getElementById('tooltip');
  if (!tt) return null;
  tt.replaceChildren();
  const titulo = document.createElement('div');
  titulo.className = 'tt-titulo';
  titulo.textContent = contenido.t;
  tt.append(titulo);
  for (const [clave, valor, color] of contenido.f) {
    const fila = document.createElement('div');
    fila.className = 'tt-fila';
    const c = document.createElement('span');
    c.className = 'tt-clave';
    if (color) {
      const i = document.createElement('i');
      i.style.color = color;
      c.append(i);
    }
    c.append(document.createTextNode(clave));
    const v = document.createElement('span');
    v.className = 'tt-valor';
    v.textContent = valor;
    fila.append(v, c);
    tt.append(fila);
  }
  tt.hidden = false;
  return tt;
}

function ubicar(tt, x, y) {
  const r = tt.getBoundingClientRect();
  const izq = Math.min(window.innerWidth - r.width - 8, x + 14);
  const arr = y + r.height + 20 > window.innerHeight ? y - r.height - 14 : y + 16;
  tt.style.left = `${Math.max(8, izq)}px`;
  tt.style.top = `${Math.max(8, arr)}px`;
}

function ocultar() {
  const tt = document.getElementById('tooltip');
  if (tt) tt.hidden = true;
}

export function activarGraficos(raiz) {
  raiz.addEventListener('pointermove', (e) => {
    const zona = e.target.closest?.('[data-tt]');
    if (!zona) return;
    const tt = pintarTooltip(JSON.parse(zona.dataset.tt));
    if (tt) ubicar(tt, e.clientX, e.clientY);
  });
  raiz.addEventListener('pointerout', (e) => {
    if (e.target.closest?.('[data-tt]') || e.target.closest?.('.capa-lineas')) ocultar();
  });
  raiz.addEventListener('focusin', (e) => {
    const zona = e.target.closest?.('[data-tt]');
    if (!zona) return;
    const tt = pintarTooltip(JSON.parse(zona.dataset.tt));
    const r = zona.getBoundingClientRect();
    if (tt) ubicar(tt, r.left + r.width / 2, r.top);
  });
  raiz.addEventListener('focusout', ocultar);

  raiz.querySelectorAll('svg[data-lineas]').forEach((svg) => {
    const datos = JSON.parse(svg.dataset.lineas);
    const cruz = svg.querySelector('.cruz');
    const capa = svg.querySelector('.capa-lineas');
    let indice = datos.x.length - 1;
    const mostrar = (i, cx, cy) => {
      indice = i;
      cruz.setAttribute('x1', datos.x[i]);
      cruz.setAttribute('x2', datos.x[i]);
      cruz.setAttribute('visibility', 'visible');
      const tt = pintarTooltip({ t: datos.etiquetas[i], f: datos.series.map((s) => [s.nombre, s.valores[i], s.color]) });
      if (tt) ubicar(tt, cx, cy);
    };
    const cercano = (clientX) => {
      const r = svg.getBoundingClientRect();
      const escala = svg.viewBox.baseVal.width / r.width;
      const xv = (clientX - r.left) * escala;
      let mejor = 0;
      datos.x.forEach((v, i) => { if (Math.abs(v - xv) < Math.abs(datos.x[mejor] - xv)) mejor = i; });
      return mejor;
    };
    capa.addEventListener('pointermove', (e) => mostrar(cercano(e.clientX), e.clientX, e.clientY));
    capa.addEventListener('pointerleave', () => { cruz.setAttribute('visibility', 'hidden'); ocultar(); });
    capa.addEventListener('focus', () => {
      const r = capa.getBoundingClientRect();
      mostrar(indice, r.right - 40, r.top);
    });
    capa.addEventListener('blur', () => { cruz.setAttribute('visibility', 'hidden'); ocultar(); });
    capa.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const i = Math.max(0, Math.min(datos.x.length - 1, indice + (e.key === 'ArrowRight' ? 1 : -1)));
      const r = svg.getBoundingClientRect();
      const escala = r.width / svg.viewBox.baseVal.width;
      mostrar(i, r.left + datos.x[i] * escala, r.top + 20);
    });
  });
}
