export class BlobSlice {
	private readonly start: number
	private readonly end: number
	private readonly blob: Blob
	private readonly is_whole: boolean
	
	constructor(blob: Blob, offset: number = 0, length: number = blob.size) {
		this.start = offset;
		this.end = offset + length;
		this.blob = blob;
		
		this.is_whole = offset === 0 && length === blob.size;
	}
	get size (): number {
		return this.end - this.start;
	}
	get_blob (): Blob {
		if (this.is_whole) {
			return this.blob;
		}
		return this.blob.slice(this.start, this.end);
	}
}