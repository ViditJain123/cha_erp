'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function NewJobPage() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addFiles = useCallback((incoming: FileList | null) => {
    if (!incoming) return;
    const pdfs = Array.from(incoming).filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    setFiles((prev) => {
      const names = new Set(prev.map((f) => f.name));
      return [...prev, ...pdfs.filter((f) => !names.has(f.name))];
    });
  }, []);

  async function submit() {
    if (!files.length) return;
    setSubmitting(true);
    setError(null);
    const form = new FormData();
    for (const f of files) form.append('files', f);
    const res = await fetch('/api/legacy/jobs', { method: 'POST', body: form });
    if (!res.ok) {
      setError(`Upload failed: ${await res.text()}`);
      setSubmitting(false);
      return;
    }
    const { id } = (await res.json()) as { id: string };
    router.push(`/legacy/jobs/${id}`);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-2 text-2xl font-semibold">New Import Job</h1>
      <p className="mb-6 text-sm text-slate-600">
        Drop every document you received for the job — invoice, BL / AWB, packing list, COO, COA. The AI classifies
        them, extracts the data, applies duty masters and prepares the checklist for review.
      </p>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
        className={`flex min-h-56 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 text-center transition
          ${dragOver ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 bg-white hover:border-indigo-400'}`}
        onClick={() => document.getElementById('file-input')?.click()}
      >
        <div className="text-5xl">📄</div>
        <p className="mt-3 font-medium">Drag & drop the job documents here</p>
        <p className="mt-1 text-sm text-slate-500">PDF only · or click to browse</p>
        <input
          id="file-input"
          type="file"
          multiple
          accept="application/pdf"
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
      </div>

      {files.length > 0 && (
        <ul className="mt-6 space-y-2">
          {files.map((f) => (
            <li key={f.name} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm">
              <span>📎 {f.name} <span className="text-slate-400">({Math.round(f.size / 1024)} KB)</span></span>
              <button
                className="text-slate-400 hover:text-red-600"
                onClick={() => setFiles((prev) => prev.filter((x) => x.name !== f.name))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

      <button
        disabled={!files.length || submitting}
        onClick={submit}
        className="mt-6 w-full rounded-xl bg-indigo-600 py-3 font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {submitting ? 'Uploading…' : `Create job from ${files.length || 'the'} document${files.length === 1 ? '' : 's'}`}
      </button>
    </div>
  );
}
