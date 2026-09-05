import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, unwrap } from '../api/client.js';
import { authStore } from '../auth/store.js';
import { PinPad } from '../components/PinPad.js';

/** First run: create the admin profile. */
export function SetupPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const setup = useMutation({
    mutationFn: async (pin: string) =>
      unwrap(await api.POST('/api/auth/setup', { body: { name: name.trim(), pin } })),
    onSuccess: (data) => {
      authStore.signIn(data.token, data.profile);
      navigate('/', { replace: true });
    },
  });
  return (
    <main className="auth-page">
      <h1 className="brand">Projektor</h1>
      <p className="muted">Welcome. Create the first profile; it will be the admin.</p>
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
      <PinPad
        label="Choose a 4 to 6 digit PIN"
        busy={setup.isPending || !name.trim()}
        error={setup.error ? setup.error.message : null}
        onSubmit={(pin) => name.trim() && setup.mutate(pin)}
      />
    </main>
  );
}
