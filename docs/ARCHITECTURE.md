# Arquitectura y guía para nuevas plataformas

## Capas

```
┌──────────────────────────────────────────────────────────┐
│ apps/web  (React)                                        │
│   pantallas, atajos, store de sesión                     │
│   ── solo importa @curador/core y las interfaces ──      │
└──────────────▲───────────────────────────▲───────────────┘
               │ puertos (interfaces)      │ composición (main.tsx)
┌──────────────┴──────────────┐  ┌─────────┴──────────────────┐
│ packages/core               │  │ packages/adapters-web      │
│  modelo + reglas puras      │◄─┤  FSA API, IndexedDB,       │
│  sin DOM, sin Node          │  │  Workers, WASM             │
│  (tsconfig lib: ES2022)     │  ├────────────────────────────┤
│                             │◄─┤ packages/adapters-node     │
└─────────────────────────────┘  │  fs/crypto (pruebas)       │
                                 └────────────────────────────┘
```

`packages/core/tsconfig.json` compila con `lib: ["ES2022"]` y `types: []`. Si alguien usa `document`, `Blob`, `TextEncoder` o `fs` en el core, el typecheck falla.

## Puertos (`packages/core/src/ports.ts`)

| Puerto | Responsabilidad | Web | Futuro nativo |
|---|---|---|---|
| `FileSystemAdapter` | Elegir carpetas de origen y destino, recordar la última, detectar si el destino está dentro del origen | `showDirectoryPicker`, handles en IndexedDB | Capacitor Filesystem + selector de documentos; RN: `react-native-document-picker` + SAF/Security-scoped bookmarks |
| `SourceDirectory` | Escanear y **leer** archivos (sin métodos de escritura) | `FileSystemDirectoryHandle` (modo `read`) | Rutas o URIs con acceso de solo lectura |
| `DestinationDirectory` | Crear subcarpetas y escribir de forma **atómica** | `createWritable()` (archivo `.crswap` + `close()`) | Escribir en un temporal y renombrarlo (ver `adapters-node`) |
| `StorageAdapter` | Marcas, ajustes, preferencias, cachés | IndexedDB (`idb`) | SQLite / MMKV |
| `ThumbnailAdapter` | Vistas `grid` / `preview` / `full` como `ImageRef { url }` | Web Workers + OffscreenCanvas → `blob:` URLs | Generador nativo → `file://` |
| `MetadataReader` | EXIF de cada archivo | exifr + lectores TIFF/RAW propios en Workers | Mismo código JS o API nativa (ImageIO) |
| `HasherFactory` | SHA-256 incremental | hash-wasm | `crypto` nativo |

## Cómo agregar una plataforma (ejemplo: Capacitor)

1. Crear `packages/adapters-capacitor` con `@curador/core` como dependencia.
2. Implementar los puertos. Usar `adapters-node` como referencia: es una implementación completa y pequeña.
3. Exportar `createCapacitorAdapters()` con la misma forma que `createWebAdapters()`.
4. En la app, reemplazar la composición de `apps/web/src/main.tsx`; para React Native, crear `apps/mobile` que reutilice `core` y la lógica del store.
5. Correr la batería de integración de exportación contra el nuevo adaptador. Copiar `export.integration.test.ts` y cambiar los constructores.

## Flujo de exportación (`core/src/export/run.ts`)

1. `buildExportPlan` (función pura): toma el orden final, aplica prefijos `001_` por carpeta (que se reinician por sector) y resuelve las colisiones de nombres.
2. `chooseExportFolder`: usa «Para subir a redes» si no existe o está vacía; si no, crea «… (2)».
3. Por cada foto:
   1. Leer el original en streaming, hashear cada bloque y escribirlo.
   2. Releer la copia, hashearla y comparar el tamaño y el SHA-256. Si no coinciden, borrar la copia y registrar el error.
4. Se puede cancelar en cualquier bloque. Una escritura atómica nunca deja archivos parciales.
5. Al final se escribe `manifest.json` con el resumen y cada ítem.

## Campos previstos (no implementados)

- `Photo.aiQuality: { score, model, computedAt }`: puntuación de calidad por IA.
- `Photo.photographerId` y `CameraSettings.photographerId`: autoría en modo colaborativo.
- `Photo.cloudSync: { state: 'local-only' | 'pending' | 'synced' | 'error', remoteId?, updatedAt? }`: sincronización en la nube.

`LibraryState.schemaVersion` permite migrar datos guardados cuando estos campos se activen.
