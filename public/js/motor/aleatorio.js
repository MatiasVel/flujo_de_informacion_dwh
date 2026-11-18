// Generador pseudoaleatorio con semilla (algoritmo mulberry32).
// Usar una semilla hace que los datos de prueba sean reproducibles: la misma semilla
// genera siempre los mismos usuarios, algo útil para repetir una medición en igualdad de condiciones.

export function crearAleatorio(semilla = 20261118) {
  let a = (Number(semilla) >>> 0) || 1;

  const siguiente = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const entero = (min, max) => min + Math.floor(siguiente() * (max - min + 1));

  const elegir = (lista) => lista[Math.floor(siguiente() * lista.length)];

  // Elige un índice según pesos relativos (no hace falta que sumen 1).
  const indicePonderado = (pesos) => {
    const total = pesos.reduce((s, p) => s + p, 0);
    let r = siguiente() * total;
    for (let i = 0; i < pesos.length; i++) {
      r -= pesos[i];
      if (r < 0) return i;
    }
    return pesos.length - 1;
  };

  const ponderado = (lista, pesos) => lista[indicePonderado(pesos)];

  // Distribución normal (transformación de Box-Muller).
  const normal = (media, desvio) => {
    const u = 1 - siguiente();
    const v = siguiente();
    return media + desvio * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  const probabilidad = (p) => siguiente() < p;

  return { siguiente, entero, elegir, indicePonderado, ponderado, normal, probabilidad };
}

// Semilla derivada de un texto (por ejemplo, la fecha simulada), para que cada jornada
// simulada sea distinta pero reproducible.
export function semillaDeTexto(texto) {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
