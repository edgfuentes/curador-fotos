import { NO_SECTOR } from '@curador/core';
import { useDerived, useSession, useStoreApi } from '../app/context';
import { useTheme } from '../app/theme';
import { Logo } from './Home';

export function Toolbar() {
  const store = useStoreApi();
  const { counts, unclassified } = useDerived();
  const stage = useSession((s) => s.stage);
  const dialog = useSession((s) => s.dialog);
  const toValidate = counts.total.pending - (counts.bySector.get(NO_SECTOR)?.pending ?? 0);
  const approved = counts.total.marked - (counts.bySector.get(NO_SECTOR)?.marked ?? 0);
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
            {counts.total.total} fotos{demo && ' · modo demostración'}
          </span>
        </div>
      </div>
      <nav className="stages" aria-label="Etapas">
        <button className={`stage${stage === 'classify' && dialog !== 'export' ? ' on' : ''}`} aria-current={stage === 'classify' ? 'step' : undefined} onClick={() => store.setStage('classify')}>
          <span className="stage-n">1</span>
          <span className="stage-txt">
            Clasificar
            <small>{unclassified ? `${unclassified} sin clasificar` : '✓ todas con sector'}</small>
          </span>
        </button>
        <button className={`stage${stage === 'validate' && dialog !== 'export' ? ' on' : ''}`} aria-current={stage === 'validate' ? 'step' : undefined} onClick={() => store.setStage('validate')}>
          <span className="stage-n">2</span>
          <span className="stage-txt">
            Validar
            <small>{toValidate ? `${toValidate} por validar` : '✓ sin pendientes'}</small>
          </span>
        </button>
        <button className={`stage${dialog === 'export' ? ' on' : ''}`} onClick={() => store.setDialog('export')} disabled={approved === 0}>
          <span className="stage-n">3</span>
          <span className="stage-txt">
            Exportar
            <small>{approved} aprobadas</small>
          </span>
        </button>
      </nav>
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
      </div>
    </header>
  );
}
