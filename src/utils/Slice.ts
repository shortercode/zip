import { inflate, deflate } from "./compression";
import { NULL_BUFFER, decode_utf8_string } from "./string";

export class BlobSlice {
  private sliced: Blob | ArrayBuffer | null = null;

  constructor(readonly source: Blob | ArrayBuffer, readonly start: number, readonly end: number) {
    const size = source instanceof Blob ? source.size : source.byteLength;
    if (start < 0 || end > size || start > end) {
      throw new RangeError("Invalid slice range");
    }
    if (this.shared) {
      this.sliced = source;
    }
  }

  get shared () {
    const size = this.source instanceof Blob ? this.source.size : this.source.byteLength;
    return this.start === 0 && this.end === size;
  }

  get size () {
    return this.end - this.start;
  }

  private resolve() {
    if (this.sliced === null) {
      this.sliced = this.source.slice(this.start, this.end);
    }
    return this.sliced;
  }

  blob(): Blob {
    const raw = this.resolve();
    return raw instanceof Blob ? raw : new Blob([raw]);
  }

  text(): Promise<string> {
    const raw = this.resolve();
    return raw instanceof Blob ? raw.text() : Promise.resolve(decode_utf8_string(raw, 0, raw.byteLength));
  }

  buffer(): Promise<ArrayBuffer> {
    const raw = this.resolve();
    return raw instanceof Blob ? raw.arrayBuffer() : Promise.resolve(raw as ArrayBuffer);
  }

  stream(): ReadableStream<Uint8Array> {
    return this.blob().stream();
  }

  async inflate(): Promise<BlobSlice> {
    const blob = await new Promise<Blob>((resolve, reject) => {
      inflate(this.blob(), (err, res) => {
        err ? reject(err) : resolve(res)
      })
    })
    return new BlobSlice(blob, 0, blob.size)
  }

  async deflate(): Promise<BlobSlice> {
    const blob = await new Promise<Blob>((resolve, reject) => {
      deflate(this.blob(), (err, res) => {
        err ? reject(err) : resolve(res)
      })
    })
    return new BlobSlice(blob, 0, blob.size)
  }

  static join(slices: BlobSlice[]): BlobSlice {
    if (slices.length === 0) {
      throw new RangeError("No slices to join");
    }
    if (slices.length === 1) {
      return slices[0];
    }
    // TODO: stitch adjacent slices instead of slicing them ( optimization )
    // TODO: skip empty slices
    const blobs = slices.map(slice => slice.blob());
    const blob = new Blob(blobs);
    return new BlobSlice(blob, 0, blob.size);
  }
}

export const NULL_SLICE = new BlobSlice(NULL_BUFFER.buffer, 0, 0);
