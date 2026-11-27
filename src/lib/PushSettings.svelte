<script lang="ts">
	import { onMount } from 'svelte';
	import { tl, tx } from './i18n.js';
	import { showToast } from './toast.svelte.js';

	/**
	 * T-015, «Настройки» → «Уведомления»: this device subscribes to the signals of the trade discipline (Web Push).
	 * On an iPhone it works in the app added to the home screen (iOS 16.4+), not in a Safari tab.
	 */
	type Kind = 'stop' | 'no_stop' | 'target' | 'review' | 'model_end' | 'path' | 'entry' | 'reminder' | 'ideas';
	const KINDS: [Kind, string, string][] = [
		['stop', 'Стоп пробит', 'Stop broken'],
		['no_stop', 'Куплено без стопа (через сутки)', 'Bought without a stop (a day later)'],
		['target', 'Цель достигнута', 'Target reached'],
		['review', 'Пора пересмотреть', 'Time to review'],
		['model_end', 'Период модели закончился', 'The model\'s period is over'],
		['path', 'Метки пути доходности', 'Marks of the return\'s path'],
		['entry', '«Хочу купить»: цена дошла до желаемой, ниже стопа плана, пора решить', '«Want to buy»: the wanted price reached, under the plan\'s stop, time to decide'],
		['reminder', 'Напоминания дневника', 'Diary reminders'],
		['ideas', 'Сводка сигналов недели', 'The week\'s signals digest']
	];
	let mode = $state<'loading' | 'unsupported' | 'ios-tab' | 'denied' | 'off' | 'on'>('loading');
	let kinds = $state<Kind[]>([]);
	let devices = $state(0);
	let publicKey = '';
	let busy = $state(false);

	function b64(s: string) {
		const p = '='.repeat((4 - (s.length % 4)) % 4);
		const raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/'));
		return Uint8Array.from(raw, (c) => c.charCodeAt(0));
	}
	async function reg() {
		return navigator.serviceWorker.ready;
	}
	onMount(async () => {
		const j = await fetch('/api/push').then((r) => r.json()).catch(() => null);
		if (j) {
			kinds = j.kinds;
			devices = j.devices.length;
			publicKey = j.publicKey;
		}
		const ios = /iPhone|iPad/.test(navigator.userAgent);
		const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
		if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return (mode = ios && !standalone ? 'ios-tab' : 'unsupported');
		if (Notification.permission === 'denied') return (mode = 'denied');
		const sub = await (await reg()).pushManager.getSubscription().catch(() => null);
		mode = sub && j?.devices.some((d: { endpoint: string }) => d.endpoint === sub.endpoint) ? 'on' : 'off';
	});

	async function post(b: object) {
		const r = await fetch('/api/push', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
		const j = await r.json().catch(() => ({}));
		if (!r.ok) throw new Error(tl(j.message) || tx('Не сохранилось', 'Not saved'));
		return j;
	}
	async function enable() {
		busy = true;
		try {
			if ((await Notification.requestPermission()) !== 'granted') return (mode = 'denied');
			const r = await reg();
			const sub = (await r.pushManager.getSubscription()) ?? (await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(publicKey) }));
			const j = await post({ action: 'subscribe', subscription: sub.toJSON(), device: navigator.userAgent.match(/iPhone|iPad|Android|Mac|Windows|Linux/)?.[0] ?? 'browser' });
			devices = j.devices;
			mode = 'on';
			showToast(tx('Уведомления включены', 'Notifications on'));
		} catch (e) {
			showToast((e as Error).message);
		} finally {
			busy = false;
		}
	}
	async function disable() {
		busy = true;
		try {
			const sub = await (await reg()).pushManager.getSubscription();
			if (sub) {
				await post({ action: 'unsubscribe', endpoint: sub.endpoint });
				await sub.unsubscribe();
			}
			mode = 'off';
		} finally {
			busy = false;
		}
	}
	async function test() {
		const j = await post({ action: 'test' }).catch((e) => (showToast(e.message), null));
		if (j) showToast(j.sent ? tx(`Отправлено на устройств: ${j.sent}`, `Sent to ${j.sent} device(s)`) : tx('Ни одно устройство не приняло', 'No device took it'));
	}
	async function toggle(k: Kind) {
		const next = kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k];
		const j = await post({ action: 'kinds', kinds: next }).catch((e) => (showToast(e.message), null));
		if (j) kinds = j.kinds;
	}
</script>

<div class="push">
	{#if mode === 'loading'}
		<p class="muted">…</p>
	{:else if mode === 'ios-tab'}
		<p>{tx('На iPhone уведомления работают в приложении с экрана «Домой»: в Safari «Поделиться» → «На экран Домой», открыть оттуда и включить здесь.', 'On an iPhone notifications work in the app on the home screen: in Safari «Share» → «Add to Home Screen», open it from there and turn them on here.')}</p>
	{:else if mode === 'unsupported'}
		<p class="muted">{tx('Этот браузер не поддерживает уведомления.', 'This browser does not support notifications.')}</p>
	{:else if mode === 'denied'}
		<p>{tx('Уведомления запрещены для приложения. Разреши их в настройках телефона (Настройки → Уведомления) и открой этот экран снова.', 'Notifications are blocked for the app. Allow them in the phone settings (Settings → Notifications) and open this screen again.')}</p>
	{:else if mode === 'off'}
		<button class="main" disabled={busy} onclick={enable}>{tx('Включить на этом устройстве', 'Turn on for this device')}</button>
	{:else}
		<p>{tx('Включены на этом устройстве', 'On for this device')}{devices > 1 ? ` · ${tx('устройств всего', 'devices in all')}: ${devices}` : ''}</p>
		<div class="btns">
			<button class="ghost" onclick={test}>{tx('Проверить', 'Test')}</button>
			<button class="ghost" disabled={busy} onclick={disable}>{tx('Выключить', 'Turn off')}</button>
		</div>
	{/if}
	{#if mode !== 'loading'}
		<p class="k">{tx('Что присылать', 'What to send')}</p>
		{#each KINDS as [k, ru, en] (k)}
			<label class="check"><input type="checkbox" checked={kinds.includes(k)} onchange={() => toggle(k)} /> {tx(ru, en)}</label>
		{/each}
		<p class="muted small">{tx('По умолчанию — только «стоп пробит». Каждый сигнал приходит один раз; после «Пересмотрел» — снова, если условие сработает.', 'By default only «stop broken». Each signal comes once; after «Reviewed» — again if the condition is met.')}</p>
	{/if}
</div>

<style>
	.push {
		display: flex;
		flex-direction: column;
		gap: var(--s2);
	}
	p {
		margin: 0;
	}
	.k {
		margin-top: var(--s2);
		font-size: var(--fs-xs);
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	.check {
		display: flex;
		align-items: center;
		gap: var(--s2);
		min-height: 36px;
	}
	.check input {
		width: 20px;
		height: 20px;
	}
	.btns {
		display: flex;
		gap: var(--s2);
	}
	.main,
	.ghost {
		min-height: var(--tap);
		padding: 0 var(--s4);
		border-radius: var(--r2);
		font-weight: 600;
		cursor: pointer;
	}
	.main {
		border: none;
		background: var(--accent);
		color: var(--accent-text);
	}
	.ghost {
		border: 1px solid var(--line);
		background: var(--surface);
		color: var(--text);
	}
	.muted {
		color: var(--muted);
	}
	.small {
		font-size: var(--fs-s);
	}
</style>
