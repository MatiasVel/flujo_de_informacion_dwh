// Laboratorio de cubos (sección 5.2 del paper): crear un cubo nuevo reutilizando la capa de cálculo.
// Criterio de la organización: "reutilizar antes de extraer". Sólo se puede armar un cubo con
// dimensiones que ya existen en el DWH; si falta una tabla de origen, primero hay que extraerla.

export const DIMENSIONES = [
  { id: 'mes', nombre: 'Mes', disponible: true, sql: 'mes', valor: (f) => f.mes },
  { id: 'anio', nombre: 'Año', disponible: true, sql: "date_part('year', fecha)::int AS anio", grupo: 'anio', valor: (f) => f.fecha.slice(0, 4) },
  { id: 'region', nombre: 'Región', disponible: true, sql: 'region', valor: (f) => f.region },
  { id: 'segmento', nombre: 'Segmento', disponible: true, sql: 'segmento', valor: (f) => f.segmento },
  { id: 'tipo_servicio', nombre: 'Tipo de servicio', disponible: true, sql: 'tipo_servicio', valor: (f) => f.tipo_servicio },
  {
    id: 'canal', nombre: 'Canal de atención', disponible: false,
    motivo: 'No está en la capa de extracción. Antes habría que incorporar su tabla de origen al proceso de extracción.',
  },
  {
    id: 'sucursal', nombre: 'Sucursal', disponible: false,
    motivo: 'El origen no la registra en las tablas extraídas. Requiere un nuevo relevamiento de fuentes.',
  },
];

export const MEDIDAS = [
  { id: 'cantidad', nombre: 'Cantidad de operaciones', sql: 'count(*)                     AS cantidad' },
  { id: 'importe_total', nombre: 'Importe total', sql: 'sum(importe)                 AS importe_total' },
  { id: 'ticket_promedio', nombre: 'Ticket promedio', sql: 'round(avg(importe), 2)       AS ticket_promedio' },
  { id: 'usuarios_distintos', nombre: 'Usuarios distintos', sql: 'count(DISTINCT id_usuario)   AS usuarios_distintos' },
];

const NOMBRE_VALIDO = /^cubo_[a-z0-9_]{2,40}$/;

export function validarCubo(spec, nombresExistentes = []) {
  const errores = [];
  if (!NOMBRE_VALIDO.test(spec.nombre ?? '')) {
    errores.push('El nombre debe empezar con "cubo_" y usar sólo minúsculas, números y guiones bajos (por ejemplo, cubo_region_mes).');
  } else if (nombresExistentes.includes(spec.nombre)) {
    errores.push(`Ya existe un objeto llamado consumo_agregado.${spec.nombre}.`);
  }
  const dims = (spec.dimensiones ?? []).map((id) => DIMENSIONES.find((d) => d.id === id));
  if (!dims.length) errores.push('Elegí al menos una dimensión: define la granularidad del cubo.');
  if (dims.some((d) => !d)) errores.push('Hay una dimensión desconocida.');
  const noDisponibles = dims.filter((d) => d && !d.disponible);
  if (noDisponibles.length) {
    errores.push(`No se puede reutilizar: ${noDisponibles.map((d) => d.nombre).join(', ')} no existe en el DWH. ${noDisponibles[0].motivo}`);
  }
  if (!(spec.medidas ?? []).length) errores.push('Elegí al menos una medida.');
  return errores;
}

export function calcularCubo(spec, depuradas) {
  const dims = spec.dimensiones.map((id) => DIMENSIONES.find((d) => d.id === id));
  const quiere = new Set(spec.medidas);
  const grupos = new Map();
  for (const f of depuradas) {
    const valores = dims.map((d) => d.valor(f));
    const clave = valores.join('|');
    let g = grupos.get(clave);
    if (!g) {
      g = { _claves: valores, cantidad: 0, importe_total: 0, _usuarios: quiere.has('usuarios_distintos') ? new Set() : null };
      grupos.set(clave, g);
    }
    g.cantidad++;
    g.importe_total += f.importe;
    if (g._usuarios) g._usuarios.add(f.id_usuario);
  }
  const filas = [];
  for (const g of grupos.values()) {
    const fila = {};
    dims.forEach((d, i) => { fila[d.grupo ?? d.id] = g._claves[i]; });
    if (quiere.has('cantidad')) fila.cantidad = g.cantidad;
    if (quiere.has('importe_total')) fila.importe_total = Math.round(g.importe_total * 100) / 100;
    if (quiere.has('ticket_promedio')) fila.ticket_promedio = Math.round((g.importe_total / g.cantidad) * 100) / 100;
    if (quiere.has('usuarios_distintos')) fila.usuarios_distintos = g._usuarios.size;
    filas.push(fila);
  }
  const columnas = dims.map((d) => d.grupo ?? d.id);
  filas.sort((a, b) => {
    for (const c of columnas) {
      if (a[c] < b[c]) return -1;
      if (a[c] > b[c]) return 1;
    }
    return 0;
  });
  return filas;
}

export function sqlDeCubo(spec) {
  const dims = spec.dimensiones.map((id) => DIMENSIONES.find((d) => d.id === id)).filter(Boolean);
  const medidas = spec.medidas.map((id) => MEDIDAS.find((m) => m.id === id)).filter(Boolean);
  const nombresDims = dims.map((d) => d.nombre.toLowerCase()).join(' × ');
  const select = [
    ...dims.map((d, i) => `    ${d.sql},${i === 0 ? '                       -- dimensiones' : ''}`),
    ...medidas.map((m, i) => `    ${m.sql}${i < medidas.length - 1 ? ',' : ''}${i === 0 ? '   -- medidas' : ''}`),
  ];
  const grupo = dims.map((d) => d.grupo ?? d.id).join(', ');
  return `-- Cubo creado en el laboratorio. Granularidad: ${nombresDims}.
-- Reutiliza la capa de cálculo: no agrega consultas al servidor de producción.
CREATE MATERIALIZED VIEW consumo_agregado.${spec.nombre} AS
SELECT
${select.join('\n')}
FROM calculo.operaciones_depuradas
GROUP BY ${grupo};

-- Se integra al proceso diario después de su dependencia (orden de dependencias).
REFRESH MATERIALIZED VIEW consumo_agregado.${spec.nombre};`;
}

export function definicionDeCubo(spec) {
  const dims = spec.dimensiones.map((id) => DIMENSIONES.find((d) => d.id === id)?.nombre ?? id);
  return {
    id: `consumo_agregado.${spec.nombre}`,
    capa: 'consumo_agregado',
    tipo: 'cubo',
    nombre: spec.nombre,
    descripcion: `Cubo creado en el laboratorio con granularidad ${dims.join(' × ').toLowerCase()}.`,
    deps: ['calculo.operaciones_depuradas'],
    personalizado: true,
    spec,
    sql: sqlDeCubo(spec),
    calcular(ctx) {
      const entrada = ctx.datos('calculo.operaciones_depuradas');
      const filas = calcularCubo(spec, entrada);
      return { filas, detalle: { entrada: entrada.length, salida: filas.length } };
    },
  };
}
