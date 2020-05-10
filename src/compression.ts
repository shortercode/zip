import { assert } from "./assert";

type FunctionType = (input: Blob) => Promise < Blob > ;
let compression_function: FunctionType;
let decompression_function: FunctionType;

export function set_compression_function(fn: FunctionType) {
	compression_function = fn;
}

export function set_decompression_function(fn: FunctionType) {
	decompression_function = fn;
}

export function compress(input: Blob): Promise <Blob> {
	assert(compression_function !== null, "Compression function not specified");
	return compression_function(input);
}

export function decompress(input: Blob): Promise <Blob> {
	assert(decompression_function !== null, "Decompression function not specified");
	return decompression_function(input);
}