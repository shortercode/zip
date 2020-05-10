import { ZipArchive } from "./zip.js";

function blob_stream (input) {
	return input.stream();
}

async function compress (input){
	const ds = new CompressionStream('deflate-raw');
	const compressedStream = blob_stream(input).pipeThrough(ds);
	return await new Response(compressedStream).blob();
}

async function decompress (input){
	const ds = new DecompressionStream('deflate-raw');
	const decompressedStream = blob_stream(input).pipeThrough(ds);
	return await new Response(decompressedStream).blob();
}

ZipArchive.set_compression_function(compress);
ZipArchive.set_decompression_function(decompress);

export { ZipArchive };