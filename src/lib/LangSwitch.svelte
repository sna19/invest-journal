<script lang="ts">
	import { lang, setLang, type Lang } from './i18n.js';
	const L: { k: Lang; label: string }[] = [
		{ k: 'ru', label: 'RU' },
		{ k: 'en', label: 'EN' }
	];
</script>

<div class="sw" role="radiogroup" aria-label="Язык / Language">
	{#each L as l (l.k)}
		<button type="button" role="radio" aria-checked={lang() === l.k} class:on={lang() === l.k} onclick={() => setLang(l.k)}>{l.label}</button>
	{/each}
</div>

<style>
	.sw {
		display: inline-flex;
		border: 1px solid var(--line);
		border-radius: 999px;
		overflow: hidden;
	}
	button {
		min-width: 44px;
		min-height: 34px;
		border: none;
		background: none;
		font-size: var(--fs-s, 14px);
		font-weight: 600;
		color: var(--muted);
		cursor: pointer;
	}
	button.on {
		background: var(--text);
		color: var(--bg);
	}
</style>
