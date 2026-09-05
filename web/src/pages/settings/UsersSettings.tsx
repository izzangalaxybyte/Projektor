import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, unwrap } from '../../api/client.js';
import { useAuth } from '../../auth/useAuth.js';

export function UsersSettings() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const users = useQuery({
    queryKey: ['users'],
    queryFn: async () => unwrap(await api.GET('/api/users')),
  });
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: async () => unwrap(await api.GET('/api/auth/sessions')),
  });
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const create = useMutation({
    mutationFn: async () =>
      unwrap(await api.POST('/api/users', { body: { name: name.trim(), pin, isAdmin } })),
    onSuccess: () => {
      setName('');
      setPin('');
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
  });
  const remove = useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.DELETE('/api/users/{id}', { params: { path: { id } } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['users'] }),
  });
  const revoke = useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.DELETE('/api/auth/sessions/{id}', { params: { path: { id } } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['sessions'] }),
  });
  return (
    <div className="settings-body">
      <ul className="card-list" data-testid="user-list">
        {(users.data ?? []).map((u) => (
          <li key={u.id} className="card row-card">
            <span className="avatar tiny" style={{ background: u.avatarColor }}>
              {u.name.slice(0, 1).toUpperCase()}
            </span>
            <strong>{u.name}</strong>
            {u.isAdmin && <span className="pill">admin</span>}
            {u.id !== profile?.id && (
              <button
                type="button"
                className="button danger"
                onClick={() => confirm(`Delete ${u.name}?`) && remove.mutate(u.id)}
              >
                Delete
              </button>
            )}
          </li>
        ))}
      </ul>
      <form
        className="card form"
        data-testid="add-user"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <h2>Add a profile</h2>
        <label>
          Name{' '}
          <input
            className="text-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={40}
          />
        </label>
        <label>
          PIN{' '}
          <input
            className="text-input"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            required
            minLength={4}
          />
        </label>
        <label className="check">
          <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} />{' '}
          Admin
        </label>
        <button
          type="submit"
          className="button primary"
          disabled={create.isPending || pin.length < 4}
        >
          Add profile
        </button>
        {create.error && <p className="form-error">{create.error.message}</p>}
      </form>
      <div className="card">
        <h2>Your devices</h2>
        <ul className="plain">
          {(sessions.data ?? []).map((s) => (
            <li key={s.id} className="row-card">
              <span>
                {s.deviceName} {s.current && <em className="muted">(this device)</em>}
              </span>
              <span className="muted small">
                last seen {new Date(s.lastSeenAt).toLocaleString()}
              </span>
              {!s.current && (
                <button
                  type="button"
                  className="button"
                  onClick={() => revoke.mutate(s.id)}
                  aria-label={`Remove ${s.deviceName}`}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
