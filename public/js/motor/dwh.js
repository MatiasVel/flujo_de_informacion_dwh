// Motor del Data Warehouse simulado.
// Reproduce la arquitectura del paper: tablas foráneas y vistas materializadas en la capa de
// extracción, cálculos intermedios, cubos y detalle en las capas de consumo, un proceso diario
// que respeta el orden de dependencias y un registro de ejecución.

import { NOMBRE_SERVICIO, normalizarRegion, normalizarSegmento, normalizarEstadoUsuario } from './catalogos.js';
import { diasEntre, inicioDeMes, sumarMeses, marcaDeTiempo } from './fechas.js';
import { SQL_OBJETOS } from './sql.js';
import { definicionDeCubo } from './cubos.js';

export class ErrorDWH extends Error {
  constructor(mensaje, origen = 'dwh') {
    super(mensaje);
    this.name = 'ErrorDWH';
    this.origen = origen;
  }
}

export const CAPAS = [
  {
    id: 'extraccion', nombre: 'Extracción', interna: true, uso: 'No se consume.',
    contenido: 'Copia local de los datos de origen: tablas foráneas y sus vistas materializadas.',
  },
  {
    id: 'calculo', nombre: 'Cálculo', interna: true, uso: 'No se consume.',
    contenido: 'Tablas intermedias con los cálculos necesarios para formar los cubos.',
  },
  {
    id: 'consumo_agregado', nombre: 'Consumo agregado', interna: false, uso: 'Excel o Power BI.',
    contenido: 'Datos agrupados (cubos), con menos filas que el detalle.',
  },
  {
    id: 'consumo_detalle', nombre: 'Consumo de detalle', interna: false, uso: 'Power BI.',
    contenido: 'Datos en detalle, de alto volumen.',
  },
];

export const FUENTES = {
  'produccion.usuarios': { nombre: 'usuarios', lugar: 'Servidor de producción', tabla: 'usuarios' },
  'produccion.operaciones': { nombre: 'operaciones', lugar: 'Servidor de producción', tabla: 'operaciones' },
  'repositorio.metas': { nombre: 'metas_mensuales.xlsx', lugar: 'Repositorio de archivos' },
};

export const TIPOS = {
  tabla_foranea: { nombre: 'Tabla foránea', almacena: false },
  vista_materializada: { nombre: 'Vista materializada', almacena: true },
  cubo: { nombre: 'Cubo (vista materializada)', almacena: true },
  detalle: { nombre: 'Detalle (vista materializada)', almacena: true },
  consulta_definicion: { nombre: 'Consulta de definición (función)', almacena: false },
};

// ---- Transformaciones puras (se reutilizan en las mediciones de rendimiento) ----

// Transferencia entre servidores: cada fila que viaja del origen al DWH (por el foreign data
// wrapper) o del DWH a Power BI (por el gateway) se serializa y se vuelve a leer, como viajaría
// por la red. Así la medición refleja que traer más filas cuesta más, algo que una copia en
// memoria no mostraría.
export function transferirFilas(filas) {
  return JSON.parse(JSON.stringify(filas));
}

export function fechaMaxima(filas) {
  let max = null;
  for (const f of filas) if (max === null || f.fecha > max) max = f.fecha;
  return max;
}

const redondear2 = (n) => Math.round(n * 100) / 100;

// Carga incremental por fecha: sólo se leen del origen las filas con fecha >= marca de agua.
// Las filas viejas no se vuelven a leer: es más rápido, pero una corrección retroactiva se pierde.
export function extraccionIncremental(copiaAnterior, origen, marcaAgua) {
  const leidas = origen.filter((o) => o.fecha >= marcaAgua); // en PostgreSQL este filtro se resuelve en el origen
  const posiciones = new Map();
  for (let i = 0; i < copiaAnterior.length; i++) {
    if (copiaAnterior[i].fecha >= marcaAgua) posiciones.set(copiaAnterior[i].id_operacion, i);
  }
  const recibidas = transferirFilas(leidas); // sólo viajan por la red las filas nuevas
  const filas = copiaAnterior.slice();
  let insertadas = 0;
  let actualizadas = 0;
  for (const o of recibidas) {
    const i = posiciones.get(o.id_operacion);
    if (i === undefined) {
      filas.push(o);
      insertadas++;
    } else {
      filas[i] = o;
      actualizadas++;
    }
  }
  return {
    filas,
    marcaAgua: fechaMaxima(filas),
    detalle: { modo: 'incremental', marcaAguaAnterior: marcaAgua, leidas: leidas.length, insertadas, actualizadas, escritas: insertadas + actualizadas },
  };
}

export function depurarOperaciones(mvOperaciones, mvUsuarios) {
  const usuarios = new Map();
  let usuariosCorregidos = 0;
  for (const u of mvUsuarios) {
    const region = normalizarRegion(u.region);
    const segmento = normalizarSegmento(u.segmento);
    if (region !== u.region || segmento !== u.segmento) usuariosCorregidos++;
    usuarios.set(u.id_usuario, { region, segmento });
  }
  const filas = [];
  let anuladas = 0;
  let sinImporte = 0;
  let sinUsuario = 0;
  for (const o of mvOperaciones) {
    if (o.estado !== 'confirmada') { anuladas++; continue; }
    if (!(o.importe > 0)) { sinImporte++; continue; }
    const u = usuarios.get(o.id_usuario);
    if (!u) { sinUsuario++; continue; }
    filas.push({
      id_operacion: o.id_operacion,
      id_usuario: o.id_usuario,
      fecha: o.fecha,
      mes: o.fecha.slice(0, 8) + '01',
      region: u.region,
      segmento: u.segmento,
      tipo_servicio: o.tipo_servicio,
      importe: o.importe,
    });
  }
  return {
    filas,
    detalle: {
      entrada: mvOperaciones.length, salida: filas.length, descartadas_anuladas: anuladas,
      descartadas_importe: sinImporte, descartadas_sin_usuario: sinUsuario, usuarios_corregidos: usuariosCorregidos,
    },
  };
}

export function usuariosVigentes(mvUsuarios, fechaReferencia) {
  const filas = [];
  let bajas = 0;
  let corregidos = 0;
  for (const u of mvUsuarios) {
    if (normalizarEstadoUsuario(u.estado) !== 'activo') { bajas++; continue; }
    const region = normalizarRegion(u.region);
    const segmento = normalizarSegmento(u.segmento);
    if (region !== u.region || segmento !== u.segmento) corregidos++;
    filas.push({
      id_usuario: u.id_usuario, region, segmento, fecha_alta: u.fecha_alta,
      antiguedad_dias: Math.max(0, diasEntre(u.fecha_alta, fechaReferencia)),
    });
  }
  return { filas, detalle: { entrada: mvUsuarios.length, salida: filas.length, descartados_baja: bajas, valores_corregidos: corregidos } };
}

export function cuboMensual(depuradas) {
  const grupos = new Map();
  for (const f of depuradas) {
    const clave = `${f.mes}|${f.region}|${f.segmento}|${f.tipo_servicio}`;
    let g = grupos.get(clave);
    if (!g) {
      g = { mes: f.mes, region: f.region, segmento: f.segmento, tipo_servicio: f.tipo_servicio, cantidad: 0, importe_total: 0 };
      grupos.set(clave, g);
    }
    g.cantidad++;
    g.importe_total += f.importe;
  }
  const filas = [...grupos.values()];
  for (const g of filas) g.importe_total = redondear2(g.importe_total);
  filas.sort((a, b) => (a.mes < b.mes ? -1 : a.mes > b.mes ? 1 : `${a.region}${a.segmento}${a.tipo_servicio}`.localeCompare(`${b.region}${b.segmento}${b.tipo_servicio}`)));
  return {
    filas,
    detalle: { entrada: depuradas.length, salida: filas.length, reduccion: depuradas.length ? 1 - filas.length / depuradas.length : 0 },
  };
}

export function cuboUsuarios(vigentes) {
  const grupos = new Map();
  for (const u of vigentes) {
    const clave = `${u.region}|${u.segmento}`;
    let g = grupos.get(clave);
    if (!g) {
      g = { region: u.region, segmento: u.segmento, usuarios_vigentes: 0, altas_30_dias: 0 };
      grupos.set(clave, g);
    }
    g.usuarios_vigentes++;
    if (u.antiguedad_dias <= 30) g.altas_30_dias++;
  }
  const filas = [...grupos.values()].sort((a, b) => `${a.region}${a.segmento}`.localeCompare(`${b.region}${b.segmento}`));
  return { filas, detalle: { entrada: vigentes.length, salida: filas.length } };
}

export function armarDetalle(depuradas) {
  const filas = new Array(depuradas.length);
  for (let i = 0; i < depuradas.length; i++) {
    const d = depuradas[i];
    filas[i] = {
      id_operacion: d.id_operacion, fecha: d.fecha, mes: d.mes, id_usuario: d.id_usuario, region: d.region,
      segmento: d.segmento, tipo_servicio: d.tipo_servicio, nombre_servicio: NOMBRE_SERVICIO[d.tipo_servicio] ?? d.tipo_servicio,
      importe: d.importe,
    };
  }
  return { filas, detalle: { entrada: depuradas.length, salida: filas.length } };
}

// Consulta de definición: últimos N meses del cubo mensual.
export function consultaDefinicion(cubo, fechaReferencia, meses = 12) {
  const desde = sumarMeses(inicioDeMes(fechaReferencia), -(meses - 1));
  return cubo.filter((f) => f.mes >= desde);
}

// ---- Catálogo de objetos ----

const OBJETOS_BASE = [
  {
    id: 'extraccion.ft_usuarios', capa: 'extraccion', tipo: 'tabla_foranea', nombre: 'ft_usuarios', fuente: 'usuarios',
    descripcion: 'Apunta a la tabla usuarios del servidor de producción. No guarda datos: cada consulta viaja al origen.',
    deps: ['produccion.usuarios'],
  },
  {
    id: 'extraccion.ft_operaciones', capa: 'extraccion', tipo: 'tabla_foranea', nombre: 'ft_operaciones', fuente: 'operaciones',
    descripcion: 'Apunta a la tabla operaciones del servidor de producción. No guarda datos.',
    deps: ['produccion.operaciones'],
  },
  {
    id: 'extraccion.mv_usuarios', capa: 'extraccion', tipo: 'vista_materializada', nombre: 'mv_usuarios',
    descripcion: 'Copia local completa de ft_usuarios. El origen se consulta una vez y la copia se reutiliza todo el día.',
    deps: ['extraccion.ft_usuarios'],
    calcular(ctx) {
      const filas = transferirFilas(ctx.leerOrigen('usuarios'));
      return { filas, detalle: { modo: 'completa', leidas: filas.length, escritas: filas.length } };
    },
  },
  {
    id: 'extraccion.mv_operaciones', capa: 'extraccion', tipo: 'vista_materializada', nombre: 'mv_operaciones',
    descripcion: 'Copia local de ft_operaciones. Por defecto se recalcula completa; en modo incremental sólo lee desde la marca de agua.',
    deps: ['extraccion.ft_operaciones'],
    calcular(ctx) {
      const origen = ctx.leerOrigen('operaciones');
      const previo = ctx.meta('extraccion.mv_operaciones');
      const anterior = ctx.datos('extraccion.mv_operaciones');
      if (ctx.modoExtraccion === 'incremental' && previo?.marcaAgua && anterior.length) {
        return extraccionIncremental(anterior, origen, previo.marcaAgua);
      }
      const filas = transferirFilas(origen);
      return { filas, marcaAgua: fechaMaxima(filas), detalle: { modo: 'completa', leidas: filas.length, escritas: filas.length } };
    },
  },
  {
    id: 'calculo.usuarios_vigentes', capa: 'calculo', tipo: 'vista_materializada', nombre: 'usuarios_vigentes',
    descripcion: 'Usuarios activos con región y segmento depurados (por ejemplo, " norte" pasa a "Norte").',
    deps: ['extraccion.mv_usuarios'],
    calcular: (ctx) => usuariosVigentes(ctx.datos('extraccion.mv_usuarios'), ctx.fechaReferencia),
  },
  {
    id: 'calculo.operaciones_depuradas', capa: 'calculo', tipo: 'vista_materializada', nombre: 'operaciones_depuradas',
    descripcion: 'Cruza operaciones con usuarios, descarta anuladas, importes inválidos y operaciones sin usuario, y normaliza atributos.',
    deps: ['extraccion.mv_operaciones', 'extraccion.mv_usuarios'],
    calcular: (ctx) => depurarOperaciones(ctx.datos('extraccion.mv_operaciones'), ctx.datos('extraccion.mv_usuarios')),
  },
  {
    id: 'consumo_agregado.cubo_mensual', capa: 'consumo_agregado', tipo: 'cubo', nombre: 'cubo_mensual',
    descripcion: 'Cubo con granularidad mes × región × segmento × tipo de servicio: cantidad e importe pre-calculados.',
    deps: ['calculo.operaciones_depuradas'],
    calcular: (ctx) => cuboMensual(ctx.datos('calculo.operaciones_depuradas')),
  },
  {
    id: 'consumo_agregado.cubo_usuarios_region', capa: 'consumo_agregado', tipo: 'cubo', nombre: 'cubo_usuarios_region',
    descripcion: 'Usuarios vigentes y altas de los últimos 30 días, por región y segmento.',
    deps: ['calculo.usuarios_vigentes'],
    calcular: (ctx) => cuboUsuarios(ctx.datos('calculo.usuarios_vigentes')),
  },
  {
    id: 'consumo_agregado.fn_tablero_gerencial', capa: 'consumo_agregado', tipo: 'consulta_definicion', nombre: 'fn_tablero_gerencial(12)',
    descripcion: 'Consulta de definición: entrega al tablero gerencial exactamente los últimos 12 meses del cubo mensual. No almacena datos.',
    deps: ['consumo_agregado.cubo_mensual'],
  },
  {
    id: 'consumo_detalle.operaciones_detalle', capa: 'consumo_detalle', tipo: 'detalle', nombre: 'operaciones_detalle',
    descripcion: 'Una fila por operación válida, con atributos descriptivos, para análisis finos en Power BI.',
    deps: ['calculo.operaciones_depuradas'],
    calcular: (ctx) => armarDetalle(ctx.datos('calculo.operaciones_depuradas')),
  },
];

for (const o of OBJETOS_BASE) o.sql = SQL_OBJETOS[o.id] ?? '';

// Las definiciones de los cubos del laboratorio se reconstruyen sólo cuando cambia su especificación.
let cacheCatalogo = { clave: null, defs: OBJETOS_BASE };

export function obtenerDefiniciones(estado) {
  const specs = estado.dwh.cubosUsuario ?? [];
  const clave = JSON.stringify(specs);
  if (clave !== cacheCatalogo.clave) {
    cacheCatalogo = { clave, defs: [...OBJETOS_BASE, ...specs.map(definicionDeCubo)] };
  }
  return cacheCatalogo.defs;
}

export function definicion(estado, id) {
  return obtenerDefiniciones(estado).find((d) => d.id === id) ?? null;
}

export function esFuente(id) {
  return Object.prototype.hasOwnProperty.call(FUENTES, id);
}

export function almacena(def) {
  return Boolean(def && TIPOS[def.tipo]?.almacena);
}

export function nombresOcupados(estado) {
  return obtenerDefiniciones(estado).filter((d) => d.capa === 'consumo_agregado').map((d) => d.nombre);
}

// ---- Acceso al origen ----

export function registrarConsultaOrigen(estado, cantidad = 1) {
  const c = estado.produccion.consultasAnaliticas;
  c.total += cantidad;
  c.porDia[estado.reloj.fecha] = (c.porDia[estado.reloj.fecha] ?? 0) + cantidad;
  const dias = Object.keys(c.porDia).sort();
  while (dias.length > 31) delete c.porDia[dias.shift()];
}

export function leerOrigen(estado, tabla, { contar = true } = {}) {
  if (estado.config.fallaOrigen) {
    throw new ErrorDWH('no se pudo conectar con el servidor remoto "srv_produccion": la conexión fue rechazada', 'origen');
  }
  if (contar) registrarConsultaOrigen(estado);
  return estado.produccion[tabla];
}

function crearContexto(estado) {
  return {
    datos: (id) => estado.dwh.datos[id] ?? [],
    meta: (id) => estado.dwh.meta[id] ?? null,
    leerOrigen: (tabla) => leerOrigen(estado, tabla),
    fechaReferencia: estado.reloj.fecha,
    modoExtraccion: estado.config.modoExtraccion,
  };
}

// ---- Versiones y estado de actualización ----
// Cada fuente tiene un número de versión que sube con cada cambio. Cada objeto recuerda qué
// versión de cada fuente "refleja". Si la fuente cambió después, el objeto está desactualizado.

export function versionFuente(estado, fuente) {
  if (fuente === 'repositorio.metas') return estado.repositorio.version;
  return estado.produccion.versiones[FUENTES[fuente].tabla];
}

function combinar(a, b) {
  const r = { ...a };
  for (const [k, v] of Object.entries(b)) r[k] = k in r ? Math.min(r[k], v) : v;
  return r;
}

export function fuentesDe(estado, id, memo = new Map()) {
  if (memo.has(id)) return memo.get(id);
  let resultado;
  if (esFuente(id)) {
    resultado = new Set([id]);
  } else {
    const def = definicion(estado, id);
    resultado = new Set();
    for (const dep of def?.deps ?? []) for (const f of fuentesDe(estado, dep, memo)) resultado.add(f);
  }
  memo.set(id, resultado);
  return resultado;
}

// Qué versión de cada fuente reflejaría un objeto construido ahora a partir de sus dependencias.
export function reflejaDeDependencias(estado, deps) {
  let r = {};
  for (const dep of deps) {
    if (esFuente(dep)) {
      r = combinar(r, { [dep]: versionFuente(estado, dep) });
      continue;
    }
    const def = definicion(estado, dep);
    if (!def) continue;
    if (!almacena(def)) {
      r = combinar(r, reflejaDeDependencias(estado, def.deps)); // tablas foráneas y funciones leen en vivo
      continue;
    }
    const meta = estado.dwh.meta[dep];
    const propio = meta?.refleja ?? {};
    const faltantes = {};
    for (const f of fuentesDe(estado, dep)) if (!(f in propio)) faltantes[f] = -1;
    r = combinar(r, combinar(propio, faltantes));
  }
  return r;
}

function comparar(estado, refleja, fuentes) {
  const pendientes = [];
  for (const f of fuentes) if ((refleja[f] ?? -1) !== versionFuente(estado, f)) pendientes.push(f);
  return pendientes;
}

export function estadoObjeto(estado, id) {
  const def = definicion(estado, id);
  if (!def) return { codigo: 'sin_datos' };
  if (def.tipo === 'tabla_foranea') return { codigo: 'vivo' };
  const fuentes = fuentesDe(estado, id);
  if (def.tipo === 'consulta_definicion') {
    const pendientes = comparar(estado, reflejaDeDependencias(estado, def.deps), fuentes);
    return pendientes.length ? { codigo: 'desactualizado', fuentes: pendientes, bloqueantes: def.deps } : { codigo: 'actualizado' };
  }
  const meta = estado.dwh.meta[id];
  if (!meta || !meta.actualizado) return meta?.estado === 'error' ? { codigo: 'error', mensaje: meta.error } : { codigo: 'sin_datos' };
  if (meta.estado === 'error') return { codigo: 'error', mensaje: meta.error };
  const pendientes = comparar(estado, meta.refleja, fuentes);
  if (!pendientes.length) return { codigo: 'actualizado' };
  const bloqueantes = def.deps.filter((d) => {
    const dd = definicion(estado, d);
    return almacena(dd) && estadoObjeto(estado, d).codigo !== 'actualizado';
  });
  return { codigo: 'desactualizado', fuentes: pendientes, bloqueantes };
}

export function dependientesDe(estado, id) {
  return obtenerDefiniciones(estado).filter((d) => d.deps.includes(id)).map((d) => d.id);
}

// Orden de actualización: recorrido en profundidad de las dependencias (orden topológico).
export function ordenDeActualizacion(estado) {
  const defs = obtenerDefiniciones(estado);
  const porId = new Map(defs.map((d) => [d.id, d]));
  const visitados = new Set();
  const orden = [];
  const visitar = (d) => {
    if (visitados.has(d.id)) return;
    visitados.add(d.id);
    for (const dep of d.deps) if (porId.has(dep)) visitar(porId.get(dep));
    if (almacena(d)) orden.push(d.id);
  };
  defs.forEach(visitar);
  return orden;
}

// ---- Actualización de objetos ----

export function refrescarObjeto(estado, id, { marca = marcaDeTiempo(estado.reloj) } = {}) {
  const def = definicion(estado, id);
  if (!almacena(def)) throw new ErrorDWH(`${id} no almacena datos, por eso no se actualiza.`);
  const previo = estado.dwh.meta[id];
  const t0 = performance.now();
  try {
    const r = def.calcular(crearContexto(estado));
    const ms = performance.now() - t0;
    estado.dwh.datos[id] = r.filas;
    estado.dwh.meta[id] = {
      actualizado: marca, ms, filas: r.filas.length, refleja: reflejaDeDependencias(estado, def.deps),
      estado: 'ok', error: null, detalle: r.detalle ?? null, marcaAgua: r.marcaAgua ?? null,
      actualizaciones: (previo?.actualizaciones ?? 0) + 1,
    };
    return { ok: true, ms, filas: r.filas.length, detalle: r.detalle ?? null };
  } catch (e) {
    const ms = performance.now() - t0;
    estado.dwh.meta[id] = {
      ...(previo ?? { actualizado: null, filas: 0, refleja: {}, ms: 0, detalle: null, marcaAgua: null, actualizaciones: 0 }),
      estado: 'error', error: e.message, ultimoIntento: marca,
    };
    return { ok: false, ms, error: e.message };
  }
}

// Actualiza primero las dependencias desactualizadas y después el objeto pedido.
export function refrescarConDependencias(estado, id, opciones = {}) {
  const necesarios = new Set();
  const marcar = (objId) => {
    const def = definicion(estado, objId);
    if (!def) return;
    for (const dep of def.deps) marcar(dep);
    if (almacena(def) && (objId === id || estadoObjeto(estado, objId).codigo !== 'actualizado')) necesarios.add(objId);
  };
  marcar(id);
  const resultados = [];
  for (const objId of ordenDeActualizacion(estado)) {
    if (!necesarios.has(objId)) continue;
    const r = refrescarObjeto(estado, objId, opciones);
    resultados.push({ id: objId, ...r });
    if (!r.ok) break;
  }
  return resultados;
}

export function resumirDetalle(detalle) {
  if (!detalle) return '';
  if (detalle.modo === 'incremental') {
    return `Incremental desde ${detalle.marcaAguaAnterior}: ${detalle.leidas} filas leídas del origen, ${detalle.insertadas} insertadas, ${detalle.actualizadas} actualizadas.`;
  }
  if (detalle.modo === 'completa') return `Copia completa: ${detalle.leidas} filas leídas del origen.`;
  if ('descartadas_anuladas' in detalle) {
    return `${detalle.salida} filas válidas. Descartadas: ${detalle.descartadas_anuladas} anuladas, ${detalle.descartadas_importe} con importe inválido, ${detalle.descartadas_sin_usuario} sin usuario. Usuarios con valores corregidos: ${detalle.usuarios_corregidos}.`;
  }
  if ('descartados_baja' in detalle) {
    return `${detalle.salida} vigentes, ${detalle.descartados_baja} dados de baja, ${detalle.valores_corregidos} con valores corregidos.`;
  }
  if ('reduccion' in detalle) return `${detalle.entrada} filas agrupadas en ${detalle.salida}.`;
  if ('entrada' in detalle) return `${detalle.entrada} filas de entrada, ${detalle.salida} de salida.`;
  return '';
}

// ---- Control de calidad: conciliación entre el origen y la copia local ----

export function resumenOperaciones(filas) {
  let n = 0;
  let importe = 0;
  let control = 0;
  for (const f of filas) {
    n++;
    if (f.estado === 'confirmada') importe += f.importe;
    control += f._v ?? 0;
  }
  return { filas: n, importe: redondear2(importe), control };
}

export function conciliar(estado) {
  const t0 = performance.now();
  if (estado.config.fallaOrigen) {
    return { estado: 'OMITIDO', ms: 0, mensaje: 'No se pudo consultar el origen para conciliar.', diferencias: null };
  }
  const origen = resumenOperaciones(leerOrigen(estado, 'operaciones'));
  const copia = resumenOperaciones(estado.dwh.datos['extraccion.mv_operaciones'] ?? []);
  const ms = performance.now() - t0;
  const diferencias = {
    filas: origen.filas - copia.filas,
    importe: redondear2(origen.importe - copia.importe),
    control: origen.control !== copia.control,
  };
  const hay = diferencias.filas !== 0 || diferencias.importe !== 0 || diferencias.control;
  return {
    estado: hay ? 'ADVERTENCIA' : 'OK',
    ms,
    origen,
    copia,
    diferencias,
    mensaje: hay
      ? `El origen y la copia no coinciden: ${diferencias.filas} filas y ${diferencias.importe} de importe confirmado de diferencia${diferencias.control ? '; además hay filas modificadas que la copia no tomó' : ''}.`
      : `Origen y copia coinciden: ${origen.filas} filas e importe confirmado ${origen.importe}.`,
  };
}

// ---- Proceso diario ----

export function ejecutarProcesoDiario(estado, { tipo = 'programada', marca = marcaDeTiempo(estado.reloj) } = {}) {
  const dwh = estado.dwh;
  const id = ++dwh.secEjecucion;
  const fallidos = new Set();
  const pasos = [];
  const t0 = performance.now();
  for (const objId of ordenDeActualizacion(estado)) {
    const def = definicion(estado, objId);
    const paso = pasos.length + 1;
    const accion = 'REFRESH MATERIALIZED VIEW';
    const depsFallidas = def.deps.filter((d) => fallidos.has(d));
    if (depsFallidas.length) {
      fallidos.add(objId);
      pasos.push({ id_ejecucion: id, paso, objeto: objId, accion, inicio: marca, ms: 0, filas: null, estado: 'OMITIDO', detalle: `Depende de ${depsFallidas.join(', ')}, que no se actualizó.` });
      continue;
    }
    const r = refrescarObjeto(estado, objId, { marca });
    if (r.ok) {
      pasos.push({ id_ejecucion: id, paso, objeto: objId, accion, inicio: marca, ms: r.ms, filas: r.filas, estado: 'OK', detalle: resumirDetalle(r.detalle) });
    } else {
      fallidos.add(objId);
      pasos.push({ id_ejecucion: id, paso, objeto: objId, accion, inicio: marca, ms: r.ms, filas: null, estado: 'ERROR', detalle: r.error });
    }
  }
  const c = conciliar(estado);
  pasos.push({ id_ejecucion: id, paso: pasos.length + 1, objeto: 'control.conciliacion', accion: 'CONTROL DE CALIDAD', inicio: marca, ms: c.ms, filas: null, estado: c.estado, detalle: c.mensaje });

  const cuenta = (e) => pasos.filter((p) => p.estado === e).length;
  const resumen = {
    id, tipo, inicio: marca, ms: performance.now() - t0, modo: estado.config.modoExtraccion,
    ok: cuenta('OK'), errores: cuenta('ERROR'), omitidos: cuenta('OMITIDO'), advertencias: cuenta('ADVERTENCIA'),
  };
  resumen.estado = resumen.errores ? 'ERROR' : resumen.advertencias ? 'ADVERTENCIA' : 'OK';

  dwh.ejecuciones.unshift(resumen);
  dwh.ejecuciones.length = Math.min(dwh.ejecuciones.length, 60);
  dwh.registro.unshift(...pasos.slice().reverse());
  dwh.registro.length = Math.min(dwh.registro.length, 800);
  const texto = resumen.estado === 'OK'
    ? `Proceso #${id} finalizado sin errores: ${resumen.ok} pasos correctos.`
    : resumen.estado === 'ADVERTENCIA'
      ? `Proceso #${id} finalizado con advertencias: revisá el control de calidad.`
      : `Proceso #${id} con errores: ${resumen.errores} con error y ${resumen.omitidos} omitidos. Los tableros mostrarán datos anteriores.`;
  dwh.notificaciones.unshift({ marca, ejecucion: id, estado: resumen.estado, texto });
  dwh.notificaciones.length = Math.min(dwh.notificaciones.length, 40);
  return { resumen, pasos };
}

// ---- Vista previa de un objeto ----

const COLUMNAS_INTERNAS = new Set(['_v', '_t']);

export function columnasDe(filas) {
  return filas.length ? Object.keys(filas[0]).filter((c) => !COLUMNAS_INTERNAS.has(c)) : [];
}

export function vistaPrevia(estado, id, limite = 8) {
  const def = definicion(estado, id);
  if (!def) return { filas: [], columnas: [], total: 0 };
  if (def.tipo === 'tabla_foranea') {
    const filas = leerOrigen(estado, def.fuente); // cada lectura de una tabla foránea consulta al origen
    return { filas: filas.slice(0, limite), columnas: columnasDe(filas), total: filas.length, consultoOrigen: true };
  }
  if (def.tipo === 'consulta_definicion') {
    const filas = consultaDefinicion(estado.dwh.datos['consumo_agregado.cubo_mensual'] ?? [], estado.reloj.fecha, 12);
    return { filas: filas.slice(0, limite), columnas: columnasDe(filas), total: filas.length };
  }
  const filas = estado.dwh.datos[id] ?? [];
  return { filas: filas.slice(0, limite), columnas: columnasDe(filas), total: filas.length };
}

// ---- Diferencias entre producción y la copia de extracción (lo que todavía no llegó al DWH) ----

function diferenciasTabla(produccion, copia, clave) {
  const mapa = new Map();
  for (const f of copia) mapa.set(f[clave], f);
  let nuevos = 0;
  let modificados = 0;
  for (const f of produccion) {
    const c = mapa.get(f[clave]);
    if (!c) nuevos++;
    else {
      if (c._v !== f._v) modificados++;
      mapa.delete(f[clave]);
    }
  }
  return { nuevos, modificados, eliminados: mapa.size, total: nuevos + modificados + mapa.size };
}

export function diferenciasPendientes(estado) {
  return {
    usuarios: diferenciasTabla(estado.produccion.usuarios, estado.dwh.datos['extraccion.mv_usuarios'] ?? [], 'id_usuario'),
    operaciones: diferenciasTabla(estado.produccion.operaciones, estado.dwh.datos['extraccion.mv_operaciones'] ?? [], 'id_operacion'),
  };
}
