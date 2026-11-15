<script lang="ts">
	import TopBar from '#lib/TopBar.svelte';
	import Empty from '#lib/Empty.svelte';
</script>

<svelte:head><title>Источники · Журнал гипотез</title></svelte:head>

<TopBar title="Источники" help="source.usefulness" />
<Empty title="Каким источникам можно верить">
	Здесь будет таблица изданий и авторов: сколько их гипотез сработало и с каким интервалом достоверности.
	Оценка появляется после 10 закрытых гипотез источника.
</Empty>
