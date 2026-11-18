// Utilidades de fechas del simulador.
// Las fechas se manejan como cadenas 'AAAA-MM-DD' (igual que el tipo date de PostgreSQL)
// y se calculan en UTC para evitar los corrimientos de un día que produce el huso horario.

const MS_POR_DIA = 86400000;

export const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

const dos = (n) => String(n).padStart(2, '0');

export function desdeISO(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}

export function aISO(fecha) {
  return fecha.toISOString().slice(0, 10);
}

export function sumarDias(iso, dias) {
  return aISO(new Date(desdeISO(iso).getTime() + dias * MS_POR_DIA));
}

export function diasEntre(desde, hasta) {
  return Math.round((desdeISO(hasta) - desdeISO(desde)) / MS_POR_DIA);
}

// Primer día del mes: equivale a date_trunc('month', fecha)::date en PostgreSQL.
export function inicioDeMes(iso) {
  return iso.slice(0, 8) + '01';
}

// Suma meses a una fecha que ya es primer día de mes.
export function sumarMeses(isoMes, meses) {
  const [a, m] = isoMes.split('-').map(Number);
  const total = a * 12 + (m - 1) + meses;
  return `${Math.floor(total / 12)}-${dos((total % 12) + 1)}-01`;
}

// Lista de meses (primer día) desde 'meses - 1' meses atrás hasta el mes de referencia.
export function ultimosMeses(isoReferencia, meses) {
  const fin = inicioDeMes(isoReferencia);
  const lista = [];
  for (let i = meses - 1; i >= 0; i--) lista.push(sumarMeses(fin, -i));
  return lista;
}

export function hoyLocalISO() {
  const d = new Date();
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

export function esFechaISO(valor) {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const d = desdeISO(valor);
  return !Number.isNaN(d.getTime()) && aISO(d) === valor;
}

// Acepta 'AAAA-MM-DD' o 'DD/MM/AAAA' (formato habitual en planillas de Argentina).
export function normalizarFecha(valor) {
  const texto = String(valor ?? '').trim();
  if (esFechaISO(texto)) return texto;
  const m = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const iso = `${m[3]}-${dos(m[2])}-${dos(m[1])}`;
    if (esFechaISO(iso)) return iso;
  }
  return null;
}

export function formatoFecha(iso) {
  if (!iso) return '—';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

export function etiquetaMes(isoMes, { largo = false } = {}) {
  const [a, m] = isoMes.split('-');
  return largo ? `${MESES_CORTOS[Number(m) - 1]} ${a}` : `${MESES_CORTOS[Number(m) - 1]} ${a.slice(2)}`;
}

export function diaDeSemana(iso) {
  return DIAS_CORTOS[desdeISO(iso).getUTCDay()];
}

// ---- Reloj simulado -------------------------------------------------------
// El simulador tiene su propio reloj (fecha + minutos desde la medianoche) para poder
// mostrar la latencia del flujo: carga durante el día, proceso nocturno, actualización matinal.

export function horaTexto(minutos) {
  return `${dos(Math.floor(minutos / 60) % 24)}:${dos(minutos % 60)}`;
}

export function marcaDeTiempo(reloj) {
  return `${reloj.fecha} ${horaTexto(reloj.minutos)}`;
}

export function formatoMarca(marca) {
  if (!marca) return '—';
  const [fecha, hora] = marca.split(' ');
  return `${formatoFecha(fecha)} ${hora ?? ''}`.trim();
}

// Avanza el reloj hasta la próxima ocurrencia de una hora dada (en minutos).
// Si esa hora ya pasó hoy, salta al día siguiente.
export function avanzarHasta(reloj, minutosObjetivo) {
  if (reloj.minutos < minutosObjetivo) return { fecha: reloj.fecha, minutos: minutosObjetivo };
  return { fecha: sumarDias(reloj.fecha, 1), minutos: minutosObjetivo };
}
