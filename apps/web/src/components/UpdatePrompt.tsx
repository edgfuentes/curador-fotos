import { useRegisterSW } from 'virtual:pwa-register/react';

/** Aviso cuando hay una versión nueva de la app (service worker). */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh && !offlineReady) return null;
  return (
    <div className="update" role="alert">
      {needRefresh ? (
        <>
          <span>Hay una versión nueva de la app.</span>
          <button className="btn btn-primary btn-sm" onClick={() => void updateServiceWorker(true)}>
            Actualizar
          </button>
          <button className="btn btn-sm" onClick={() => setNeedRefresh(false)}>
            Después
          </button>
        </>
      ) : (
        <>
          <span>Lista para usarse sin conexión.</span>
          <button className="btn btn-sm" onClick={() => setOfflineReady(false)}>
            Entendido
          </button>
        </>
      )}
    </div>
  );
}
