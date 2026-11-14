import { defineConfig } from 'drizzle-kit';

// market.db — market data in groups ref_*, market_*, ops_* (spec section 14). Can be rebuilt from /raw.
export default defineConfig({
	dialect: 'sqlite',
	casing: 'snake_case',
	schema: './src/lib/server/schema/market.ts',
	out: './drizzle/market'
});
