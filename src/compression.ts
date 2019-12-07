import { assert } from "./assert.js";

type FunctionType = (buffer: ArrayBuffer) => Promise<ArrayBuffer>;
let compression_function: FunctionType;
let decompression_function: FunctionType;

export function set_compression_function (fn: FunctionType) {
    compression_function = fn;
}

export function set_decompression_function (fn: FunctionType) {
    decompression_function = fn;
}

export function compress (buffer: ArrayBuffer): Promise<ArrayBuffer> {
    assert(compression_function !== null, "Compression function not specified");
    return compression_function(buffer);
}

export function decompress (buffer: ArrayBuffer): Promise<ArrayBuffer> {
    assert(decompression_function !== null, "Decompression function not specified");
    return decompression_function(buffer);
}