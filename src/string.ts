const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encode_utf8_string(str: string): Uint8Array {
	return encoder.encode(str);
}

export function decode_utf8_string(buffer: ArrayBuffer, offset: number, length: number): string {
	const view = new Uint8Array(buffer, offset, length)
	return decoder.decode(view);
}