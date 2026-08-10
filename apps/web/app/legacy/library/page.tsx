import { listDocs } from '@checklist/library';
import LibraryView from './library-view';

export const dynamic = 'force-dynamic';

export default async function LibraryPage() {
  return <LibraryView initialDocs={listDocs()} />;
}
