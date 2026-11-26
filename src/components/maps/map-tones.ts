/** Pin colours: strongly contrasting, readable in the sun (as the framing plan). */
export const PIN_TONE = { site: "#22262A", ok: "#2E7D32", far: "#C62828", project: "#B5653E", late: "#C62828" } as const;
export type PinTone = keyof typeof PIN_TONE;
