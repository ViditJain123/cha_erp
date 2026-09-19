import { loadTariffBookFile } from './tariff-book.js';

/**
 * The Section and Chapter Notes printed ahead of each chapter's rate table.
 *
 * Under the General Interpretative Rules these decide any contested heading —
 * classification is "determined according to the terms of the headings and any
 * relative Section or Chapter Notes" before anything else. Note 1 to Chapter 7
 * says the chapter does not cover forage products of heading 1214, and nothing
 * in a goods description will tell you that.
 *
 * They are here so the classifier can stop apologising for not having them.
 * Its prompt used to say "if the goods could fall under a Section or Chapter
 * Note you cannot see here, answer null" — honest while the notes were only on
 * paper, and a ceiling on how often it could answer at all.
 *
 * 71 of the 97 chapters print notes; the rest genuinely have none at that
 * level. An absent chapter here means the book printed nothing, not that the
 * parse missed it — but it is OCR'd prose either way, so it is context for a
 * decision, never a quotable authority.
 */

export interface ChapterNotes {
  chapter: number;
  /** The chapter's title, where one could be read off the page. */
  title: string;
  /** Each note, numbered as printed, wrapped lines joined. */
  notes: string[];
  page: number;
}

export interface ChapterNotesFile {
  source: string;
  edition: string;
  chapterCount: number;
  noteCount: number;
  chapters: ChapterNotes[];
}

let file: ChapterNotesFile | null | undefined;
let byChapter: Map<number, ChapterNotes> | null = null;

export function chapterNotesFile(): ChapterNotesFile | null {
  if (file === undefined) file = loadTariffBookFile<ChapterNotesFile>('chapter-notes.json');
  return file;
}

/** The notes governing a CTH's chapter, or undefined where the book prints none. */
export function chapterNotes(cth: string): ChapterNotes | undefined {
  if (!byChapter) {
    byChapter = new Map();
    for (const entry of chapterNotesFile()?.chapters ?? []) byChapter.set(entry.chapter, entry);
  }
  const code = cth.replace(/\D/g, '');
  if (code.length < 2) return undefined;
  return byChapter.get(Number(code.slice(0, 2)));
}
