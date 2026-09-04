import { describe, expect, it } from 'vitest';
import { parseSceneName, type ParsedName } from './scene-parser.js';

type Case = [file: string, dirs: string[], expected: Partial<ParsedName>];

const episodes: Case[] = [
  [
    'Sample.Show.S01E02.1080p.WEB.H265-GRP.mkv',
    [],
    { kind: 'episode', title: 'Sample Show', season: 1, episode: 2, episodeEnd: null },
  ],
  [
    'The.Office.US.S03E12-E13.720p.HDTV.x264-CTU.mkv',
    [],
    { kind: 'episode', title: 'The Office US', season: 3, episode: 12, episodeEnd: 13 },
  ],
  [
    'Show.S01E01E02.mkv',
    [],
    { kind: 'episode', title: 'Show', season: 1, episode: 1, episodeEnd: 2 },
  ],
  [
    'Show.S01E01-02.mkv',
    [],
    { kind: 'episode', title: 'Show', season: 1, episode: 1, episodeEnd: 2 },
  ],
  [
    'Breaking Bad - 1x05 - Gray Matter.mkv',
    [],
    { kind: 'episode', title: 'Breaking Bad', season: 1, episode: 5 },
  ],
  [
    'Show Name - S01E01 - Pilot.mkv',
    [],
    { kind: 'episode', title: 'Show Name', season: 1, episode: 1 },
  ],
  ['Friends.S02.E07.mkv', [], { kind: 'episode', title: 'Friends', season: 2, episode: 7 }],
  ['Friends S02 E07.mkv', [], { kind: 'episode', title: 'Friends', season: 2, episode: 7 }],
  ['Mr. Robot S01E01.mkv', [], { kind: 'episode', title: 'Mr Robot', season: 1, episode: 1 }],
  [
    'mr.robot.s01e01.720p.hdtv.x264-killers.mkv',
    [],
    { kind: 'episode', title: 'mr robot', season: 1, episode: 1 },
  ],
  [
    'The.Mandalorian.S02E08.2160p.WEB.H265-GGEZ.mkv',
    [],
    { kind: 'episode', title: 'The Mandalorian', season: 2, episode: 8 },
  ],
  [
    'Severance.2022.S01E01.1080p.mkv',
    [],
    { kind: 'episode', title: 'Severance', year: 2022, season: 1, episode: 1 },
  ],
  [
    'Doctor Who (2005) - S01E01 - Rose.mkv',
    [],
    { kind: 'episode', title: 'Doctor Who', year: 2005, season: 1, episode: 1 },
  ],
  [
    'Doctor.Who.2005.S13E01.mkv',
    [],
    { kind: 'episode', title: 'Doctor Who', year: 2005, season: 13, episode: 1 },
  ],
  [
    'Chernobyl.S01E05.Vichnaya.Pamyat.1080p.AMZN.WEB-DL.DDP5.1.H.264-NTb.mkv',
    [],
    { kind: 'episode', title: 'Chernobyl', season: 1, episode: 5 },
  ],
  [
    'Game.of.Thrones.S08E06.The.Iron.Throne.REPACK.1080p.mkv',
    [],
    { kind: 'episode', title: 'Game of Thrones', season: 8, episode: 6 },
  ],
  [
    'Its.Always.Sunny.in.Philadelphia.S14E10.mkv',
    [],
    { kind: 'episode', title: 'Its Always Sunny in Philadelphia', season: 14, episode: 10 },
  ],
  ['The.100.S07E16.mkv', [], { kind: 'episode', title: 'The 100', season: 7, episode: 16 }],
  ['24.S01E01.mkv', [], { kind: 'episode', title: '24', season: 1, episode: 1 }],
  [
    'S.W.A.T.2017.S01E01.mkv',
    [],
    { kind: 'episode', title: 'S W A T', year: 2017, season: 1, episode: 1 },
  ],
  ['Show - 10x03 - Title.mkv', [], { kind: 'episode', season: 10, episode: 3 }],
  ['Show Season 2 Episode 5.mkv', [], { kind: 'episode', title: 'Show', season: 2, episode: 5 }],
  ['show.s01e100.mkv', [], { kind: 'episode', season: 1, episode: 100 }],
  ['Some Show S01E03 1920x1080.mkv', [], { kind: 'episode', season: 1, episode: 3 }],
  // Folder hints
  [
    'Episode 3.mkv',
    ['Better Call Saul', 'Season 01'],
    { kind: 'episode', title: 'Better Call Saul', season: 1, episode: 3, confidence: 'high' },
  ],
  [
    'E03.mkv',
    ['Better Call Saul', 'Season 1'],
    { kind: 'episode', title: 'Better Call Saul', season: 1, episode: 3 },
  ],
  [
    '03 - Nacho.mkv',
    ['Better Call Saul (2015)', 'Season 01'],
    { kind: 'episode', title: 'Better Call Saul', year: 2015, season: 1, episode: 3 },
  ],
  [
    'S01E03.mkv',
    ['Better Call Saul', 'Season 01'],
    { kind: 'episode', title: 'Better Call Saul', season: 1, episode: 3 },
  ],
  [
    'Special.mkv',
    ['Show', 'Specials'],
    { kind: 'episode', title: 'Show', season: 0, episode: null, confidence: 'low' },
  ],
  [
    'Random Name.mkv',
    ['Show', 'Season 02'],
    { kind: 'episode', title: 'Show', season: 2, episode: null, confidence: 'low' },
  ],
];

const movies: Case[] = [
  [
    'Sample Movie (2019).mp4',
    [],
    { kind: 'movie', title: 'Sample Movie', year: 2019, confidence: 'high' },
  ],
  [
    'some.random.download.2021.x264-NOGROUP.mp4',
    [],
    { kind: 'movie', title: 'some random download', year: 2021 },
  ],
  [
    'Dune.Part.Two.2024.2160p.UHD.BluRay.x265-GROUP.mkv',
    [],
    { kind: 'movie', title: 'Dune Part Two', year: 2024 },
  ],
  ['1917 (2019) [1080p].mkv', [], { kind: 'movie', title: '1917', year: 2019 }],
  ['2012.2009.720p.mkv', [], { kind: 'movie', title: '2012', year: 2009 }],
  [
    'Blade.Runner.2049.2017.1080p.BluRay.x264-SPARKS.mkv',
    [],
    { kind: 'movie', title: 'Blade Runner 2049', year: 2017 },
  ],
  [
    'The.Matrix.1999.REMASTERED.1080p.BluRay.x264.mkv',
    [],
    { kind: 'movie', title: 'The Matrix', year: 1999 },
  ],
  [
    'Inception.2010.1080p.BluRay.x264.YIFY.mp4',
    [],
    { kind: 'movie', title: 'Inception', year: 2010 },
  ],
  [
    'Spirited.Away.2001.JAPANESE.1080p.BluRay.x265-RARBG.mkv',
    [],
    { kind: 'movie', title: 'Spirited Away', year: 2001 },
  ],
  [
    'Everything Everywhere All at Once (2022) [1080p] [WEBRip] [5.1] [YTS.MX].mp4',
    [],
    { kind: 'movie', title: 'Everything Everywhere All at Once', year: 2022 },
  ],
  [
    'Oppenheimer.2023.IMAX.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX.mkv',
    [],
    { kind: 'movie', title: 'Oppenheimer', year: 2023 },
  ],
  [
    'Parasite.2019.KOREAN.1080p.BluRay.H264.AAC-VXT.mp4',
    [],
    { kind: 'movie', title: 'Parasite', year: 2019 },
  ],
  [
    'The.Lord.of.the.Rings.The.Fellowship.of.the.Ring.2001.EXTENDED.1080p.mkv',
    [],
    { kind: 'movie', title: 'The Lord of the Rings The Fellowship of the Ring', year: 2001 },
  ],
  [
    'Mad.Max.Fury.Road.2015.1080p.mkv',
    [],
    { kind: 'movie', title: 'Mad Max Fury Road', year: 2015 },
  ],
  ['Amelie.2001.FRENCH.1080p.mkv', [], { kind: 'movie', title: 'Amelie', year: 2001 }],
  ['Se7en.1995.1080p.mkv', [], { kind: 'movie', title: 'Se7en', year: 1995 }],
  ['Movie.Name.mkv', [], { kind: 'movie', title: 'Movie Name', year: null, confidence: 'low' }],
  ['movie.mkv', ['Heat (1995)'], { kind: 'movie', title: 'Heat', year: 1995, confidence: 'high' }],
  ['Heat.1995.1080p.mkv', ['Heat (1995)'], { kind: 'movie', title: 'Heat', year: 1995 }],
  ['Heat.1080p.mkv', ['Heat (1995)'], { kind: 'movie', title: 'Heat', year: 1995 }],
  [
    'Alien.1979.Directors.Cut.1080p.mkv',
    ['Alien (1979)'],
    { kind: 'movie', title: 'Alien', year: 1979 },
  ],
  ['Up (2009).mkv', ['Movies'], { kind: 'movie', title: 'Up', year: 2009 }],
  ['Her.2013.mkv', [], { kind: 'movie', title: 'Her', year: 2013 }],
  ['Interstellar_2014_1080p.mkv', [], { kind: 'movie', title: 'Interstellar', year: 2014 }],
  ['Casablanca (1942).mkv', [], { kind: 'movie', title: 'Casablanca', year: 1942 }],
];

describe('parseSceneName', () => {
  it.each([...episodes, ...movies])('%s in %j', (file, dirs, expected) => {
    expect(parseSceneName(file, dirs)).toMatchObject(expected);
  });

  it('covers at least 50 real-world names', () => {
    expect(episodes.length + movies.length).toBeGreaterThanOrEqual(50);
  });
});
