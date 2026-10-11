import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initTelegram } from './telegram';
import { App } from './App';
import './styles.css';

// Must run before React paints, so the theme is right on the first frame.
initTelegram();

/**
 * The visible viewport, for sheets and bars that must stay above the
 * on-screen keyboard: `100vh` in a WebView ignores the keyboard, the visual
 * viewport does not.
 */
function trackViewport(): void {
  const viewport = window.visualViewport;
  const apply = () => {
    const height = viewport?.height ?? window.innerHeight;
    document.documentElement.style.setProperty('--vvh', `${height}px`);
  };
  apply();
  viewport?.addEventListener('resize', apply);
  window.addEventListener('resize', apply);
}
trackViewport();

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
