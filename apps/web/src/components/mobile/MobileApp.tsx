import { useEffect, useState } from 'react';
import { NO_SECTOR } from '@curador/core';
import { isOpfsSupported } from '../../app/carreras';
import { useDerived, useSession, useStoreApi } from '../../app/context';
import { Logo } from '../Home';
import { NewSectorDialog } from '../NewSectorDialog';
import { SectorsDialog } from '../SectorsDialog';
import { ScanProgress } from '../ScanProgress';
import { UpdatePrompt } from '../UpdatePrompt';
import { MobileClassify } from './MobileClassify';
import { MobileHome } from './MobileHome';
import { MobileSave } from './MobileSave';
import { MobileValidate } from './MobileValidate';

export type MobileTab = 'classify' | 'validate' | 'save';

/** Versión táctil para iPhone y iPad: clasificar → validar deslizando → guardar en Fotos. */
export function MobileApp() {
  const phase = useSession((s) => s.phase);
  const dialog = useSession((s) => s.dialog);
  const toasts = useSession((s) => s.toasts);

  useEffect(() => {
    document.documentElement.classList.add('is-mobile');
    void navigator.storage?.persist?.().catch(() => undefined);
    return () => document.documentElement.classList.remove('is-mobile');
  }, []);

  return (
    <>
      {!isOpfsSupported() ? (
        <MobileUnsupported />
      ) : phase === 'home' ? (
        <MobileHome />
      ) : phase === 'scanning' ? (
        <ScanProgress />
      ) : (
        <MobileShell />
      )}
      {dialog === 'new-sector' && <NewSectorDialog />}
      {dialog === 'sectors' && <SectorsDialog />}
      <div className="toasts m-toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
      <UpdatePrompt />
    </>
  );
}

function MobileShell() {
  const store = useStoreApi();
  const name = useSession((s) => s.source?.name ?? '');
  const canUndo = useSession((s) => s.history.past.length > 0);
  const { counts, unclassified } = useDerived();
  const [tab, setTab] = useState<MobileTab>(() => (unclassified === 0 && counts.total.total > 0 ? 'validate' : 'classify'));

  const toValidate = counts.total.pending - (counts.bySector.get(NO_SECTOR)?.pending ?? 0);
  const approved = counts.total.marked - (counts.bySector.get(NO_SECTOR)?.marked ?? 0);

  useEffect(() => {
    store.setStage(tab === 'classify' ? 'classify' : 'validate');
  }, [tab, store]);

  return (
    <div className="m-app">
      <header className="m-top">
        <button className="m-icon-btn" onClick={() => store.closeSource()} aria-label="Volver a mis carreras">
          ‹
        </button>
        <h1 className="m-title ellipsis">{name}</h1>
        <button className="m-icon-btn" onClick={() => store.undo()} disabled={!canUndo} aria-label="Deshacer">
          ↶
        </button>
      </header>
      <main className="m-main" id="main">
        {tab === 'classify' && <MobileClassify onDone={() => setTab('validate')} />}
        {tab === 'validate' && <MobileValidate onDone={() => setTab('save')} />}
        {tab === 'save' && <MobileSave />}
      </main>
      <nav className="m-tabs" aria-label="Etapas">
        <TabButton active={tab === 'classify'} onClick={() => setTab('classify')} n={1} label="Clasificar" badge={unclassified || null} />
        <TabButton active={tab === 'validate'} onClick={() => setTab('validate')} n={2} label="Validar" badge={toValidate || null} />
        <TabButton active={tab === 'save'} onClick={() => setTab('save')} n={3} label="Guardar" badge={approved || null} tone="ok" />
      </nav>
    </div>
  );
}

function TabButton(p: { active: boolean; onClick(): void; n: number; label: string; badge: number | null; tone?: 'ok' }) {
  return (
    <button className={`m-tab${p.active ? ' on' : ''}`} onClick={p.onClick} aria-current={p.active ? 'page' : undefined}>
      <span className="m-tab-n">{p.n}</span>
      <span className="m-tab-label">{p.label}</span>
      {p.badge !== null && <span className={`m-tab-badge${p.tone === 'ok' ? ' ok' : ''}`}>{p.badge}</span>}
    </button>
  );
}

function MobileUnsupported() {
  return (
    <main className="home">
      <div className="home-card">
        <div className="home-logo" aria-hidden="true">
          <Logo />
        </div>
        <h1>Actualiza Safari</h1>
        <p className="home-lead">
          Este navegador no permite guardar las fotos dentro de la app. Actualiza iOS / iPadOS a una versión reciente.
        </p>
      </div>
    </main>
  );
}
