/**
 * Spec section 13 — instead of «Are you sure?» the action happens at once and a bar with «Отменить» stays
 * at the bottom for 5 seconds.
 */
export const toast = $state<{ text: string; undo?: () => void; id: number } | { text: null; id: number }>({ text: null, id: 0 });

let timer: ReturnType<typeof setTimeout> | undefined;

export function showToast(text: string, undo?: () => void) {
	clearTimeout(timer);
	const id = toast.id + 1;
	Object.assign(toast, { text, undo, id });
	timer = setTimeout(() => {
		if (toast.id === id) Object.assign(toast, { text: null, undo: undefined });
	}, 5000);
}

export function hideToast() {
	clearTimeout(timer);
	Object.assign(toast, { text: null, undo: undefined });
}
