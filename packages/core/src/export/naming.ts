/**
 * Reglas de nombres de archivo para la exportación.
 */

/** Ancho del prefijo: mínimo 3 dígitos (001_), más si hay 1000 o más fotos. */
export function prefixWidth(count: number): number {
  return Math.max(3, String(Math.max(1, count)).length);
}

/** "001_IMG_1234.HEIC": conserva el nombre original completo tras el prefijo. */
export function prefixedName(index: number, count: number, originalName: string): string {
  return `${String(index).padStart(prefixWidth(count), '0')}_${originalName}`;
}

/**
 * Clave de comparación de nombres: macOS (APFS/HFS+) no distingue mayúsculas
 * por defecto y puede almacenar Unicode en otra forma, así que "Á.jpg" y
 * "á.JPG" chocan.
 */
export function nameKey(name: string): string {
  return name.normalize('NFC').toLowerCase();
}

/**
 * Resuelve colisiones agregando " (2)", " (3)"… antes de la extensión.
 * `taken` contiene claves de `nameKey` y se actualiza con el nombre elegido.
 */
export function resolveCollision(name: string, taken: Set<string>): string {
  if (!taken.has(nameKey(name))) {
    taken.add(nameKey(name));
    return name;
  }
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(nameKey(candidate))) {
      taken.add(nameKey(candidate));
      return candidate;
    }
  }
}

/** Limpia un nombre de carpeta: sin "/", ":", caracteres de control ni puntos iniciales. */
export function sanitizeFolderName(name: string): string {
  const cleaned = name
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '-')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 120);
  return cleaned || 'Sin nombre';
}
