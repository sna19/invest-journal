<script lang="ts">
	import Fold from '#lib/Fold.svelte';
	import { goto } from '$app/navigation';
	import LangSwitch from '#lib/LangSwitch.svelte';
	import TopBar from '#lib/TopBar.svelte';
	import { t, type Key } from '#lib/i18n.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const errOf = (name: string) => (form?.form === name && 'error' in form && form.error ? t(`err.${form.error}` as Key) : '');
	const okOf = (name: string) => form?.form === name && 'ok' in form && form.ok;

	async function logout(everywhere: boolean) {
		await fetch('/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ everywhere }) });
		await goto('/login', { invalidateAll: true });
	}
</script>

<svelte:head><title>{t('acc.title')} · {t('app.name')}</title></svelte:head>

<TopBar title={t('acc.title')} help="account.users" back={{ href: '/more', label: t('acc.back') }} />

<section class="card">
	<p class="who">{t('acc.you')} <b>{data.user?.name}</b> <span class="muted">({data.user?.login})</span></p>
	<div class="row"><span>{t('acc.lang')}</span><LangSwitch /></div>
	<div class="buttons">
		<button type="button" onclick={() => logout(false)}>{t('acc.logout')}</button>
		<button type="button" onclick={() => logout(true)}>{t('acc.logoutAll')}</button>
	</div>
</section>

<Fold key="account-password" title={t('acc.password')} open={false}>
	<form method="POST" action="?/password">
		<input type="text" name="username" autocomplete="username" value={data.user?.login} hidden readonly />
		<label><span>{t('acc.old')}</span><input name="old" type="password" autocomplete="current-password" required /></label>
		<label><span>{t('acc.new')}</span><input name="new" type="password" autocomplete="new-password" minlength="6" required /></label>
		<label><span>{t('acc.repeat')}</span><input name="repeat" type="password" autocomplete="new-password" minlength="6" required /></label>
		{#if errOf('password')}<p class="err" role="alert">{errOf('password')}</p>{/if}
		{#if okOf('password')}<p class="ok" role="status">{t('acc.saved')}</p>{/if}
		<button type="submit" class="primary">{t('acc.save')}</button>
	</form>
</Fold>

{#if data.user?.admin}
	<Fold key="account-users" title={t('acc.users')} summary={data.users.map((u) => u.name).join(' · ')}>
		<p class="muted">{t('acc.usersNote')}</p>
		<ul class="users">
			{#each data.users as u (u.id)}
				<li>
					<div><b>{u.name}</b> <span class="muted">{u.login}{u.admin ? ` · ${t('acc.admin')}` : ''}</span></div>
					<form method="POST" action="?/reset" class="inline">
						<input type="hidden" name="id" value={u.id} />
						<input name="password" type="password" autocomplete="new-password" minlength="6" required placeholder={t('acc.reset')} aria-label={`${t('acc.reset')}: ${u.login}`} />
						<button type="submit">{t('acc.save')}</button>
					</form>
					{#if errOf(`reset-${u.id}`)}<p class="err" role="alert">{errOf(`reset-${u.id}`)}</p>{/if}
					{#if okOf(`reset-${u.id}`)}<p class="ok" role="status">{t('acc.resetDone')}</p>{/if}
				</li>
			{/each}
		</ul>
		<h3>{t('acc.add')}</h3>
		<form method="POST" action="?/add">
			<label><span>{t('login.login')}</span><input name="login" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" required /></label>
			<label><span>{t('login.name')}</span><input name="name" autocomplete="off" /></label>
			<label><span>{t('login.password')}</span><input name="password" type="password" autocomplete="new-password" minlength="6" required /></label>
			<label>
				<span>{t('acc.lang')}</span>
				<select name="lang"><option value="en">English</option><option value="ru">Русский</option></select>
			</label>
			{#if errOf('add')}<p class="err" role="alert">{errOf('add')}</p>{/if}
			{#if okOf('add')}<p class="ok" role="status">{t('acc.added')}</p>{/if}
			<button type="submit" class="primary">{t('acc.add')}</button>
		</form>
	</Fold>
{/if}

<style>
	.card {
		margin-bottom: var(--s4);
		padding: var(--s4);
		border-radius: var(--r3);
		background: var(--surface);
	}
	h3 {
		margin: var(--s4) 0 var(--s2);
		font-size: var(--fs-m);
	}
	.who {
		margin: 0 0 var(--s3);
	}
	.muted {
		color: var(--muted);
		font-size: var(--fs-s);
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--s3);
	}
	.buttons {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s2);
	}
	form {
		display: flex;
		flex-direction: column;
		gap: var(--s3);
	}
	form.inline {
		flex-direction: row;
		gap: var(--s2);
		margin-top: var(--s2);
	}
	form.inline input {
		flex: 1;
		min-width: 0;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	label span {
		font-size: var(--fs-s);
		color: var(--muted);
	}
	input,
	select {
		min-height: var(--tap);
		padding: 0 var(--s3);
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: var(--bg);
		color: var(--text);
		font-size: 16px;
	}
	button {
		min-height: var(--tap);
		padding: 0 var(--s4);
		border: 1px solid var(--line);
		border-radius: var(--r2);
		background: none;
		color: var(--text);
		font-size: var(--fs-m);
		cursor: pointer;
	}
	button.primary {
		border: none;
		background: var(--accent);
		color: var(--accent-text);
		font-weight: 600;
	}
	.users {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.users li {
		padding: var(--s3) 0;
		border-top: 1px solid var(--line);
	}
	.err {
		margin: 0;
		color: var(--down);
	}
	.ok {
		margin: 0;
		color: var(--up);
	}
</style>
