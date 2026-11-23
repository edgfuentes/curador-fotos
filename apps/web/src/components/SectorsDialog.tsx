import { useState } from 'react';
import { useDerived, useStoreApi } from '../app/context';
import { Dialog } from './Dialog';

/** Corregir el nombre de los sectores (p. ej. si se escribió mal al crearlo). */
export function SectorsDialog() {
  const store = useStoreApi();
  const { sectorNames, counts } = useDerived();
  return (
    <Dialog title="Nombres de los sectores" onClose={() => store.setDialog(null)}>
      <p className="muted small">Cambiar el nombre no cambia las fotos del sector ni su validación.</p>
      <ul className="sector-rename-list">
        {sectorNames.map((name) => (
          <SectorRow key={name} name={name} count={counts.bySector.get(name)?.total ?? 0} />
        ))}
      </ul>
      <div className="row end">
        <button className="btn btn-primary" onClick={() => store.setDialog(null)}>
          Listo
        </button>
      </div>
    </Dialog>
  );
}

function SectorRow({ name, count }: { name: string; count: number }) {
  const store = useStoreApi();
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const changed = value.trim() !== name;
  return (
    <li>
      <form
        className="sector-rename"
        onSubmit={(e) => {
          e.preventDefault();
          setError(store.renameSector(name, value));
        }}
      >
        <input
          aria-label={`Nombre del sector ${name}`}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          enterKeyHint="done"
          autoCapitalize="sentences"
        />
        <span className="sector-rename-count muted small">
          {count} {count === 1 ? 'foto' : 'fotos'}
        </span>
        <button className="btn btn-sm btn-primary" type="submit" disabled={!changed || !value.trim()}>
          Guardar
        </button>
      </form>
      {error && (
        <p className="sector-rename-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}
