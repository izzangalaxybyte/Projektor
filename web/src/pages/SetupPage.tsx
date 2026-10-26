import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, unwrap } from '../api/client.js';
import { authStore } from '../auth/store.js';

/** First run: create the admin profile. */
export function SetupPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const setup = useMutation({
    mutationFn: async () =>
      unwrap(await api.POST('/api/auth/setup', { body: { name: name.trim() } })),
    onSuccess: (data) => {
      authStore.signIn(data.token, data.profile);
      navigate('/', { replace: true });
    },
  });
  return (
    <main className="auth-page">
      <h1 className="brand">Projektor</h1>
      <p className="muted">Welcome. Create the first profile; it will be the admin.</p>
      <form
        className="auth-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) setup.mutate();
        }}
      >
        <label htmlFor="name" className="field-label">
          Name
        </label>
        <input
          id="name"
          className="text-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
        />
        <button
          type="submit"
          className="button primary"
          disabled={setup.isPending || !name.trim()}
          data-testid="setup-submit"
        >
          Create profile
        </button>
        {setup.error && <p className="form-error">{setup.error.message}</p>}
      </form>
    </main>
  );
}
