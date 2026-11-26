import { HIGHLIGHTS, TEXT_COLORS } from '../journal/palette.js';

/**
 * T-032: the diary's rich text (owner 26.11.2026: «выделять, красить и подкрашивать»). The editor gives HTML; only
 * what it is meant to make passes: paragraphs, line breaks, bold, italic, underline, strike, lists, quotes, links to
 * http(s), and the colours and highlights of the palette. Everything else — tags, attributes, scripts, styles — is
 * dropped, so nothing written can run on the page.
 */

const KEEP = new Set(['p', 'div', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'span', 'ul', 'ol', 'li', 'blockquote', 'a', 'font']);
const VOID = new Set(['br']);
const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|template|svg|math)\b[\s\S]*?<\/\1\s*>/gi;
const TEXT = new Set(TEXT_COLORS.map((c) => c[0]));
const HIGH = new Set(HIGHLIGHTS.map((c) => c[0]));

/** «rgb(220, 38, 38)», «#DC2626», «#d22» → «#dc2626» */
export function hexOf(v: string): string | null {
	const s = v.trim().toLowerCase();
	let m = s.match(/^#([0-9a-f]{6})$/);
	if (m) return `#${m[1]}`;
	m = s.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
	if (m) return `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`;
	m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
	if (m) return '#' + [m[1], m[2], m[3]].map((x) => Math.min(255, Number(x)).toString(16).padStart(2, '0')).join('');
	return null;
}

function cleanStyle(style: string) {
	const out: string[] = [];
	for (const part of style.split(';')) {
		const i = part.indexOf(':');
		if (i < 0) continue;
		const prop = part.slice(0, i).trim().toLowerCase();
		const val = part.slice(i + 1).trim().toLowerCase();
		if (prop === 'color') {
			const h = hexOf(val);
			if (h && TEXT.has(h)) out.push(`color: ${h}`);
		} else if (prop === 'background-color' || prop === 'background') {
			const h = hexOf(val);
			if (h && HIGH.has(h)) out.push(`background-color: ${h}`);
		} else if (prop === 'font-weight' && /^(bold|bolder|[6-9]00)$/.test(val)) out.push('font-weight: bold');
		else if (prop === 'font-style' && val === 'italic') out.push('font-style: italic');
		else if ((prop === 'text-decoration' || prop === 'text-decoration-line') && /underline|line-through/.test(val))
			out.push(`text-decoration: ${['underline', 'line-through'].filter((x) => val.includes(x)).join(' ')}`);
	}
	return out.join('; ');
}

const attr = (attrs: string, name: string) => {
	const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
	return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null;
};
const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function sanitize(html: string): string {
	const src = html.replace(/<!--[\s\S]*?-->/g, '').replace(DROP_WITH_CONTENT, '');
	let out = '';
	let last = 0;
	const open: string[] = [];
	for (const m of src.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g)) {
		// text between tags: any stray «<» or «>» is escaped
		out += src.slice(last, m.index).replace(/</g, '&lt;').replace(/>/g, '&gt;');
		last = m.index! + m[0].length;
		const close = m[1] === '/';
		let tag = m[2].toLowerCase();
		if (!KEEP.has(tag)) continue;
		if (tag === 'font') tag = 'span';
		if (close) {
			const i = open.lastIndexOf(tag);
			if (i >= 0) {
				for (const t of open.splice(i).reverse()) out += `</${t}>`;
			}
			continue;
		}
		let a = '';
		const style = cleanStyle(attr(m[3], 'style') ?? '');
		const fontColor = m[2].toLowerCase() === 'font' ? hexOf(attr(m[3], 'color') ?? '') : null;
		const st = [style, fontColor && TEXT.has(fontColor) ? `color: ${fontColor}` : ''].filter(Boolean).join('; ');
		if (st && tag === 'span') a += ` style="${escAttr(st)}"`;
		if (tag === 'a') {
			const href = attr(m[3], 'href') ?? '';
			if (!/^https?:\/\//i.test(href.trim())) continue;
			a += ` href="${escAttr(href.trim())}" target="_blank" rel="noopener noreferrer"`;
		}
		if (tag === 'span' && !a) {
			// a bare span carries nothing; keep it balanced by pairing it anyway
			open.push(tag);
			out += '<span>';
			continue;
		}
		out += `<${tag}${a}>`;
		if (!VOID.has(tag)) open.push(tag);
	}
	out += src.slice(last).replace(/</g, '&lt;').replace(/>/g, '&gt;');
	for (const t of open.reverse()) out += `</${t}>`;
	return out;
}

/** the words of a rich text, for the search and for «is it empty» */
export function plainText(html: string): string {
	return html
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div|li|blockquote)>/gi, '\n')
		.replace(/<[^>]*>/g, '')
		.replace(/&nbsp;/g, ' ')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, '&')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}
