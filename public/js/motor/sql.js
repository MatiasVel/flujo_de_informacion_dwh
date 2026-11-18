// Definiciones SQL (PostgreSQL) de cada objeto del DWH simulado.
// Son genéricas y comentadas con fines didácticos: no reproducen la estructura de ninguna organización real.

export const SQL_OBJETOS = {
  'extraccion.ft_usuarios': `-- Tabla foránea: se consulta como una tabla local, pero NO guarda datos.
-- Cada SELECT viaja al servidor de producción a través del foreign data wrapper (postgres_fdw).
CREATE FOREIGN TABLE extraccion.ft_usuarios (
    id_usuario   integer,
    nombre       text,
    email        text,
    region       text,
    segmento     text,
    estado       text,
    fecha_alta   date
)
SERVER srv_produccion                      -- servidor remoto declarado con CREATE SERVER
OPTIONS (schema_name 'public', table_name 'usuarios');`,

  'extraccion.ft_operaciones': `-- Tabla foránea sobre la tabla de operaciones del origen.
-- Consultarla muchas veces cargaría al servidor de producción: por eso se copia una vez por día.
CREATE FOREIGN TABLE extraccion.ft_operaciones (
    id_operacion   integer,
    id_usuario     integer,
    fecha          date,
    tipo_servicio  text,
    importe        numeric(12,2),
    estado         text
)
SERVER srv_produccion
OPTIONS (schema_name 'public', table_name 'operaciones');`,

  'extraccion.mv_usuarios': `-- Copia local completa de la tabla foránea.
-- La vista materializada guarda físicamente el resultado en el servidor del DWH.
CREATE MATERIALIZED VIEW extraccion.mv_usuarios AS
SELECT *
FROM extraccion.ft_usuarios;

-- Sincronización diaria (o bajo demanda): vuelve a leer el origen y reemplaza la copia.
REFRESH MATERIALIZED VIEW extraccion.mv_usuarios;`,

  'extraccion.mv_operaciones': `-- Copia local completa de las operaciones: el origen se consulta una sola vez por día.
CREATE MATERIALIZED VIEW extraccion.mv_operaciones AS
SELECT *
FROM extraccion.ft_operaciones;

REFRESH MATERIALIZED VIEW extraccion.mv_operaciones;

-- Alternativa evaluada (trabajo futuro del paper): carga incremental por fecha.
-- PostgreSQL no refresca vistas materializadas de forma incremental, así que se usa
-- una tabla local que sólo recibe las filas desde la última "marca de agua".
INSERT INTO extraccion.t_operaciones AS t
SELECT f.*
FROM extraccion.ft_operaciones f
WHERE f.fecha >= (SELECT max(fecha) FROM extraccion.t_operaciones)   -- el filtro se ejecuta en el origen
ON CONFLICT (id_operacion) DO UPDATE                                  -- requiere clave primaria
SET importe = EXCLUDED.importe,
    estado  = EXCLUDED.estado;
-- Riesgo: una corrección sobre una fila con fecha anterior a la marca no se vuelve a leer.`,

  'calculo.operaciones_depuradas': `-- Capa de cálculo: depuración y cruce de tablas, todo en SQL dentro del DWH.
CREATE MATERIALIZED VIEW calculo.operaciones_depuradas AS
SELECT
    o.id_operacion,
    o.id_usuario,
    o.fecha,
    date_trunc('month', o.fecha)::date        AS mes,         -- granularidad mensual
    calculo.normalizar_region(u.region)       AS region,      -- ' norte' -> 'Norte'
    calculo.normalizar_segmento(u.segmento)   AS segmento,
    o.tipo_servicio,
    o.importe
FROM extraccion.mv_operaciones o
JOIN extraccion.mv_usuarios    u ON u.id_usuario = o.id_usuario   -- descarta operaciones sin usuario
WHERE o.estado = 'confirmada'                                     -- regla de negocio: sin anuladas
  AND o.importe > 0;                                              -- descarta importes inválidos`,

  'calculo.usuarios_vigentes': `-- Usuarios activos con sus atributos ya depurados.
CREATE MATERIALIZED VIEW calculo.usuarios_vigentes AS
SELECT
    u.id_usuario,
    calculo.normalizar_region(u.region)     AS region,
    calculo.normalizar_segmento(u.segmento) AS segmento,
    u.fecha_alta,
    current_date - u.fecha_alta              AS antiguedad_dias
FROM extraccion.mv_usuarios u
WHERE lower(trim(u.estado)) = 'activo';`,

  'consumo_agregado.cubo_mensual': `-- Cubo agregado: granularidad mes × región × segmento × tipo de servicio.
-- Tiene muchas menos filas que el detalle y es apto para Excel o Power BI.
CREATE MATERIALIZED VIEW consumo_agregado.cubo_mensual AS
SELECT
    mes,                                  -- dimensiones (definen la granularidad)
    region,
    segmento,
    tipo_servicio,
    count(*)      AS cantidad,            -- medidas pre-calculadas
    sum(importe)  AS importe_total
FROM calculo.operaciones_depuradas
GROUP BY mes, region, segmento, tipo_servicio;`,

  'consumo_agregado.cubo_usuarios_region': `-- Cubo de usuarios vigentes por región y segmento.
CREATE MATERIALIZED VIEW consumo_agregado.cubo_usuarios_region AS
SELECT
    region,
    segmento,
    count(*)                                       AS usuarios_vigentes,
    count(*) FILTER (WHERE antiguedad_dias <= 30)  AS altas_30_dias
FROM calculo.usuarios_vigentes
GROUP BY region, segmento;`,

  'consumo_detalle.operaciones_detalle': `-- Consumo de detalle: una fila por operación, para análisis finos en Power BI.
CREATE MATERIALIZED VIEW consumo_detalle.operaciones_detalle AS
SELECT
    d.id_operacion,
    d.fecha,
    d.mes,
    d.id_usuario,
    d.region,
    d.segmento,
    d.tipo_servicio,
    t.nombre AS nombre_servicio,           -- atributo descriptivo para los visuales
    d.importe
FROM calculo.operaciones_depuradas d
JOIN calculo.tipos_servicio t USING (tipo_servicio);`,

  'consumo_agregado.fn_tablero_gerencial': `-- Consulta de definición: entrega al tablero exactamente los datos que necesita.
-- Power BI la invoca con una consulta nativa; no almacena datos.
CREATE OR REPLACE FUNCTION consumo_agregado.fn_tablero_gerencial(p_meses integer DEFAULT 12)
RETURNS TABLE (
    mes            date,
    region         text,
    segmento       text,
    tipo_servicio  text,
    cantidad       bigint,
    importe_total  numeric
)
LANGUAGE sql STABLE
AS $$
    SELECT c.mes, c.region, c.segmento, c.tipo_servicio, c.cantidad, c.importe_total
    FROM consumo_agregado.cubo_mensual c
    WHERE c.mes >= date_trunc('month', current_date)::date
                   - make_interval(months => p_meses - 1)      -- últimos N meses
$$;

-- Uso desde Power BI (consulta nativa):
SELECT * FROM consumo_agregado.fn_tablero_gerencial(12);`,
};

export const SQL_REFERENCIA = [
  {
    id: 'fdw',
    titulo: 'Conectar el DWH con el servidor de producción (postgres_fdw)',
    sql: `-- Se ejecuta una sola vez en el servidor del DWH.
CREATE EXTENSION IF NOT EXISTS postgres_fdw;

-- Servidor remoto: datos de conexión del origen (valores de ejemplo).
CREATE SERVER srv_produccion
    FOREIGN DATA WRAPPER postgres_fdw
    OPTIONS (host 'servidor-produccion', port '5432', dbname 'bd_operativa');

-- Usuario de sólo lectura en el origen; la contraseña nunca va en el código versionado.
CREATE USER MAPPING FOR rol_etl
    SERVER srv_produccion
    OPTIONS (user 'lector_dwh', password '********');

-- Importa de una vez la definición de varias tablas como tablas foráneas.
IMPORT FOREIGN SCHEMA public
    LIMIT TO (usuarios, operaciones)
    FROM SERVER srv_produccion
    INTO extraccion;`,
  },
  {
    id: 'esquemas',
    titulo: 'Capas como esquemas y permisos de sólo lectura',
    sql: `-- Un esquema por capa (la organización repite esta estructura por unidad de negocio).
CREATE SCHEMA extraccion;
CREATE SCHEMA calculo;
CREATE SCHEMA consumo_agregado;
CREATE SCHEMA consumo_detalle;

-- Los usuarios finales sólo leen las capas de consumo.
CREATE ROLE rol_lectura_consumo NOLOGIN;
GRANT USAGE  ON SCHEMA consumo_agregado, consumo_detalle TO rol_lectura_consumo;
GRANT SELECT ON ALL TABLES IN SCHEMA consumo_agregado, consumo_detalle TO rol_lectura_consumo;

-- Credencial nominal de un usuario de gerencia, que hereda el rol de lectura.
CREATE ROLE gerencia_comercial LOGIN IN ROLE rol_lectura_consumo;`,
  },
  {
    id: 'registro',
    titulo: 'Registro de ejecución y proceso diario',
    sql: `-- Tabla donde el proceso deja constancia de cada paso.
CREATE TABLE control.registro_ejecucion (
    id_ejecucion  bigint,
    paso          integer,
    objeto        text,
    inicio        timestamptz,
    fin           timestamptz,
    filas         bigint,
    estado        text,        -- OK | ERROR | OMITIDO | ADVERTENCIA
    detalle       text
);

-- Procedimiento que actualiza los objetos respetando el orden de dependencias.
CREATE OR REPLACE PROCEDURE control.proceso_diario(p_id bigint)
LANGUAGE plpgsql
AS $$
DECLARE
    v_objetos text[] := ARRAY[
        'extraccion.mv_usuarios', 'extraccion.mv_operaciones',          -- 1) extracción
        'calculo.usuarios_vigentes', 'calculo.operaciones_depuradas',   -- 2) cálculo
        'consumo_agregado.cubo_mensual',                                -- 3) consumo
        'consumo_agregado.cubo_usuarios_region',
        'consumo_detalle.operaciones_detalle'];
    v_obj    text;
    v_paso   integer := 0;
    v_inicio timestamptz;
BEGIN
    FOREACH v_obj IN ARRAY v_objetos LOOP
        v_paso   := v_paso + 1;
        v_inicio := clock_timestamp();
        BEGIN
            EXECUTE format('REFRESH MATERIALIZED VIEW %s', v_obj);
            INSERT INTO control.registro_ejecucion
            VALUES (p_id, v_paso, v_obj, v_inicio, clock_timestamp(), NULL, 'OK', NULL);
        EXCEPTION WHEN OTHERS THEN
            -- Si un paso falla, se registra el error; la copia anterior queda intacta.
            INSERT INTO control.registro_ejecucion
            VALUES (p_id, v_paso, v_obj, v_inicio, clock_timestamp(), NULL, 'ERROR', SQLERRM);
        END;
    END LOOP;
END $$;

-- Se agenda una vez por día (por ejemplo con pg_cron o una tarea del sistema operativo).
CALL control.proceso_diario(1);`,
  },
  {
    id: 'concurrente',
    titulo: 'Refresco concurrente (trabajo futuro)',
    sql: `-- REFRESH ... CONCURRENTLY permite seguir leyendo la vista mientras se actualiza,
-- pero exige un índice único y suele tardar más que el refresco común.
CREATE UNIQUE INDEX ux_cubo_mensual
    ON consumo_agregado.cubo_mensual (mes, region, segmento, tipo_servicio);

REFRESH MATERIALIZED VIEW CONCURRENTLY consumo_agregado.cubo_mensual;`,
  },
  {
    id: 'medir',
    titulo: 'Medir tiempos en el DWH real',
    sql: `-- En psql: muestra el tiempo de cada sentencia.
\\timing on

-- Plan de ejecución con tiempos reales y lecturas de bloques.
EXPLAIN (ANALYZE, BUFFERS)
SELECT mes, region, sum(importe_total) AS importe
FROM consumo_agregado.cubo_mensual
GROUP BY mes, region;

-- Duración de cada paso del proceso diario, a partir del registro de ejecución.
SELECT objeto,
       round(avg(extract(epoch FROM fin - inicio) * 1000)) AS ms_promedio,
       max(fin - inicio)                                   AS peor_caso
FROM control.registro_ejecucion
WHERE estado = 'OK'
GROUP BY objeto
ORDER BY ms_promedio DESC;`,
  },
];

export const POWER_QUERY = `// Power Query (M): conexión al DWH con el conector estándar de PostgreSQL.
// En Power BI Service, la actualización programada pasa por el gateway de datos local.
let
    Origen = PostgreSQL.Database(
        "servidor-dwh",                 // nombre de ejemplo del servidor del DWH
        "dwh",
        [Query = "SELECT * FROM consumo_agregado.fn_tablero_gerencial(12)"]   // consulta de definición
    ),
    Tipos = Table.TransformColumnTypes(Origen, {
        {"mes", type date}, {"cantidad", Int64.Type}, {"importe_total", Currency.Type}
    })
in
    Tipos`;

export const DAX_MEDIDAS = `-- Medidas DAX del modelo semántico (el cálculo pesado ya lo hizo el DWH).
Importe total = SUM ( hechos[importe_total] )

Operaciones = SUM ( hechos[cantidad] )

-- DIVIDE evita el error de dividir por cero.
Ticket promedio = DIVIDE ( [Importe total], [Operaciones] )

-- La meta viene de la planilla del repositorio de archivos (no pasa por el DWH).
Meta del período =
    SUM ( metas[meta_mensual] ) * DISTINCTCOUNT ( hechos[mes] )

Cumplimiento = DIVIDE ( [Importe total], [Meta del período] )`;
