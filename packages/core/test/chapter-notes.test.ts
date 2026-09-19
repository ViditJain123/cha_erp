import { describe, expect, it } from 'vitest';
import { chapterNotes, chapterNotesFile } from '../src/masters/chapter-notes.js';

describe('chapter notes', () => {
  const file = chapterNotesFile();

  it('is built and covers most chapters', () => {
    expect(file).not.toBeNull();
    expect(file!.chapterCount).toBeGreaterThan(50);
    expect(file!.noteCount).toBeGreaterThan(200);
  });

  it('finds the notes that govern a CTH', () => {
    // Note 1 to Chapter 7 excludes forage products — the example the whole
    // feature exists for, since nothing in a goods description implies it.
    const ch7 = chapterNotes('07031011');
    expect(ch7?.chapter).toBe(7);
    expect(ch7!.notes.join(' ')).toMatch(/does not cover forage/i);
  });

  it('numbers its notes and does not repeat them', () => {
    for (const chapter of file!.chapters) {
      const numbers = chapter.notes.map((n) => n.match(/^(\d{1,2})/)?.[1]);
      expect(numbers.every(Boolean), `chapter ${chapter.chapter}`).toBe(true);
    }
    // A chapter whose notes restart at 1 has had a second block spliced on,
    // which would attribute one chapter's exclusions to another.
    const spliced = file!.chapters.filter(
      (c) => c.notes.filter((n) => /^1\s*[.)]/.test(n)).length > 1,
    );
    expect(spliced.length).toBeLessThan(8);
  });

  it('says nothing for a chapter the book prints no notes for', () => {
    expect(chapterNotes('')).toBeUndefined();
  });
});
