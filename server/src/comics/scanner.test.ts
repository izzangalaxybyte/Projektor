import { describe, expect, it } from 'vitest';
import { findShelves, seriesFor } from './scanner.js';

const root = '/media/comics';
const at = (...parts: string[]) => [root, ...parts].join('/');

describe('seriesFor', () => {
  it('folds range and chapter folders into the series above them', () => {
    expect(
      seriesFor(root, at('Spiderman', 'The Amazing Spiderman', '001-100', 'ASM 001.cbr')),
    ).toEqual({ key: at('Spiderman', 'The Amazing Spiderman'), title: 'The Amazing Spiderman' });
    expect(seriesFor(root, at('Kaguya-sama - Love Is War', 'Chap 242-259', 'c242.cbz')).title).toBe(
      'Kaguya-sama - Love Is War',
    );
  });

  it('names generic folders after the series above them', () => {
    expect(seriesFor(root, at('DC', 'batman', 'Annual', 'Batman Annual 01.cbr')).title).toBe(
      'batman - Annual',
    );
    expect(seriesFor(root, at('Iron Man', '05. Volume 4', 'Iron Man 001.cbr')).title).toBe(
      'Iron Man - Volume 4',
    );
  });

  it('groups loose books in a shelf by their names, unless named after the shelf', () => {
    const shelves = new Set([at('Marvel'), at('Flash')]);
    expect(
      seriesFor(root, at('Marvel', 'Avengers - Standoff (2016) (Digital).cbz'), shelves),
    ).toEqual({
      key: `${at('Marvel')}#avengers - standoff`,
      title: 'Avengers - Standoff',
    });
    expect(seriesFor(root, at('Flash', 'The Flash 012 (1988).cbr'), shelves)).toEqual({
      key: at('Flash'),
      title: 'Flash',
    });
  });
});

describe('findShelves', () => {
  it('finds folders with books of their own beside two or more series folders', () => {
    const files = [
      at('Marvel', 'Age of Ultron.cbr'),
      at('Marvel', 'Civil War', '001 Civil War 001.cbr'),
      at('Marvel', 'Secret Wars', '001 Secret Wars 001.cbr'),
      at('One Piece', 'One Piece c120.cbz'),
      at('One Piece', 'Volumes', 'One Piece v01.cbz'),
      at('One Piece', 'Extras', 'One Piece Omake.cbz'),
      at('DC', 'Batman', 'Batman 001.cbr'),
      at('DC', 'Flash', 'Flash 001.cbr'),
    ].map((p) => ({ root, path: p }));
    expect([...findShelves(files)]).toEqual([at('Marvel')]);
  });
});
