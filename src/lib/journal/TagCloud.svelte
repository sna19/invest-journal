<script lang="ts">
	import { tx } from '../i18n.js';
	import { GROUP_LABEL } from './screen.svelte.js';

	/**
	 * Д-13: the tags as a cloud of coloured chips with their counts, by groups, the frequent first; several can be chosen
	 * (an entry must have all of them); «ещё» unfolds the rare ones.
	 */
	export interface Tag {
		id: number;
		name: string;
		grp: string;
		system: number;
		color: string;
		n: number;
	}
	interface Props {
		tags: Tag[];
		selected: number[];
		onchange: (ids: number[]) => void;
		/** how many chips show before «ещё» */
		top?: number;
	}
	let { tags, selected, onchange, top = 14 }: Props = $props();
	let all = $state(false);
	const order = $derived([...tags].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)));
	const shown = $derived(all ? order : order.filter((t, i) => i < top || selected.includes(t.id)));
	const groups = $derived(
		Object.keys(GROUP_LABEL)
			.map((g) => ({ g, items: shown.filter((t) => t.grp === g) }))
			.filter((x) => x.items.length)
	);
	const toggle = (id: number) => onchange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
</script>

{#if tags.length}
	<div class="cloud">
		{#each groups as { g, items } (g)}
			<div class="grp">
				<span class="gl">{tx(...GROUP_LABEL[g])}</span>
				{#each items as t (t.id)}
					<button type="button" class="chip" class:on={selected.includes(t.id)} style="--c: {t.color}" aria-pressed={selected.includes(t.id)} onclick={() => toggle(t.id)}>
						<i></i>{t.name}<span class="n">{t.n}</span>
					</button>
				{/each}
			</div>
		{/each}
		{#if order.length > top}
			<button type="button" class="more" onclick={() => (all = !all)}>{all ? tx('свернуть', 'less') : tx(`ещё ${order.length - shown.length}`, `${order.length - shown.length} more`)}</button>
		{/if}
		{#if selected.length}<button type="button" class="more" onclick={() => onchange([])}>{tx('сбросить теги', 'clear tags')}</button>{/if}
	</div>
{/if}

<style>
	.cloud {
		display: flex;
		flex-direction: column;
		gap: var(--s1);
	}
	.grp {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}
	.gl {
		font-size: var(--fs-xs);
		color: var(--muted);
		min-width: 64px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		min-height: 30px;
		padding: 0 10px;
		border: 1px solid color-mix(in srgb, var(--c) 45%, var(--line));
		border-radius: var(--r-pill);
		background: color-mix(in srgb, var(--c) 10%, var(--surface));
		color: var(--text);
		font-size: var(--fs-s);
		cursor: pointer;
	}
	.chip i {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--c);
	}
	.chip.on {
		background: var(--c);
		border-color: var(--c);
		color: #fff;
	}
	.chip.on i {
		background: #fff;
	}
	.n {
		font-size: var(--fs-xs);
		opacity: 0.75;
		font-variant-numeric: tabular-nums;
	}
	.more {
		align-self: flex-start;
		border: none;
		background: none;
		color: var(--link);
		font-size: var(--fs-s);
		cursor: pointer;
		padding: 2px 0;
	}
</style>
