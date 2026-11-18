// Lectura y escritura de CSV sin dependencias.
// Detecta el separador: Excel en español (Argentina) exporta con punto y coma.

import { normalizarFecha } from './fechas.js';
import { normalizarEstadoUsuario } from './catalogos.js';

export const COLUMNAS_USUARIOS = ['nombre', 'email', 'region', 'segmento', 'estado', 'fecha_alta'];

export function detectarSeparador(primeraLinea) {
  const pc = (primeraLinea.match(/;/g) || []).length;
  const c = (primeraLinea.match(/,/g) || []).length;
  const t = (primeraLinea.match(/\t/g) || []).length;
  if (t > pc && t > c) return '\t';
  return pc >= c ? ';' : ',';
}

// Parser de CSV que respeta comillas dobles ("texto, con separador") y comillas escapadas ("").
export function leerCSV(texto) {
  const contenido = String(texto ?? '').replace(/^﻿/, '');
  const primera = contenido.split(/\r?\n/, 1)[0] ?? '';
  const sep = detectarSeparador(primera);
  const filas = [];
  let fila = [];
  let campo = '';
  let entreComillas = false;
  for (let i = 0; i < contenido.length; i++) {
    const c = contenido[i];
    if (entreComillas) {
      if (c === '"') {
        if (contenido[i + 1] === '"') { campo += '"'; i++; } else { entreComillas = false; }
      } else {
        campo += c;
      }
    } else if (c === '"') {
      entreComillas = true;
    } else if (c === sep) {
      fila.push(campo); campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && contenido[i + 1] === '\n') i++;
      fila.push(campo); campo = '';
      filas.push(fila); fila = [];
    } else {
      campo += c;
    }
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  return { separador: sep, filas: filas.filter((f) => f.some((v) => String(v).trim() !== '')) };
}

function escaparCampo(valor, sep) {
  const texto = valor === null || valor === undefined ? '' : String(valor);
  return /["\n\r]/.test(texto) || texto.includes(sep) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

export function escribirCSV(registros, columnas, sep = ';') {
  const lineas = [columnas.join(sep)];
  for (const r of registros) lineas.push(columnas.map((c) => escaparCampo(r[c], sep)).join(sep));
  return lineas.join('\r\n') + '\r\n';
}

export const PLANTILLA_USUARIOS = escribirCSV(
  [
    { nombre: 'Lucía Benítez', email: 'lucia.benitez@ejemplo.test', region: 'Norte', segmento: 'Residencial', estado: 'activo', fecha_alta: '15/03/2025' },
    { nombre: 'Tomás Acosta', email: 'tomas.acosta@ejemplo.test', region: ' norte', segmento: 'Comercial', estado: 'activo', fecha_alta: '2025-08-02' },
    { nombre: 'Carla Medina', email: 'carla.medina@ejemplo.test', region: 'REGION SUR', segmento: 'corporativo', estado: 'baja', fecha_alta: '2024-11-20' },
  ],
  COLUMNAS_USUARIOS,
);

const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Valida las filas de un CSV de usuarios. La región y el segmento se aceptan tal cual
// se escribieron: limpiarlos es tarea de la capa de cálculo del DWH, no del operador.
export function validarUsuariosCSV(texto) {
  const { filas } = leerCSV(texto);
  if (!filas.length) return { validos: [], errores: [{ linea: 1, mensaje: 'El archivo está vacío.' }] };
  const encabezado = filas[0].map((c) => c.trim().toLowerCase());
  const faltantes = COLUMNAS_USUARIOS.filter((c) => !encabezado.includes(c));
  if (faltantes.length) {
    return { validos: [], errores: [{ linea: 1, mensaje: `Faltan columnas en el encabezado: ${faltantes.join(', ')}.` }] };
  }
  const indice = Object.fromEntries(COLUMNAS_USUARIOS.map((c) => [c, encabezado.indexOf(c)]));
  const validos = [];
  const errores = [];
  filas.slice(1).forEach((fila, i) => {
    const linea = i + 2;
    const v = (col) => String(fila[indice[col]] ?? '').trim();
    const problemas = [];
    const nombre = v('nombre');
    const email = v('email');
    const estado = normalizarEstadoUsuario(v('estado'));
    const fecha = normalizarFecha(v('fecha_alta'));
    if (!nombre) problemas.push('nombre vacío');
    if (!EMAIL_VALIDO.test(email)) problemas.push('email inválido');
    if (!String(fila[indice.region] ?? '').trim()) problemas.push('región vacía');
    if (!v('segmento')) problemas.push('segmento vacío');
    if (!estado) problemas.push('estado debe ser "activo" o "baja"');
    if (!fecha) problemas.push('fecha_alta debe ser AAAA-MM-DD o DD/MM/AAAA');
    if (problemas.length) {
      errores.push({ linea, mensaje: problemas.join('; ') });
    } else {
      validos.push({ nombre, email, region: String(fila[indice.region]), segmento: v('segmento'), estado, fecha_alta: fecha });
    }
  });
  return { validos, errores };
}
