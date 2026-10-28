import { createEffect, createRoot } from 'solid-js';
import { render } from 'solid-js/web';
import { capturePristine } from './runtime/save';
import { store } from './runtime/store';
import { App } from './App';
import './styles/theme.css';

// before anything changes the DOM: saving writes this page back
capturePristine();

async function boot() {
  // the splash says what's being read: a big table can take a while
  const line = document.querySelector('#d-splash span');
  const stop = createRoot(dispose => (createEffect(() => line && store.status() && (line.textContent = store.status())), dispose));
  try {
    await store.hydrate();
  } catch (err) {
    console.error('[dashier] Boot hydration error:', err);
  }
  stop();
  document.getElementById('d-splash')?.remove();
  const root = document.getElementById('app');
  if (root) render(() => <App />, root);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
