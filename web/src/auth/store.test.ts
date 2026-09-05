import { beforeEach, describe, expect, it } from 'vitest';
import { authStore } from './store.js';

beforeEach(() => {
  localStorage.clear();
  authStore.signOut();
});

describe('authStore', () => {
  it('persists sign in to localStorage and notifies subscribers', () => {
    let calls = 0;
    const unsubscribe = authStore.subscribe(() => calls++);
    authStore.signIn('tok', { id: 'u1', name: 'Izzan', isAdmin: true, avatarColor: '#ffffff' });
    expect(authStore.token).toBe('tok');
    expect(authStore.profile?.name).toBe('Izzan');
    expect(JSON.parse(localStorage.getItem('projektor.auth')!)).toMatchObject({ token: 'tok' });
    authStore.signOut();
    expect(authStore.token).toBeNull();
    expect(localStorage.getItem('projektor.auth')).toBeNull();
    expect(calls).toBe(2);
    unsubscribe();
  });
});
