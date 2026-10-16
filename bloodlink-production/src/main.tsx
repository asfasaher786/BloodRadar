import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {MotionConfig} from 'motion/react';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* reducedMotion="user" makes every framer-motion animation honour the
        OS-level prefers-reduced-motion setting (WCAG 2.3.3) — the CSS
        reduced-motion block only covers CSS keyframes, not JS-driven motion. */}
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </StrictMode>,
);

// PWA: register the service worker in production builds only (dev has no
// /sw.js emit and we don't want SW caching to mask HMR during development).
// A failed registration must never break the app — log quietly and move on.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[PWA] Service worker registration failed:', err);
    });
  });
}
