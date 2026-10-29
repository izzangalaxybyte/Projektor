import { describe, expect, it } from 'vitest';
import {
  compareBooks,
  inReadingOrder,
  isGenericFolderTitle,
  isGroupingFolder,
  numberingLabel,
  parseComicName,
  seriesTitle,
  sortBooks,
} from './naming.js';

const parsed = (name: string) => {
  const p = parseComicName(name);
  return { volume: p.volume, chapter: p.chapter, bare: p.bare, special: p.special };
};

describe('parseComicName', () => {
  it.each([
    ['One Piece v01.cbz', 1, null],
    ['One Piece v01 (2003) (Digital) (danke-Empire).cbz', 1, null],
    ['One Piece Vol. 20.cbr', 20, null],
    ['One Piece Volume 03.cbz', 3, null],
    ['Berserk_Tome_12.cbz', 12, null],
    ['[Group] Chainsaw Man - c120 [EN].cbz', null, 120],
    ['Chainsaw Man Ch. 120.5.cbz', null, 120.5],
    ['Chainsaw Man Chapter 121 - Title Here.cbz', null, 121],
    ['Vinland Saga v03 c020.cbz', 3, 20],
    ['Vinland.Saga.Vol.03.Ch.020.cbz', 3, 20],
    ['Saga #054.cbz', null, 54],
    ['ワンピース 第3巻.zip', 3, null],
    ['ワンピース 第1050話.cbz', null, 1050],
    ['Tokyo Ghoul re 2018 Ch 5.pdf', null, 5],
  ])('%s → volume %s, chapter %s', (name, volume, chapter) => {
    expect(parsed(name)).toMatchObject({ volume, chapter, bare: false });
  });

  it('reads a bare trailing number as the issue, skipping years', () => {
    expect(parsed('Batman 001.cbz')).toMatchObject({ volume: null, chapter: 1, bare: true });
    expect(parsed('One Piece - 121 (2021).cbz')).toMatchObject({ chapter: 121, bare: true });
    expect(parsed('Spider-Man 2099 007.cbr')).toMatchObject({ chapter: 7, bare: true });
    expect(parsed('Batman v2 015.cbz')).toMatchObject({ volume: 2, chapter: 15, bare: true });
    expect(parsed('Akira (1988).pdf')).toMatchObject({ volume: null, chapter: null });
  });

  it('flags specials', () => {
    expect(parsed('One Piece v05 Extra.cbz').special).toBe(true);
    expect(parsed('Naruto Omake.cbz').special).toBe(true);
    expect(parsed('Naruto v05.cbz').special).toBe(false);
  });

  it('keeps the series name in front of the numbering', () => {
    expect(parseComicName('One Piece v01 (2003).cbz').series).toBe('One Piece');
    expect(parseComicName('[Group] Chainsaw Man - c120.cbz').series).toBe('Chainsaw Man');
    expect(parseComicName('Saga #054.cbz').series).toBe('Saga');
    expect(parseComicName('Watchmen.pdf').series).toBe('Watchmen');
  });
});

describe('compareBooks', () => {
  const book = (fileName: string) => ({ ...parseComicName(fileName), fileName });

  it('reads volumes 1–20, then the loose chapters from 120 on, then unnumbered extras', () => {
    const files = [
      'OP c121.cbz',
      'OP v10.cbz',
      'OP Artbook.cbz',
      'OP v2.cbz',
      'OP c120.cbz',
      'OP v20.cbz',
      'OP c1000.cbz',
      'OP v1.cbz',
      'OP c120.5.cbz',
      'OP v05 Extra.cbz',
      'OP v5.cbz',
    ];
    const sorted = files
      .map(book)
      .sort(compareBooks)
      .map((b) => b.fileName);
    expect(sorted).toEqual([
      'OP v1.cbz',
      'OP v2.cbz',
      'OP v5.cbz',
      'OP v05 Extra.cbz',
      'OP v10.cbz',
      'OP v20.cbz',
      'OP c120.cbz',
      'OP c120.5.cbz',
      'OP c121.cbz',
      'OP c1000.cbz',
      'OP Artbook.cbz',
    ]);
  });

  it('orders chapters inside a volume', () => {
    const sorted = ['X v02 c010.cbz', 'X v01 c002.cbz', 'X v01 c001.cbz', 'X v02 c009.cbz']
      .map(book)
      .sort(compareBooks)
      .map((b) => b.fileName);
    expect(sorted).toEqual([
      'X v01 c001.cbz',
      'X v01 c002.cbz',
      'X v02 c009.cbz',
      'X v02 c010.cbz',
    ]);
  });
});

describe('labels and folders', () => {
  it('labels the numbering', () => {
    expect(numberingLabel({ volume: 3, chapter: null, bare: false })).toBe('Vol. 3');
    expect(numberingLabel({ volume: null, chapter: 120.5, bare: false })).toBe('Ch. 120.5');
    expect(numberingLabel({ volume: 3, chapter: 20, bare: false })).toBe('Vol. 3 · Ch. 20');
    expect(numberingLabel({ volume: null, chapter: 12, bare: true })).toBe('#12');
    expect(numberingLabel({ volume: null, chapter: null, bare: false })).toBeNull();
  });

  it('tells grouping folders from series folders', () => {
    for (const name of [
      'Volumes',
      'Chapters',
      'Vol 01',
      'v01',
      'Specials',
      'Chapter 120-150',
      'Chap 242-259',
      '001-100',
      '11-20',
    ])
      expect(isGroupingFolder(name), name).toBe(true);
    for (const name of ['One Piece', 'Chainsaw Man (2018)', 'Saga', 'Marvel', '52', '1602', '300'])
      expect(isGroupingFolder(name), name).toBe(false);
  });

  it('cleans a series folder name', () => {
    expect(seriesTitle('One Piece (2003) [Digital]')).toBe('One Piece');
    expect(seriesTitle('The Flash (001 - 027 (ongoing) + Annuals)')).toBe('The Flash');
    expect(seriesTitle('Death of the Family {New DC 52 Batman Event} (Complete) [ironFUR')).toBe(
      'Death of the Family',
    );
    expect(seriesTitle('Batman - The Dark Knight (1-23.4) (2011-2013) -=SPIDAROT SHARE=-')).toBe(
      'Batman - The Dark Knight',
    );
    expect(seriesTitle('Spider-Man - Return of the Black Cat GetComics.INFO')).toBe(
      'Spider-Man - Return of the Black Cat',
    );
    expect(seriesTitle('06.Batman - The Man Who Laughs')).toBe('Batman - The Man Who Laughs');
    expect(seriesTitle('01 - Peace In Our Time')).toBe('Peace In Our Time');
    expect(seriesTitle('2004-12 - Wolverine 020-025 - Enemy of the State')).toBe(
      'Wolverine 020-025 - Enemy of the State',
    );
    expect(seriesTitle('52')).toBe('52');
    expect(seriesTitle('100 Bullets')).toBe('100 Bullets');
  });

  it('knows folder names that need the series above them', () => {
    for (const name of ['Annual', 'Variant Covers', 'variants', 'Artbook', 'Mini Series'])
      expect(isGenericFolderTitle(name), name).toBe(true);
    expect(isGenericFolderTitle('Batman Annual')).toBe(false);
  });
});

describe('reading order', () => {
  const book = (fileName: string) => ({ ...parseComicName(fileName), fileName });

  it('reads numbers in brackets', () => {
    expect(parsed('Kaguya-Sama Love is War [Volume 03 - guya].cbz').volume).toBe(3);
    expect(parsed('Secret Files & Origins - Flash (#2).cbr').chapter).toBe(2);
    expect(parsed('Marvel Holiday Special 1996 (c2c) (ActionComics-DCP).cbz').chapter).toBeNull();
  });

  it('follows a story arc folder rather than the issue numbers', () => {
    const arc = [
      '010 Infinity Wars - Arachknight 001 (2018).cbr',
      '001 Infinity Wars Prime 001 (2018).cbr',
      '003 Infinity Wars 001 (2018).cbr',
      '000b (prelude) Heroic Age Prince of Power 002 (2010).cbr',
      '002 Thanos Legacy 001 (2018).cbr',
    ].map(book);
    expect(inReadingOrder(arc)).toBe(true);
    expect(sortBooks(arc).map((b) => b.fileName.slice(0, 4))).toEqual([
      '000b',
      '001 ',
      '002 ',
      '003 ',
      '010 ',
    ]);
  });

  it('keeps issue order for a series named the usual way', () => {
    const series = ['Batman 010 (2012).cbz', 'Batman 002 (2011).cbz', 'Batman 001 (2011).cbz'].map(
      book,
    );
    expect(inReadingOrder(series)).toBe(false);
    expect(sortBooks(series).map((b) => b.chapter)).toEqual([1, 2, 10]);
  });
});
