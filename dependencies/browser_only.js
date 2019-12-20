import { ZipArchive } from "./zip.js";

declare class CompressionStream extends TransformStream {
    constructor (type: string)
}

declare class DecompressionStream extends TransformStream {
    constructor (type: string)
}

// HACK typescript doesn't believe in Blob.prototype.stream
// so we use type convertion to allow the call, but preserve
// the overall type from the outside
function blob_stream (input: Blob): ReadableStream {
    return (input as any).stream() as ReadableStream
}

async function compress (input: Blob): Promise<Blob> {
    const ds = new CompressionStream('deflate-raw');
    const compressedStream = blob_stream(input).pipeThrough(ds);
    return await new Response(compressedStream).blob();
}

async function decompress (input: Blob): Promise<Blob> {
    const ds = new DecompressionStream('deflate-raw');
    const decompressedStream = blob_stream(input).pipeThrough(ds);
    return await new Response(decompressedStream).blob();
}

ZipArchive.set_compression_function(compress);
ZipArchive.set_decompression_function(decompress);

export { ZipArchive };