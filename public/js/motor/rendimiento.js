// Mediciones de rendimiento. El paper señala como limitación que no tiene mediciones
// cuantitativas y propone medir como trabajo futuro: este módulo mide en el navegador.
//
// Método: cada medición se repite varias veces y se informa la mediana (menos sensible a
// interrupciones del sistema que el promedio) y el percentil 95. Si una operación dura
// menos que la resolución del reloj, se ejecuta en lotes y se divide por la cantidad.

import { generarVolumen } from './generador.js';
import { sumarDias, ultimosMeses } from './fechas.js';
import { TIPOS_SERVICIO } from './catalogos.js';
import {
  transferirFilas, depurarOperaciones, cuboMensual, armarDetalle, extraccionIncremental, fechaMaxima,
  resumenOperaciones,
} from './dwh.js';
import {
  consultaSinDWH, consultaSobreDetalle, consultaSobreCubo, mismosResultados, totalDeGrupos, estimarBytes,
} from './powerbi.js';

const pausa = () => new Promise((resolver) => setTimeout(resolver, 0));

export function resumir(muestras) {
  const orden = [...muestras].sort((a, b) => a - b);
  const percentil = (p) => orden[Math.min(orden.length - 1, Math.ceil(p * orden.length) - 1)];
  const suma = orden.reduce((s, v) => s + v, 0);
  return {
    n: orden.length,
    mediana: orden.length % 2 ? orden[(orden.length - 1) / 2] : (orden[orden.length / 2 - 1] + orden[orden.length / 2]) / 2,
    p95: percentil(0.95),
    min: orden[0],
    max: orden[orden.length - 1],
    promedio: suma / orden.length,
  };
}

function calibrarLote(fn, loteMinMs) {
  let lote = 1;
  for (;;) {
    const t0 = performance.now();
    for (let i = 0; i < lote; i++) fn();
    const dt = performance.now() - t0;
    if (dt >= loteMinMs || lote >= 4096) return lote;
    lote *= 2;
  }
}

export function medirSincrono(fn, { repeticiones = 10, calentamiento = 2, loteMinMs = 3 } = {}) {
  for (let i = 0; i < calentamiento; i++) fn();
  const lote = calibrarLote(fn, loteMinMs);
  const muestras = [];
  for (let r = 0; r < repeticiones; r++) {
    const t0 = performance.now();
    for (let i = 0; i < lote; i++) fn();
    muestras.push((performance.now() - t0) / lote);
  }
  return { ...resumir(muestras), lote };
}

// Igual que medirSincrono, pero cede el control entre repeticiones para que la página no se congele.
export async function medir(fn, { repeticiones = 10, calentamiento = 2, loteMinMs = 3 } = {}) {
  for (let i = 0; i < calentamiento; i++) fn();
  await pausa();
  const lote = calibrarLote(fn, loteMinMs);
  const muestras = [];
  for (let r = 0; r < repeticiones; r++) {
    const t0 = performance.now();
    for (let i = 0; i < lote; i++) fn();
    muestras.push((performance.now() - t0) / lote);
    await pausa();
  }
  return { ...resumir(muestras), lote };
}

// ---- 1) ¿Dónde conviene procesar? Tres estrategias sobre los datos actuales ----

export async function compararEstrategias(estado, { repeticiones = 12, alProgresar } = {}) {
  const desde = ultimosMeses(estado.reloj.fecha, 12)[0];
  const detalle = estado.dwh.datos['consumo_detalle.operaciones_detalle'] ?? [];
  const cubo = estado.dwh.datos['consumo_agregado.cubo_mensual'] ?? [];
  const hechos = cubo.filter((f) => f.mes >= desde);
  const prod = estado.produccion;

  const estrategias = [
    {
      id: 'sin_dwh', nombre: 'Sin DWH: consulta directa a producción', corto: 'Sin DWH',
      descripcion: 'Power BI en DirectQuery contra la base transaccional: cada visual repite el JOIN, las reglas y la agregación.',
      procesa: 'Servidor de producción, en cada interacción',
      fn: () => consultaSinDWH(prod, { desde }),
      filasLeidas: prod.usuarios.length + prod.operaciones.length,
      filasModelo: 0, bytesModelo: 0, consultasProduccion: 1,
    },
    {
      id: 'detalle', nombre: 'Power BI procesa el detalle', corto: 'Detalle en Power BI',
      descripcion: 'El modelo importa una fila por operación y agrega en cada interacción del usuario.',
      procesa: 'Power BI, en cada interacción',
      fn: () => consultaSobreDetalle(detalle, { desde }),
      filasLeidas: detalle.length,
      filasModelo: detalle.length, bytesModelo: estimarBytes(detalle.length, 9), consultasProduccion: 0,
    },
    {
      id: 'cubo', nombre: 'DWH con cubo (solución del paper)', corto: 'Cubo en el DWH',
      descripcion: 'El DWH agregó una vez por día; Power BI importa el resultado y sólo suma unas pocas filas.',
      procesa: 'DWH, una vez por día',
      fn: () => consultaSobreCubo(hechos, { desde }),
      filasLeidas: hechos.length,
      filasModelo: hechos.length, bytesModelo: estimarBytes(hechos.length, 6), consultasProduccion: 0,
    },
  ];

  const resultados = [];
  let referencia = null;
  for (const [i, e] of estrategias.entries()) {
    const medicion = await medir(e.fn, { repeticiones });
    const grupos = e.fn();
    if (!referencia) referencia = grupos;
    resultados.push({
      id: e.id, nombre: e.nombre, corto: e.corto, descripcion: e.descripcion, procesa: e.procesa,
      filasLeidas: e.filasLeidas, filasModelo: e.filasModelo, bytesModelo: e.bytesModelo,
      consultasProduccion: e.consultasProduccion, medicion,
      total: totalDeGrupos(grupos), coincide: mismosResultados(referencia, grupos),
    });
    alProgresar?.((i + 1) / (estrategias.length + 2));
  }

  // Tiempo de actualizar el modelo: importar el detalle completo o sólo el cubo.
  const importarDetalle = await medir(() => transferirFilas(detalle), { repeticiones: Math.max(5, Math.round(repeticiones / 2)) });
  alProgresar?.((estrategias.length + 1) / (estrategias.length + 2));
  const importarCubo = await medir(() => transferirFilas(hechos), { repeticiones: Math.max(5, Math.round(repeticiones / 2)) });
  alProgresar?.(1);

  return {
    marca: `${estado.reloj.fecha}`,
    desde,
    repeticiones,
    resultados,
    importacion: {
      detalle: { filas: detalle.length, medicion: importarDetalle },
      cubo: { filas: hechos.length, medicion: importarCubo },
    },
    coinciden: resultados.every((r) => r.coincide),
  };
}

// ---- 2) Escalabilidad: ¿cómo crecen los tiempos con el volumen? ----

export async function medirEscalabilidad({ volumenes = [10000, 25000, 50000, 100000], repeticiones = 6, fechaFin, alProgresar } = {}) {
  const puntos = [];
  for (const [i, filas] of volumenes.entries()) {
    const { usuarios, operaciones } = generarVolumen({ operaciones: filas, fechaFin, semilla: 31 + i });
    const depuradas = depurarOperaciones(operaciones, usuarios).filas;
    const detalle = armarDetalle(depuradas).filas;
    const cubo = cuboMensual(depuradas).filas;
    const desde = ultimosMeses(fechaFin, 12)[0];
    // Un día de operaciones nuevas en el origen, para medir la carga incremental.
    const marcaAgua = fechaMaxima(operaciones);
    const nuevasPorDia = Math.max(1, Math.round(filas / 365));
    const hoy = sumarDias(marcaAgua, 1);
    const origen = operaciones.concat(Array.from({ length: nuevasPorDia }, (_, k) => ({
      id_operacion: filas + k + 1, id_usuario: usuarios[k % usuarios.length].id_usuario, fecha: hoy,
      tipo_servicio: TIPOS_SERVICIO[k % TIPOS_SERVICIO.length].codigo, importe: 10000, estado: 'confirmada', _v: 1, _t: null,
    })));

    const consultaDetalle = await medir(() => consultaSobreDetalle(detalle, { desde }), { repeticiones });
    const consultaCubo = await medir(() => consultaSobreCubo(cubo, { desde }), { repeticiones });
    const refrescoCompleto = await medir(() => transferirFilas(origen), { repeticiones, calentamiento: 1 });
    const refrescoIncremental = await medir(() => extraccionIncremental(operaciones, origen, marcaAgua), { repeticiones, calentamiento: 1 });
    puntos.push({ filas, filasCubo: cubo.length, filasNuevas: nuevasPorDia, consultaDetalle, consultaCubo, refrescoCompleto, refrescoIncremental });
    alProgresar?.((i + 1) / volumenes.length, filas);
    await pausa();
  }
  return { fechaFin, repeticiones, puntos };
}

// ---- 3) Refresco completo vs. incremental: qué se gana y qué se pierde ----

export function experimentoIncremental({ filas = 30000, fechaFin }) {
  const { usuarios, operaciones } = generarVolumen({ operaciones: filas, fechaFin, semilla: 101 });
  const copiaDeAyer = transferirFilas(operaciones);
  const marcaAgua = fechaMaxima(copiaDeAyer);
  const hoy = sumarDias(marcaAgua, 1);

  // Lo que pasa hoy en el origen:
  const origen = transferirFilas(operaciones);
  const nuevas = Math.max(5, Math.round(filas / 365));
  for (let k = 0; k < nuevas; k++) {
    origen.push({ id_operacion: filas + k + 1, id_usuario: usuarios[k % usuarios.length].id_usuario, fecha: hoy, tipo_servicio: 'MAN', importe: 21000, estado: 'confirmada', _v: 1, _t: null });
  }
  // a) un operador corrige el importe de una operación de hace más de un mes;
  const limite = sumarDias(marcaAgua, -35);
  const editada = origen.find((o) => o.estado === 'confirmada' && o.fecha <= limite);
  const antes = editada.importe;
  editada.importe += 12500;
  editada._v += 1;
  // b) y elimina una operación vieja cargada por error.
  const idxEliminada = origen.findIndex((o) => o.fecha <= limite && o !== editada);
  const [eliminada] = origen.splice(idxEliminada, 1);

  const completa = medirSincrono(() => transferirFilas(origen), { repeticiones: 7, calentamiento: 1 });
  const incremental = medirSincrono(() => extraccionIncremental(copiaDeAyer, origen, marcaAgua), { repeticiones: 7, calentamiento: 1 });
  const resultadoCompleto = transferirFilas(origen);
  const resultadoIncremental = extraccionIncremental(copiaDeAyer, origen, marcaAgua);

  const conciliar = (copia) => {
    const o = resumenOperaciones(origen);
    const c = resumenOperaciones(copia);
    return { filas: o.filas - c.filas, importe: Math.round((o.importe - c.importe) * 100) / 100, coincide: o.filas === c.filas && o.importe === c.importe && o.control === c.control };
  };

  return {
    filas, nuevas, marcaAgua,
    editada: { id: editada.id_operacion, fecha: editada.fecha, antes, despues: editada.importe },
    eliminada: { id: eliminada.id_operacion, fecha: eliminada.fecha },
    completa: { medicion: completa, escritas: resultadoCompleto.length, leidas: origen.length, diferencias: conciliar(resultadoCompleto) },
    incremental: {
      medicion: incremental, escritas: resultadoIncremental.detalle.escritas, leidas: resultadoIncremental.detalle.leidas,
      diferencias: conciliar(resultadoIncremental.filas),
    },
  };
}

// ---- 4) Protección de la operación: consultas que recibiría producción en un día ----

export function cargaSobreProduccion({ gerentes, interacciones, visuales, msConsulta, consultasProceso = 3 }) {
  const sinDWH = gerentes * interacciones * visuales;
  return {
    sinDWH,
    conDWH: consultasProceso,
    msSinDWH: msConsulta == null ? null : sinDWH * msConsulta,
    proporcion: consultasProceso ? sinDWH / consultasProceso : null,
  };
}
