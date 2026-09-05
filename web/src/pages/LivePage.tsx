import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/useAuth.js';
import type { LiveChannel } from '../api/client.js';
import {
  fmtClock,
  programmeProgress,
  useLiveCategories,
  useLiveChannels,
  useLiveStatus,
} from '../hooks/useLive.js';

export function LivePage() {
  const { isAdmin } = useAuth();
  const status = useLiveStatus();
  const categories = useLiveCategories();
  const channels = useLiveChannels();
  const [category, setCategory] = useState<string | null>(null);

  if (status.data && !status.data.configured) {
    return (
      <section className="page">
        <h1>Live TV</h1>
        <p className="muted">
          Live TV is not set up yet.{' '}
          {isAdmin ? (
            <Link to="/settings/metadata">Enter the IPTV username and password in Settings.</Link>
          ) : (
            'Ask the owner to add the IPTV login in Settings.'
          )}
        </p>
      </section>
    );
  }

  const list = (channels.data ?? []).filter((c) => !category || c.categoryId === category);
  return (
    <section className="page">
      <header className="page-head">
        <h1>Live TV</h1>
        <div className="page-tools">
          <span className="muted" data-testid="channel-count">
            {list.length} channels
          </span>
        </div>
      </header>
      <div className="chips" role="tablist" aria-label="Categories">
        <button
          type="button"
          role="tab"
          aria-selected={category === null}
          className={`chip ${category === null ? 'active' : ''}`}
          onClick={() => setCategory(null)}
          data-testid="category-all"
        >
          All
        </button>
        {(categories.data ?? []).map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={category === c.id}
            className={`chip ${category === c.id ? 'active' : ''}`}
            onClick={() => setCategory(c.id)}
            data-testid={`category-${c.id}`}
          >
            {c.name}
          </button>
        ))}
      </div>
      {channels.isPending && <p className="muted">Loading channels…</p>}
      {channels.isError && <p className="form-error">Could not load channels.</p>}
      {channels.isSuccess && list.length === 0 && (
        <p className="muted">
          {status.data?.lastError
            ? `The provider could not be reached: ${status.data.lastError}`
            : 'No channels yet. The guide refreshes a moment after the login is saved.'}
        </p>
      )}
      <ul className="channel-list plain">
        {list.map((c) => (
          <ChannelRow key={c.id} channel={c} />
        ))}
      </ul>
    </section>
  );
}

function ChannelRow({ channel }: { channel: LiveChannel }) {
  const now = channel.now;
  return (
    <li>
      <Link
        to={`/live/${channel.id}/watch`}
        className="channel"
        data-testid={`channel-${channel.id}`}
      >
        <span className="channel-logo">
          {channel.logoUrl ? (
            <img src={channel.logoUrl} alt="" loading="lazy" />
          ) : (
            <span className="channel-number">{channel.number ?? '·'}</span>
          )}
        </span>
        <span className="channel-main">
          <span className="channel-name">
            {channel.number !== null && <span className="muted">{channel.number} </span>}
            {channel.name}
          </span>
          {now ? (
            <span className="now-next">
              <span className="now">
                <span className="muted small">{fmtClock(now.startAt)}</span> {now.title}
              </span>
              <span className="progress">
                <span style={{ width: `${Math.round(programmeProgress(now) * 100)}%` }} />
              </span>
              {channel.next && (
                <span className="muted small">
                  Next {fmtClock(channel.next.startAt)} · {channel.next.title}
                </span>
              )}
            </span>
          ) : (
            <span className="muted small">No guide information</span>
          )}
        </span>
        {channel.hasArchive && (
          <span className="pill" title={`Catch-up for ${channel.archiveDays} days`}>
            Catch-up
          </span>
        )}
      </Link>
    </li>
  );
}
