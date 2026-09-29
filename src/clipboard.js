/** HTTP origins may not expose Clipboard API. Never report success on failure. */
export async function copyText(text, environment = globalThis) {
  try {
    if (environment.isSecureContext && environment.navigator?.clipboard?.writeText) {
      await environment.navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permissions or browser policy can also deny the modern API on HTTPS.
  }

  const doc = environment.document;
  if (!doc?.execCommand) return false;
  const previousFocus = doc.activeElement;
  let input;
  try {
    input = doc.createElement('textarea');
    input.value = text;
    input.readOnly = true;
    input.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;pointer-events:none;';
    // Content outside an open modal is inert, so retries must stay inside it.
    (doc.querySelector('dialog[open]') ?? doc.body).appendChild(input);
    input.focus({ preventScroll: true });
    input.select();
    input.setSelectionRange(0, text.length);
    return doc.execCommand('copy') === true;
  } catch {
    return false;
  } finally {
    input?.remove();
    previousFocus?.focus({ preventScroll: true });
  }
}
