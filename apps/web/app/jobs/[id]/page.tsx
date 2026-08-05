import { notFound } from 'next/navigation';
import { getJob } from '@/lib/store';
import JobView from './job-view';

export const dynamic = 'force-dynamic';

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) notFound();
  return <JobView initialJob={job} />;
}
