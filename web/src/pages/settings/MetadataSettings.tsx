import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, unwrap, type SettingsView } from '../../api/client.js';
import { useLiveStatus } from '../../hooks/useLive.js';

export function MetadataSettings() {
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: async () => unwrap(await api.GET('/api/settings')),
  });
  const save = useMutation({
    mutationFn: async (body: Record<string, string | null>) =>
      unwrap(await api.PATCH('/api/settings', { body })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings'] });
      // IPTV changes start a refresh on the server; the live status card should follow it.
      void qc.invalidateQueries({ queryKey: ['live'] });
    },
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
      <IptvCard settings={s} save={(body) => save.mutate(body)} />
      {save.error && <p className="form-error">{save.error.message}</p>}
    </div>
  );
}

function IptvCard({
  settings: s,
  save,
}: {
  settings: SettingsView;
  save: (body: Record<string, string | null>) => void;
}) {
  const qc = useQueryClient();
  const status = useLiveStatus();
  const refresh = useMutation({
    mutationFn: async () => unwrap(await api.POST('/api/live/refresh')),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['live'] }),
  });
  const st = status.data;
  const summary = !st
    ? ''
    : !st.configured
      ? 'Not set up'
      : st.refreshing
        ? 'Refreshing…'
        : st.lastError
          ? `Error: ${st.lastError}`
          : `${st.channels} channels, ${st.programmes} programmes` +
            (st.accountStatus ? ` · account ${st.accountStatus}` : '') +
            (st.lastRefreshAt
              ? ` · refreshed ${new Date(st.lastRefreshAt).toLocaleTimeString()}`
              : '');
  return (
    <div className="card form" data-testid="iptv-card">
      <h2>Live TV (IPTV)</h2>
      <p className="muted small">
        Your Xtream Codes login. The server fetches channels and the guide every six hours and
        relays streams, so devices never see these details. The address changes now and then; update
        it here when the provider moves.
      </p>
      <label>
        Server address{' '}
        <input
          className="text-input"
          defaultValue={s.iptvUrl}
          data-testid="iptv-url"
          onBlur={(e) => e.target.value !== s.iptvUrl && save({ iptvUrl: e.target.value || null })}
        />
      </label>
      <label>
        Username{' '}
        <input
          className="text-input"
          defaultValue={s.iptvUsername ?? ''}
          data-testid="iptv-username"
          onBlur={(e) =>
            e.target.value !== (s.iptvUsername ?? '') &&
            save({ iptvUsername: e.target.value || null })
          }
        />
      </label>
      <SecretInline
        label="Password"
        status={s.iptvPassword}
        onSave={(v) => save({ iptvPassword: v })}
        testId="iptv-password"
      />
      <div className="secret-row">
        <button
          type="button"
          className="button"
          disabled={!st?.configured || refresh.isPending}
          onClick={() => refresh.mutate()}
          data-testid="iptv-refresh"
        >
          Refresh channels now
        </button>
        <span className="muted small" data-testid="iptv-status">
          {summary}
        </span>
      </div>
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
