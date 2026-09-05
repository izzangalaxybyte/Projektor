import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api, unwrap } from './api/client.js';
import { useAuth } from './auth/useAuth.js';
import { HomePage } from './pages/HomePage.js';
import { ItemPage } from './pages/ItemPage.js';
import { LibraryPage } from './pages/LibraryPage.js';
import { LivePage } from './pages/LivePage.js';
import { IptvMoviePage, IptvMoviesPage } from './pages/IptvMoviesPage.js';
import { IptvSeriesDetailPage, IptvSeriesPage } from './pages/IptvSeriesPage.js';
import { LiveCatchupPage } from './pages/LiveCatchupPage.js';
import { RecordingsPage } from './pages/RecordingsPage.js';
import { LivePlayerPage } from './pages/LivePlayerPage.js';
import { PlayerPage } from './pages/PlayerPage.js';
import { SearchPage } from './pages/SearchPage.js';
import { LibrariesSettings } from './pages/settings/LibrariesSettings.js';
import { MetadataSettings } from './pages/settings/MetadataSettings.js';
import { ReviewSettings } from './pages/settings/ReviewSettings.js';
import { SettingsLayout } from './pages/settings/SettingsLayout.js';
import { UsersSettings } from './pages/settings/UsersSettings.js';
import { LoginPage } from './pages/LoginPage.js';
import { SetupPage } from './pages/SetupPage.js';
import { AppShell } from './shell/AppShell.js';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 10_000, refetchOnWindowFocus: false } },
});

/** Sends first-run visitors to setup, signed-out visitors to login, and everyone else through. */
function Gate({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const location = useLocation();
  const setup = useQuery({
    queryKey: ['setup'],
    queryFn: async () => unwrap(await api.GET('/api/auth/setup')),
    enabled: !token,
  });
  if (token) return <>{children}</>;
  if (setup.isPending) return <main className="auth-page muted">Loading…</main>;
  if (setup.data?.needsSetup) return <Navigate to="/setup" replace />;
  return <Navigate to="/login" replace state={{ from: location }} />;
}

/** Once signed in, the auth pages bounce to home. */
function PublicOnly({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  return token ? <Navigate to="/" replace /> : <>{children}</>;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route
            path="/setup"
            element={
              <PublicOnly>
                <SetupPage />
              </PublicOnly>
            }
          />
          <Route
            path="/login"
            element={
              <PublicOnly>
                <LoginPage />
              </PublicOnly>
            }
          />
          <Route
            path="/play/:fileId"
            element={
              <Gate>
                <PlayerPage />
              </Gate>
            }
          />
          <Route
            path="/live/:channelId/catchup/:programmeId"
            element={
              <Gate>
                <LiveCatchupPage />
              </Gate>
            }
          />
          <Route
            path="/live/recordings/:recordingId/watch"
            element={
              <Gate>
                <LiveCatchupPage source="recording" />
              </Gate>
            }
          />
          <Route
            path="/live/movies/:vodId/watch"
            element={
              <Gate>
                <LiveCatchupPage source="movie" />
              </Gate>
            }
          />
          <Route
            path="/live/series/:seriesId/episodes/:episodeId/watch"
            element={
              <Gate>
                <LiveCatchupPage source="episode" />
              </Gate>
            }
          />
          <Route
            path="/live/:channelId/watch"
            element={
              <Gate>
                <LivePlayerPage />
              </Gate>
            }
          />
          <Route
            element={
              <Gate>
                <AppShell />
              </Gate>
            }
          >
            <Route index element={<HomePage />} />
            <Route path="movies" element={<LibraryPage kind="movie" />} />
            <Route path="tv" element={<LibraryPage kind="tv" />} />
            <Route path="anime" element={<LibraryPage kind="anime" />} />
            <Route path="live" element={<LivePage />} />
            <Route path="live/movies" element={<IptvMoviesPage />} />
            <Route path="live/movies/:vodId" element={<IptvMoviePage />} />
            <Route path="live/series" element={<IptvSeriesPage />} />
            <Route path="live/series/:seriesId" element={<IptvSeriesDetailPage />} />
            <Route path="live/recordings" element={<RecordingsPage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="items/:id" element={<ItemPage />} />
            <Route path="settings" element={<SettingsLayout />}>
              <Route index element={<LibrariesSettings />} />
              <Route path="metadata" element={<MetadataSettings />} />
              <Route path="users" element={<UsersSettings />} />
              <Route path="review" element={<ReviewSettings />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
