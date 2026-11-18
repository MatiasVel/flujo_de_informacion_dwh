// Utilidades de interfaz: escape de HTML, formato de números, íconos, avisos y diálogos.

export function esc(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---- Formato (es-AR) ----
const nf0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfC = new Intl.NumberFormat('es-AR', { notation: 'compact', maximumFractionDigits: 1 });
const nfP0 = new Intl.NumberFormat('es-AR', { style: 'percent', maximumFractionDigits: 0 });
const nfP1 = new Intl.NumberFormat('es-AR', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const fmt = {
  entero: (n) => (n == null ? '—' : nf0.format(n)),
  decimal: (n) => (n == null ? '—' : nf2.format(n)),
  moneda: (n) => (n == null ? '—' : `$\u00a0${nf0.format(Math.round(n))}`),
  monedaDecimal: (n) => (n == null ? '—' : `$\u00a0${nf2.format(n)}`),
  compacto: (n) => (n == null ? '—' : nfC.format(n)),
  monedaCompacta: (n) => (n == null ? '—' : `$\u00a0${nfC.format(n)}`),
  porcentaje: (p, decimales = 0) => (p == null ? '—' : (decimales ? nfP1 : nfP0).format(p)),
  ms(v) {
    if (v == null || Number.isNaN(v)) return '—';
    if (v < 0.01) return '< 0,01 ms';
    if (v < 10) return `${nf2.format(v)} ms`;
    if (v < 100) return `${nf1.format(v)} ms`;
    if (v < 1000) return `${nf0.format(v)} ms`;
    return `${nf2.format(v / 1000)} s`;
  },
  bytes(b) {
    if (b == null) return '—';
    if (b < 1024) return `${nf0.format(b)} B`;
    if (b < 1048576) return `${nf1.format(b / 1024)} KB`;
    return `${nf1.format(b / 1048576)} MB`;
  },
  veces: (x) => (x == null || !Number.isFinite(x) ? '—' : `${x >= 10 ? nf0.format(x) : nf1.format(x)} veces`),
};

// ---- Íconos (trazo, 24 × 24) ----
const trazo = (contenido) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${contenido}</svg>`;

export const icono = {
  ok: trazo('<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.6 2.5L16 9.5"/>'),
  aviso: trazo('<path d="M12 3.5 2.8 19.5h18.4L12 3.5Z"/><path d="M12 10v4.2"/><path d="M12 17.3h.01"/>'),
  critico: trazo('<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>'),
  info: trazo('<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.8h.01"/>'),
  neutro: trazo('<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>'),
  vivo: trazo('<circle cx="12" cy="12" r="2.5"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/>'),
  reloj: trazo('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  refrescar: trazo('<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/>'),
  play: trazo('<path d="M7 5v14l11-7L7 5Z"/>'),
  editar: trazo('<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>'),
  borrar: trazo('<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>'),
  candado: trazo('<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  descargar: trazo('<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>'),
  subir: trazo('<path d="M12 20V9"/><path d="m7 14 5-5 5 5"/><path d="M5 4h14"/>'),
  cerrar: trazo('<path d="M6 6l12 12M18 6 6 18"/>'),
  menu: trazo('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  copiar: trazo('<rect x="9" y="9" width="11" height="11" rx="1.5"/><path d="M5 15V5h10"/>'),
  base: trazo('<ellipse cx="12" cy="6" rx="7" ry="2.8"/><path d="M5 6v12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6"/><path d="M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8"/>'),
  usuario: trazo('<circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0 1 16 0"/>'),
  medir: trazo('<path d="M4 18a8 8 0 1 1 16 0"/><path d="m12 18 4-6"/>'),
  chevron: trazo('<path d="m6 9 6 6 6-6"/>'),
};

export function asterisco(color = '#3b7cf0') {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g stroke="${color}" stroke-width="3.2" stroke-linecap="round"><line x1="12" y1="3.5" x2="12" y2="20.5"/><line x1="4.6" y1="7.75" x2="19.4" y2="16.25"/><line x1="4.6" y1="16.25" x2="19.4" y2="7.75"/></g></svg>`;
}

// ---- Avisos emergentes ----
export function aviso(texto, tipo = 'info', { duracion = 5200 } = {}) {
  const zona = document.getElementById('avisos');
  if (!zona) return;
  const el = document.createElement('div');
  el.className = `toast ${tipo}`;
  el.setAttribute('role', tipo === 'critico' ? 'alert' : 'status');
  const simbolo = { ok: icono.ok, aviso: icono.aviso, critico: icono.critico, info: icono.info }[tipo] ?? icono.info;
  el.innerHTML = `${simbolo}<p></p><button type="button" aria-label="Cerrar aviso">×</button>`;
  el.querySelector('p').textContent = texto;
  el.querySelector('button').addEventListener('click', () => el.remove());
  zona.append(el);
  while (zona.children.length > 3) zona.firstElementChild.remove();
  if (duracion) setTimeout(() => el.remove(), duracion);
}

// ---- Diálogos ----
// abrirDialogo recibe el HTML del cuerpo y devuelve el elemento <dialog> ya abierto.
export function abrirDialogo({ titulo, cuerpo, pie = '', alCerrar } = {}) {
  const dialogo = document.createElement('dialog');
  dialogo.className = 'dialogo';
  dialogo.setAttribute('aria-labelledby', 'dialogo-titulo');
  dialogo.innerHTML = `
    <div class="dialogo-cabeza">
      <h2 id="dialogo-titulo">${esc(titulo)}</h2>
      <button type="button" class="cerrar" data-cerrar aria-label="Cerrar">${icono.cerrar}</button>
    </div>
    <div class="dialogo-cuerpo">${cuerpo}</div>
    ${pie ? `<div class="dialogo-pie">${pie}</div>` : ''}`;
  document.body.append(dialogo);
  const cerrar = () => dialogo.close();
  dialogo.addEventListener('click', (e) => {
    if (e.target === dialogo || e.target.closest('[data-cerrar]')) cerrar();
  });
  dialogo.addEventListener('close', () => {
    alCerrar?.();
    dialogo.remove();
  });
  dialogo.showModal();
  return dialogo;
}

export function confirmar({ titulo, mensaje, aceptar = 'Confirmar', peligro = false }) {
  return new Promise((resolver) => {
    let resultado = false;
    const d = abrirDialogo({
      titulo,
      cuerpo: `<p>${esc(mensaje)}</p>`,
      pie: `<button type="button" class="boton secundario" data-cerrar>Cancelar</button>
            <button type="button" class="boton ${peligro ? 'peligro' : ''}" data-aceptar>${esc(aceptar)}</button>`,
      alCerrar: () => resolver(resultado),
    });
    d.querySelector('[data-aceptar]').addEventListener('click', () => { resultado = true; d.close(); });
    d.querySelector('[data-aceptar]').focus();
  });
}

export function descargarArchivo(nombre, contenido, tipo = 'text/csv;charset=utf-8') {
  const blob = new Blob([contenido], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    return false;
  }
}

export function movimientoReducido() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

// Lee los campos de un formulario como objeto plano.
export function datosDeFormulario(form) {
  return Object.fromEntries(new FormData(form).entries());
}

// Marca los campos con error según las claves de ErrorValidacion.campos.
export function mostrarErrores(form, campos = {}) {
  form.querySelectorAll('[aria-invalid="true"]').forEach((el) => el.removeAttribute('aria-invalid'));
  form.querySelectorAll('.error-campo').forEach((el) => el.remove());
  for (const [nombre, mensaje] of Object.entries(campos)) {
    const input = form.elements[nombre];
    if (!input) continue;
    input.setAttribute('aria-invalid', 'true');
    const p = document.createElement('p');
    p.className = 'error-campo';
    p.id = `error-${form.id || 'f'}-${nombre}`;
    p.textContent = mensaje;
    input.setAttribute('aria-describedby', p.id);
    input.closest('.campo')?.append(p);
  }
  const primero = form.querySelector('[aria-invalid="true"]');
  primero?.focus();
}
