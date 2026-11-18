// Simulación de Power BI: modelo semántico en modo importación, actualización programada
// vía gateway de datos local y las consultas que ejecutan los visuales del tablero.

import { REGIONES, SEGMENTOS, NOMBRE_SERVICIO, normalizarRegion } from './catalogos.js';
import { ultimosMeses, marcaDeTiempo } from './fechas.js';
import { consultaDefinicion, reflejaDeDependencias, fuentesDe, versionFuente, estadoObjeto, transferirFilas } from './dwh.js';

export const DEPENDENCIAS_MODELO = ['consumo_agregado.fn_tablero_gerencial', 'consumo_agregado.cubo_usuarios_region', 'repositorio.metas'];

const redondear2 = (n) => Math.round(n * 100) / 100;

// Tamaño aproximado sin comprimir: filas × columnas × 8 bytes. Power BI (VertiPaq) comprime
// bastante más, pero la proporción entre un modelo de detalle y uno de cubo se mantiene.
export function estimarBytes(filas, columnas) {
  return filas * columnas * 8;
}

export function actualizarModelo(estado, { marca = marcaDeTiempo(estado.reloj), meses = 12 } = {}) {
  const pbi = estado.powerbi;
  if (estado.config.gatewayCaido) {
    const r = {
      marca, estado: 'ERROR', ms: 0, filas: 0,
      mensaje: 'El gateway de datos local no responde: Power BI Service no pudo conectarse con el DWH (on-premises).',
    };
    pbi.historial.unshift(r);
    pbi.historial.length = Math.min(pbi.historial.length, 40);
    pbi.ultimoError = r;
    return r;
  }
  const t0 = performance.now();
  // 1) Consulta de definición contra el DWH: el resultado viaja a la nube a través del gateway.
  const hechos = transferirFilas(consultaDefinicion(estado.dwh.datos['consumo_agregado.cubo_mensual'] ?? [], estado.reloj.fecha, meses));
  // 2) Cubo de usuarios.
  const usuarios = transferirFilas(estado.dwh.datos['consumo_agregado.cubo_usuarios_region'] ?? []);
  // 3) Planilla del repositorio de archivos: entra directo al modelo, sin pasar por el DWH.
  const metas = transferirFilas(estado.repositorio.metas);
  const ms = performance.now() - t0;
  const filas = hechos.length + usuarios.length + metas.length;
  pbi.modelo = {
    hechos, usuarios, metas, meses,
    fechaReferencia: estado.reloj.fecha,
    datosAl: estado.dwh.meta['extraccion.mv_operaciones']?.actualizado ?? null,
  };
  pbi.meta = {
    actualizado: marca, ms, filas,
    bytes: estimarBytes(hechos.length, 6) + estimarBytes(usuarios.length, 4) + estimarBytes(metas.length, 2),
    refleja: reflejaDeDependencias(estado, DEPENDENCIAS_MODELO),
  };
  const r = { marca, estado: 'OK', ms, filas, mensaje: `Modelo actualizado: ${filas} filas importadas.` };
  pbi.historial.unshift(r);
  pbi.historial.length = Math.min(pbi.historial.length, 40);
  pbi.ultimoError = null;
  return r;
}

// Estado del modelo y, si está desactualizado, en qué tramo del flujo quedó retenido el cambio.
export function estadoModelo(estado) {
  const meta = estado.powerbi.meta;
  if (!meta) return { codigo: 'sin_datos' };
  const fuentes = new Set();
  for (const dep of DEPENDENCIAS_MODELO) for (const f of fuentesDe(estado, dep)) fuentes.add(f);
  const pendientes = [...fuentes].filter((f) => (meta.refleja[f] ?? -1) !== versionFuente(estado, f));
  if (!pendientes.length) return { codigo: 'actualizado' };
  const dwhAtrasado = ['consumo_agregado.fn_tablero_gerencial', 'consumo_agregado.cubo_usuarios_region']
    .some((id) => estadoObjeto(estado, id).codigo !== 'actualizado');
  const motivo = pendientes.every((f) => f === 'repositorio.metas')
    ? 'repositorio'
    : dwhAtrasado ? 'dwh' : 'modelo';
  return { codigo: 'desactualizado', fuentes: pendientes, motivo };
}

// ---- Consultas de los visuales ----

export function consultarTablero(modelo, { meses = 12, region = 'todas', segmento = 'todos' } = {}) {
  if (!modelo) return null;
  const listaMeses = ultimosMeses(modelo.fechaReferencia, Math.min(meses, modelo.meses));
  const desde = listaMeses[0];
  const porMes = new Map(listaMeses.map((m) => [m, { mes: m, importe: 0, operaciones: 0 }]));
  const porRegion = new Map();
  const porTipo = new Map();
  let importe = 0;
  let operaciones = 0;
  for (const f of modelo.hechos) {
    if (f.mes < desde) continue;
    if (region !== 'todas' && f.region !== region) continue;
    if (segmento !== 'todos' && f.segmento !== segmento) continue;
    importe += f.importe_total;
    operaciones += f.cantidad;
    const pm = porMes.get(f.mes);
    if (pm) { pm.importe += f.importe_total; pm.operaciones += f.cantidad; }
    const pr = porRegion.get(f.region) ?? { region: f.region, importe: 0, operaciones: 0 };
    pr.importe += f.importe_total; pr.operaciones += f.cantidad;
    porRegion.set(f.region, pr);
    const pt = porTipo.get(f.tipo_servicio) ?? { tipo: f.tipo_servicio, nombre: NOMBRE_SERVICIO[f.tipo_servicio] ?? f.tipo_servicio, importe: 0, operaciones: 0 };
    pt.importe += f.importe_total; pt.operaciones += f.cantidad;
    porTipo.set(f.tipo_servicio, pt);
  }
  const usuarios = modelo.usuarios.filter((u) => (region === 'todas' || u.region === region) && (segmento === 'todos' || u.segmento === segmento));
  const porSegmento = SEGMENTOS.map((s) => ({ segmento: s, usuarios: usuarios.filter((u) => u.segmento === s).reduce((n, u) => n + u.usuarios_vigentes, 0) }));
  const usuariosVigentes = usuarios.reduce((n, u) => n + u.usuarios_vigentes, 0);
  const altas30 = usuarios.reduce((n, u) => n + u.altas_30_dias, 0);

  // La meta es mensual y por región: no se puede repartir por segmento.
  const metaPorRegion = new Map(modelo.metas.map((m) => [m.region, m.meta_mensual]));
  const conMeta = segmento === 'todos';
  const metaMensual = conMeta
    ? modelo.metas.filter((m) => region === 'todas' || m.region === region).reduce((n, m) => n + m.meta_mensual, 0)
    : null;
  const metaPeriodo = conMeta ? metaMensual * listaMeses.length : null;

  const regiones = new Set([...REGIONES.filter((r) => region === 'todas' || r === region), ...porRegion.keys()]);
  const filasRegion = [...regiones].map((r) => {
    const pr = porRegion.get(r) ?? { region: r, importe: 0, operaciones: 0 };
    const meta = conMeta && metaPorRegion.has(r) ? metaPorRegion.get(r) * listaMeses.length : null;
    return { ...pr, importe: redondear2(pr.importe), ticket: pr.operaciones ? pr.importe / pr.operaciones : 0, meta, cumplimiento: meta ? pr.importe / meta : null };
  }).sort((a, b) => b.importe - a.importe);

  return {
    meses: listaMeses,
    kpis: {
      importe: redondear2(importe), operaciones, ticket: operaciones ? importe / operaciones : 0,
      usuariosVigentes, altas30, metaPeriodo, cumplimiento: metaPeriodo ? importe / metaPeriodo : null,
    },
    porMes: [...porMes.values()].map((m) => ({ ...m, importe: redondear2(m.importe), meta: metaMensual })),
    porRegion: filasRegion,
    porTipo: [...porTipo.values()].map((t) => ({ ...t, importe: redondear2(t.importe) })).sort((a, b) => b.importe - a.importe),
    porSegmento,
  };
}

// ---- Tres estrategias para responder la misma pregunta del tablero ----
// "Importe y cantidad de operaciones por mes y región en los últimos 12 meses".

function agrupar(grupos, clave, importe, cantidad) {
  const g = grupos.get(clave);
  if (g) { g.importe += importe; g.cantidad += cantidad; } else grupos.set(clave, { importe, cantidad });
}

// A) Sin DWH: Power BI en DirectQuery contra la base transaccional. Cada visual repite el JOIN,
// las reglas de negocio y la agregación sobre las tablas operativas.
export function consultaSinDWH(produccion, { desde }) {
  const region = new Map();
  for (const u of produccion.usuarios) region.set(u.id_usuario, normalizarRegion(u.region));
  const grupos = new Map();
  for (const o of produccion.operaciones) {
    if (o.estado !== 'confirmada' || !(o.importe > 0) || o.fecha < desde) continue;
    const r = region.get(o.id_usuario);
    if (r === undefined) continue;
    agrupar(grupos, `${o.fecha.slice(0, 8)}01|${r}`, o.importe, 1);
  }
  return grupos;
}

// B) Power BI importa el detalle y agrega en cada interacción.
export function consultaSobreDetalle(detalle, { desde }) {
  const grupos = new Map();
  for (const f of detalle) {
    if (f.mes < desde) continue;
    agrupar(grupos, `${f.mes}|${f.region}`, f.importe, 1);
  }
  return grupos;
}

// C) Solución del paper: el DWH ya agregó; Power BI sólo suma unas pocas filas del cubo.
export function consultaSobreCubo(hechos, { desde }) {
  const grupos = new Map();
  for (const f of hechos) {
    if (f.mes < desde) continue;
    agrupar(grupos, `${f.mes}|${f.region}`, f.importe_total, f.cantidad);
  }
  return grupos;
}

export function mismosResultados(a, b) {
  if (a.size !== b.size) return false;
  for (const [clave, va] of a) {
    const vb = b.get(clave);
    if (!vb || vb.cantidad !== va.cantidad || Math.abs(vb.importe - va.importe) > 0.01) return false;
  }
  return true;
}

export function totalDeGrupos(grupos) {
  let importe = 0;
  let cantidad = 0;
  for (const g of grupos.values()) { importe += g.importe; cantidad += g.cantidad; }
  return { importe: redondear2(importe), cantidad, grupos: grupos.size };
}
