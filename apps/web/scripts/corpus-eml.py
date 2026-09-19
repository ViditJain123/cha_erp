"""Unpack a saved `.eml` into the documents and the message it was carrying.

Only the corpus needs this. In production the attachments arrive from Graph
already separated, and a `.eml` never reaches ingest — but two folders in the
corpus were saved as whole messages, and one of them
(`ex_job20`) keeps its commercial invoice *inside* the `.eml`, nowhere else. Run
without it, that job has a bill of lading and no invoice, and the export fails
for a reason that has nothing to do with the system under test.

    python3 corpus-eml.py <file.eml> <out-dir>

Writes each document attachment into <out-dir> and prints one JSON object:
{subject, from, date, body, attachments: [...]}. Inline images are skipped —
they are signature logos, never documents.
"""
import email
import json
import os
import sys
from email import policy

DOCUMENT_TYPES = {".pdf", ".xlsx", ".xls", ".doc", ".docx"}


def main(eml_path: str, out_dir: str) -> None:
    with open(eml_path, "r", errors="replace") as handle:
        message = email.message_from_file(handle, policy=policy.default)

    os.makedirs(out_dir, exist_ok=True)
    bodies: list[str] = []
    attachments: list[str] = []

    for part in message.walk():
        name = part.get_filename()
        if name:
            extension = os.path.splitext(name)[1].lower()
            if extension not in DOCUMENT_TYPES:
                continue
            payload = part.get_payload(decode=True)
            if not payload:
                continue
            safe = os.path.basename(name).replace("/", "_")
            with open(os.path.join(out_dir, safe), "wb") as out:
                out.write(payload)
            attachments.append(safe)
        elif part.get_content_type() == "text/plain":
            try:
                bodies.append(part.get_content())
            except Exception:  # noqa: BLE001 - a broken part must not lose the rest
                pass

    print(
        json.dumps(
            {
                "subject": message.get("subject"),
                "from": message.get("from"),
                "date": message.get("date"),
                "body": "\n".join(bodies).strip(),
                "attachments": attachments,
            }
        )
    )


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
