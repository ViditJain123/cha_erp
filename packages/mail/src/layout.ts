import { APP } from '@checklist/config/app';

/** Minimal HTML escaping for values interpolated into templates. */
export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Wraps body markup in a table-based shell. Tables and inline styles rather
 * than flexbox because Outlook renders with Word's HTML engine, which supports
 * neither.
 */
export function layout(opts: { previewText: string; body: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(APP.name)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0f172a;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(opts.previewText)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;">
      <tr><td style="padding:28px 32px 8px;">
        <div style="font-size:17px;font-weight:600;letter-spacing:-0.01em;">${esc(APP.name)}</div>
      </td></tr>
      <tr><td style="padding:8px 32px 32px;font-size:15px;line-height:1.6;">
        ${opts.body}
      </td></tr>
    </table>
    <div style="max-width:520px;padding:16px 8px;font-size:12px;line-height:1.5;color:#64748b;">
      ${esc(APP.tagline)}<br>
      Questions? Write to <a href="mailto:${esc(APP.supportEmail)}" style="color:#64748b;">${esc(APP.supportEmail)}</a>.
    </div>
  </td></tr>
</table>
</body>
</html>`;
}

export function button(href: string, label: string): string {
  return `<a href="${esc(href)}" style="display:inline-block;background:${APP.primaryColor};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:11px 20px;border-radius:8px;">${esc(label)}</a>`;
}
