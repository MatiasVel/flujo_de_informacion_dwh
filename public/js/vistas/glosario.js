// Glosario de términos y SQL de referencia.

import { esc } from '../ui/dom.js';
import { banda, bloqueCodigo } from '../ui/componentes.js';
import { SQL_REFERENCIA } from '../motor/sql.js';

export const titulo = 'Glosario';

const TERMINOS = [
  ['Base de datos transaccional (OLTP)', 'Base donde los sistemas de gestión registran la operación diaria. Está optimizada para muchas escrituras chicas, no para análisis sobre grandes volúmenes.'],
  ['Data Warehouse (DWH)', 'Repositorio orientado al análisis que integra, depura y organiza los datos de los sistemas operativos, separado de la base transaccional.'],
  ['ETL', 'Extracción, transformación y carga: el proceso que lleva los datos del origen al DWH y los prepara para su consumo.'],
  ['Esquema', 'Espacio de nombres dentro de una base de datos que agrupa tablas, vistas y funciones. El DWH usa un esquema por capa.'],
  ['Tabla foránea', 'Objeto que se consulta como una tabla local pero no guarda datos: cada consulta viaja al servidor remoto a través de un foreign data wrapper.'],
  ['Foreign data wrapper (postgres_fdw)', 'Extensión de PostgreSQL que permite conectarse a otro servidor y declarar sus tablas como tablas foráneas.'],
  ['Vista', 'Consulta guardada con nombre. Cada vez que se la invoca vuelve a ejecutar su consulta.'],
  ['Vista materializada', 'Vista cuyo resultado se guarda físicamente. Hay que actualizarla con REFRESH MATERIALIZED VIEW para que refleje los cambios del origen.'],
  ['REFRESH MATERIALIZED VIEW', 'Recalcula por completo una vista materializada. Con CONCURRENTLY permite seguir leyéndola mientras se actualiza, pero exige un índice único.'],
  ['Capa de extracción', 'Copia local de los datos de origen: tablas foráneas y sus vistas materializadas. No la consumen los usuarios finales.'],
  ['Capa de cálculo', 'Tablas intermedias con depuración, cruces y reglas de negocio necesarias para formar los cubos. Uso interno del equipo de datos.'],
  ['Capas de consumo', 'Agregada (cubos, pocas filas, para Excel o Power BI) y de detalle (alto volumen, para Power BI). Son las únicas que ven los usuarios finales.'],
  ['Cubo', 'Tabla de resultados pre-procesados con una granularidad definida, por ejemplo mes × región, con medidas ya calculadas.'],
  ['Granularidad', 'Nivel de detalle de una tabla: qué representa cada fila. Más dimensiones implican más filas y menos agregación.'],
  ['Consulta de definición', 'Consulta almacenada en la base que entrega a cada tablero exactamente el conjunto de datos que necesita. En el simulador, una función SQL.'],
  ['Orden de dependencias', 'Los cubos dependen del cálculo y el cálculo de la extracción: hay que actualizarlos en ese orden o el resultado queda desactualizado.'],
  ['Linaje', 'Rastro que permite saber de qué objetos sale un dato: de un cubo a la capa de cálculo y de ahí a la extracción.'],
  ['Latencia de los datos', 'Tiempo entre que un dato se carga en el origen y aparece en el tablero. En la organización estudiada es de un día.'],
  ['Carga completa', 'Cada actualización vuelve a leer todas las filas del origen. Es simple y la copia queda idéntica, pero su costo crece con el volumen.'],
  ['Carga incremental', 'Sólo se leen las filas nuevas o modificadas desde la última carga. Es más rápida, a costa de mayor complejidad.'],
  ['Marca de agua', 'Valor (por ejemplo, la fecha máxima ya copiada) que indica desde dónde leer en la próxima carga incremental.'],
  ['Conciliación', 'Control de calidad que compara cantidades y sumas entre el origen y la copia para detectar diferencias.'],
  ['Registro de ejecución', 'Tabla donde el proceso diario deja el resultado de cada paso (correcto, error u omitido) y se notifica al equipo.'],
  ['Modelo semántico', 'Modelo de datos de Power BI (antes llamado conjunto de datos) con tablas, relaciones y medidas sobre las que se arman los informes.'],
  ['Importación y DirectQuery', 'En importación, Power BI guarda una copia de los datos y la actualiza según un programa; en DirectQuery consulta la fuente en cada interacción.'],
  ['Gateway de datos local', 'Software que conecta Power BI Service, en la nube, con fuentes que están en la infraestructura propia de la organización.'],
  ['Power BI Desktop y Service', 'Desktop es la aplicación donde se desarrollan los informes; Service es la plataforma en la nube donde se publican en áreas de trabajo.'],
  ['Medida (DAX)', 'Cálculo definido en el modelo con el lenguaje DAX, que se evalúa según los filtros de cada visual.'],
  ['Power Query (M)', 'Herramienta y lenguaje de Power BI para conectarse a las fuentes y transformar los datos antes de cargarlos al modelo.'],
  ['Credenciales nominales', 'Usuario y contraseña personales para cada persona, en lugar de cuentas compartidas, para saber quién accede a qué.'],
];

const REFERENCIAS = [
  'Kimball, R., & Ross, M. (2013). The Data Warehouse Toolkit: The Definitive Guide to Dimensional Modeling (3ra ed.). Wiley.',
  'Inmon, W. H. (2005). Building the Data Warehouse (4ta ed.). Wiley.',
  'The PostgreSQL Global Development Group. Foreign Data. Documentación de PostgreSQL.',
  'The PostgreSQL Global Development Group. REFRESH MATERIALIZED VIEW. Documentación de PostgreSQL.',
  'Microsoft. What is an on-premises data gateway?',
  'Microsoft. Documentación oficial de Power BI.',
  'Gupta, A., & Mumick, I. S. (Eds.). (1999). Materialized Views: Techniques, Implementations, and Applications. MIT Press.',
  'Vassiliadis, P. (2009). A Survey of Extract-Transform-Load Technology. International Journal of Data Warehousing and Mining, 5(3), 1-27.',
  'Armbrust, M., Ghodsi, A., Xin, R., & Zaharia, M. (2021). Lakehouse: A New Generation of Open Platforms that Unify Data Warehousing and Advanced Analytics. CIDR.',
];

export function render(ctx) {
  return `
  ${banda({ titulo: 'Glosario y SQL de referencia', bajada: 'Los términos que usa el simulador y las sentencias de PostgreSQL que hay detrás de cada etapa.', estado: ctx.estado })}
  <div class="pagina">
    <section class="lamina">
      <div class="seccion-cabeza">
        <div><h2>Términos</h2><p>${TERMINOS.length} términos del flujo DWH → Power BI.</p></div>
        <div class="campo" style="min-width:260px"><label for="buscar-termino">Buscar un término</label><input id="buscar-termino" type="search" autocomplete="off"></div>
      </div>
      <dl class="glosario" id="lista-terminos">
        ${TERMINOS.map(([t, d]) => `<div class="termino" data-texto="${esc(`${t} ${d}`.toLowerCase())}"><dt>${esc(t)}</dt><dd>${esc(d)}</dd></div>`).join('')}
      </dl>
      <p class="muted" id="sin-terminos" hidden>No hay términos que coincidan con la búsqueda.</p>
    </section>

    <section class="bloque">
      <div class="seccion-cabeza"><div><h2>SQL de referencia</h2><p>Ejemplos genéricos y comentados. Los nombres de servidores, bases y usuarios son de ejemplo.</p></div></div>
      ${SQL_REFERENCIA.map((s) => `<details class="desplegable" id="sql-${esc(s.id)}" ${s.id === 'medir' || ctx.parametros.get('seccion') === `sql-${s.id}` ? 'open' : ''}><summary>${esc(s.titulo)}</summary><div class="contenido">${bloqueCodigo(s.sql)}</div></details>`).join('')}
    </section>

    <section class="bloque">
      <div class="seccion-cabeza"><div><h2>Referencias del paper</h2></div></div>
      <ol class="referencias">${REFERENCIAS.map((r) => `<li>${esc(r)}</li>`).join('')}</ol>
    </section>
  </div>`;
}

export function montar(raiz) {
  const input = raiz.querySelector('#buscar-termino');
  input?.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    let visibles = 0;
    raiz.querySelectorAll('.termino').forEach((t) => {
      const ok = !q || t.dataset.texto.includes(q);
      t.hidden = !ok;
      if (ok) visibles++;
    });
    raiz.querySelector('#sin-terminos').hidden = visibles > 0;
  });
}
