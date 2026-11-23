import type { CurationStatus } from '@curador/core';

export type Choice = { sector: string } | 'pending' | 'discarded' | 'new';

const PENDING = '__pending__';
const DISCARDED = '__discarded__';
const NEW = '__new__';

/** Valor actual de la lista: el sector si está marcada; si no, su estado. */
export function choiceValue(status: CurationStatus, sector: string | undefined): string {
  if (status === 'marked' && sector !== undefined) return `s:${sector}`;
  return status === 'discarded' ? DISCARDED : PENDING;
}

/**
 * Lista desplegable para decidir qué hacer con una foto:
 * marcarla para un sector (1–9), dejarla pendiente o descartarla.
 */
export function SectorSelect({
  status,
  sector,
  sectorNames,
  onChoose,
  label,
  className,
}: {
  status: CurationStatus;
  sector: string | undefined;
  sectorNames: readonly string[];
  onChoose(choice: Choice): void;
  label: string;
  className?: string;
}) {
  const value = choiceValue(status, sector);
  return (
    <select
      className={['sector-select', `is-${status}`, className].filter(Boolean).join(' ')}
      aria-label={label}
      value={value}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // Las flechas cambian de opción dentro de la lista, no de foto.
        if (e.key !== 'Escape') e.stopPropagation();
      }}
      onChange={(e) => {
        const v = e.target.value;
        if (v === PENDING) onChoose('pending');
        else if (v === DISCARDED) onChoose('discarded');
        else if (v === NEW) onChoose('new');
        else if (v.startsWith('s:')) onChoose({ sector: v.slice(2) });
        e.currentTarget.blur();
      }}
    >
      <option value={PENDING}>○ Pendiente</option>
      <optgroup label="Marcar para el sector…">
        {sectorNames.map((name, i) => (
          <option key={name} value={`s:${name}`}>
            {i < 9 ? `${i + 1} · ` : ''}
            {name}
          </option>
        ))}
        <option value={NEW}>＋ Sector nuevo…</option>
      </optgroup>
      <option value={DISCARDED}>✕ Descartar</option>
    </select>
  );
}
