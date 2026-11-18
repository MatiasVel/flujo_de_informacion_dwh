// Servidor estático mínimo para probar el sitio en la computadora, sin dependencias.
// Uso: node scripts/servidor.mjs [puerto]   (por defecto, http://localhost:8080)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(fileURLToPath(new URL('../public', import.meta.url)));
const puerto = Number(process.argv[2] ?? process.env.PORT ?? 8080);
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
};

createServer(async (pedido, respuesta) => {
  try {
    const ruta = decodeURIComponent(new URL(pedido.url, 'http://localhost').pathname);
    let archivo = normalize(join(raiz, ruta));
    if (!archivo.startsWith(raiz)) throw new Error('fuera de la carpeta pública');
    if ((await stat(archivo).catch(() => null))?.isDirectory()) archivo = join(archivo, 'index.html');
    const contenido = await readFile(archivo);
    respuesta.writeHead(200, {
      'Content-Type': TIPOS[extname(archivo)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      // La misma política de seguridad que publica Netlify (ver netlify.toml).
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
    });
    respuesta.end(contenido);
  } catch {
    const pagina = await readFile(join(raiz, '404.html')).catch(() => 'No encontrado');
    respuesta.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    respuesta.end(pagina);
  }
}).listen(puerto, () => console.log(`Simulador disponible en http://localhost:${puerto}`));
