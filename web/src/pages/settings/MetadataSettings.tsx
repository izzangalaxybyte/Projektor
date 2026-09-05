import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, unwrap, type SettingsView } from '../../api/client.js';

export function MetadataSettings() {
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: async () => unwrap(await api.GET('/api/settings')),
  });
  const save = useMutation({
    mutationFn: async (body: Record<string, string | null>) =>
      unwrap(await api.PATCH('/api/settings', { body })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['settings'] }),
  });
  if (!settings.data) return <p className="muted">Loading…</p>;
  const s = settings.data;
  return (
    <div className="settings-body">
      <SecretField
        title="TMDB"
        help="Posters, descriptions, and episode titles come from TMDB. Create a free account at themoviedb.org and paste the v3 API key or v4 read access token."
        status={s.tmdbApiKey}
        onSave={(v) => save.mutate({ tmdbApiKey: v })}
        testId="tmdb-key"
      />
      <div className="card form">
        <h2>OpenSubtitles</h2>
        <p className="muted small">
          Used only when you ask for subtitles a file does not have. Needs an API key
          (opensubtitles.com consumer) and your account login.
        </p>
        <SecretInline
          label="API key"
          status={s.openSubtitlesApiKey}
          onSave={(v) => save.mutate({ openSubtitlesApiKey: v })}
        />
        <label>
          Username{' '}
          <input
            className="text-input"
            defaultValue={s.openSubtitlesUsername ?? ''}
            onBlur={(e) =>
              e.target.value !== (s.openSubtitlesUsername ?? '') &&
              save.mutate({ openSubtitlesUsername: e.target.value || null })
            }
          />
        </label>
        <SecretInline
          label="Password"
          status={s.openSubtitlesPassword}
          onSave={(v) => save.mutate({ openSubtitlesPassword: v })}
        />
      </div>
      {save.error && <p className="form-error">{save.error.message}</p>}
    </div>
  );
}

function SecretField({
  title,
  help,
  status,
  onSave,
  testId,
}: {
  title: string;
  help: string;
  status: SettingsView['tmdbApiKey'];
  onSave: (v: string | null) => void;
  testId: string;
}) {
  return (
    <div className="card form">
      <h2>{title}</h2>
      <p className="muted small">{help}</p>
      <SecretInline label="API key" status={status} onSave={onSave} testId={testId} />
    </div>
  );
}

function SecretInline({
  label,
  status,
  onSave,
  testId,
}: {
  label: string;
  status: SettingsView['tmdbApiKey'];
  onSave: (v: string | null) => void;
  testId?: string;
}) {
  const [value, setValue] = useState('');
  return (
    <div className="secret-row">
      <label>
        {label}{' '}
        <input
          className="text-input"
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={status.set ? `Saved (${status.hint})` : 'Not set'}
          data-testid={testId}
          autoComplete="off"
        />
      </label>
      <button
        type="button"
        className="button primary"
        disabled={!value}
        onClick={() => {
          onSave(value);
          setValue('');
        }}
        data-testid={testId ? `${testId}-save` : undefined}
      >
        Save
      </button>
      {status.set && (
        <button type="button" className="button" onClick={() => onSave(null)}>
          Clear
        </button>
      )}
      <span className="muted small" data-testid={testId ? `${testId}-status` : undefined}>
        {status.set ? `Set ${status.hint}` : 'Not set'}
      </span>
    </div>
  );
}
