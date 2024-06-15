const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const NULL_BUFFER = new Uint8Array(0);

export function encode_utf8_string(str: string) {
	if (str === "")	{
		return NULL_BUFFER;
	}
	return encoder.encode(str)
}

export function decode_utf8_string(buffer: ArrayBuffer, offset: number, length: number) {
	if (length === 0) {
		return ""
	}
	const view = new Uint8Array(buffer, offset, length)
	return decoder.decode(view);
}