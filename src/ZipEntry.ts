import { HEADER_DATA_DESCRIPTOR } from "./constants";
import { assert } from "./utils/assert";
import { BlobSlice } from "./utils/Slice";

export class ZipEntry {
	private locked = false;

	extra?: Uint8Array
	comment?: Uint8Array
	
	internal_file_attr = 0
	external_file_attr = 0
	bit_flag = 0
	modified = new Date
	
	get is_compressed(): boolean {
		return this.compression !== 0;
	}
	
	constructor(private slice: BlobSlice, public compression: number, readonly uncompressed_size: number, readonly crc: number) {}

	clone (): ZipEntry {
		const copy = new ZipEntry(this.slice, this.compression, this.uncompressed_size, this.crc);

		copy.modified = new Date(this.modified.getTime());

		if (this.comment) {
			copy.comment = this.comment.slice(0);
		}
		if (this.extra) {
			copy.extra = this.extra.slice(0);
		}

		copy.bit_flag = this.bit_flag;
		copy.external_file_attr = this.external_file_attr;
		copy.internal_file_attr = this.internal_file_attr;

		return copy;
	}
	
	// alias for uncompressed_size
	get size(): number {
		return this.uncompressed_size;
	}
	
	get compressed_size(): number {
		return this.slice.size;
	}
	
	generate_data_descriptor () {
		const length = 16;
		const buffer = new ArrayBuffer(length);
		const view = new DataView(buffer);
		
		view.setUint32(0, HEADER_DATA_DESCRIPTOR, true);
		view.setUint32(4, this.crc, true);
		view.setUint32(8, this.compressed_size, true);
		view.setUint32(12, this.uncompressed_size, true);
		
		return buffer;
	}

	async decompress() {
		if (this.compression === 0) {
			return;
		}
		assert(this.compression === 8, "Incompatible compression type");
		assert(!this.locked, "Entry is locked");
		this.locked = true

		try {
			const slice = await this.slice.inflate();
			this.slice = slice
		} finally {
			this.locked = false;
		}
	}

	async compress() {
		if (this.compression !== 0) {
			return;
		}
		assert(!this.locked, "Entry is locked");
		this.locked = true

		try {
			await this.slice.deflate();
		} finally {
			this.locked = false;
		}
	}
	
	async blob () {
		await this.decompress()
		return this.slice.blob();
	}

	async text () {
		await this.decompress()
		return this.slice.text();
	}

	async buffer () {
		await this.decompress()
		return this.slice.buffer();
	}

	async stream () {
		await this.decompress()
		return this.slice.stream();
	}
	
	/**
	 * @deprecated use `entry.blob()` instead
	 */
	get_blob = () => this.blob();	
	/**
	 * @deprecated use `entry.buffer()` instead
	 */
	get_array_buffer = () => this.buffer();
	/**
	 * @deprecated use `entry.text()` instead
	 */
	get_string = () => this.text();
}