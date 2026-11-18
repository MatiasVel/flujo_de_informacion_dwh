// Catálogos de la organización ficticia. Todos los datos son inventados:
// el simulador no reproduce la estructura ni los datos de ninguna organización real.

export const REGIONES = ['Norte', 'Centro', 'Sur', 'Este', 'Oeste'];
export const PESOS_REGION = [0.22, 0.31, 0.18, 0.15, 0.14];

export const SEGMENTOS = ['Residencial', 'Comercial', 'Corporativo'];
export const PESOS_SEGMENTO = [0.62, 0.29, 0.09];

export const ESTADOS_USUARIO = ['activo', 'baja'];
export const ESTADOS_OPERACION = ['confirmada', 'anulada'];

export const TIPOS_SERVICIO = [
  { codigo: 'INS', nombre: 'Instalación', base: 52000 },
  { codigo: 'MAN', nombre: 'Mantenimiento', base: 21000 },
  { codigo: 'REP', nombre: 'Reparación', base: 34000 },
  { codigo: 'SOP', nombre: 'Soporte remoto', base: 9500 },
  { codigo: 'CON', nombre: 'Consultoría', base: 78000 },
];

export const NOMBRE_SERVICIO = Object.fromEntries(TIPOS_SERVICIO.map((t) => [t.codigo, t.nombre]));

// Cuánto contrata cada segmento de cada tipo de servicio (pesos relativos, mismo orden que TIPOS_SERVICIO).
export const PESOS_TIPO_POR_SEGMENTO = {
  Residencial: [0.22, 0.3, 0.28, 0.18, 0.02],
  Comercial: [0.2, 0.32, 0.2, 0.16, 0.12],
  Corporativo: [0.14, 0.3, 0.12, 0.14, 0.3],
};

// Los clientes más grandes pagan más por el mismo servicio y operan más seguido.
export const FACTOR_IMPORTE_SEGMENTO = { Residencial: 1, Comercial: 1.55, Corporativo: 2.7 };
export const FACTOR_ACTIVIDAD_SEGMENTO = { Residencial: 0.85, Comercial: 1.25, Corporativo: 2.1 };

export const NOMBRES = [
  'Lucía', 'Martina', 'Sofía', 'Valentina', 'Camila', 'Julieta', 'Florencia', 'Agustina', 'Paula', 'Carla',
  'Natalia', 'Romina', 'Daniela', 'Laura', 'Mariana', 'Victoria', 'Micaela', 'Rocío', 'Belén', 'Lorena',
  'Mateo', 'Santiago', 'Benjamín', 'Joaquín', 'Tomás', 'Lautaro', 'Facundo', 'Nicolás', 'Juan', 'Martín',
  'Gonzalo', 'Diego', 'Pablo', 'Federico', 'Lucas', 'Matías', 'Ignacio', 'Franco', 'Ramiro', 'Sebastián',
];

export const APELLIDOS = [
  'González', 'Rodríguez', 'Gómez', 'Fernández', 'López', 'Díaz', 'Martínez', 'Pérez', 'García', 'Sánchez',
  'Romero', 'Sosa', 'Álvarez', 'Torres', 'Ruiz', 'Ramírez', 'Flores', 'Acosta', 'Benítez', 'Medina',
  'Suárez', 'Herrera', 'Aguirre', 'Pereyra', 'Gutiérrez', 'Giménez', 'Molina', 'Silva', 'Castro', 'Rojas',
  'Ortiz', 'Núñez', 'Luna', 'Juárez', 'Cabrera', 'Ríos', 'Morales', 'Godoy', 'Moreno', 'Ferreyra',
];

// Perfiles de acceso (sección 4.1 del paper): los usuarios finales sólo ven las capas de consumo.
export const PERFILES = {
  operador: {
    nombre: 'Operador',
    descripcion: 'Carga los datos de la operación diaria en los sistemas de gestión.',
    permisos: ['ver_datos', 'editar_datos'],
  },
  datos: {
    nombre: 'Equipo de datos',
    descripcion: 'Administra el DWH: extracción, cálculo, cubos y actualización de Power BI.',
    permisos: ['ver_datos', 'editar_datos', 'ver_dwh_interno', 'ver_consumo', 'operar_dwh', 'ver_powerbi', 'actualizar_powerbi', 'medir'],
  },
  gerencia: {
    nombre: 'Gerencia (sólo lectura)',
    descripcion: 'Consulta los tableros publicados y las capas de consumo, con permisos de sólo lectura.',
    permisos: ['ver_consumo', 'ver_powerbi'],
  },
};

export const CUENTAS_INICIALES = [
  { id: 'c1', usuario: 'ana.operadora', nombre: 'Ana Pereyra', perfil: 'operador' },
  { id: 'c2', usuario: 'luis.datos', nombre: 'Luis Herrera', perfil: 'datos' },
  { id: 'c3', usuario: 'gerencia.comercial', nombre: 'Gerencia Comercial', perfil: 'gerencia' },
];

// Quita tildes y pasa a minúsculas: sirve para comparar textos cargados a mano.
export function sinTildes(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

// Regla de depuración de la capa de cálculo: lleva una región escrita a mano
// (' norte', 'REGION NORTE', 'Región Norte') a su valor canónico ('Norte').
export function normalizarRegion(valor) {
  const limpio = sinTildes(valor).replace(/\s+/g, ' ').trim().replace(/^region /, '');
  const encontrada = REGIONES.find((r) => sinTildes(r) === limpio);
  return encontrada ?? 'Sin asignar';
}

export function normalizarSegmento(valor) {
  const limpio = sinTildes(valor).replace(/\s+/g, ' ').trim();
  const encontrado = SEGMENTOS.find((s) => sinTildes(s) === limpio);
  return encontrado ?? 'Sin asignar';
}

export function normalizarEstadoUsuario(valor) {
  const limpio = sinTildes(valor).trim();
  if (['activo', 'activa', 'alta', 'si', 'vigente'].includes(limpio)) return 'activo';
  if (['baja', 'inactivo', 'inactiva', 'no'].includes(limpio)) return 'baja';
  return null;
}
