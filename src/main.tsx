import { createEffect, createRoot } from 'solid-js';
import { render } from 'solid-js/web';
import { capturePristine } from './runtime/save';
import { store } from './runtime/store';
import { App } from './App';
import { PasswordDialog } from './components/PasswordDialog';
import './styles/theme.css';

// before anything changes the DOM: saving writes this page back
capturePristine();

async function boot() {
  const root = document.getElementById('app');
  const splash = document.getElementById('d-splash');
  // an encrypted file asks for its password before any of the report renders
  if (root && splash && store.locked()) {
    splash.style.display = 'none';
    await new Promise<void>(done => {
      const dispose = render(() => (
        <div class={`ed-root theme-${store.isDark() ? 'dark' : 'light'}`}>
          <PasswordDialog onSubmit={async (pw) => ((await store.unlock(pw)) ? (dispose(), done()) : 'Wrong password')} />
        </div>
      ), root);
    });
    splash.style.display = '';
  }
  // the splash says what's being read: a big table can take a while
  const line = splash?.querySelector('span');
  const stop = createRoot(dispose => (createEffect(() => line && store.status() && (line.textContent = store.status())), dispose));
  try {
    await store.hydrate();
  } catch (err) {
    console.error('[dashier] Boot hydration error:', err);
  }
  stop();
  splash?.remove();
  if (root) render(() => <App />, root);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
