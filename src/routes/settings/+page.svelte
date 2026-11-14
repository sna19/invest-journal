<script lang="ts">
	import TopBar from '#lib/TopBar.svelte';
	import Empty from '#lib/Empty.svelte';
</script>

<svelte:head><title>Настройки · Журнал гипотез</title></svelte:head>

<TopBar title="Настройки" back={{ href: '/more', label: 'Ещё' }} />
<Empty title="Бенчмарки, пороги и данные">
	Здесь будут бенчмарки, пороги достоверности, журнал ежедневного задания цен и список бумаг без данных.
	Состояние загрузки списков бумаг уже видно на экране «Тикеры».
	{#snippet action()}<a href="/tickers">Открыть тикеры</a>{/snippet}
</Empty>
