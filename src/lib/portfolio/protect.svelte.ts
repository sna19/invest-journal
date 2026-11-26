/** T-021: after «Купил» the card opens with this position's cheat sheet for the broker already open */
export const protectFocus = $state<{ positionId: number | null }>({ positionId: null });
