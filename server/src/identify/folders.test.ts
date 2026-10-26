import { describe, expect, it } from 'vitest';
import { cleanFolderTitle, isSpecialName, isSpecialsDir, showFolder } from './folders.js';

describe('cleanFolderTitle', () => {
  it('keeps the title and first year of a release folder name', () => {
    const cases: Array<[string, string, number | null]> = [
      [
        'Futurama (1999) Season 1-7 S01-S07 + Extras (Mixed x265 HEVC 10bit AAC 5.1 RCVR) REPACK',
        'Futurama',
        1999,
      ],
      [
        'The X-Files Season 1, 2, 3, 4, 5, 6, 7, 8 & 9 + Extras DVDRip HDTV TSV',
        'The X-Files',
        null,
      ],
      [
        'Buffy.the.Vampire.Slayer.seasons.01-07.AMZN.1080p.5.1.HEVC.10bit-Bearfish',
        'Buffy the Vampire Slayer',
        null,
      ],
      ['Gintama 001-367 (Seasons 1-10) [BD 1080p][HEVC x265 10bit][Eng-Subs]', 'Gintama', null],
      [
        'DC.Super.Hero.Girls.2019.S01.1080p.AMZN.WEBRip.DDP5.1.x264-NYH[rartv]',
        'DC Super Hero Girls',
        2019,
      ],
      [
        'ED, EDD n EDDY (1999-2009) - Complete ANIMATED TV Series, S01-S06 - 720p HMax Web-DL x264',
        'ED, EDD n EDDY',
        1999,
      ],
      ['Steins;Gate 1080p 10Bit BDRip Dual-Audio Opus 5.1 X265 [NRN]', 'Steins;Gate', null],
      ['Attack on Titan S01-04 (BD 1080p) [Dual Audio] [TatakaeFuniSubs]', 'Attack on Titan', null],
      [
        'Maou Gakuin no Futekigousha S02P01 1080p BDRip 10 bits Dual Audio DD+ x265-EMBER',
        'Maou Gakuin no Futekigousha',
        null,
      ],
      [
        'A Certain Scientific Railgun - Toaru Kagaku no Railgun',
        'A Certain Scientific Railgun',
        null,
      ],
      ['Cromartie High School [480p 10bit X264 DVD Dual-Audio]', 'Cromartie High School', null],
      ['Kaichou wa Maid sama!', 'Kaichou wa Maid sama!', null],
    ];
    for (const [dir, title, year] of cases)
      expect(cleanFolderTitle(dir), dir).toEqual({ title, year });
  });
});

describe('showFolder', () => {
  it('names the show by its folder, looking past catch-all folders', () => {
    expect(showFolder(['Digimon 02'])).toMatchObject({ title: 'Digimon 02', index: 0 });
    expect(showFolder(['Ongoing', 'Beelzebub [BD]', 'Season 1'])).toMatchObject({
      title: 'Beelzebub',
      index: 1,
    });
    expect(showFolder(['Ongoing', 'Summer 2022'])).toBeNull();
    expect(showFolder(['Movies & Others'])).toBeNull();
    expect(showFolder([])).toBeNull();
  });
});

describe('specials', () => {
  it('recognises film, special, and OVA folders and names', () => {
    expect(isSpecialsDir('b. DBZ Movies (1989-2018)')).toBe(true);
    expect(isSpecialsDir('Specials [OVA - OAD]')).toBe(true);
    expect(isSpecialsDir('Season 01')).toBe(false);
    expect(isSpecialName('Digimon Adventure tri. 2 Determination (Dub) Movie.MP4')).toBe(true);
    expect(isSpecialName('[AnimeRG] Date A Live S02EOVA [1080p].mkv')).toBe(true);
    expect(isSpecialName('[Erai-raws] Nanbaka - Special [1080p].mkv')).toBe(true);
    expect(isSpecialName('Dragon Ball GT 01 A Devastating Wish.mkv')).toBe(false);
  });
});
