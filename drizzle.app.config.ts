import { defineConfig } from 'drizzle-kit';

// app.db — the journal (sources, articles, hypotheses, help). Its data cannot be rebuilt: backed up daily.
export default defineConfig({
	dialect: 'sqlite',
	casing: 'snake_case',
	schema: './src/lib/server/schema/app.ts',
	out: './drizzle/app'
});
