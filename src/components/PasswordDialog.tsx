import { Component, Show, createSignal } from 'solid-js';

/**
 * Asks for the file's password: once to open its data, or twice to encrypt it (`confirm`). `onSubmit` resolves to
 * an error to show (and the dialog stays for another try), or to nothing.
 */
export const PasswordDialog: Component<{ confirm?: boolean; onSubmit: (password: string) => Promise<string | void>; onClose?: () => void }> = (props) => {
  const [error, setError] = createSignal('');
  // one submit at a time: a double click during the key derivation would run it twice
  let busy = 0;
  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    const [pw, again] = [...(e.currentTarget as HTMLFormElement).querySelectorAll('input')].map(i => i.value);
    if (busy) return;
    if (props.confirm && pw !== again) return void setError("The passwords don't match");
    busy = 1;
    try {
      setError((await props.onSubmit(pw)) || '');
    } finally {
      busy = 0;
    }
  };
  const field = (placeholder: string) => <input type="password" class="d-input" placeholder={placeholder} required />;

  return (
    <div class="modal-backdrop">
      <form class="modal-dialog d-about d-password" onSubmit={submit} ref={(f) => setTimeout(() => f.querySelector('input')?.focus())}>
        <h3>{props.confirm ? 'Encrypt with password' : 'This report is encrypted'}</h3>
        {field('Password')}
        <Show when={props.confirm}>
          {field('Password again')}
          <p><b>If you lose the password, the data cannot be recovered.</b></p>
        </Show>
        <Show when={error()}>
          <p class="d-form-error" role="alert">{error()}</p>
        </Show>
        <div class="d-row">
          <Show when={props.onClose}>
            <button type="button" class="btn-secondary" onClick={() => props.onClose!()}>Cancel</button>
          </Show>
          <button class="btn-primary">{props.confirm ? 'Encrypt' : 'Open'}</button>
        </div>
      </form>
    </div>
  );
};
