import { workerize } from "isoworker";

export const inflate = workerize(async (blob: Blob) => {
  const chunks: Uint8Array[] = [];

  await blob.stream()
    .pipeThrough(new DecompressionStream("deflate-raw"))
    .pipeTo(
      new WritableStream({
        write (chunk) {
          chunks.push(chunk);
        }
      })
    );
  
  return new Blob(chunks);
}, []);

export const deflate = workerize(async (blob: Blob) => {
  const chunks: Uint8Array[] = [];

  await blob.stream()
    .pipeThrough(new CompressionStream("deflate-raw"))
    .pipeTo(
      new WritableStream({
        write (chunk) {
          chunks.push(chunk);
        }
      })
    );
  
  return new Blob(chunks);
}, []);