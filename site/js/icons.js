// One icon family: 24px grid, 1.8 stroke, round caps and joins. icon('check') -> inline SVG string.
const P = {
  check: '<path d="M5 12.5l4.2 4.2L19 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  back: '<path d="M14.5 6l-6 6 6 6"/>',
  next: '<path d="M9.5 6l6 6-6 6"/>',
  dust: '<path d="M12 3.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5z" fill="currentColor" stroke="none"/><path d="M18.5 15.5c.25 1.4.85 2 2.25 2.25-1.4.25-2 .85-2.25 2.25-.25-1.4-.85-2-2.25-2.25 1.4-.25 2-.85 2.25-2.25z" fill="currentColor" stroke="none"/>',
  sun: '<circle cx="12" cy="12" r="3.6"/><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6L18 18M6 18l1.4-1.4M16.6 7.4L18 6"/>',
  hanger: '<path d="M12 7.2a2 2 0 1 1 2-2c0 1.2-2 1.6-2 3.1V9"/><path d="M12 9L3.6 15.4c-.8.6-.4 1.9.6 1.9h15.6c1 0 1.4-1.3.6-1.9L12 9z"/>',
  more: '<circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
  edit: '<path d="M4.5 19.5l1-4.2L15.8 5a2 2 0 0 1 2.8 0l.4.4a2 2 0 0 1 0 2.8L8.7 18.5l-4.2 1z"/><path d="M13.8 7l3.2 3.2"/>',
  trash: '<path d="M4.5 7h15M9.5 7V5.2c0-.7.5-1.2 1.2-1.2h2.6c.7 0 1.2.5 1.2 1.2V7M6.5 7l.8 11.3c.1 1 .9 1.7 1.9 1.7h5.6c1 0 1.8-.7 1.9-1.7L17.5 7"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  moon: '<path d="M19 14.6A7.5 7.5 0 0 1 9.4 5a7.5 7.5 0 1 0 9.6 9.6z"/>',
  cloud: '<path d="M7.2 18.5h10a3.8 3.8 0 0 0 .5-7.6 5.3 5.3 0 0 0-10.2-1.2A4.4 4.4 0 0 0 7.2 18.5z"/>',
  book: '<path d="M12 6.5c-1.8-1.3-4.3-1.8-7.5-1.5v13c3.2-.3 5.7.2 7.5 1.5 1.8-1.3 4.3-1.8 7.5-1.5V5c-3.2-.3-5.7.2-7.5 1.5zM12 6.5v13"/>',
  replay: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v3.8h3.8"/>',
  forward: '<path d="M5 12h13M13 6.5l5.5 5.5-5.5 5.5"/>',
  alert: '<path d="M12 4.5l8.5 14.5h-17L12 4.5z"/><path d="M12 10v4"/><circle cx="12" cy="16.6" r=".4" fill="currentColor"/>',
  leaf: '<path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14"/><path d="M5 19l7-7"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="3"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
};
export function icon(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}
// Nimbus's mark: the cloud silhouette with its face
export const MARK = `<svg class="mark" viewBox="0 0 64 48" aria-hidden="true"><path d="M14.5 44h35a12.5 12.5 0 0 0 3.3-24.6A17.5 17.5 0 0 0 19.6 15 14.5 14.5 0 0 0 14.5 44z" fill="#fffafd"/><path d="M14.5 44h35a12.5 12.5 0 0 0 3.3-24.6A17.5 17.5 0 0 0 19.6 15 14.5 14.5 0 0 0 14.5 44z" fill="none" stroke="#2c2240" stroke-opacity=".12" stroke-width="1.5"/><ellipse cx="25.5" cy="29" rx="2.4" ry="3" fill="#2c2240"/><ellipse cx="38.5" cy="29" rx="2.4" ry="3" fill="#2c2240"/><path d="M29.4 33.4q2.6 2.4 5.2 0" fill="none" stroke="#2c2240" stroke-width="1.8" stroke-linecap="round"/><ellipse cx="20" cy="34" rx="3.2" ry="2" fill="#f7a8c8" opacity=".7"/><ellipse cx="44" cy="34" rx="3.2" ry="2" fill="#f7a8c8" opacity=".7"/></svg>`;
