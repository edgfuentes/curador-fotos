import { useDerived, useSession, useStoreApi } from '../app/context';
import { useTheme } from '../app/theme';
import { Logo } from './Home';

export function Toolbar() {
  const store = useStoreApi();
  const { counts } = useDerived();
  const name = useSession((s) => s.source?.name ?? '');
  const tileSize = useSession((s) => s.tileSize);
  const canUndo = useSession((s) => s.history.past.length > 0);
  const canRedo = useSession((s) => s.history.future.length > 0);
  const demo = useSession((s) => s.demo);
  const { theme, cycle } = useTheme();

  return (
    <header className="toolbar">
      <div className="toolbar-left">
        <Logo size={28} />
        <div className="toolbar-title">
          <strong>{name}</strong>
          <span className="muted small">
            {counts.total.total} fotos · {counts.total.marked} marcadas · {counts.total.discarded} descartadas
            {demo && ' · modo demostración'}
          </span>
        </div>
      </div>
      <div className="toolbar-right">
        <button className="btn btn-ghost" onClick={() => store.undo()} disabled={!canUndo} title="Deshacer (⌘Z)" aria-label="Deshacer">
          ↶
        </button>
        <button className="btn btn-ghost" onClick={() => store.redo()} disabled={!canRedo} title="Rehacer (⇧⌘Z)" aria-label="Rehacer">
          ↷
        </button>
        <label className="size-slider" title="Tamaño de las miniaturas">
          <span className="sr-only">Tamaño de las miniaturas</span>
          <input type="range" min={120} max={360} step={20} value={tileSize} onChange={(e) => store.setUi({ tileSize: Number(e.target.value) })} />
        </label>
        <button className="btn btn-ghost" onClick={cycle} title={`Tema: ${theme === 'auto' ? 'automático' : theme === 'dark' ? 'oscuro' : 'claro'}`} aria-label="Cambiar tema claro/oscuro">
          {theme === 'dark' ? '☾' : theme === 'light' ? '☀' : '◐'}
        </button>
        <button className="btn btn-ghost" onClick={() => store.setDialog('help')} title="Atajos de teclado (?)" aria-label="Atajos de teclado">
          ?
        </button>
        <button className="btn btn-ghost" onClick={() => store.closeSource()} title="Elegir otra carpeta">
          Cambiar carpeta
        </button>
        <button className="btn btn-primary" onClick={() => store.setDialog('export')} disabled={counts.total.marked === 0}>
          Exportar seleccionadas ({counts.total.marked})
        </button>
      </div>
    </header>
  );
}
