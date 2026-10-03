import DOMPurify from 'dompurify';

/** Keep the formatting supported by NotesEditor; never trust stored/imported HTML. */
export function safeNotesHtml(notes: string | null | undefined): string {
  const fragment = DOMPurify.sanitize(notes ?? '', {
    RETURN_DOM_FRAGMENT: true,
    ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 's', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'h1', 'h2', 'h3', 'hr', 'span'],
    ALLOWED_ATTR: ['style'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    // Only the editor's font size survives. Styles are normalized again below.
    FORBID_TAGS: ['script', 'style', 'svg', 'math', 'iframe', 'object', 'embed', 'form', 'input', 'template'],
  });
  for (const element of fragment.querySelectorAll<HTMLElement>('[style]')) {
    const size = element.style.fontSize;
    element.removeAttribute('style');
    if (/^(12|14|16|20|24)px$/.test(size)) {
      element.setAttribute('style', `font-size: ${size}`);
    }
  }
  const container = fragment.ownerDocument.createElement('div');
  container.append(fragment);
  return container.innerHTML;
}
