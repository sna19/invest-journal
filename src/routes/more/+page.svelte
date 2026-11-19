<script lang="ts">
	import TopBar from '#lib/TopBar.svelte';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Database from '@lucide/svelte/icons/database';
	import Settings from '@lucide/svelte/icons/settings';
	import UserRound from '@lucide/svelte/icons/user-round';
	import CalendarRange from '@lucide/svelte/icons/calendar-range';
	import { t, tx } from '#lib/i18n.js';
</script>

<svelte:head><title>{t('tab.more')} · {t('app.name')}</title></svelte:head>

<TopBar title={t('tab.more')} />
<ul class="menu">
	<li><a href="/model"><CalendarRange size={20} /><span>{tx('Квартальная модель', 'Quarterly model')}</span><ChevronRight size={18} /></a></li>
	<li><a href="/tickers"><Database size={20} /><span>{t('more.tickers')}</span><ChevronRight size={18} /></a></li>
	<li><a href="/settings"><Settings size={20} /><span>{t('more.settings')}</span><ChevronRight size={18} /></a></li>
	<li><a href="/account"><UserRound size={20} /><span>{t('more.account')}</span><ChevronRight size={18} /></a></li>
</ul>

<!-- the licence of Lightweight Charts (Apache-2.0) asks for this notice and a link to TradingView -->
<p class="credits">
	{t('more.credits')}
	<a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">tradingview.com</a> · {t('more.licence')}
	{t('more.sources')}
</p>

<style>
	.menu {
		list-style: none;
		margin: 0;
		padding: 0;
		border-radius: var(--r2);
		background: var(--surface);
		overflow: hidden;
	}
	li + li {
		border-top: 1px solid var(--line);
	}
	a {
		display: flex;
		align-items: center;
		gap: var(--s3);
		min-height: 52px;
		padding: 0 var(--s3) 0 var(--s4);
		color: var(--text);
		text-decoration: none;
	}
	span {
		flex: 1;
	}
	.credits {
		margin: var(--s5) var(--s2) 0;
		font-size: var(--fs-xs);
		color: var(--muted);
		line-height: 1.5;
	}
</style>
