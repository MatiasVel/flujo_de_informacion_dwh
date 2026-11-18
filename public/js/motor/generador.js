// Generador de datos de prueba: usuarios ficticios y sus operaciones.
// Simula lo que en la organización hacen los operadores al cargar datos a mano día a día.

import { crearAleatorio } from './aleatorio.js';
import {
  REGIONES, PESOS_REGION, SEGMENTOS, PESOS_SEGMENTO, TIPOS_SERVICIO, PESOS_TIPO_POR_SEGMENTO,
  FACTOR_IMPORTE_SEGMENTO, FACTOR_ACTIVIDAD_SEGMENTO, NOMBRES, APELLIDOS, sinTildes,
} from './catalogos.js';
import { sumarDias, diasEntre } from './fechas.js';

export const LIMITES = {
  usuariosPorCarga: 25000,
  operacionesTotales: 250000,
  promedioOperaciones: 60,
  mesesHistoria: 36,
};

const DIAS_POR_MES = 30.44;

// Calendario precalculado: convertir miles de veces un desplazamiento en fecha ISO
// con Date es lento; con una tabla de búsqueda es inmediato.
function calendario(desde, dias) {
  const fechas = new Array(dias + 1);
  for (let i = 0; i <= dias; i++) fechas[i] = sumarDias(desde, i);
  return fechas;
}

export function crearEmail(nombre, id) {
  const base = sinTildes(nombre).replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
  return `${base}.${id}@ejemplo.test`;
}

function redondearImporte(valor) {
  return Math.max(500, Math.round(valor / 50) * 50);
}

// Estacionalidad suave y crecimiento leve: le da forma realista a la serie mensual.
function factorTemporal(fecha, fechaFin) {
  const mes = Number(fecha.slice(5, 7));
  const estacional = 1 + 0.12 * Math.sin(((mes - 3) / 12) * 2 * Math.PI);
  const mesesAtras = diasEntre(fecha, fechaFin) / DIAS_POR_MES;
  const crecimiento = Math.pow(1.012, -mesesAtras);
  return estacional * crecimiento;
}

export function generarUsuarios({ cantidad, desdeId = 1, fechaFin, mesesHistoria = 12, aleatorio, marca = null }) {
  const rnd = aleatorio ?? crearAleatorio();
  const diasVentana = Math.round(mesesHistoria * DIAS_POR_MES);
  const inicioVentana = sumarDias(fechaFin, -diasVentana);
  const altas = [];
  for (let i = 0; i < cantidad; i++) {
    // Más de la mitad de los usuarios ya existía antes de la ventana analizada.
    const alta = rnd.probabilidad(0.55)
      ? sumarDias(inicioVentana, -rnd.entero(1, 900))
      : sumarDias(inicioVentana, rnd.entero(0, diasVentana));
    altas.push(alta);
  }
  altas.sort();
  return altas.map((fecha_alta, i) => {
    const id_usuario = desdeId + i;
    const nombre = `${rnd.elegir(NOMBRES)} ${rnd.elegir(APELLIDOS)}`;
    return {
      id_usuario,
      nombre,
      email: crearEmail(nombre, id_usuario),
      region: rnd.ponderado(REGIONES, PESOS_REGION),
      segmento: rnd.ponderado(SEGMENTOS, PESOS_SEGMENTO),
      estado: rnd.probabilidad(0.07) ? 'baja' : 'activo',
      fecha_alta,
      _v: 1,
      _t: marca,
    };
  });
}

export function importeDeServicio(tipo, segmento, fecha, fechaFin, rnd) {
  const ruido = 0.7 + rnd.siguiente() * 0.6;
  return redondearImporte(tipo.base * (FACTOR_IMPORTE_SEGMENTO[segmento] ?? 1) * ruido * factorTemporal(fecha, fechaFin));
}

export function generarOperaciones({ usuarios, promedioPorUsuario = 12, fechaFin, mesesHistoria = 12, desdeId = 1, aleatorio, marca = null }) {
  const rnd = aleatorio ?? crearAleatorio();
  const diasVentana = Math.round(mesesHistoria * DIAS_POR_MES);
  const inicioVentana = sumarDias(fechaFin, -diasVentana);
  const dias = calendario(inicioVentana, diasVentana);
  const operaciones = [];

  for (const u of usuarios) {
    const desdeIndice = u.fecha_alta > inicioVentana ? diasEntre(inicioVentana, u.fecha_alta) : 0;
    if (desdeIndice > diasVentana) continue;
    const fraccion = (diasVentana - desdeIndice + 1) / (diasVentana + 1);
    const segmento = SEGMENTOS.includes(u.segmento) ? u.segmento : 'Residencial';
    const esperado = promedioPorUsuario * (mesesHistoria / 12) * fraccion * (FACTOR_ACTIVIDAD_SEGMENTO[segmento] ?? 1);
    const cantidad = Math.max(0, Math.round(rnd.normal(esperado, Math.max(1, esperado * 0.35))));
    const pesos = PESOS_TIPO_POR_SEGMENTO[segmento];
    for (let j = 0; j < cantidad; j++) {
      const fecha = dias[desdeIndice + rnd.entero(0, diasVentana - desdeIndice)];
      const tipo = TIPOS_SERVICIO[rnd.indicePonderado(pesos)];
      operaciones.push({
        id_operacion: 0,
        id_usuario: u.id_usuario,
        fecha,
        tipo_servicio: tipo.codigo,
        importe: importeDeServicio(tipo, segmento, fecha, fechaFin, rnd),
        estado: rnd.probabilidad(0.04) ? 'anulada' : 'confirmada',
        _v: 1,
        _t: marca,
      });
    }
  }
  // Los identificadores siguen el orden de carga (por fecha), como en un sistema real.
  operaciones.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.id_usuario - b.id_usuario));
  for (let i = 0; i < operaciones.length; i++) operaciones[i].id_operacion = desdeId + i;
  return operaciones;
}

// Conjunto de datos de un volumen exacto, para las pruebas de escalabilidad.
// No toca los datos del usuario: se crea aparte y se descarta al terminar la medición.
export function generarVolumen({ operaciones, fechaFin, semilla = 7, mesesHistoria = 12 }) {
  const rnd = crearAleatorio(semilla);
  const cantidadUsuarios = Math.max(50, Math.round(operaciones / 14));
  const usuarios = generarUsuarios({ cantidad: cantidadUsuarios, fechaFin, mesesHistoria, aleatorio: rnd });
  const diasVentana = Math.round(mesesHistoria * DIAS_POR_MES);
  const inicioVentana = sumarDias(fechaFin, -diasVentana);
  const dias = calendario(inicioVentana, diasVentana);
  const filas = new Array(operaciones);
  for (let i = 0; i < operaciones; i++) {
    const u = usuarios[rnd.entero(0, usuarios.length - 1)];
    const tipo = TIPOS_SERVICIO[rnd.indicePonderado(PESOS_TIPO_POR_SEGMENTO[u.segmento])];
    const fecha = dias[rnd.entero(0, diasVentana)];
    filas[i] = {
      id_operacion: 0,
      id_usuario: u.id_usuario,
      fecha,
      tipo_servicio: tipo.codigo,
      importe: importeDeServicio(tipo, u.segmento, fecha, fechaFin, rnd),
      estado: rnd.probabilidad(0.04) ? 'anulada' : 'confirmada',
      _v: 1,
      _t: null,
    };
  }
  filas.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
  for (let i = 0; i < filas.length; i++) filas[i].id_operacion = i + 1;
  return { usuarios, operaciones: filas };
}
