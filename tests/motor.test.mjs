// Pruebas del motor de simulación. Se ejecutan con: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { crearEscenarioInicial, simularDiaCompleto, ejecutarProcesoNocturno, actualizacionProgramadaPowerBI } from '../public/js/motor/escenario.js';
import {
  crearEstado, agregarUsuario, editarUsuario, eliminarUsuario, agregarOperacion, editarOperacion,
  cargarUsuariosDePrueba, importarUsuariosCSV, editarMeta, ErrorValidacion,
} from '../public/js/motor/estado.js';
import {
  estadoObjeto, refrescarObjeto, refrescarConDependencias, ejecutarProcesoDiario, ordenDeActualizacion,
  diferenciasPendientes, vistaPrevia, depurarOperaciones,
} from '../public/js/motor/dwh.js';
import {
  actualizarModelo, estadoModelo, consultarTablero, consultaSinDWH, consultaSobreDetalle, consultaSobreCubo, mismosResultados,
} from '../public/js/motor/powerbi.js';
import { leerCSV, validarUsuariosCSV, escribirCSV, PLANTILLA_USUARIOS } from '../public/js/motor/csv.js';
import { generarUsuarios, generarOperaciones } from '../public/js/motor/generador.js';
import { crearAleatorio } from '../public/js/motor/aleatorio.js';
import { validarCubo, calcularCubo } from '../public/js/motor/cubos.js';
import { resumir, experimentoIncremental, medirEscalabilidad, compararEstrategias, cargaSobreProduccion } from '../public/js/motor/rendimiento.js';
import { normalizarRegion } from '../public/js/motor/catalogos.js';
import { ultimosMeses, sumarMeses, normalizarFecha, avanzarHasta } from '../public/js/motor/fechas.js';

const FECHA = '2026-11-18';
const escenario = (opciones = {}) => crearEscenarioInicial({ fecha: FECHA, usuarios: 150, promedioOperaciones: 10, semilla: 7, ...opciones });
const codigo = (estado, id) => estadoObjeto(estado, id).codigo;

test('el escenario inicial deja todas las capas y el modelo actualizados', () => {
  const e = escenario();
  assert.ok(e.produccion.usuarios.length === 150);
  assert.ok(e.produccion.operaciones.length > 500);
  for (const id of ordenDeActualizacion(e)) assert.equal(codigo(e, id), 'actualizado', id);
  assert.equal(estadoModelo(e).codigo, 'actualizado');
  assert.equal(e.dwh.ejecuciones[0].estado, 'OK');
  assert.equal(e.reloj.minutos, 9 * 60);
});

test('el orden de actualización respeta las dependencias', () => {
  const e = escenario();
  const orden = ordenDeActualizacion(e);
  const pos = (id) => orden.indexOf(id);
  assert.ok(pos('extraccion.mv_operaciones') < pos('calculo.operaciones_depuradas'));
  assert.ok(pos('extraccion.mv_usuarios') < pos('calculo.operaciones_depuradas'));
  assert.ok(pos('calculo.operaciones_depuradas') < pos('consumo_agregado.cubo_mensual'));
  assert.ok(pos('calculo.usuarios_vigentes') < pos('consumo_agregado.cubo_usuarios_region'));
  assert.ok(!orden.includes('extraccion.ft_usuarios'), 'las tablas foráneas no se actualizan');
});

test('un cambio en producción se propaga capa por capa', () => {
  const e = escenario();
  const u = e.produccion.usuarios.find((x) => x.estado === 'activo');
  const nuevaRegion = u.region === 'Sur' ? 'Norte' : 'Sur';
  editarUsuario(e, u.id_usuario, { region: nuevaRegion });

  assert.equal(codigo(e, 'extraccion.mv_usuarios'), 'desactualizado');
  assert.equal(codigo(e, 'consumo_agregado.cubo_usuarios_region'), 'desactualizado');
  assert.equal(estadoModelo(e).motivo, 'dwh');
  assert.equal(diferenciasPendientes(e).usuarios.modificados, 1);

  refrescarObjeto(e, 'extraccion.mv_usuarios');
  assert.equal(codigo(e, 'extraccion.mv_usuarios'), 'actualizado');
  assert.equal(codigo(e, 'calculo.usuarios_vigentes'), 'desactualizado');
  assert.equal(diferenciasPendientes(e).usuarios.modificados, 0);

  ejecutarProcesoDiario(e, { tipo: 'bajo demanda' });
  assert.equal(codigo(e, 'consumo_agregado.cubo_usuarios_region'), 'actualizado');
  assert.equal(estadoModelo(e).motivo, 'modelo', 'el DWH ya está al día; falta actualizar Power BI');

  actualizarModelo(e);
  assert.equal(estadoModelo(e).codigo, 'actualizado');
  const vigente = e.dwh.datos['calculo.usuarios_vigentes'].find((x) => x.id_usuario === u.id_usuario);
  assert.equal(vigente.region, nuevaRegion);
});

test('actualizar fuera de orden no alcanza: el objeto sigue desactualizado', () => {
  const e = escenario();
  agregarOperacion(e, { id_usuario: 1, fecha: FECHA, tipo_servicio: 'MAN', importe: 30000, estado: 'confirmada' });
  refrescarObjeto(e, 'consumo_agregado.cubo_mensual');
  const est = estadoObjeto(e, 'consumo_agregado.cubo_mensual');
  assert.equal(est.codigo, 'desactualizado');
  assert.deepEqual(est.bloqueantes, ['calculo.operaciones_depuradas']);
  const pasos = refrescarConDependencias(e, 'consumo_agregado.cubo_mensual');
  assert.deepEqual(pasos.map((p) => p.id), ['extraccion.mv_operaciones', 'calculo.operaciones_depuradas', 'consumo_agregado.cubo_mensual']);
  assert.equal(codigo(e, 'consumo_agregado.cubo_mensual'), 'actualizado');
});

test('si el origen no responde, la extracción falla, los dependientes se omiten y se conserva la copia anterior', () => {
  const e = escenario();
  const filasAntes = e.dwh.datos['extraccion.mv_operaciones'].length;
  agregarOperacion(e, { id_usuario: 2, fecha: FECHA, tipo_servicio: 'INS', importe: 50000, estado: 'confirmada' });
  e.config.fallaOrigen = true;
  const { resumen, pasos } = ejecutarProcesoNocturno(e);
  assert.equal(resumen.estado, 'ERROR');
  assert.equal(pasos.find((p) => p.objeto === 'extraccion.mv_operaciones').estado, 'ERROR');
  assert.equal(pasos.find((p) => p.objeto === 'consumo_agregado.cubo_mensual').estado, 'OMITIDO');
  assert.equal(pasos.find((p) => p.objeto === 'control.conciliacion').estado, 'OMITIDO');
  assert.equal(e.dwh.datos['extraccion.mv_operaciones'].length, filasAntes);
  assert.equal(codigo(e, 'extraccion.mv_operaciones'), 'error');
  assert.match(e.dwh.notificaciones[0].texto, /errores/);
  e.config.fallaOrigen = false;
  assert.equal(ejecutarProcesoNocturno(e).resumen.estado, 'OK');
  assert.equal(e.dwh.datos['extraccion.mv_operaciones'].length, filasAntes + 1);
});

test('la carga incremental pierde una corrección retroactiva y el control de calidad lo detecta', () => {
  const e = escenario();
  e.config.modoExtraccion = 'incremental';
  const vieja = e.produccion.operaciones.find((o) => o.estado === 'confirmada' && o.fecha < '2026-10-01');
  const importeOriginal = vieja.importe;
  editarOperacion(e, vieja.id_operacion, { importe: importeOriginal + 1000 });
  agregarOperacion(e, { id_usuario: 3, fecha: FECHA, tipo_servicio: 'SOP', importe: 9000, estado: 'confirmada' });
  const { pasos } = ejecutarProcesoNocturno(e);
  const extraccion = pasos.find((p) => p.objeto === 'extraccion.mv_operaciones');
  assert.match(extraccion.detalle, /Incremental/);
  assert.equal(pasos.find((p) => p.objeto === 'control.conciliacion').estado, 'ADVERTENCIA');
  const copia = e.dwh.datos['extraccion.mv_operaciones'].find((o) => o.id_operacion === vieja.id_operacion);
  assert.equal(copia.importe, importeOriginal, 'la copia conserva el importe viejo');
  assert.equal(e.produccion.operaciones.find((o) => o.id_operacion === vieja.id_operacion).importe, importeOriginal + 1000);

  e.config.modoExtraccion = 'completa';
  const segunda = ejecutarProcesoNocturno(e);
  assert.equal(segunda.pasos.find((p) => p.objeto === 'control.conciliacion').estado, 'OK');
});

test('con el gateway caído, Power BI conserva los datos anteriores', () => {
  const e = escenario();
  const antes = e.powerbi.meta.actualizado;
  e.config.gatewayCaido = true;
  const r = actualizacionProgramadaPowerBI(e);
  assert.equal(r.estado, 'ERROR');
  assert.equal(e.powerbi.meta.actualizado, antes);
  assert.ok(e.powerbi.ultimoError);
});

test('la planilla de metas llega a Power BI sin pasar por el DWH', () => {
  const e = escenario();
  editarMeta(e, 'Norte', 999000);
  const est = estadoModelo(e);
  assert.equal(est.codigo, 'desactualizado');
  assert.equal(est.motivo, 'repositorio');
  for (const id of ordenDeActualizacion(e)) assert.equal(codigo(e, id), 'actualizado');
  actualizarModelo(e);
  assert.equal(e.powerbi.modelo.metas.find((m) => m.region === 'Norte').meta_mensual, 999000);
});

test('la capa de cálculo depura valores cargados a mano', () => {
  assert.equal(normalizarRegion(' norte '), 'Norte');
  assert.equal(normalizarRegion('REGION SUR'), 'Sur');
  assert.equal(normalizarRegion('Región Este'), 'Este');
  assert.equal(normalizarRegion('Atlántida'), 'Sin asignar');
  const r = depurarOperaciones(
    [
      { id_operacion: 1, id_usuario: 1, fecha: '2026-11-01', tipo_servicio: 'INS', importe: 100, estado: 'confirmada' },
      { id_operacion: 2, id_usuario: 1, fecha: '2026-11-02', tipo_servicio: 'INS', importe: 100, estado: 'anulada' },
      { id_operacion: 3, id_usuario: 9, fecha: '2026-11-02', tipo_servicio: 'INS', importe: 100, estado: 'confirmada' },
      { id_operacion: 4, id_usuario: 1, fecha: '2026-11-03', tipo_servicio: 'INS', importe: 0, estado: 'confirmada' },
    ],
    [{ id_usuario: 1, region: ' norte', segmento: 'comercial', estado: 'activo' }],
  );
  assert.equal(r.filas.length, 1);
  assert.equal(r.filas[0].region, 'Norte');
  assert.equal(r.filas[0].segmento, 'Comercial');
  assert.equal(r.filas[0].mes, '2026-11-01');
  assert.deepEqual(
    [r.detalle.descartadas_anuladas, r.detalle.descartadas_sin_usuario, r.detalle.descartadas_importe, r.detalle.usuarios_corregidos],
    [1, 1, 1, 1],
  );
});

test('las tres estrategias de consulta devuelven el mismo resultado', () => {
  const e = escenario();
  const desde = ultimosMeses(e.reloj.fecha, 12)[0];
  const a = consultaSinDWH(e.produccion, { desde });
  const b = consultaSobreDetalle(e.dwh.datos['consumo_detalle.operaciones_detalle'], { desde });
  const c = consultaSobreCubo(e.dwh.datos['consumo_agregado.cubo_mensual'], { desde });
  assert.ok(a.size > 10);
  assert.ok(mismosResultados(a, b));
  assert.ok(mismosResultados(a, c));
});

test('el tablero suma lo mismo que el cubo y calcula el cumplimiento de la meta', () => {
  const e = escenario();
  const t = consultarTablero(e.powerbi.modelo, { meses: 12 });
  const desde = ultimosMeses(e.powerbi.modelo.fechaReferencia, 12)[0];
  const esperado = e.dwh.datos['consumo_agregado.cubo_mensual'].filter((f) => f.mes >= desde).reduce((s, f) => s + f.importe_total, 0);
  assert.ok(Math.abs(t.kpis.importe - esperado) < 0.01);
  assert.equal(t.porMes.length, 12);
  assert.ok(t.kpis.cumplimiento > 0.5 && t.kpis.cumplimiento < 1.5);
  const porSegmento = consultarTablero(e.powerbi.modelo, { meses: 12, segmento: 'Comercial' });
  assert.equal(porSegmento.kpis.cumplimiento, null, 'la meta es por región: no se reparte por segmento');
  const norte = consultarTablero(e.powerbi.modelo, { meses: 3, region: 'Norte' });
  assert.ok(norte.porRegion.every((r) => r.region === 'Norte' || r.importe === 0));
});

test('las validaciones imitan las restricciones de la base transaccional', () => {
  const e = crearEstado({ fecha: FECHA });
  assert.throws(() => agregarUsuario(e, { nombre: '', email: 'x', region: '', segmento: '', estado: 'raro', fecha_alta: '2030-01-01' }), ErrorValidacion);
  const u = agregarUsuario(e, { nombre: 'Prueba Uno', email: 'prueba@ejemplo.test', region: 'Norte', segmento: 'Residencial', estado: 'activo', fecha_alta: FECHA });
  assert.equal(u.id_usuario, 1);
  assert.throws(() => agregarOperacion(e, { id_usuario: 99, fecha: FECHA, tipo_servicio: 'MAN', importe: 10 }), /clave foránea/);
  agregarOperacion(e, { id_usuario: 1, fecha: FECHA, tipo_servicio: 'MAN', importe: '1500,50', estado: 'confirmada' });
  assert.equal(e.produccion.operaciones[0].importe, 1500.5);
  assert.throws(() => eliminarUsuario(e, 1), /clave foránea/);
  const v = agregarUsuario(e, { nombre: 'Prueba Dos', email: 'dos@ejemplo.test', region: 'Sur', segmento: 'Comercial', estado: 'activo', fecha_alta: FECHA });
  eliminarUsuario(e, v.id_usuario);
  assert.equal(e.produccion.usuarios.length, 1);
});

test('los datos de prueba son reproducibles con la misma semilla', () => {
  const a = generarUsuarios({ cantidad: 20, fechaFin: FECHA, aleatorio: crearAleatorio(5) });
  const b = generarUsuarios({ cantidad: 20, fechaFin: FECHA, aleatorio: crearAleatorio(5) });
  assert.deepEqual(a, b);
  const ops = generarOperaciones({ usuarios: a, promedioPorUsuario: 8, fechaFin: FECHA, aleatorio: crearAleatorio(5) });
  assert.ok(ops.every((o, i) => o.id_operacion === i + 1));
  assert.ok(ops.every((o) => o.fecha <= FECHA));
});

test('la carga masiva respeta los límites', () => {
  const e = crearEstado({ fecha: FECHA });
  assert.throws(() => cargarUsuariosDePrueba(e, { usuarios: 0 }), ErrorValidacion);
  assert.throws(() => cargarUsuariosDePrueba(e, { usuarios: 25000, promedioOperaciones: 60 }), /admite hasta/);
  const r = cargarUsuariosDePrueba(e, { usuarios: 50, promedioOperaciones: 5, semilla: 1 });
  assert.equal(r.usuarios, 50);
  assert.equal(e.produccion.versiones.usuarios, 1);
});

test('CSV: separadores, comillas y validación por línea', () => {
  const coma = leerCSV('nombre,email\n"Pérez, Juan",juan@ejemplo.test\n');
  assert.equal(coma.separador, ',');
  assert.deepEqual(coma.filas[1], ['Pérez, Juan', 'juan@ejemplo.test']);
  const pc = leerCSV('a;b\r\n"dice ""hola""";2\r\n');
  assert.equal(pc.separador, ';');
  assert.equal(pc.filas[1][0], 'dice "hola"');
  const { validos, errores } = validarUsuariosCSV(PLANTILLA_USUARIOS + 'Sin Email;;Norte;Residencial;activo;2025-01-01\r\n');
  assert.equal(validos.length, 3);
  assert.equal(errores.length, 1);
  assert.match(errores[0].mensaje, /email/);
  assert.equal(validos[1].region, ' norte', 'la región se guarda como la escribió el operador');
  const e = crearEstado({ fecha: FECHA });
  assert.equal(importarUsuariosCSV(e, PLANTILLA_USUARIOS).agregados.length, 3);
  assert.equal(escribirCSV([{ a: 'x;y' }], ['a']).trim(), 'a\r\n"x;y"');
});

test('laboratorio de cubos: reutilizar antes de extraer', () => {
  const e = escenario();
  assert.ok(validarCubo({ nombre: 'cubo_region_mes', dimensiones: ['region', 'mes'], medidas: ['importe_total'] }, []).length === 0);
  assert.match(validarCubo({ nombre: 'cubo_canal', dimensiones: ['canal'], medidas: ['cantidad'] }, []).join(' '), /No se puede reutilizar/);
  assert.match(validarCubo({ nombre: 'malo', dimensiones: ['mes'], medidas: ['cantidad'] }, []).join(' '), /cubo_/);
  const spec = { nombre: 'cubo_region_mes', dimensiones: ['region', 'mes'], medidas: ['cantidad', 'importe_total', 'usuarios_distintos'] };
  e.dwh.cubosUsuario.push(spec);
  assert.ok(ordenDeActualizacion(e).includes('consumo_agregado.cubo_region_mes'));
  refrescarObjeto(e, 'consumo_agregado.cubo_region_mes');
  const filas = e.dwh.datos['consumo_agregado.cubo_region_mes'];
  const total = filas.reduce((s, f) => s + f.cantidad, 0);
  assert.equal(total, e.dwh.datos['calculo.operaciones_depuradas'].length);
  assert.equal(codigo(e, 'consumo_agregado.cubo_region_mes'), 'actualizado');
  const anual = calcularCubo({ nombre: 'cubo_x', dimensiones: ['anio'], medidas: ['cantidad'] }, e.dwh.datos['calculo.operaciones_depuradas']);
  assert.ok(anual.every((f) => /^\d{4}$/.test(f.anio)));
});

test('la vista previa de una tabla foránea consulta al origen', () => {
  const e = escenario();
  const antes = e.produccion.consultasAnaliticas.total;
  const v = vistaPrevia(e, 'extraccion.ft_usuarios', 5);
  assert.equal(v.filas.length, 5);
  assert.ok(v.consultoOrigen);
  assert.equal(e.produccion.consultasAnaliticas.total, antes + 1);
  assert.ok(!v.columnas.includes('_v'));
});

test('un día completo avanza el reloj y deja todo actualizado', () => {
  const e = escenario();
  const ops = e.produccion.operaciones.length;
  const r = simularDiaCompleto(e);
  assert.equal(e.reloj.fecha, '2026-11-19');
  assert.equal(e.reloj.minutos, 9 * 60);
  assert.ok(e.produccion.operaciones.length > ops);
  assert.equal(r.proceso.resumen.estado, 'OK');
  assert.equal(r.powerbi.estado, 'OK');
  assert.equal(estadoModelo(e).codigo, 'actualizado');
  assert.equal(e.powerbi.modelo.datosAl, '2026-11-19 02:00');
});

test('mediciones: resumen estadístico, experimento incremental y escalabilidad', async () => {
  const r = resumir([5, 1, 3, 2, 4]);
  assert.equal(r.mediana, 3);
  assert.equal(r.min, 1);
  assert.equal(r.max, 5);
  const exp = experimentoIncremental({ filas: 4000, fechaFin: FECHA });
  assert.ok(exp.completa.diferencias.coincide);
  assert.ok(!exp.incremental.diferencias.coincide);
  assert.equal(exp.incremental.diferencias.filas, -1, 'la copia tiene una fila de más: la eliminada en el origen');
  assert.ok(exp.incremental.escritas < exp.completa.escritas);
  const esc = await medirEscalabilidad({ volumenes: [2000, 4000], repeticiones: 2, fechaFin: FECHA });
  assert.equal(esc.puntos.length, 2);
  assert.ok(esc.puntos.every((p) => p.consultaDetalle.mediana >= 0 && p.filasCubo > 0));
  const e = escenario();
  const comp = await compararEstrategias(e, { repeticiones: 2 });
  assert.equal(comp.resultados.length, 3);
  assert.ok(comp.coinciden);
  assert.ok(comp.resultados[2].filasModelo < comp.resultados[1].filasModelo);
  const carga = cargaSobreProduccion({ gerentes: 10, interacciones: 20, visuales: 5, msConsulta: 2 });
  assert.equal(carga.sinDWH, 1000);
  assert.equal(carga.msSinDWH, 2000);
});

test('fechas: meses, normalización y reloj', () => {
  assert.equal(sumarMeses('2026-01-01', -1), '2025-12-01');
  assert.deepEqual(ultimosMeses('2026-03-15', 3), ['2026-01-01', '2026-02-01', '2026-03-01']);
  assert.equal(normalizarFecha('05/03/2025'), '2025-03-05');
  assert.equal(normalizarFecha('31/02/2025'), null);
  assert.deepEqual(avanzarHasta({ fecha: '2026-11-18', minutos: 600 }, 120), { fecha: '2026-11-19', minutos: 120 });
  assert.deepEqual(avanzarHasta({ fecha: '2026-11-18', minutos: 60 }, 120), { fecha: '2026-11-18', minutos: 120 });
});
