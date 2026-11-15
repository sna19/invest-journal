import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { getAppDb } from '#lib/server/db.js';
import { fetchTitle } from '#lib/server/article.js';
import { sourceForUrl } from '#lib/server/journal.js';
import { articles } from '#lib/server/schema/app.js';
import { normalizeUrl } from '#lib/hypothesis.js';

/**
 * GET /api/article-meta?url=… — the source by the link's domain, the article if it was saved before
 * (its author and title), otherwise the page's title when the site gives it (best effort, ≤ 5 s).
 */
export async function GET({ url }) {
	const link = normalizeUrl(url.searchParams.get('url'));
	if (!link) return json({ url: null, source: null, article: null, title: null });
	const db = getAppDb();
	const source = sourceForUrl(db, link);
	const article = source
		? (db
				.select({ id: articles.id, author: articles.author, title: articles.title })
				.from(articles)
				.where(and(eq(articles.url, link), eq(articles.sourceId, source.id)))
				.get() ?? null)
		: null;
	const title = article?.title ?? (url.searchParams.get('title') === '0' ? null : await fetchTitle(link));
	return json({ url: link, source, article, title });
}
