/** Download a notification PDF: pnpm fetch-notification <url> <label> */
import { fetchNotification } from '../src/fetch.js';

const [url, label] = process.argv.slice(2);
if (!url || !label) {
  console.error('usage: pnpm fetch-notification <pdf-url> <label e.g. 096/2008-Customs>');
  process.exit(1);
}
const r = await fetchNotification(url, label);
console.log(r);
