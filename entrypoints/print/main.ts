import { getRecording } from '@/lib/db';
import { buildMarkdown, markdownToHtml } from '@/lib/markdown';

// The side panel cannot open Chrome's print dialog, so the PDF prints from this tab.
async function render() {
  const id = new URLSearchParams(location.search).get('recordingId');
  const rec = id ? await getRecording(id) : undefined;
  if (!rec) return;
  const doc = new DOMParser().parseFromString(markdownToHtml(buildMarkdown(rec), rec.title), 'text/html');
  document.title = doc.title;
  document.head.append(...doc.head.querySelectorAll('style'));
  document.body.replaceChildren(...doc.body.childNodes);
  setTimeout(() => window.print(), 300);
}

render();
