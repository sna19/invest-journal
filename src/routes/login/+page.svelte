<script lang="ts">
	import LangSwitch from '#lib/LangSwitch.svelte';
	import { t } from '#lib/i18n.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const err = $derived(form?.error ? t(form.error === 'bad' ? 'login.bad' : (`err.${form.error}` as 'err.login')) : '');
</script>

<svelte:head><title>{t('login.title')} · {t('app.name')}</title></svelte:head>

<div class="wrap">
	<div class="top"><LangSwitch /></div>
	<img src="/icon.svg" alt="" width="64" height="64" />
	<h1>{t('app.name')}</h1>
	{#if data.setup}
		<h2>{t('login.setup')}</h2>
		<p class="note">{t('login.setupNote')}</p>
	{/if}
	<form method="POST" action={data.setup ? '?/setup' : '?/login'}>
		<label>
			<span>{t('login.login')}</span>
			<input name="login" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required value={form?.login ?? ''} />
		</label>
		{#if data.setup}
			<label>
				<span>{t('login.name')}</span>
				<input name="name" autocomplete="name" />
			</label>
		{/if}
		<label>
			<span>{t('login.password')}</span>
			<input name="password" type="password" autocomplete={data.setup ? 'new-password' : 'current-password'} required minlength={data.setup ? 6 : undefined} />
		</label>
		{#if err}<p class="err" role="alert">{err}</p>{/if}
		<button type="submit">{data.setup ? t('login.create') : t('login.submit')}</button>
		<p class="note">{t('login.remember')}</p>
	</form>
</div>

<style>
	.wrap {
		max-width: 360px;
		margin: 0 auto;
		padding: calc(env(safe-area-inset-top) + var(--s4)) 0 var(--s5);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--s3);
	}
	.top {
		align-self: flex-end;
	}
	img {
		border-radius: 14px;
		margin-top: var(--s4);
	}
	h1 {
		margin: 0;
		font-size: var(--fs-xl, 24px);
	}
	h2 {
		margin: 0;
		font-size: var(--fs-l, 18px);
	}
	form {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: var(--s3);
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	label span {
		font-size: var(--fs-s, 14px);
		color: var(--muted);
	}
	input {
		min-height: var(--tap, 44px);
		padding: 0 var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: var(--surface);
		color: var(--text);
		font-size: 17px;
	}
	button {
		min-height: var(--tap, 44px);
		border: none;
		border-radius: var(--r2);
		background: var(--accent);
		color: var(--accent-text);
		font-size: 17px;
		font-weight: 600;
		cursor: pointer;
	}
	.note {
		margin: 0;
		font-size: var(--fs-s, 14px);
		color: var(--muted);
		text-align: center;
	}
	.err {
		margin: 0;
		color: var(--down);
	}
</style>
