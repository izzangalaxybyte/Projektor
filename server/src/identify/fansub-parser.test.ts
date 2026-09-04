import { describe, expect, it } from 'vitest';
import { parseFansubName, type ParsedFansub } from './fansub-parser.js';

type Case = [file: string, dirs: string[], expected: Partial<ParsedFansub>];

const cases: Case[] = [
  [
    '[SubGroup] Sample Anime - 13 [1080p][HEVC][Dual-Audio].mkv',
    [],
    { title: 'Sample Anime', episode: 13, season: null, group: 'SubGroup', confidence: 'high' },
  ],
  [
    '[SubsPlease] Frieren - Sousou no Frieren - 28 (1080p) [ABC123].mkv',
    [],
    { title: 'Frieren - Sousou no Frieren', episode: 28, group: 'SubsPlease' },
  ],
  [
    '[Erai-raws] Jujutsu Kaisen 2nd Season - 05 [1080p][Multiple Subtitle][ENG].mkv',
    [],
    {
      title: 'Jujutsu Kaisen',
      searchTitle: 'Jujutsu Kaisen 2nd Season',
      season: 2,
      episode: 5,
      group: 'Erai-raws',
    },
  ],
  [
    '[Judas] Spy x Family - S02E03v2 [1080p][HEVC x265 10bit][Multi-Subs].mkv',
    [],
    { title: 'Spy x Family', season: 2, episode: 3, version: 2, group: 'Judas' },
  ],
  ['Attack on Titan S04E28 1080p.mkv', [], { title: 'Attack on Titan', season: 4, episode: 28 }],
  [
    '[HorribleSubs] One Piece - 1000 [720p].mkv',
    [],
    { title: 'One Piece', episode: 1000, season: null },
  ],
  ['Cowboy Bebop - 01 - Asteroid Blues [BD 1080p].mkv', [], { title: 'Cowboy Bebop', episode: 1 }],
  [
    '[Group] Mushoku Tensei S2 - 12 END [1080p].mkv',
    [],
    { title: 'Mushoku Tensei', searchTitle: 'Mushoku Tensei S2', season: 2, episode: 12 },
  ],
  [
    '[Anime Time] Steins;Gate - 01 [BD][Dual Audio][1080p][HEVC 10bit x265][AAC][Multi Sub].mkv',
    [],
    { title: 'Steins;Gate', episode: 1, group: 'Anime Time' },
  ],
  ['Vinland Saga Season 2 - 08.mkv', [], { title: 'Vinland Saga', season: 2, episode: 8 }],
  [
    '[EMBER] Chainsaw Man (2022) (Season 1) [BDRip] [1080p Dual Audio HEVC 10 bits] - 05.mkv',
    [],
    { title: 'Chainsaw Man', year: 2022, season: 1, episode: 5, group: 'EMBER' },
  ],
  [
    '[ASW] Oshi no Ko - 11v2 [1080p HEVC x265 10Bit][AAC].mkv',
    [],
    { title: 'Oshi no Ko', episode: 11, version: 2 },
  ],
  [
    '[Commie] Mob Psycho 100 - 06 [BD 720p AAC] [1A2B3C4D].mkv',
    [],
    { title: 'Mob Psycho 100', episode: 6 },
  ],
  [
    '[Coalgirls]_Fullmetal_Alchemist_Brotherhood_01_(1920x1080_Blu-ray_FLAC)_[ABCDEF12].mkv',
    [],
    { title: 'Fullmetal Alchemist Brotherhood', episode: 1, group: 'Coalgirls' },
  ],
  [
    '[Doki] Made in Abyss - 13 (1920x1080 Hi10P BD FLAC) [12345678].mkv',
    [],
    { title: 'Made in Abyss', episode: 13 },
  ],
  [
    '[SubsPlease] Bocchi the Rock! - 12 (1080p) [1A2B3C4D].mkv',
    [],
    { title: 'Bocchi the Rock!', episode: 12 },
  ],
  [
    '[SubsPlease] Re Zero kara Hajimeru Isekai Seikatsu S3 - 07 (1080p).mkv',
    [],
    { title: 'Re Zero kara Hajimeru Isekai Seikatsu', season: 3, episode: 7 },
  ],
  [
    '[Erai-raws] Mushishi Zoku Shou - 01 ~ 10 [BD 1080p].mkv',
    [],
    { title: 'Mushishi Zoku Shou', episode: 1 },
  ],
  ['[Group] Show Name - 01-02 [1080p].mkv', [], { title: 'Show Name', episode: 1, episodeEnd: 2 }],
  ['[Group] Show Name - S01E01-E02 [1080p].mkv', [], { season: 1, episode: 1, episodeEnd: 2 }],
  [
    'Neon Genesis Evangelion - Episode 26 [BD].mkv',
    [],
    { title: 'Neon Genesis Evangelion', episode: 26 },
  ],
  ['Monster Ep 74.mkv', [], { title: 'Monster', episode: 74 }],
  [
    '[Group] Kaguya-sama wa Kokurasetai - 07 [1080p].mkv',
    [],
    { title: 'Kaguya-sama wa Kokurasetai', episode: 7 },
  ],
  ['[Group] 86 Eighty Six - 03 [1080p].mkv', [], { title: '86 Eighty Six', episode: 3 }],
  ['[Group] Dr. Stone - 02v3 [720p].mkv', [], { title: 'Dr. Stone', episode: 2, version: 3 }],
  [
    '[Group] Hunter x Hunter (2011) - 148 [BD 1080p].mkv',
    [],
    { title: 'Hunter x Hunter', year: 2011, episode: 148 },
  ],
  [
    '[Group] Sword Art Online II - 14 [1080p].mkv',
    [],
    { title: 'Sword Art Online II', episode: 14, season: null },
  ],
  ['Death Note 37.mkv', [], { title: 'Death Note', episode: 37 }],
  ['[Group] Show Name - 12.5 [1080p].mkv', [], { title: 'Show Name', episode: 12 }],
  [
    '[Group] Boku no Hero Academia 6th Season - 24 [1080p].mkv',
    [],
    { title: 'Boku no Hero Academia', season: 6, episode: 24 },
  ],
  [
    '[Group] Tensei Shitara Slime Datta Ken Part 2 - 03 [1080p].mkv',
    [],
    { title: 'Tensei Shitara Slime Datta Ken', season: 2, episode: 3 },
  ],
  // Folder hints
  ['03.mkv', ['Frieren', 'Season 01'], { title: 'Frieren', season: 1, episode: 3 }],
  ['[Group] - 05 [1080p].mkv', ['Frieren'], { title: 'Frieren', episode: 5 }],
  [
    '[Group] Frieren - 05 [1080p].mkv',
    ['Frieren (2023)', 'Season 02'],
    { title: 'Frieren', season: 2, episode: 5 },
  ],
  // No number at all
  [
    '[Group] Some Movie Special [1080p].mkv',
    [],
    { title: 'Some Movie Special', episode: null, confidence: 'low' },
  ],
];

describe('parseFansubName', () => {
  it.each(cases)('%s in %j', (file, dirs, expected) => {
    expect(parseFansubName(file, dirs)).toMatchObject(expected);
  });

  it('covers at least 30 real-world names', () => {
    expect(cases.length).toBeGreaterThanOrEqual(30);
  });
});
