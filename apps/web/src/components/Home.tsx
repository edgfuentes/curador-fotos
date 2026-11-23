import { useEffect, useState } from 'react';
import type { RememberedSource } from '@curador/core';
import { usePlatform, useSession, useStoreApi } from '../app/context';
import { createDemoSource } from '../app/demo';

export function Home() {
  const { fileSystem } = usePlatform();
  const store = useStoreApi();
  const error = useSession((s) => s.error);
  const [remembered, setRemembered] = useState<RememberedSource | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fileSystem.getRememberedSource().then(setRemembered).catch(() => setRemembered(null));
  }, [fileSystem]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    store.setError(null);
    try {
      await fn();
    } catch (err) {
      store.setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const pick = () =>
    run(async () => {
      const source = await fileSystem.pickSourceDirectory();
      if (source) await store.openSource(source);
    });

  const resume = () =>
    run(async () => {
      if (!remembered) return;
      const source = await remembered.reopen();
      if (source) await store.openSource(source);
      else store.setError('No se concedió permiso para leer la carpeta. Vuelve a intentarlo o elige otra.');
    });

  const demo = () =>
    run(async () => {
      await store.openSource(await createDemoSource(), { demo: true });
    });

  return (
    <main className="home" aria-labelledby="home-title">
      <div className="home-card">
        <div className="home-logo" aria-hidden="true">
          <Logo />
        </div>
        <h1 id="home-title">Curador de Fotos</h1>
        <p className="home-lead">
          Ordena por fecha real de captura, marca las que se publican y exporta los <strong>originales</strong> sin ninguna
          pérdida de calidad.
        </p>
        <div className="home-actions">
          <button className="btn btn-primary btn-lg" onClick={pick} disabled={busy} autoFocus>
            Elegir carpeta de fotos…
          </button>
          {remembered && (
            <button className="btn btn-lg" onClick={resume} disabled={busy}>
              Continuar con «{remembered.name}»
            </button>
          )}
        </div>
        {error && (
          <p className="home-error" role="alert">
            {error}
          </p>
        )}
        <ul className="home-points">
          <li>Las fotos nunca salen de este Mac: no hay servidor.</li>
          <li>Los originales no se modifican, ni se mueven, ni se recomprimen.</li>
          <li>Las copias exportadas se verifican con SHA-256 contra el original.</li>
        </ul>
        <button className="link" onClick={demo} disabled={busy}>
          Probar con fotos de demostración
        </button>
      </div>
    </main>
  );
}

export function Logo({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Curador de Fotos">
      <rect x="4" y="12" width="44" height="40" rx="7" fill="var(--accent)" opacity="0.35" />
      <rect x="14" y="6" width="44" height="40" rx="7" fill="var(--accent)" />
      <path d="M24 26l7 7 13-13" fill="none" stroke="var(--on-accent)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Unsupported() {
  return (
    <main className="home" aria-labelledby="unsupported-title">
      <div className="home-card">
        <div className="home-logo" aria-hidden="true">
          <Logo />
        </div>
        <h1 id="unsupported-title">Abre esta app en Google Chrome o Microsoft Edge</h1>
        <p className="home-lead">
          Para leer tus carpetas de fotos y crear «Para subir a redes» sin subir nada a internet, la app usa la{' '}
          <em>File System Access API</em>, que Safari y Firefox todavía no ofrecen.
        </p>
        <ol className="home-points">
          <li>Copia la dirección de esta página.</li>
          <li>Ábrela en Chrome o Edge (en Mac, también puedes instalarla como app desde la barra de direcciones).</li>
        </ol>
        {!window.isSecureContext && (
          <p className="home-error" role="alert">
            Además, la página debe abrirse con <strong>https://</strong> (o desde localhost).
          </p>
        )}
      </div>
    </main>
  );
}
