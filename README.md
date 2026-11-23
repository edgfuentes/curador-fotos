# Curador de Fotos

Aplicación web **local-first** para Mac que sirve para curar fotografías de varias cámaras y teléfonos:

- las ordena por **fecha real de captura** (EXIF), corrigiendo relojes desajustados de cada cámara;
- el fotógrafo las **clasifica por sector** (Entrada, Banda, Congregación, Otros…) y luego un validador las **aprueba o rechaza**;
- **exporta los originales aprobados** a una carpeta «Para subir a redes», con verificación SHA-256.

No hay servidor: las fotos nunca salen del computador.

> **Reglas que la app no rompe nunca**
>
> 1. Los originales no se modifican, no se recomprimen y no se mueven. La carpeta de origen se abre con permiso de **solo lectura**, y la capa que la representa (`SourceDirectory`) no tiene métodos para escribir.
> 2. La exportación copia byte a byte. Cada copia se vuelve a leer y su SHA-256 se compara con el del original. Si no coinciden, la copia se borra y se informa el error.
> 3. La app solo muestra miniaturas y vistas medias generadas localmente. El original se lee solo para el zoom al 100 % y para exportar.

---

## Uso rápido

El trabajo se hace en **tres etapas**, en el mismo computador y sin usuarios: el fotógrafo clasifica y, después, otra persona valida.

1. Abre la app en **Google Chrome** o **Microsoft Edge**. Safari y Firefox todavía no permiten acceder a carpetas; si los usas, la app muestra un aviso.
2. Pulsa **«Elegir carpeta de fotos…»** y elige la carpeta del evento. Se leen todas las subcarpetas.
   - La próxima vez puedes pulsar **«Continuar con …»**: el navegador vuelve a pedir permiso con un clic.
   - Para probar sin tus fotos, usa **«Probar con fotos de demostración»**.
3. Si una cámara tenía la hora mal, ve a **Ajustar hora de cámaras…** e indica el desfase. También puedes escribir la hora real de su primera foto y pulsar «Calcular desfase».

### Etapa 1 · Clasificar (fotógrafo)

Todas las fotos empiezan **sin clasificar**. La pantalla tiene tres columnas:

- **Izquierda:** el filtro «Mostrar: Todas / Sin clasificar», las carpetas de origen, las cámaras y los duplicados.
- **Centro:** las fotos agrupadas por carpeta de origen y ordenadas por hora. Al clasificarlas **no cambian de lugar**.
- **Derecha:** los sectores (**Entrada, Banda, Congregación, Otros** y los que agregues), cada uno con su cantidad de fotos y una muestra de 3. Arriba se ve cuántas faltan por clasificar.

Para asignar el sector de una foto puedes:

- usar la **lista desplegable bajo la miniatura** (también sirve para crear un sector nuevo);
- pulsar **1–9**: la app pasa sola a la siguiente foto;
- **arrastrar** la foto a la tarjeta de un sector.

Con **0** o **⌫** la foto vuelve a quedar sin clasificar. Si hay varias fotos seleccionadas, la elección se aplica a todas. Los sectores nuevos se recuerdan para las próximas carpetas.

Al pulsar una tarjeta (↗), el sector se abre en una **ventana aparte** que se actualiza en vivo. Ahí puedes fijar el orden final arrastrando las fotos o con ⌥← / ⌥→. Si el navegador bloquea la ventana, permite las ventanas emergentes para este sitio.

### Etapa 2 · Validar (validador)

Pulsa **2 · Validar**. A la izquierda aparece cada sector con su avance: aprobadas, rechazadas y cuántas faltan.

Elige un sector y pulsa **Validar a pantalla completa**. La app muestra las fotos de a una y pasa sola a la siguiente por validar:

| Tecla | Acción |
|---|---|
| **A** | Aprobar |
| **R** | Rechazar |
| **U** | Dejar por validar |
| ← → | Foto anterior / siguiente |
| **Z** | Zoom al 100 % (original) |
| Esc | Volver a la cuadrícula |

En la cuadrícula también puedes aprobar o rechazar con los botones bajo cada foto. Si en la etapa 1 cambian a una foto de sector, su validación anterior se anula y vuelve a quedar por validar.

### Etapa 3 · Exportar

Pulsa **3 · Exportar** y elige la carpeta de destino, por ejemplo el Escritorio. Solo se copian las fotos **aprobadas**, en el orden de la lista de sectores. Si quedan fotos sin validar, la app te avisa. La app crea:

```
Para subir a redes/
  Entrada/001_IMG_1234.HEIC
  Entrada/002_DSC_0456.JPG
  Banda/001_…
  manifest.json
```

Opciones de exportación:
- **Subcarpetas por sector**: la numeración se reinicia en cada subcarpeta.
- **Prefijo numérico** `001_`: se puede desactivar.
- **Nombre de la carpeta** de exportación.

Si ya existe una exportación con ese nombre, se crea `Para subir a redes (2)`; nunca se sobrescribe nada. Las colisiones de nombres se resuelven con ` (2)`, ` (3)`… sin distinguir mayúsculas, igual que macOS.

Al terminar verás un resumen con las fotos copiadas, verificadas y con errores. `manifest.json` incluye el orden, la ruta original, el SHA-256, la hora de captura (con y sin ajuste) y la cámara de cada foto, además de la fecha de exportación.

Los sectores, las validaciones, los desfases y el orden manual se guardan solos en este navegador (IndexedDB). No se pierden si cierras la pestaña.

### En iPhone y iPad

Abre la misma dirección en **Safari**. Para usarla como app: *Compartir → Agregar a pantalla de inicio*. En pantallas táctiles se abre una versión pensada para el dedo. En el Mac puedes verla con `?movil` al final de la dirección.

1. **Clasificar.** Escribe el nombre de la carrera y toca *Elegir fotos de la carrera…*. Las fotos se copian dentro de la app sin recomprimir; la fototeca no se toca. Para clasificar puedes:
   - seleccionar varias fotos y tocar su sector;
   - ir *una por una*: tocas el sector y pasa sola a la siguiente.
2. **Validar.** Elige un sector y desliza cada foto: a la **derecha la apruebas** y a la **izquierda la rechazas**. ↶ deshace la última decisión.
3. **Guardar.** Todas las aprobadas se comparten juntas, en un solo envío, numeradas en el orden de los sectores (`001_Entrada_IMG_1234.JPG`…).
   - **Álbum nuevo:** Safari no permite que una página web cree álbumes. Lo hace un Atajo de iOS, «Guardar en álbum nuevo», que se crea una sola vez (la app explica los pasos). Aparece en el menú de compartir, pide el nombre del álbum y guarda ahí todas las fotos.
   - *Guardar en Archivos* las deja en una carpeta para subir a la web.

El nombre de un sector se corrige con **✎ Editar**, también en la versión de escritorio. Las fotos y sus validaciones no cambian. *Mis carreras* permite agregar más fotos a una carrera o borrarla para liberar espacio.

### Formatos

| Formato | Vista previa |
|---|---|
| JPG/JPEG, PNG, WebP | Nativa |
| HEIC/HEIF (iPhone) | Decodificador libheif (WebAssembly) en un Web Worker; se carga solo cuando hace falta |
| TIFF | Decodificador UTIF en un Web Worker |
| RAW: CR2, CR3, NEF, NRW, ARW, DNG, RAF, ORF, RW2, PEF, SRW… | Se usa el **JPEG incrustado** más adecuado. En CR3 se usa la vista previa de 1620 px. |
| Otros RAW sin JPEG legible | Se muestra un marcador, y aun así se puede marcar y exportar el original |

Los archivos ocultos y los `._IMG_0001.JPG` que macOS crea en tarjetas exFAT se ignoran. También se ignoran las carpetas `Para subir a redes…` que estén dentro del origen.

---

## Ejecutar en local

Requisitos: Node.js 20 o superior (`node -v`).

```bash
npm install
```

```bash
npm run dev
```

Abre http://localhost:5173 en Chrome o Edge. `localhost` cuenta como contexto seguro, así que la File System Access API funciona sin HTTPS.

Otros comandos:

```bash
npm test            # pruebas unitarias e integración (Vitest)
```

```bash
npm run typecheck   # TypeScript estricto en todos los paquetes
```

```bash
npm run build       # genera apps/web/dist (sitio estático + service worker)
```

```bash
npm run preview     # sirve el build en http://localhost:4173
```

## Desplegar como sitio estático con HTTPS

La app es 100 % estática: la carpeta `apps/web/dist` se puede publicar en cualquier hosting con HTTPS. Después basta con abrir la misma dirección en Chrome o Edge desde cualquier Mac. Cada Mac guarda sus propias marcas y ajustes. Desde la barra de direcciones se puede **instalar como app** (ícono ⊕ «Instalar»), y funciona sin conexión.

### GitHub Pages (configurado)

1. Sube el repositorio a GitHub y deja el código en la rama `main`.
2. En GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Crea la variable de repositorio `DEPLOY_PAGES` con valor `true` (**Settings → Secrets and variables → Actions → Variables**). Sin ella, el workflow solo corre pruebas y build.
   > Pages en un repositorio **privado** requiere GitHub Pro/Team. Con el plan gratis, haz el repo público o usa Netlify/Vercel (abajo).
4. Cada `push` a `main` ejecuta `.github/workflows/deploy.yml`, que corre los tipos, las pruebas y el build, y publica el sitio en `https://<usuario>.github.io/<repositorio>/`.

El workflow define `BASE_PATH=/<repositorio>/` para que las rutas, el manifest y el service worker funcionen en la subruta.

### Netlify

- Build command: `npm run build`
- Publish directory: `apps/web/dist`

También puedes arrastrar la carpeta `apps/web/dist` a https://app.netlify.com/drop.

### Vercel

- Framework: «Other»
- Build command: `npm run build`
- Output directory: `apps/web/dist`

En Netlify y Vercel el sitio vive en la raíz, así que no hace falta `BASE_PATH`.

---

## Arquitectura

```
curador-fotos/
├─ packages/
│  ├─ core/            Modelos y reglas. TypeScript puro: sin React, sin DOM, sin APIs del navegador
│  │  ├─ model.ts        Photo, CameraSettings, LibraryState (+ campos previstos: IA, fotógrafo, nube)
│  │  ├─ capture.ts      Fecha EXIF, cámaras, desfases
│  │  ├─ ordering.ts     Orden automático, sectores, combinación con el orden manual
│  │  ├─ curation.ts     Estados, asignación de sector, arrastrar/soltar, deshacer, reconciliación
│  │  ├─ grouping.ts     Filtros, contadores, cámaras, duplicados
│  │  ├─ ports.ts        Interfaces: FileSystemAdapter, StorageAdapter, ThumbnailAdapter, MetadataReader…
│  │  └─ export/         Nombres (prefijo, colisiones), plan, ejecución con verificación, manifest
│  ├─ adapters-web/    Implementación para Chrome/Edge
│  │  ├─ fs-access.ts    File System Access API (origen solo lectura, destino con create:true)
│  │  ├─ storage.ts      IndexedDB (marcas, ajustes, caché de metadatos, vistas y hashes)
│  │  ├─ thumbnails.ts   Vistas cacheadas, invalidadas por tamaño y fecha de modificación
│  │  ├─ worker*.ts      Pool de Web Workers con prioridad y cancelación
│  │  ├─ decoders.ts     EXIF (exifr), HEIC (libheif WASM), TIFF (UTIF), RAW, orientación
│  │  └─ parsers/        Lectores TIFF/JPEG/RAW propios, con acceso aleatorio (no cargan el archivo entero)
│  └─ adapters-node/   Implementación para Node (pruebas de integración y base para una app de escritorio)
├─ apps/web/           Interfaz React + Vite + PWA. Solo consume el core y los puertos
└─ docs/ARCHITECTURE.md
```

- **La interfaz no conoce la plataforma.** `apps/web/src/main.tsx` es el único punto donde se eligen los adaptadores (`createWebAdapters()`). El resto de la app recibe interfaces del core.
- **Migrar a nativo** (Capacitor, React Native, Electron/Tauri): se crea un paquete hermano, por ejemplo `adapters-capacitor`, que implemente los mismos puertos, y se cambia esa línea. El core y sus pruebas no cambian. Más detalle en [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- **Previsto en el modelo, sin implementar:** `Photo.aiQuality` (puntuación de calidad por IA), `Photo.photographerId` y `CameraSettings.photographerId` (colaboración entre fotógrafos), `Photo.cloudSync` (sincronización en la nube).

### Identidad de cada foto y caché

- La foto se identifica por su **ruta relativa**. Cada marca guarda además una huella: nombre, tamaño, fecha de modificación y SHA-256 si ya se calculó.
- Si renombras o mueves un archivo, al reabrir la carpeta su marca se recupera por huella o por hash.
- Las miniaturas y los metadatos se cachean con la clave `ruta|tamaño|fecha de modificación`: si el archivo cambia, se regeneran.
- Los duplicados exactos se detectan en segundo plano. Solo se hashean archivos que comparten tamaño, porque son los únicos que pueden ser idénticos.

### Pruebas

- `packages/core/test`: orden por EXIF (nunca por fecha de modificación), respaldo por nombre natural, desfase por cámara, orden manual e intercalado, estados, deshacer/rehacer, sectores, filtros y contadores, reconciliación, duplicados, prefijos, colisiones (incluido Unicode y mayúsculas) y plan de exportación.
- `packages/adapters-web/test`: lectores TIFF/EXIF, JPEG y extracción de vistas previas RAW (estilo NEF/DNG, RW2/ORF, RAF y respaldo).
- `packages/adapters-node/test/export.integration.test.ts`: exportación real en disco. Comprueba la copia byte a byte, que el SHA-256 coincide, el manifest, que los originales quedan intactos, que nunca se sobrescribe, que una copia corrupta se detecta y se borra, y la cancelación sin archivos parciales.

## Limitaciones conocidas

- Solo Chrome y Edge (de escritorio): Safari y Firefox no implementan `showDirectoryPicker`.
- El navegador no puede conservar la fecha de modificación del original en la copia. El **contenido** sí es idéntico, incluido todo el EXIF.
- Cada «biblioteca» se identifica por el **nombre** de la carpeta de origen: dos carpetas distintas con el mismo nombre comparten marcas en el mismo navegador.
- La detección de ráfagas similares (no idénticas) queda para una fase posterior.
