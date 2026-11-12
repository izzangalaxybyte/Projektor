-- Rescans used to overwrite the volume and chapter that indexing had read from ComicInfo.xml,
-- on books the scanner then never indexed again. Clearing indexed_at on books left with neither
-- makes the next scan index them once more.
UPDATE `comic_books` SET `indexed_at` = NULL WHERE `volume` IS NULL AND `chapter` IS NULL AND `indexed_at` IS NOT NULL;
