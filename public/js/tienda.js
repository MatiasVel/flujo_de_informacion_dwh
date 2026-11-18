// Estado global del simulador y su persistencia en el navegador (IndexedDB).
// Los datos se guardan sólo en este navegador; si el almacenamiento no está disponible
// (por ejemplo, en una ventana privada), el simulador funciona igual, sin guardar.

import { crearEscenarioInicial } from './motor/escenario.js';
import { VERSION_ESQUEMA } from './motor/estado.js';

const BASE = 'simulador-flujo-dwh';
const ALMACEN = 'estado';
const CLAVE = 'actual';

let estado = null;
let temporizador = null;
// En algunos marcos aislados, sólo consultar indexedDB ya lanza un error de seguridad.
let disponible = (() => {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
})();
const oyentes = new Set();

function abrir() {
  return new Promise((resolver, rechazar) => {
    const pedido = indexedDB.open(BASE, 1);
    pedido.onupgradeneeded = () => pedido.result.createObjectStore(ALMACEN);
    pedido.onsuccess = () => resolver(pedido.result);
    pedido.onerror = () => rechazar(pedido.error);
  });
}

async function leer() {
  if (!disponible) return null;
  try {
    const db = await abrir();
    return await new Promise((resolver, rechazar) => {
      const pedido = db.transaction(ALMACEN, 'readonly').objectStore(ALMACEN).get(CLAVE);
      pedido.onsuccess = () => resolver(pedido.result ?? null);
      pedido.onerror = () => rechazar(pedido.error);
    });
  } catch {
    disponible = false;
    return null;
  }
}

async function escribir(valor) {
  if (!disponible) return;
  try {
    const db = await abrir();
    await new Promise((resolver, rechazar) => {
      const tx = db.transaction(ALMACEN, 'readwrite');
      tx.objectStore(ALMACEN).put(valor, CLAVE);
      tx.oncomplete = resolver;
      tx.onerror = () => rechazar(tx.error);
    });
  } catch {
    disponible = false;
  }
}

export async function iniciar() {
  const guardado = await leer();
  estado = guardado && guardado.esquema === VERSION_ESQUEMA ? guardado : crearEscenarioInicial();
  if (!guardado) programarGuardado();
  return estado;
}

export function obtener() {
  return estado;
}

// Aplica un cambio al estado, avisa a la interfaz y programa el guardado.
export function cambiar(funcion) {
  const resultado = funcion(estado);
  notificar();
  programarGuardado();
  return resultado;
}

export async function cambiarAsync(funcion) {
  const resultado = await funcion(estado);
  notificar();
  programarGuardado();
  return resultado;
}

export function suscribir(funcion) {
  oyentes.add(funcion);
  return () => oyentes.delete(funcion);
}

function notificar() {
  for (const f of oyentes) f(estado);
}

function programarGuardado() {
  clearTimeout(temporizador);
  temporizador = setTimeout(() => escribir(estado), 900);
}

export async function restablecer() {
  estado = crearEscenarioInicial();
  notificar();
  clearTimeout(temporizador);
  await escribir(estado);
}

export function persistenciaDisponible() {
  return disponible;
}
