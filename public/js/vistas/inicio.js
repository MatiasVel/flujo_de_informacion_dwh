// Inicio: presentación del flujo, alcance del simulador y estado actual.

import { esc, fmt, aviso } from '../ui/dom.js';
import { chip, codigoDeFondo, textoReloj } from '../ui/componentes.js';
import { diferenciasPendientes } from '../motor/dwh.js';
import { estadoModelo } from '../motor/powerbi.js';
import { simularDiaCompleto } from '../motor/escenario.js';
import { formatoMarca } from '../motor/fechas.js';

export const titulo = 'Inicio';

const ETAPAS = [
  { titulo: 'Registro operativo', texto: 'Los operadores cargan a mano los datos del día en los sistemas de gestión; quedan en la base transaccional.', enlace: '#/datos', accion: 'Cargar usuarios de prueba' },
  { titulo: 'Extracción', texto: 'Una vez al día, el servidor del DWH lee el origen con tablas foráneas y guarda una copia local.', enlace: '#/dwh', accion: 'Ver la capa de extracción' },
  { titulo: 'Transformación', texto: 'Con SQL se limpian, cruzan y agregan los datos, generando cálculos intermedios.', enlace: '#/dwh', accion: 'Ver la capa de cálculo' },
  { titulo: 'Presentación', texto: 'Los resultados se exponen como cubos y tablas de consumo, con distinto nivel de detalle.', enlace: '#/dwh', accion: 'Ver cubos y detalle' },
  { titulo: 'Consumo y distribución', texto: 'Power BI arma el modelo y los tableros, que se publican en la nube y llegan a las gerencias.', enlace: '#/powerbi', accion: 'Abrir el tablero' },
];

const VENTAJAS = [
  { titulo: 'Protección de la operación', texto: 'La base transaccional se consulta una sola vez por día: el análisis no compite con la carga de datos.', enlace: '#/rendimiento?seccion=proteccion', accion: 'Contar las consultas que recibe producción' },
  { titulo: 'Rendimiento en Power BI', texto: 'Al procesar en la base de datos, los modelos son más livianos y se actualizan más rápido.', enlace: '#/rendimiento?seccion=estrategias', accion: 'Comparar las tres estrategias' },
  { titulo: 'Consistencia de los indicadores', texto: 'La lógica de negocio se define una vez en los cubos y todos los tableros usan las mismas cifras.', enlace: '#/rendimiento?seccion=estrategias', accion: 'Verificar que den el mismo resultado' },
  { titulo: 'Escalabilidad', texto: 'Con la misma estructura de capas, un requerimiento nuevo se atiende agregando un cubo.', enlace: '#/dwh?pestana=laboratorio', accion: 'Crear un cubo en el laboratorio' },
  { titulo: 'Control del proceso', texto: 'El registro de ejecución diario muestra el resultado de cada paso y permite actuar ante una falla.', enlace: '#/dwh?pestana=registro', accion: 'Revisar el registro de ejecución' },
  { titulo: 'Acceso simple y controlado', texto: 'Los usuarios finales sólo ven información procesada, en las capas de consumo, con permisos de sólo lectura.', enlace: '#/arquitectura?seccion=accesos', accion: 'Probar los perfiles de acceso' },
];

export function render(ctx) {
  const e = ctx.estado;
  const dif = diferenciasPendientes(e);
  const pendientes = dif.usuarios.total + dif.operaciones.total;
  const ultimo = e.dwh.ejecuciones[0];
  const modelo = estadoModelo(e);
  const puedeOperar = ctx.puede('operar_dwh');

  return `
  <section class="hero">
    ${codigoDeFondo()}
    <div class="hero-interior">
      <h1>Del registro operativo al tablero de decisión</h1>
      <p>Simulador del flujo de información de un Data Warehouse en PostgreSQL integrado con Power BI. Cargá datos, ejecutá el proceso diario, seguí cada cambio hasta el tablero y medí cuánto tarda cada etapa.</p>
    </div>
  </section>

  <div class="inicio-grilla">
    <section class="lamina" aria-labelledby="como-usar">
      <h2 class="lamina-titulo" id="como-usar">Cómo usar el simulador</h2>
      <h3 class="lamina-subtitulo">Alcance</h3>
      <ol class="alcance">
        <li><a href="#/datos">Cargar usuarios de prueba</a> en la base transaccional, como lo harían los operadores.<span>Generador con semilla, alta manual o importación desde un CSV.</span></li>
        <li><a href="#/dwh">Ejecutar el proceso diario</a> del DWH: extracción, cálculo y consumo.<span>Con registro de ejecución, control de calidad y simulación de fallas.</span></li>
        <li><a href="#/powerbi">Consultar el tablero de Power BI</a> con los datos al cierre del proceso.<span>Modelo en modo importación, actualizado a través del gateway.</span></li>
        <li><a href="#/cambios">Editar un dato y seguirlo</a> capa por capa hasta el tablero.<span>Muestra por qué un cambio no aparece enseguida en Power BI.</span></li>
        <li><a href="#/rendimiento">Medir el rendimiento</a> y comparar dónde conviene procesar.<span>Consulta directa a producción, detalle en Power BI o cubo en el DWH.</span></li>
      </ol>
    </section>

    <aside class="panel-estado" aria-labelledby="estado-titulo">
      <h2 id="estado-titulo">Estado actual</h2>
      <dl>
        <div><dt>Fecha y hora simuladas</dt><dd>${esc(textoReloj(e.reloj))}</dd></div>
        <div><dt>Base transaccional</dt><dd>${fmt.entero(e.produccion.usuarios.length)} usuarios y ${fmt.entero(e.produccion.operaciones.length)} operaciones</dd></div>
        <div><dt>Cambios que todavía no llegaron al DWH</dt><dd>${fmt.entero(pendientes)}</dd></div>
        <div><dt>Último proceso diario</dt><dd>${ultimo ? `#${ultimo.id}, ${esc(formatoMarca(ultimo.inicio))} ${chip(ultimo.estado)}` : 'Todavía no se ejecutó'}</dd></div>
        <div><dt>Tablero de Power BI</dt><dd>${chip(modelo.codigo)}</dd></div>
      </dl>
      <div class="acciones">
        ${puedeOperar ? '<button type="button" class="boton claro" data-accion="dia">Simular un día completo</button>' : ''}
        <a class="boton contorno-claro" href="#/arquitectura">Ver la arquitectura</a>
      </div>
    </aside>
  </div>

  <div class="pagina">
    <section class="bloque" aria-labelledby="etapas-titulo">
      <div class="seccion-cabeza">
        <div>
          <h2 id="etapas-titulo">El flujo en cinco etapas</h2>
          <p>El servidor de producción atiende la operación y el servidor del DWH atiende las consultas analíticas: así el análisis nunca compite con la operación diaria.</p>
        </div>
      </div>
      <ol class="etapas">
        ${ETAPAS.map((x) => `<li><h3>${esc(x.titulo)}</h3><p>${esc(x.texto)}</p><a href="${x.enlace}">${esc(x.accion)}</a></li>`).join('')}
      </ol>
      <p class="complementaria">Fuente complementaria: un repositorio institucional de archivos con planillas de las áreas (en el simulador, la planilla de metas). No pasa por el DWH: se integra directamente en el modelo de Power BI.</p>
    </section>

    <section class="bloque" aria-labelledby="ventajas-titulo">
      <div class="seccion-cabeza">
        <div>
          <h2 id="ventajas-titulo">Ventajas que se pueden comprobar</h2>
          <p>Las seis ventajas que identifica el paper y dónde verlas funcionando en el simulador.</p>
        </div>
      </div>
      <div class="ventajas">
        ${VENTAJAS.map((v) => `<div class="ventaja"><h3>${esc(v.titulo)}</h3><p>${esc(v.texto)}</p><a href="${v.enlace}">${esc(v.accion)}</a></div>`).join('')}
      </div>
    </section>
  </div>`;
}

export function montar(raiz, ctx) {
  raiz.addEventListener('click', (ev) => {
    const boton = ev.target.closest('[data-accion="dia"]');
    if (!boton) return;
    const r = ctx.cambiar((e) => simularDiaCompleto(e));
    const j = r.jornada;
    aviso(
      `Día simulado: ${j.operacionesNuevas} operaciones y ${j.usuariosNuevos} altas cargadas; proceso #${r.proceso.resumen.id} ${r.proceso.resumen.estado === 'OK' ? 'sin errores' : 'con problemas'}; Power BI ${r.powerbi.estado === 'OK' ? 'actualizado' : 'sin actualizar'}.`,
      r.proceso.resumen.estado === 'OK' && r.powerbi.estado === 'OK' ? 'ok' : 'aviso',
    );
  });
}
