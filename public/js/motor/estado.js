// Estado del simulador y acciones sobre la base transaccional (servidor de producción).
// Todo cambio en producción sube la "versión" de la tabla: así el DWH sabe que su copia quedó vieja.

import { crearAleatorio, semillaDeTexto } from './aleatorio.js';
import {
  REGIONES, SEGMENTOS, TIPOS_SERVICIO, ESTADOS_USUARIO, ESTADOS_OPERACION, CUENTAS_INICIALES,
  NOMBRES, APELLIDOS, PESOS_REGION, PESOS_SEGMENTO, PESOS_TIPO_POR_SEGMENTO, normalizarEstadoUsuario,
  normalizarRegion, normalizarSegmento,
} from './catalogos.js';
import { esFechaISO, marcaDeTiempo, sumarDias, hoyLocalISO, horaTexto } from './fechas.js';
import { generarUsuarios, generarOperaciones, crearEmail, importeDeServicio, LIMITES } from './generador.js';
import { validarUsuariosCSV } from './csv.js';

export const VERSION_ESQUEMA = 1;

export class ErrorValidacion extends Error {
  constructor(mensaje, campos = {}) {
    super(mensaje);
    this.name = 'ErrorValidacion';
    this.campos = campos;
  }
}

export function crearEstado({ fecha = hoyLocalISO() } = {}) {
  return {
    esquema: VERSION_ESQUEMA,
    reloj: { fecha, minutos: 9 * 60 },
    produccion: {
      usuarios: [],
      operaciones: [],
      secuencias: { usuarios: 0, operaciones: 0, filas: 0 },
      versiones: { usuarios: 0, operaciones: 0 },
      consultasAnaliticas: { total: 0, porDia: {} },
      actividad: [],
    },
    repositorio: { archivo: 'metas_mensuales.xlsx', metas: REGIONES.map((region) => ({ region, meta_mensual: 0 })), version: 1, actualizado: null },
    dwh: { datos: {}, meta: {}, cubosUsuario: [], ejecuciones: [], registro: [], secEjecucion: 0, notificaciones: [] },
    powerbi: { modelo: null, meta: null, historial: [], ultimoError: null },
    config: { modoExtraccion: 'completa', fallaOrigen: false, gatewayCaido: false },
    cuentas: CUENTAS_INICIALES.map((c) => ({ ...c })),
    sesion: 'c2',
    rendimiento: { estrategias: null, escalabilidad: null, incremental: null },
  };
}

const marca = (estado) => marcaDeTiempo(estado.reloj);

function siguienteVersionFila(estado) {
  estado.produccion.secuencias.filas += 1;
  return estado.produccion.secuencias.filas;
}

function registrarCambio(estado, tabla) {
  estado.produccion.versiones[tabla] += 1;
}

export function registrarActividad(estado, texto) {
  const lista = estado.produccion.actividad;
  lista.unshift({ marca: marca(estado), texto });
  lista.length = Math.min(lista.length, 60);
}

// ---- Validaciones (como las restricciones de una base transaccional) ----

const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validarUsuario(estado, datos) {
  const campos = {};
  const nombre = String(datos.nombre ?? '').trim();
  const email = String(datos.email ?? '').trim();
  const region = String(datos.region ?? '');
  const segmento = String(datos.segmento ?? '');
  const estadoUsuario = normalizarEstadoUsuario(datos.estado);
  const fecha = String(datos.fecha_alta ?? '').trim();
  if (!nombre) campos.nombre = 'Ingresá el nombre.';
  else if (nombre.length > 80) campos.nombre = 'Usá hasta 80 caracteres.';
  if (!EMAIL_VALIDO.test(email)) campos.email = 'Ingresá un email con formato nombre@dominio.';
  if (!region.trim()) campos.region = 'Ingresá la región.';
  if (!segmento.trim()) campos.segmento = 'Ingresá el segmento.';
  if (!estadoUsuario) campos.estado = 'El estado debe ser activo o baja.';
  if (!esFechaISO(fecha)) campos.fecha_alta = 'Ingresá una fecha válida.';
  else if (fecha > estado.reloj.fecha) campos.fecha_alta = 'La fecha de alta no puede ser posterior a la fecha simulada.';
  if (Object.keys(campos).length) throw new ErrorValidacion(`Revisá los datos del usuario: ${Object.values(campos).join(' ')}`, campos);
  return { nombre, email, region, segmento, estado: estadoUsuario, fecha_alta: fecha };
}

function validarOperacion(estado, datos) {
  const campos = {};
  const idUsuario = Number(datos.id_usuario);
  const fecha = String(datos.fecha ?? '').trim();
  const tipo = String(datos.tipo_servicio ?? '');
  const importe = Number(String(datos.importe ?? '').replace(',', '.'));
  const estadoOp = String(datos.estado ?? 'confirmada');
  if (!Number.isInteger(idUsuario) || !estado.produccion.usuarios.some((u) => u.id_usuario === idUsuario)) {
    campos.id_usuario = 'El usuario no existe (restricción de clave foránea).';
  }
  if (!esFechaISO(fecha)) campos.fecha = 'Ingresá una fecha válida.';
  else if (fecha > estado.reloj.fecha) campos.fecha = 'La fecha no puede ser posterior a la fecha simulada.';
  if (!TIPOS_SERVICIO.some((t) => t.codigo === tipo)) campos.tipo_servicio = 'Elegí un tipo de servicio.';
  if (!Number.isFinite(importe) || importe < 0) campos.importe = 'El importe debe ser un número mayor o igual a cero.';
  if (!ESTADOS_OPERACION.includes(estadoOp)) campos.estado = 'El estado debe ser confirmada o anulada.';
  if (Object.keys(campos).length) throw new ErrorValidacion(`Revisá los datos de la operación: ${Object.values(campos).join(' ')}`, campos);
  return { id_usuario: idUsuario, fecha, tipo_servicio: tipo, importe: Math.round(importe * 100) / 100, estado: estadoOp };
}

// ---- Usuarios ----

export function agregarUsuario(estado, datos, { registrar = true } = {}) {
  const valido = validarUsuario(estado, datos);
  const p = estado.produccion;
  p.secuencias.usuarios += 1;
  const fila = { id_usuario: p.secuencias.usuarios, ...valido, _v: siguienteVersionFila(estado), _t: marca(estado) };
  p.usuarios.push(fila);
  registrarCambio(estado, 'usuarios');
  if (registrar) registrarActividad(estado, `Alta del usuario #${fila.id_usuario} (${fila.nombre}).`);
  return fila;
}

export function editarUsuario(estado, id, cambios) {
  const fila = estado.produccion.usuarios.find((u) => u.id_usuario === Number(id));
  if (!fila) throw new ErrorValidacion(`No existe el usuario #${id}.`);
  const valido = validarUsuario(estado, { ...fila, ...cambios });
  const antes = { ...fila };
  const modificados = Object.keys(valido).filter((k) => valido[k] !== fila[k]);
  if (!modificados.length) return { fila, modificados };
  Object.assign(fila, valido, { _v: siguienteVersionFila(estado), _t: marca(estado) });
  registrarCambio(estado, 'usuarios');
  registrarActividad(estado, `Modificación del usuario #${fila.id_usuario}: ${modificados.map((k) => `${k} "${antes[k]}" → "${fila[k]}"`).join(', ')}.`);
  return { fila, modificados, antes };
}

export function eliminarUsuario(estado, id) {
  const p = estado.produccion;
  const i = p.usuarios.findIndex((u) => u.id_usuario === Number(id));
  if (i < 0) throw new ErrorValidacion(`No existe el usuario #${id}.`);
  const cantidad = p.operaciones.reduce((n, o) => n + (o.id_usuario === Number(id) ? 1 : 0), 0);
  if (cantidad) {
    throw new ErrorValidacion(`No se puede eliminar el usuario #${id}: tiene ${cantidad} operaciones registradas (restricción de clave foránea). Podés darlo de baja.`);
  }
  const [fila] = p.usuarios.splice(i, 1);
  registrarCambio(estado, 'usuarios');
  registrarActividad(estado, `Eliminación del usuario #${fila.id_usuario}.`);
  return fila;
}

// ---- Operaciones ----

export function agregarOperacion(estado, datos, { registrar = true } = {}) {
  const valido = validarOperacion(estado, datos);
  const p = estado.produccion;
  p.secuencias.operaciones += 1;
  const fila = { id_operacion: p.secuencias.operaciones, ...valido, _v: siguienteVersionFila(estado), _t: marca(estado) };
  p.operaciones.push(fila);
  registrarCambio(estado, 'operaciones');
  if (registrar) registrarActividad(estado, `Registro de la operación #${fila.id_operacion} del usuario #${fila.id_usuario}.`);
  return fila;
}

export function editarOperacion(estado, id, cambios) {
  const fila = estado.produccion.operaciones.find((o) => o.id_operacion === Number(id));
  if (!fila) throw new ErrorValidacion(`No existe la operación #${id}.`);
  const valido = validarOperacion(estado, { ...fila, ...cambios });
  const antes = { ...fila };
  const modificados = Object.keys(valido).filter((k) => valido[k] !== fila[k]);
  if (!modificados.length) return { fila, modificados };
  Object.assign(fila, valido, { _v: siguienteVersionFila(estado), _t: marca(estado) });
  registrarCambio(estado, 'operaciones');
  registrarActividad(estado, `Modificación de la operación #${fila.id_operacion}: ${modificados.map((k) => `${k} "${antes[k]}" → "${fila[k]}"`).join(', ')}.`);
  return { fila, modificados, antes };
}

export function eliminarOperacion(estado, id) {
  const p = estado.produccion;
  const i = p.operaciones.findIndex((o) => o.id_operacion === Number(id));
  if (i < 0) throw new ErrorValidacion(`No existe la operación #${id}.`);
  const [fila] = p.operaciones.splice(i, 1);
  registrarCambio(estado, 'operaciones');
  registrarActividad(estado, `Eliminación de la operación #${fila.id_operacion}.`);
  return fila;
}

// ---- Carga masiva de usuarios de prueba ----

export function recalcularMetas(estado, { mesesHistoria = 12 } = {}) {
  const porRegion = Object.fromEntries(REGIONES.map((r) => [r, 0]));
  const regionDe = new Map(estado.produccion.usuarios.map((u) => [u.id_usuario, normalizarRegion(u.region)]));
  for (const o of estado.produccion.operaciones) {
    if (o.estado !== 'confirmada') continue;
    const r = regionDe.get(o.id_usuario);
    if (r in porRegion) porRegion[r] += o.importe;
  }
  // Meta mensual: el promedio mensual histórico más un 8 %, redondeado a miles.
  estado.repositorio.metas = REGIONES.map((region) => ({
    region,
    meta_mensual: Math.round(((porRegion[region] / mesesHistoria) * 1.08) / 1000) * 1000,
  }));
  estado.repositorio.version += 1;
  estado.repositorio.actualizado = marca(estado);
}

export function cargarUsuariosDePrueba(estado, { usuarios = 300, promedioOperaciones = 14, mesesHistoria = 12, semilla, reemplazar = false, recalcularMetas: recalcular = reemplazar } = {}) {
  const cantidad = Math.floor(Number(usuarios));
  const promedio = Number(promedioOperaciones);
  const meses = Math.floor(Number(mesesHistoria));
  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > LIMITES.usuariosPorCarga) {
    throw new ErrorValidacion(`La cantidad de usuarios debe estar entre 1 y ${LIMITES.usuariosPorCarga.toLocaleString('es-AR')}.`, { usuarios: 'Fuera de rango.' });
  }
  if (!Number.isFinite(promedio) || promedio < 0 || promedio > LIMITES.promedioOperaciones) {
    throw new ErrorValidacion(`El promedio de operaciones por usuario debe estar entre 0 y ${LIMITES.promedioOperaciones}.`, { promedioOperaciones: 'Fuera de rango.' });
  }
  if (!Number.isInteger(meses) || meses < 1 || meses > LIMITES.mesesHistoria) {
    throw new ErrorValidacion(`Los meses de historia deben estar entre 1 y ${LIMITES.mesesHistoria}.`, { mesesHistoria: 'Fuera de rango.' });
  }
  const estimadas = (reemplazar ? 0 : estado.produccion.operaciones.length) + cantidad * promedio * (meses / 12) * 1.1;
  if (estimadas > LIMITES.operacionesTotales) {
    throw new ErrorValidacion(
      `Esa carga dejaría unas ${Math.round(estimadas).toLocaleString('es-AR')} operaciones; el simulador admite hasta ${LIMITES.operacionesTotales.toLocaleString('es-AR')} para que el navegador responda con fluidez.`,
      { usuarios: 'Demasiadas operaciones.' },
    );
  }
  const p = estado.produccion;
  const t0 = performance.now();
  const semillaUsada = Number.isFinite(Number(semilla)) && String(semilla).trim() !== '' ? Number(semilla) : semillaDeTexto(`${estado.reloj.fecha}-${p.secuencias.usuarios}-${Date.now()}`);
  const rnd = crearAleatorio(semillaUsada);
  if (reemplazar) {
    p.usuarios = [];
    p.operaciones = [];
    p.secuencias.usuarios = 0;
    p.secuencias.operaciones = 0;
  }
  const m = marca(estado);
  const nuevosUsuarios = generarUsuarios({ cantidad, desdeId: p.secuencias.usuarios + 1, fechaFin: estado.reloj.fecha, mesesHistoria: meses, aleatorio: rnd, marca: m });
  const nuevasOperaciones = generarOperaciones({
    usuarios: nuevosUsuarios, promedioPorUsuario: promedio, fechaFin: estado.reloj.fecha, mesesHistoria: meses,
    desdeId: p.secuencias.operaciones + 1, aleatorio: rnd, marca: m,
  });
  for (const u of nuevosUsuarios) u._v = siguienteVersionFila(estado);
  for (const o of nuevasOperaciones) o._v = siguienteVersionFila(estado);
  for (const u of nuevosUsuarios) p.usuarios.push(u);
  for (const o of nuevasOperaciones) p.operaciones.push(o);
  p.secuencias.usuarios += nuevosUsuarios.length;
  p.secuencias.operaciones += nuevasOperaciones.length;
  registrarCambio(estado, 'usuarios');
  registrarCambio(estado, 'operaciones');
  if (recalcular) recalcularMetas(estado, { mesesHistoria: meses });
  const ms = performance.now() - t0;
  registrarActividad(estado, `Carga de ${nuevosUsuarios.length.toLocaleString('es-AR')} usuarios de prueba y ${nuevasOperaciones.length.toLocaleString('es-AR')} operaciones${reemplazar ? ' (reemplazó los datos anteriores)' : ''}.`);
  return { usuarios: nuevosUsuarios.length, operaciones: nuevasOperaciones.length, ms, semilla: semillaUsada };
}

export function importarUsuariosCSV(estado, texto) {
  const { validos, errores } = validarUsuariosCSV(texto);
  const agregados = [];
  for (const datos of validos) {
    try {
      agregados.push(agregarUsuario(estado, datos, { registrar: false }));
    } catch (e) {
      errores.push({ linea: '—', mensaje: `${datos.nombre}: ${e.message}` });
    }
  }
  if (agregados.length) registrarActividad(estado, `Importación CSV: ${agregados.length} usuarios agregados.`);
  return { agregados, errores };
}

// ---- Planilla de metas (repositorio de archivos: no pasa por el DWH) ----

export function editarMeta(estado, region, valor) {
  const meta = estado.repositorio.metas.find((m) => m.region === region);
  if (!meta) throw new ErrorValidacion(`La región ${region} no está en la planilla.`);
  const numero = Number(String(valor).replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(numero) || numero < 0) throw new ErrorValidacion('La meta debe ser un número mayor o igual a cero.');
  if (meta.meta_mensual === numero) return false;
  meta.meta_mensual = Math.round(numero);
  estado.repositorio.version += 1;
  estado.repositorio.actualizado = marca(estado);
  return true;
}

// ---- Cuentas de prueba (credenciales nominales simuladas) ----

export function agregarCuenta(estado, { usuario, nombre, perfil }) {
  const u = String(usuario ?? '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(u)) throw new ErrorValidacion('El usuario debe tener entre 3 y 30 caracteres: letras minúsculas, números, punto, guion o guion bajo.');
  if (estado.cuentas.some((c) => c.usuario === u)) throw new ErrorValidacion(`Ya existe la cuenta ${u}.`);
  if (!['operador', 'datos', 'gerencia'].includes(perfil)) throw new ErrorValidacion('Elegí un perfil.');
  const cuenta = { id: `c${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`, usuario: u, nombre: String(nombre ?? '').trim() || u, perfil };
  estado.cuentas.push(cuenta);
  return cuenta;
}

export function eliminarCuenta(estado, id) {
  if (estado.cuentas.length <= 1) throw new ErrorValidacion('Tiene que quedar al menos una cuenta.');
  estado.cuentas = estado.cuentas.filter((c) => c.id !== id);
  if (estado.sesion === id) estado.sesion = estado.cuentas[0].id;
}

// ---- Jornada operativa simulada ----
// Lo que harían los operadores durante un día: altas, operaciones nuevas y alguna corrección.

export function simularJornada(estado, { semilla } = {}) {
  const p = estado.produccion;
  const fecha = estado.reloj.fecha;
  const rnd = crearAleatorio(semilla ?? semillaDeTexto(`${fecha}-${p.secuencias.operaciones}-${p.secuencias.usuarios}`));
  const resumen = { usuariosNuevos: 0, operacionesNuevas: 0, correcciones: [] };
  estado.reloj = { fecha, minutos: Math.max(estado.reloj.minutos, 9 * 60) };

  const activos = p.usuarios.filter((u) => normalizarEstadoUsuario(u.estado) === 'activo');
  const altas = rnd.entero(0, Math.max(1, Math.round(activos.length * 0.004)));
  for (let i = 0; i < altas; i++) {
    const nombre = `${rnd.elegir(NOMBRES)} ${rnd.elegir(APELLIDOS)}`;
    const u = agregarUsuario(estado, {
      nombre, email: crearEmail(nombre, p.secuencias.usuarios + 1), region: rnd.ponderado(REGIONES, PESOS_REGION),
      segmento: rnd.ponderado(SEGMENTOS, PESOS_SEGMENTO), estado: 'activo', fecha_alta: fecha,
    }, { registrar: false });
    activos.push(u);
    resumen.usuariosNuevos++;
  }

  const cantidad = activos.length ? Math.max(3, Math.round(activos.length * rnd.entero(25, 45) / 1000)) : 0;
  for (let i = 0; i < cantidad; i++) {
    estado.reloj.minutos = 9 * 60 + Math.round((i / Math.max(1, cantidad)) * 9 * 60);
    const u = rnd.elegir(activos);
    const segmento = SEGMENTOS.includes(normalizarSegmento(u.segmento)) ? normalizarSegmento(u.segmento) : 'Residencial';
    const tipo = TIPOS_SERVICIO[rnd.indicePonderado(PESOS_TIPO_POR_SEGMENTO[segmento])];
    agregarOperacion(estado, {
      id_usuario: u.id_usuario, fecha, tipo_servicio: tipo.codigo,
      importe: importeDeServicio(tipo, segmento, fecha, fecha, rnd), estado: 'confirmada',
    }, { registrar: false });
    resumen.operacionesNuevas++;
  }

  // Corrección retroactiva: un operador corrige el importe de una operación de hace semanas.
  const viejas = p.operaciones.filter((o) => o.estado === 'confirmada' && o.fecha <= sumarDias(fecha, -20) && o.fecha >= sumarDias(fecha, -60));
  if (viejas.length) {
    const o = rnd.elegir(viejas);
    const nuevo = Math.round((o.importe * (1 + rnd.entero(5, 25) / 100)) / 50) * 50;
    estado.reloj.minutos = 15 * 60 + rnd.entero(0, 90);
    editarOperacion(estado, o.id_operacion, { importe: nuevo });
    resumen.correcciones.push(`Corrección del importe de la operación #${o.id_operacion} (fecha ${o.fecha}).`);
  }
  // Un usuario se muda de región.
  if (activos.length && rnd.probabilidad(0.7)) {
    const u = rnd.elegir(activos);
    const otras = REGIONES.filter((r) => r !== normalizarRegion(u.region));
    estado.reloj.minutos = 16 * 60 + rnd.entero(0, 60);
    editarUsuario(estado, u.id_usuario, { region: rnd.elegir(otras) });
    resumen.correcciones.push(`Cambio de región del usuario #${u.id_usuario}.`);
  }

  estado.reloj.minutos = 18 * 60;
  registrarActividad(estado, `Jornada del ${fecha}: ${resumen.usuariosNuevos} altas, ${resumen.operacionesNuevas} operaciones y ${resumen.correcciones.length} correcciones.`);
  return resumen;
}

export function horaActual(estado) {
  return horaTexto(estado.reloj.minutos);
}

export { ESTADOS_USUARIO, ESTADOS_OPERACION };
