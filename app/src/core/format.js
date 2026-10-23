// Text and money formatting shared by every panel.

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function coinParts(c) {
  c = Math.max(0, Math.round(c));
  return { g: Math.floor(c / 10000), s: Math.floor((c % 10000) / 100), c: c % 100 };
}

export function coinHTML(c) {
  const p = coinParts(c);
  const out = [];
  if (p.g) out.push(`<span class="coin g">${p.g.toLocaleString()}<span class="sr"> gold</span></span>`);
  if (p.s || (p.g && p.c)) out.push(`<span class="coin s">${p.s}<span class="sr"> silver</span></span>`);
  if (p.c || !out.length) out.push(`<span class="coin c">${p.c}<span class="sr"> copper</span></span>`);
  return `<span class="coins">${out.join("")}</span>`;
}

export function coinText(c) {
  const p = coinParts(c);
  const out = [];
  if (p.g) out.push(`${p.g.toLocaleString()}g`);
  if (p.s) out.push(`${p.s}s`);
  if (p.c || !out.length) out.push(`${p.c}c`);
  return out.join(" ");
}

export const plural = (n, one, many = one + "s") => `${n.toLocaleString()} ${n === 1 ? one : many}`;
