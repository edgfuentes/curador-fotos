import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createWebAdapters } from '@curador/adapters-web';
import { App } from './App';
import { AppProvider, type Platform } from './app/context';
import { SessionStore } from './app/store';
import { applyTheme } from './app/theme';
import './styles.css';

applyTheme();

// Composición: aquí se eligen los adaptadores de la plataforma. Para Capacitor o
// React Native bastaría con crear otros adaptadores que cumplan los mismos puertos.
const adapters = createWebAdapters();
const platform: Platform = {
  fileSystem: adapters.fileSystem,
  thumbnails: adapters.thumbnails,
  createHasher: adapters.createHasher,
  clearCaches: () => adapters.thumbnails.clearCache(),
};
const store = new SessionStore({ storage: adapters.storage, metadata: adapters.metadata });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider platform={platform} store={store}>
      <App />
    </AppProvider>
  </StrictMode>,
);
