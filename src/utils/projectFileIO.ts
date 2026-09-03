/**
 * Browser-side file I/O for `.solna` files. A Blob URL instead of the data
 * URL the preset libraries use: a project with many loops is far bigger than a
 * preset list, and data URLs have per-browser length limits.
 */
export function slugifyProjectName(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'project';
}

export function projectFileName(name: string): string {
  return `${slugifyProjectName(name)}.solna`;
}

interface ObjectUrlApi {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
}

export function downloadTextFile(
  fileName: string,
  text: string,
  mime: string,
  doc?: Document,
  url?: ObjectUrlApi,
): void {
  const d = doc ?? document;
  const u = url ?? URL;
  const href = u.createObjectURL(new Blob([text], { type: mime }));
  const anchor = d.createElement('a');
  anchor.href = href;
  anchor.download = fileName;
  d.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    u.revokeObjectURL(href);
  }
}

/** A directory or a zero-byte pick reads as '' and is then reported as malformed. */
export async function readFileAsText(file: Pick<File, 'text' | 'size'>): Promise<string> {
  if (file.size === 0) return '';
  try {
    return await file.text();
  } catch {
    return '';
  }
}
