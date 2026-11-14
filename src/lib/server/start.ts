/** Why the app could not start (e.g. a data volume it cannot write to); shown by /health. */
let error: string | null = null;
export const setStartError = (e: string) => (error = e);
export const startError = () => error;
