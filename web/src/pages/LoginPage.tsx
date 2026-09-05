import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, unwrap, type Profile } from '../api/client.js';
import { authStore } from '../auth/store.js';
import { PinPad } from '../components/PinPad.js';

/** Pick a profile, enter its PIN. */
export function LoginPage() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Profile | null>(null);
  const profiles = useQuery({
    queryKey: ['profiles'],
    queryFn: async () => unwrap(await api.GET('/api/auth/profiles')),
  });
  const login = useMutation({
    mutationFn: async (pin: string) =>
      unwrap(
        await api.POST('/api/auth/login', {
          body: { profileId: selected!.id, pin, deviceName: deviceName() },
        }),
      ),
    onSuccess: (data) => {
      authStore.signIn(data.token, data.profile);
      navigate('/', { replace: true });
    },
  });

  return (
    <main className="auth-page">
      <h1 className="brand">Projektor</h1>
      {!selected ? (
        <>
          <p className="muted">Who is watching?</p>
          <div className="profile-grid">
            {(profiles.data ?? []).map((p) => (
              <button
                key={p.id}
                type="button"
                className="profile-card"
                onClick={() => setSelected(p)}
                data-testid={`profile-${p.name}`}
              >
                <span className="avatar" style={{ background: p.avatarColor }}>
                  {p.name.slice(0, 1).toUpperCase()}
                </span>
                <span>{p.name}</span>
              </button>
            ))}
          </div>
          {profiles.isError && <p className="form-error">Could not reach the server.</p>}
        </>
      ) : (
        <>
          <button type="button" className="link-button" onClick={() => setSelected(null)}>
            ← {selected.name}
          </button>
          <PinPad
            busy={login.isPending}
            error={login.error ? login.error.message : null}
            onSubmit={(pin) => login.mutate(pin)}
          />
        </>
      )}
    </main>
  );
}

function deviceName(): string {
  const ua = navigator.userAgent;
  if (/Tizen/i.test(ua)) return 'Samsung TV';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android browser';
  if (/Mac OS/i.test(ua)) return 'Mac browser';
  if (/Windows/i.test(ua)) return 'Windows browser';
  return 'Browser';
}
