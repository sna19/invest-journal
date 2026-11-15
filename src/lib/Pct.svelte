<script lang="ts">
	/** Spec section 13 — a result with a sign and an arrow, not by colour alone: ▲ +4,2%, ▼ −1,8%. */
	let { value, digits = 1, plain = false }: { value: number | null | undefined; digits?: number; plain?: boolean } = $props();
	const fmt = $derived(
		value === null || value === undefined
			? '—'
			: `${value > 0 ? '▲ +' : value < 0 ? '▼ −' : ''}${Math.abs(value).toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`
	);
</script>

<span class="pct" class:up={!plain && (value ?? 0) > 0} class:down={!plain && (value ?? 0) < 0}>{fmt}</span>

<style>
	.pct {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.up {
		color: var(--up);
	}
	.down {
		color: var(--down);
	}
</style>
