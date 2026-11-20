<script lang="ts">
	import { tradingViewUrl } from './tradingview.js';
	import { tx } from './i18n.js';

	/** «TV» — the security's chart on TradingView in a new window */
	let { exchange, symbol }: { exchange: string | null | undefined; symbol: string } = $props();
</script>

<a class="tv" href={tradingViewUrl(exchange, symbol)} target="_blank" rel="noopener noreferrer" title={tx('График на TradingView', 'Chart on TradingView')} aria-label="{symbol}: {tx('график на TradingView', 'chart on TradingView')}" onclick={(e) => e.stopPropagation()}>TV ↗</a>

<style>
	.tv {
		display: inline-flex;
		align-items: center;
		padding: 0 6px;
		min-height: 22px;
		border: 1px solid var(--line);
		border-radius: 6px;
		color: var(--link);
		font-size: var(--fs-xs);
		font-weight: 600;
		text-decoration: none;
		white-space: nowrap;
		vertical-align: middle;
	}
</style>
