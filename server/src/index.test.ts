import { describe, expect, it } from 'vitest';
import { name } from './index.js';

describe('package', () => {
  it('has a name', () => {
    expect(name).toMatch(/^@projektor\//);
  });
});
