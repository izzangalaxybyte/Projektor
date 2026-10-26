import { describe, expect, it } from 'vitest';
import { collectionName, movieSearchTitles } from './movie-queries.js';

describe('movieSearchTitles', () => {
  it('adds the collection name, the episode subtitle, digits, and drops "The Movie"', () => {
    expect(
      movieSearchTitles(
        'Chamber Of Secrets',
        '/media/movies/Harry.Potter.Complete.Collection.2001-2011.1080p.BluRay/02. Chamber.Of.Secrets.2002/x.mkv',
      ),
    ).toEqual(['Chamber Of Secrets', 'Harry Potter Chamber Of Secrets']);
    expect(movieSearchTitles('Star Wars Episode V - The Empire Strikes Back', null)).toEqual([
      'Star Wars Episode V - The Empire Strikes Back',
      'The Empire Strikes Back',
      'Star Wars',
    ]);
    expect(movieSearchTitles('F1 The Movie', null)).toEqual(['F1 The Movie', 'F1']);
    expect(movieSearchTitles('Furious Seven', null)).toEqual(['Furious Seven', 'Furious 7']);
    expect(movieSearchTitles('Shrek 2', '/media/movies/Shrek 2 (2004)/Shrek 2.mkv')).toEqual([
      'Shrek 2',
    ]);
  });

  it('reads a collection folder name', () => {
    expect(collectionName('/m/Fast and Furious Collection BR 10bit dts-d3g/Fast Five.mkv')).toBe(
      'Fast and Furious',
    );
    expect(collectionName('/m/Shrek 2 (2004)/Shrek 2.mkv')).toBeNull();
  });
});
