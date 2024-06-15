export function assert(test: boolean, msg: string): asserts test {
	if (test === false) {
		throw Error(msg)
	}
}