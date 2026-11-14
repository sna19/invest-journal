<script lang="ts">
	import TopBar from '#lib/TopBar.svelte';
	import Empty from '#lib/Empty.svelte';
</script>

<svelte:head><title>Гипотезы · Журнал гипотез</title></svelte:head>

<TopBar title="Гипотезы" />
<Empty title="Здесь будут ваши гипотезы">
	Прочитали статью с идеей — запишите гипотезу: тикер, направление, срок и уверенность. Приложение само
	зафиксирует цену входа, будет следить за результатом против бенчмарка и закроет гипотезу в срок.
	<p>Запись гипотез появится на этапе 2; база тикеров уже работает.</p>
	{#snippet action()}<a href="/tickers">Открыть тикеры</a>{/snippet}
</Empty>
