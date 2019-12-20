import { ZipArchive } from "./zip.js";

async function compress (input) {
    const buffer = await new Response(input).arrayBuffer();
    const bytes = new Uint8Array(buffer);

    const compressed_bytes = pako.deflateRaw(bytes);

    return new Blob([compressed_bytes]);
}

async function decompress (input) {
    const buffer = await new Response(input).arrayBuffer();
    const bytes = new Uint8Array(buffer);

    const decompressed_bytes = pako.inflateRaw(bytes);

    return new Blob([decompressed_bytes]);
}

ZipArchive.set_compression_function(compress);
ZipArchive.set_decompression_function(decompress);

export { ZipArchive };