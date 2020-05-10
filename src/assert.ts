export class AssertionError extends Error {};

export function assert(test: boolean, msg: string) {
	if (test === false) {
		throw new AssertionError(msg);
	}
}