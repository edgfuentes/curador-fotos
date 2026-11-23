import { useState } from 'react';
import { useSession, useStoreApi } from '../app/context';
import { Dialog } from './Dialog';

/** Crea un sector y marca en él las fotos que lo pidieron desde la lista desplegable. */
export function NewSectorDialog() {
  const store = useStoreApi();
  const count = useSession((s) => s.pendingAssign.length);
  const [name, setName] = useState('');
  return (
    <Dialog title="Sector nuevo" onClose={() => store.setDialog(null)}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          store.createSectorAndAssign(name);
        }}
      >
        <label className="field">
          <span>Nombre del sector</span>
          <input data-autofocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Por ejemplo: Sector 4, Tribuna norte…" />
        </label>
        {count > 0 && (
          <p className="muted small">
            {count === 1 ? 'La foto quedará marcada' : `Las ${count} fotos quedarán marcadas`} para este sector.
          </p>
        )}
        <div className="row end">
          <button type="button" className="btn" onClick={() => store.setDialog(null)}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
            Crear y marcar
          </button>
        </div>
      </form>
    </Dialog>
  );
}
