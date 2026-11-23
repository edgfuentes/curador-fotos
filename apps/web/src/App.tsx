import { useEffect } from 'react';
import { usePlatform, useSession, useStoreApi } from './app/context';
import { useShortcuts } from './app/shortcuts';
import { CamerasDialog } from './components/CamerasDialog';
import { ExportDialog } from './components/ExportDialog';
import { Grid } from './components/Grid';
import { HelpDialog } from './components/HelpDialog';
import { Home, Unsupported } from './components/Home';
import { NewSectorDialog } from './components/NewSectorDialog';
import { Review } from './components/Review';
import { ScanProgress } from './components/ScanProgress';
import { SectorsPanel } from './components/SectorsPanel';
import { SectorWindows } from './components/SectorWindow';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { UpdatePrompt } from './components/UpdatePrompt';

export function App() {
  const { fileSystem } = usePlatform();
  const store = useStoreApi();
  const phase = useSession((s) => s.phase);
  const view = useSession((s) => s.view);
  const stage = useSession((s) => s.stage);
  const dialog = useSession((s) => s.dialog);
  const toasts = useSession((s) => s.toasts);
  useShortcuts(store);

  // Pedir almacenamiento persistente para que el navegador no borre marcas ni caché.
  useEffect(() => {
    void navigator.storage?.persist?.().catch(() => undefined);
  }, []);

  const supported = fileSystem.isSupported();

  return (
    <>
      <a className="skip" href="#main">
        Saltar al contenido
      </a>
      {!supported ? (
        <Unsupported />
      ) : phase === 'home' ? (
        <Home />
      ) : phase === 'scanning' ? (
        <ScanProgress />
      ) : (
        <div className="app">
          <Toolbar />
          <div className="workspace">
            <Sidebar />
            <main id="main" className="main">
              <Grid />
            </main>
            {stage === 'classify' && <SectorsPanel />}
          </div>
          <SectorWindows />
          {view === 'review' && <Review />}
        </div>
      )}
      {dialog === 'help' && <HelpDialog />}
      {dialog === 'cameras' && <CamerasDialog />}
      {dialog === 'export' && <ExportDialog />}
      {dialog === 'new-sector' && <NewSectorDialog />}
      <div className="toasts" role="status" aria-live="polite">
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
