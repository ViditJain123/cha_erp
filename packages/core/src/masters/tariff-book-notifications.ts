import { loadTariffBookFile } from './tariff-book.js';

/**
 * Where each notification sits in Volume II of the printed tariff.
 *
 * Volume II is the notification text itself — exemptions, anti-dumping and
 * safeguard duties, FTA concessions — 286 notifications over 1,456 pages. The
 * map of which pages each occupies is committed; the text is not, because it
 * is the publisher's prose rather than a fact derived from it. The text lives
 * in the library index, one document per notification, and this is how a
 * caller that already knows its notification finds the right one.
 */

export interface TariffBookNotification {
  /** "045/2025" — absent where the scan truncated the date past recovering the year. */
  notification?: string;
  number: number;
  /** "CUS", "ADD", "NT", ... as the Contents prints it. */
  kind: string;
  date: string;
  title: string;
  /** The book's own page label, e.g. "A-3". */
  label: string;
  startPage?: number;
  endPage?: number;
}

interface NotificationsFile {
  edition: string;
  notificationCount: number;
  notifications: TariffBookNotification[];
}

let file: NotificationsFile | null | undefined;
let byNumber: Map<string, TariffBookNotification> | null = null;

export function tariffBookNotificationsFile(): NotificationsFile | null {
  if (file === undefined) file = loadTariffBookFile<NotificationsFile>('notifications.json');
  return file;
}

/**
 * A notification's place in Volume II, or undefined when the book does not
 * reprint it. Where it appears twice, the first run is returned.
 */
export function tariffBookNotification(notification: string): TariffBookNotification | undefined {
  if (!byNumber) {
    byNumber = new Map();
    for (const entry of tariffBookNotificationsFile()?.notifications ?? []) {
      if (entry.notification && entry.startPage && !byNumber.has(entry.notification)) {
        byNumber.set(entry.notification, entry);
      }
    }
  }
  return byNumber.get(notification);
}
