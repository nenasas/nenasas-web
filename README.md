# Nenasas

Landing one-page de **Nenasas**, un live propio de humor y magazine. El sitio explica el proyecto y muestra cómo apoyarlo: tres planes recurrentes (Socio, Socio+, Impulsor) y un aporte único. Todavía no hay cobro: los botones están deshabilitados con “Próximamente”.

Paleta y logo salen del archivo oficial en `public/logo-nenasas.jpg`. Los tokens viven en `src/styles/theme.css`.

## Cómo correrlo

```sh
npm install
npm run dev
```

El server queda en [http://127.0.0.1:45217](http://127.0.0.1:45217).

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Dev server (puerto 45217) |
| `npm run build` | Build de producción en `./dist` |
| `npm run preview` | Sirve el build |

## Fuera de alcance

No hay auth, base de datos ni APIs de pago. Mercado Pago (ARS) e internacional (TBD) son badges de UI.
