import { describe, expect, it } from 'vitest';
import { matchesSearch, searchKey } from './search.js';

describe('matchesSearch', () => {
  it('ignores hyphens, spaces and case', () => {
    for (const q of ['spiderman', 'Spider-Man', 'spider man', 'SPIDER MAN'])
      for (const title of ['The Amazing Spiderman', 'Spider-Man (2016)', 'Ultimate Spider Man'])
        expect(matchesSearch(title, q), `${q} → ${title}`).toBe(true);
    expect(matchesSearch('Iron Man - Volume 4', 'ironman')).toBe(true);
    expect(matchesSearch('The Invincible Ironman', 'iron man')).toBe(true);
  });

  it('needs every word, in any order', () => {
    expect(matchesSearch('Batman - The Dark Knight Returns', 'dark knight batman')).toBe(true);
    expect(matchesSearch('Batman - Year One', 'batman knight')).toBe(false);
    expect(matchesSearch('Superman', 'spiderman')).toBe(false);
    expect(matchesSearch('Spider-Woman', 'Spider-Man')).toBe(false);
    expect(matchesSearch('Spider-Woman', 'spider man')).toBe(false);
  });

  it('matches what is typed so far', () => {
    expect(matchesSearch('The Amazing Spider-Man', 'spide')).toBe(true);
    expect(matchesSearch('The Amazing Spider-Man', 'amaz spid')).toBe(true);
  });

  it('drops accents and reads & as and', () => {
    expect(matchesSearch('Pokémon Adventures', 'pokemon')).toBe(true);
    expect(matchesSearch('Batman and Robin', 'batman & robin')).toBe(true);
    expect(searchKey('Spider-Man: No Way Home')).toBe('spidermannowayhome');
  });

  it('matches everything for an empty or punctuation-only query', () => {
    expect(matchesSearch('Anything', '')).toBe(true);
    expect(matchesSearch('Anything', ' - ')).toBe(true);
  });
});
