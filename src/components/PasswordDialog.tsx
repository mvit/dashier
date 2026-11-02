import { Component, Show, createSignal } from 'solid-js';
import { Modal } from './Modal';

/**
 * Asks for the file's password: once to open its data, or twice to set one (`confirm`: the dialog's title, "Add a
 * password"). `onSubmit` resolves to an error to show (and the dialog stays for another try), or to nothing.
 */
export const PasswordDialog: Component<{ confirm?: string; onSubmit: (password: string) => Promise<string | void>; onClose?: () => void }> = (props) => {
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
    <Modal
      class="d-small d-password"
      title={props.confirm ?? 'This report is encrypted'}
      subtitle={props.confirm && 'If you lose the password, the data cannot be recovered.'}
      onClose={props.onClose}
      onSubmit={submit}
      onKeyDown={(e) => e.key === 'Escape' && props.onClose?.()}
      ref={(f) => setTimeout(() => f.querySelector('input')?.focus())}
    >
      <div class="modal-body d-password-body">
        {field('Password')}
        <Show when={props.confirm}>{field('Confirm password')}</Show>
        <Show when={error()}>
          <p class="d-form-error" role="alert">{error()}</p>
        </Show>
      </div>
      <div class="modal-footer">
        <Show when={props.onClose}>
          <button type="button" class="btn-secondary" onClick={() => props.onClose!()}>Cancel</button>
        </Show>
        <button class="btn-primary">{props.confirm ? 'Save with password' : 'Open'}</button>
      </div>
    </Modal>
  );
};
