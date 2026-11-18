// Punto de entrada: barra de navegación, enrutador por hash, pie y manejadores globales.

import * as tienda from './tienda.js';
import { PERFILES } from './motor/catalogos.js';
import { esc, icono, asterisco, aviso, confirmar, copiarTexto } from './ui/dom.js';
import { activarGraficos } from './ui/graficos.js';
import { tablasVisibles, textoReloj } from './ui/componentes.js';

import * as inicio from './vistas/inicio.js';
import * as arquitectura from './vistas/arquitectura.js';
import * as datos from './vistas/datos.js';
import * as dwh from './vistas/dwh.js';
import * as cambios from './vistas/cambios.js';
import * as powerbi from './vistas/powerbi.js';
import * as rendimiento from './vistas/rendimiento.js';
import * as glosario from './vistas/glosario.js';

const VISTAS = [
  { id: 'inicio', nav: 'Inicio', modulo: inicio },
  { id: 'arquitectura', nav: 'Arquitectura', modulo: arquitectura },
  { id: 'datos', nav: 'Datos de prueba', modulo: datos },
  { id: 'dwh', nav: 'DWH', modulo: dwh },
  { id: 'cambios', nav: 'Cambios', modulo: cambios },
  { id: 'powerbi', nav: 'Power BI', modulo: powerbi },
  { id: 'rendimiento', nav: 'Rendimiento', modulo: rendimiento },
  { id: 'glosario', nav: 'Glosario', modulo: glosario },
];

const REPOSITORIO = 'https://github.com/MatiasVel/flujo_de_informacion_dwh';

const barra = document.getElementById('barra');
const principal = document.getElementById('contenido');
const pie = document.getElementById('pie');

let menuSesionAbierto = false;
let anchoAnterior = window.innerWidth;

function ruta() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [id, consulta = ''] = hash.split('?');
  const vista = VISTAS.find((v) => v.id === id) ?? VISTAS[0];
  return { vista, parametros: new URLSearchParams(consulta) };
}

function cuentaActual() {
  const e = tienda.obtener();
  return e.cuentas.find((c) => c.id === e.sesion) ?? e.cuentas[0];
}

const ctx = {
  get estado() { return tienda.obtener(); },
  cambiar: tienda.cambiar,
  cambiarAsync: tienda.cambiarAsync,
  cuenta: cuentaActual,
  perfil: () => PERFILES[cuentaActual().perfil],
  puede: (permiso) => PERFILES[cuentaActual().perfil].permisos.includes(permiso),
  ir: (destino) => { location.hash = `#/${destino}`; },
  refrescar: () => pintar(false),
  get parametros() { return ruta().parametros; },
};

function iniciales(nombre) {
  return nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
}

function pintarBarra(vistaActual) {
  const e = tienda.obtener();
  const cuenta = cuentaActual();
  const perfil = PERFILES[cuenta.perfil];
  barra.innerHTML = `
    <a class="marca" href="#/inicio" aria-label="Inicio del simulador DWH a Power BI">DWH ${asterisco()} BI</a>
    <button type="button" class="menu-boton" aria-expanded="false" aria-controls="nav">${icono.menu.replace('<svg', '<svg width="22" height="22"')}<span>Menú</span></button>
    <nav class="nav" id="nav" aria-label="Secciones del simulador">
      <ul class="nav-lista">
        ${VISTAS.map((v) => `<li><a href="#/${v.id}" ${v.id === vistaActual.id ? 'aria-current="page"' : ''}>${esc(v.nav)}</a></li>`).join('')}
      </ul>
      <div class="sesion">
        <button type="button" class="sesion-boton" aria-haspopup="true" aria-expanded="${menuSesionAbierto}" aria-controls="menu-sesion">
          <span class="iniciales" aria-hidden="true">${esc(iniciales(cuenta.nombre))}</span>
          <span class="sesion-texto">${esc(cuenta.usuario)}<small>${esc(perfil.nombre)}</small></span>
        </button>
        <ul class="sesion-menu" id="menu-sesion" role="menu" ${menuSesionAbierto ? '' : 'hidden'}>
          ${e.cuentas.map((c) => `<li role="none"><button type="button" role="menuitemradio" aria-checked="${c.id === cuenta.id}" data-sesion="${esc(c.id)}">
            <span class="iniciales" aria-hidden="true">${esc(iniciales(c.nombre))}</span>
            <span>${esc(c.usuario)}<small>${esc(PERFILES[c.perfil].nombre)}</small></span></button></li>`).join('')}
          <li role="none" class="separador"></li>
          <li role="none"><button type="button" role="menuitem" data-ir="arquitectura?seccion=accesos">Administrar cuentas de prueba</button></li>
        </ul>
      </div>
    </nav>`;
}

function pintarPie() {
  pie.innerHTML = `
    <div class="pie-interior">
      <div>
        <a class="marca" href="#/inicio">DWH ${asterisco()} BI</a>
        <p>Simulador educativo del flujo de información desde la carga operativa hasta los tableros de decisión. Los datos son ficticios y no representan a ninguna organización real.</p>
        <p>Basado en el paper «Del registro operativo al tablero de decisión: arquitectura y flujo de información de un Data Warehouse integrado con Power BI».</p>
      </div>
      <ul>
        <li><a href="${REPOSITORIO}" rel="noopener">Código fuente en GitHub</a></li>
        <li><a href="#/glosario">Glosario y SQL de referencia</a></li>
        <li><a href="#/arquitectura?seccion=accesos">Cuentas de prueba y perfiles</a></li>
      </ul>
      <div>
        <p id="pie-guardado">${tienda.persistenciaDisponible() ? 'Los cambios se guardan sólo en este navegador.' : 'Este navegador no permite guardar: los cambios se pierden al recargar la página.'}</p>
        <div class="acciones" style="margin-top:12px">
          <button type="button" class="boton contorno-claro chico" data-restablecer>Restablecer la demostración</button>
        </div>
      </div>
    </div>`;
}

function pintar(cambioDeRuta) {
  const { vista } = ruta();
  const contenedor = document.createElement('div');
  contenedor.className = 'vista';
  try {
    contenedor.innerHTML = vista.modulo.render(ctx);
  } catch (error) {
    console.error(error);
    contenedor.innerHTML = `<div class="pagina"><div class="bloque" style="margin-top:32px"><h2>No se pudo mostrar esta sección</h2><p>${esc(error.message)}</p><p><button type="button" class="boton" data-restablecer>Restablecer la demostración</button></p></div></div>`;
  }
  principal.replaceChildren(contenedor);
  try {
    vista.modulo.montar?.(contenedor, ctx);
  } catch (error) {
    console.error(error);
  }
  activarGraficos(contenedor);
  document.title = `${vista.modulo.titulo} | Simulador del flujo DWH a Power BI`;
  pintarBarra(vista);
  if (cambioDeRuta) {
    menuSesionAbierto = false;
    pintarBarra(vista);
    const seccion = ruta().parametros.get('seccion');
    const destino = seccion ? document.getElementById(seccion) : null;
    if (destino) destino.scrollIntoView();
    else window.scrollTo({ top: 0 });
    principal.focus({ preventScroll: true });
  }
}

// ---- Manejadores globales (delegación de eventos) ----

document.addEventListener('click', async (e) => {
  const objetivo = e.target;

  const menuBoton = objetivo.closest('.menu-boton');
  if (menuBoton) {
    const nav = document.getElementById('nav');
    const abierto = nav.classList.toggle('abierto');
    menuBoton.setAttribute('aria-expanded', String(abierto));
    return;
  }

  const sesionBoton = objetivo.closest('.sesion-boton');
  if (sesionBoton) {
    menuSesionAbierto = !menuSesionAbierto;
    document.getElementById('menu-sesion').hidden = !menuSesionAbierto;
    sesionBoton.setAttribute('aria-expanded', String(menuSesionAbierto));
    if (menuSesionAbierto) document.querySelector('#menu-sesion button')?.focus();
    return;
  }

  const opcionSesion = objetivo.closest('[data-sesion]');
  if (opcionSesion) {
    menuSesionAbierto = false;
    tienda.cambiar((estado) => { estado.sesion = opcionSesion.dataset.sesion; });
    const c = cuentaActual();
    aviso(`Sesión iniciada como ${c.usuario} (${PERFILES[c.perfil].nombre}).`, 'info');
    return;
  }

  const irA = objetivo.closest('[data-ir]');
  if (irA) {
    menuSesionAbierto = false;
    location.hash = `#/${irA.dataset.ir}`;
    return;
  }

  if (menuSesionAbierto && !objetivo.closest('.sesion')) {
    menuSesionAbierto = false;
    const menu = document.getElementById('menu-sesion');
    if (menu) menu.hidden = true;
  }

  if (objetivo.closest('.nav-lista a')) document.getElementById('nav')?.classList.remove('abierto');

  const copiar = objetivo.closest('[data-copiar]');
  if (copiar) {
    const bloque = copiar.closest('.codigo-bloque');
    const ok = await copiarTexto(bloque.dataset.codigo);
    copiar.textContent = ok ? 'Copiado' : 'No se pudo copiar';
    setTimeout(() => { copiar.textContent = 'Copiar'; }, 1600);
    return;
  }

  const alternar = objetivo.closest('[data-alternar-figura]');
  if (alternar) {
    const fig = alternar.closest('[data-figura]');
    const verTabla = alternar.getAttribute('aria-pressed') !== 'true';
    fig.querySelector('.vista-grafico').hidden = verTabla;
    fig.querySelector('.vista-tabla').hidden = !verTabla;
    alternar.setAttribute('aria-pressed', String(verTabla));
    alternar.textContent = verTabla ? 'Ver gráfico' : 'Ver como tabla';
    if (verTabla) tablasVisibles.add(fig.id); else tablasVisibles.delete(fig.id);
    return;
  }

  if (objetivo.closest('[data-restablecer]')) {
    const ok = await confirmar({
      titulo: 'Restablecer la demostración',
      mensaje: 'Se borran los datos cargados, el registro de ejecución y las mediciones, y se vuelve al escenario inicial de 400 usuarios.',
      aceptar: 'Restablecer',
      peligro: true,
    });
    if (ok) {
      await tienda.restablecer();
      aviso('Demostración restablecida.', 'ok');
    }
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && menuSesionAbierto) {
    menuSesionAbierto = false;
    document.getElementById('menu-sesion').hidden = true;
    document.querySelector('.sesion-boton')?.focus();
  }
});

window.addEventListener('hashchange', () => pintar(true));

let temporizadorAncho = null;
window.addEventListener('resize', () => {
  clearTimeout(temporizadorAncho);
  temporizadorAncho = setTimeout(() => {
    if (Math.abs(window.innerWidth - anchoAnterior) > 40) {
      anchoAnterior = window.innerWidth;
      pintar(false);
    }
  }, 250);
});

async function arrancar() {
  await tienda.iniciar();
  tienda.suscribir(() => pintar(false));
  pintarPie();
  pintar(true);
  window.__simulador = { tienda, version: '1.0.0', reloj: () => textoReloj(tienda.obtener().reloj) };
}

arrancar().catch((error) => {
  console.error(error);
  principal.innerHTML = `<div class="pagina"><div class="bloque" style="margin-top:32px"><h2>No se pudo iniciar el simulador</h2><p>${esc(error.message)}</p></div></div>`;
});
