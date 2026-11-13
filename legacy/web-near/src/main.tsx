import './polyfills';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Fonts are bundled and served by this app (OFL), as in Noren on NEAR: no request to a font CDN.
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource-variable/urbanist';
import '@fontsource/space-mono/400.css';
import '@fontsource/space-mono/700.css';
// Noren on NEAR's system, copied verbatim, then the Avalanche additions.
import './ui/nk/styles.css';
import './ui/nk/app-base.css';
import './ui/nk/near.css';
import './ui/nk/avax.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
