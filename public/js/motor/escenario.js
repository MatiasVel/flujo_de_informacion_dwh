// Escenario de demostración y acciones que combinan el reloj simulado con el flujo completo.

import { crearEstado, cargarUsuariosDePrueba, simularJornada } from './estado.js';
import { ejecutarProcesoDiario } from './dwh.js';
import { actualizarModelo } from './powerbi.js';
import { avanzarHasta, hoyLocalISO, sumarDias } from './fechas.js';

export const HORA_PROCESO = 2 * 60; // 02:00: proceso ETL nocturno
export const HORA_POWERBI = 6 * 60; // 06:00: actualización programada en Power BI Service
export const HORA_JORNADA = 9 * 60; // 09:00: comienza la carga de los operadores

// Estado inicial: los datos se cargaron ayer, el proceso corrió a las 02:00 y Power BI se
// actualizó a las 06:00. Son las 09:00 y todo está al día, listo para hacer cambios.
export function crearEscenarioInicial({ fecha = hoyLocalISO(), usuarios = 400, promedioOperaciones = 14, mesesHistoria = 12, semilla = 2026 } = {}) {
  const estado = crearEstado({ fecha });
  estado.reloj = { fecha: sumarDias(fecha, -1), minutos: 18 * 60 };
  cargarUsuariosDePrueba(estado, { usuarios, promedioOperaciones, mesesHistoria, semilla, reemplazar: true });
  estado.produccion.actividad = [];
  estado.reloj = { fecha, minutos: HORA_PROCESO };
  ejecutarProcesoDiario(estado, { tipo: 'programada' });
  estado.reloj = { fecha, minutos: HORA_POWERBI };
  actualizarModelo(estado);
  estado.reloj = { fecha, minutos: HORA_JORNADA };
  return estado;
}

export function ejecutarProcesoNocturno(estado) {
  estado.reloj = avanzarHasta(estado.reloj, HORA_PROCESO);
  return ejecutarProcesoDiario(estado, { tipo: 'programada' });
}

export function actualizacionProgramadaPowerBI(estado) {
  estado.reloj = avanzarHasta(estado.reloj, HORA_POWERBI);
  return actualizarModelo(estado);
}

export function iniciarJornada(estado) {
  estado.reloj = avanzarHasta(estado.reloj, HORA_JORNADA);
}

// Un día completo: carga de los operadores, proceso nocturno, actualización de Power BI y
// comienzo de la jornada siguiente.
export function simularDiaCompleto(estado) {
  if (estado.reloj.minutos < HORA_JORNADA) estado.reloj = { ...estado.reloj, minutos: HORA_JORNADA };
  const jornada = simularJornada(estado);
  const proceso = ejecutarProcesoNocturno(estado);
  const powerbi = actualizacionProgramadaPowerBI(estado);
  iniciarJornada(estado);
  return { jornada, proceso, powerbi };
}
