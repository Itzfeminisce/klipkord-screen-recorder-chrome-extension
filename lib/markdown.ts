import { captionCues } from './captions';
import { toEdited } from './editList';
import { decodeTimed } from './notes/chapters';
import { STYLE_SECTIONS } from './notes/style';
import { formatClock } from './time';
import type { Recording } from './types';

/** Markdown for the notes: title, summary, the style's sections, points, actions, chapters, transcript. Times use the edited video. */
export function buildMarkdown(rec: Recording): string {
  const t = (ms: number) => formatClock(toEdited(rec.edits, rec.duration, ms));
  const notes = rec.summary;
  const out: string[] = [`# ${rec.title}`];
  if (notes) {
    if (notes.summary) out.push(notes.summary);
    const sections = notes.sections ?? {};
    for (const def of STYLE_SECTIONS[notes.style]) {
      const lines = sections[def.key];
      if (!lines?.length) continue;
      const items = lines.map((line, i) => {
        const { at, text } = decodeTimed(line);
        const time = def.timed && at !== undefined ? ` (${t(at)})` : '';
        return def.timed ? `${i + 1}. ${text}${time}` : `- ${text}`;
      });
      out.push(`## ${def.heading}\n\n${items.join('\n')}`);
    }
    if (['update', 'meeting', 'general'].includes(notes.style) && notes.points.length) {
      out.push(`## Key points\n\n${notes.points.map((p) => `- ${p}`).join('\n')}`);
    }
    if (['meeting', 'general'].includes(notes.style) && notes.actions.length) {
      out.push(`## Action items\n\n${notes.actions.map((a) => `- ${a}`).join('\n')}`);
    }
    if (notes.chapters.length) {
      out.push(`## Chapters\n\n${notes.chapters.map((c) => `- ${t(c.at)} ${c.title}`).join('\n')}`);
    }
  }
  const cues = captionCues(rec.transcript, rec.edits, rec.duration);
  if (cues.length) out.push(`## Transcript\n\n${cues.map((c) => `${formatClock(c.start)} ${c.text}`).join('\n')}`);
  return `${out.join('\n\n')}\n`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A printable page for the Markdown above (headings, lists, paragraphs): the PDF is "print to PDF". */
export function markdownToHtml(md: string, title: string): string {
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  const close = () => { if (list) out.push(`</${list}>`); list = null; };
  for (const line of md.split('\n')) {
    const open = (tag: 'ul' | 'ol') => { if (list !== tag) { close(); out.push(`<${tag}>`); list = tag; } };
    if (line.startsWith('# ')) { close(); out.push(`<h1>${esc(line.slice(2))}</h1>`); }
    else if (line.startsWith('## ')) { close(); out.push(`<h2>${esc(line.slice(3))}</h2>`); }
    else if (line.startsWith('- ')) { open('ul'); out.push(`<li>${esc(line.slice(2))}</li>`); }
    else if (/^\d+\. /.test(line)) { open('ol'); out.push(`<li>${esc(line.replace(/^\d+\. /, ''))}</li>`); }
    else if (line.trim()) { close(); out.push(`<p>${esc(line)}</p>`); }
  }
  close();
  const css = '@page{size:A4;margin:0}body{margin:0;font:14px/1.5 system-ui,sans-serif;color:#111114}main{box-sizing:border-box;width:794px;max-width:100%;padding:32px}h1{margin:0;font-size:22px;line-height:1.3}h2{margin:20px 0 6px;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#5F6168}ul,ol{margin:0;padding-left:28px}li{margin:3px 0}p{margin:6px 0}';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}</style></head><body><main>${out.join('')}</main></body></html>`;
}
