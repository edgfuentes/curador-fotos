import { NO_SECTOR } from '@curador/core';

export type Choice = { sector: string } | 'unclassified' | 'new';

const NONE = '__none__';
const NEW = '__new__';

/**
 * Etapa 1: lista desplegable para elegir el sector de una foto
 * (las teclas 1–9 eligen el mismo sector que el número de la lista).
 */
export function SectorSelect({
  sector,
  sectorNames,
  onChoose,
  label,
  className,
}: {
  /** Sector actual (NO_SECTOR o undefined = sin clasificar). */
  sector: string | undefined;
  sectorNames: readonly string[];
  onChoose(choice: Choice): void;
  label: string;
  className?: string;
}) {
  const classified = sector !== undefined && sector !== NO_SECTOR;
  return (
    <select
      className={['sector-select', classified ? 'is-classified' : 'is-unclassified', className].filter(Boolean).join(' ')}
      aria-label={label}
      value={classified ? `s:${sector}` : NONE}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // Las flechas cambian de opción dentro de la lista, no de foto.
        if (e.key !== 'Escape') e.stopPropagation();
      }}
      onChange={(e) => {
        const v = e.target.value;
        if (v === NONE) onChoose('unclassified');
        else if (v === NEW) onChoose('new');
        else if (v.startsWith('s:')) onChoose({ sector: v.slice(2) });
        e.currentTarget.blur();
      }}
    >
      <option value={NONE}>○ Sin clasificar</option>
      {sectorNames.map((name, i) => (
        <option key={name} value={`s:${name}`}>
          {i < 9 ? `${i + 1} · ` : ''}
          {name}
        </option>
      ))}
      <option value={NEW}>＋ Sector nuevo…</option>
    </select>
  );
}
