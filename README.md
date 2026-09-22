# Nenasas

Landing de [nenasas.com.ar](https://nenasas.com.ar): streaming de humor en vivo con Carola Oyarbide, Nahuel Puyaps y Lucas Roman. Una sola página con presentación, programación y formas de apoyar el proyecto.

Los planes abren links de Mercado Pago y PayPal. No hay backend, auth ni base de datos.

Astro 7 y Tailwind CSS 4. Hace falta Node `>=22.12.0`.

## Cómo correrlo

```sh
npm install
npm run dev
```

El server queda en [http://127.0.0.1:45217](http://127.0.0.1:45217).

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Dev server, puerto 45217 |
| `npm run build` | Build de producción en `./dist` |
| `npm run preview` | Sirve el build |
