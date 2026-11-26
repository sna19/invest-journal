import { describe, expect, it } from 'vitest';
import { hexOf, plainText, sanitize } from './richtext.js';
import { openApp, openMarket } from './db.js';
import { addEntry, editEntry, listEntries, revisions } from './diary.js';

describe('T-032: the diary rich text', () => {
	it('keeps the marks and the palette colours the editor makes, in rgb() or hex', () => {
		expect(hexOf('rgb(220, 38, 38)')).toBe('#dc2626');
		const html = sanitize(
			'<p><b>жирный</b> <span style="color: rgb(220, 38, 38);">красный</span> <span style="background-color: rgb(253, 230, 138); font-weight: bold;">подсветка</span> <i>к</i><u>п</u><s>з</s></p><ul><li>раз</li></ul>'
		);
		expect(html).toBe(
			'<p><b>жирный</b> <span style="color: #dc2626">красный</span> <span style="background-color: #fde68a; font-weight: bold">подсветка</span> <i>к</i><u>п</u><s>з</s></p><ul><li>раз</li></ul>'
		);
	});

	it('drops what could run or what is not of the palette', () => {
		const html = sanitize(
			'<img src=x onerror=alert(1)><script>alert(2)</script><span style="color: #123456; position: fixed" onclick="x()">x</span><a href="javascript:alert(3)">a</a><a href="https://example.com" onclick="y">b</a><iframe src="https://e"></iframe><p style="color:red">p</p>'
		);
		expect(html).not.toMatch(/img|script|alert\(2\)|onclick|javascript|iframe|position|#123456|style="color:red"/);
		expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">b</a>');
		expect(html).toContain('<span>x</span>');
		expect(sanitize('<b>не закрыт')).toBe('<b>не закрыт</b>');
		expect(sanitize('3 < 5 > 2')).toBe('3 &lt; 5 &gt; 2');
	});

	it('the search reads the words, not the marks; an edit of an old markdown entry becomes rich, the revision keeps both', () => {
		const app = openApp(':memory:').sqlite;
		const market = openMarket(':memory:').sqlite;
		const id = addEntry(app, market, { body: '<p>Маржа <span style="background-color: #fde68a">растёт</span></p>', format: 'html' })!;
		expect(plainText('<p>a<br>b</p><p>c &amp; d</p>')).toBe('a\nb\nc & d');
		expect(listEntries(app, market, { q: 'растёт' }).items.map((e) => e.id)).toEqual([id]);
		expect(listEntries(app, market, { q: 'span' }).items).toEqual([]);
		expect(listEntries(app, market, {}).items[0].html).toContain('background-color: #fde68a');
		expect(() => addEntry(app, market, { body: '<p><br></p>', format: 'html' })).toThrow(/Текст/);
		const old = addEntry(app, market, { body: '**старый** текст' })!;
		editEntry(app, old, { body: '<p><b>старый</b> текст, <span style="color: #2563eb">дополнен</span></p>', format: 'html' });
		expect(revisions(app, old).map((r) => r.format)).toEqual(['md', 'html']);
		expect(listEntries(app, market, { q: 'дополнен' }).items.map((e) => e.id)).toEqual([old]);
	});
});
