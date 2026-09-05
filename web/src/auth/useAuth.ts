import { useSyncExternalStore } from 'react';
import { authStore } from './store.js';

/** Current token and profile, re-rendering on sign in/out. */
export function useAuth() {
  const token = useSyncExternalStore(
    (cb) => authStore.subscribe(cb),
    () => authStore.token,
  );
  const profile = useSyncExternalStore(
    (cb) => authStore.subscribe(cb),
    () => authStore.profile,
  );
  return { token, profile, isAdmin: profile?.isAdmin ?? false, signOut: () => authStore.signOut() };
}
