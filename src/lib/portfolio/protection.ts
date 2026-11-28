/** T-021: the block «Защита» as the API gives it (src/lib/server/protection.ts) */
export interface PFormula {
	atr: number;
	atrPct: number;
	level: { kind: 'low_short' | 'low_long' | 'sma'; days: number; value: number } | null;
	stop: number;
	limit: number;
	trailPct: number;
	trailStop: number;
	target: number;
	targetR: number;
	resistance: number | null;
}
export interface PItem {
	securityId: number;
	symbol: string;
	priceUnit: string;
	currency: string;
	price: number;
	approx: boolean;
	historyQueued: boolean;
	f: PFormula;
	recommended: 'fixed' | 'trail';
	why: 'model_term' | 'spec' | 'no_thesis' | 'profit' | 'no_term' | 'term' | 'new';
	size: { qty: number; amount: number; budget: number; portfolio: string; portfolioCurrency: string } | null;
	position: { id: number; qty: number; portfolioId: number; portfolio: string; portfolioCurrency: string } | null;
	maxLoss: { fixed: number; trail: number; pctFixed: number | null; pctTrail: number | null; currency: string } | null;
	order: { id: number; type: 'fixed' | 'trail'; stop: number | null; limitPrice: number | null; trailPct: number | null; takeProfit: number | null; basePrice: number | null; setDate: string; level: number | null } | null;
	status: 'protected' | 'near' | 'unprotected' | 'declined' | null;
	noStopReason: string | null;
	broker: string | null;
	oco: boolean | null;
	/** owner 28.11.2026: a price or a percent into money at once */
	calc?: { qty: number; perUnit: number; portfolioValue: number; avgPrice: number | null; currency: string };
}
/** a price as the broker takes it: dollars to cents, agorot whole */
export const plain = (x: number, unit: string) => (unit === 'ILA' ? String(Math.round(x)) : x.toFixed(2));
