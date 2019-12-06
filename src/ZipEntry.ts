import { HEADER_CD, HEADER_LOCAL } from "./constants.js";
import { encode_utf8_string } from "./string.js";

const inflated_entries: WeakMap<Blob, Blob> = new WeakMap

export class ZipEntry {
	private readonly blob: Blob
	private extra?: Uint8Array
	private comment?: Uint8Array
	readonly compressed: boolean
	
	constructor (blob: Blob, isCompressed: boolean) {
		this.compressed = isCompressed;
		this.blob = blob;
	}
	
    private async decompress(): Promise<Blob> {
        const existing = inflated_entries.get(this.blob);
		if (existing)
			return existing;
		else {
			// TODO decompression logic here
            return this.blob;
		}
    }
    
    generate_local (filename: string): ArrayBuffer {
		const encoded_filename = encode_utf8_string(filename);
		const N = encoded_filename.length;
		const M = this.extra ? this.extra.length : 0;
		const length = 30 + N + M;
		const buffer = new ArrayBuffer(length);
		const view = new DataView(buffer);
		const uintview = new Uint8Array(buffer);

		/*
		 *	4 bytes - Local file header signature
		 *	2 bytes - Minimum require version
		 *	2 bytes - Bit flag
		 *	2 bytes - Compression method
		 *  2 bytes - Last modified time
		 *  2 bytes - Last modified date
		 *  4 bytes - CRC
		 *  4 bytes - Compressed size
		 *  4 bytes - Uncompressed size
		 *  2 bytes - Filename length
		 *  2 bytes - Extra field length
		 *  N bytes - Filename
		 *  M bytes - Extra field
		 */

		view.setUint32(0, HEADER_LOCAL, true);
		view.setUint16(4, 0, true); // TODO add correct minimum required version
		view.setUint16(6, 0, true); // TODO add correct bit flag
		view.setUint16(8, this.compressed ? 8 : 0, true);
		view.setUint16(10, 0, true); // TODO add correct time
		view.setUint16(12, 0, true); // TODO add correct date
		view.setUint32(16, 0, true); // TODO add correct CRC
		view.setUint32(20, 0, true); // TODO add correct compressed size
		view.setUint32(24, 0, true); // TODO add correct uncompressed size
		view.setUint16(26, encoded_filename.length, true);
		view.setUint16(28, M, true);
		
		uintview.set(encoded_filename, 30);

		if (this.extra) {
			uintview.set(this.extra, 30 + N);
		}

		// might be a 12 - 16 byte footer here, depending on the value of flag

		return buffer;
    }

    generate_cd (filename: string, local_position: number): ArrayBuffer {
		const encoded_filename = encode_utf8_string(filename);
		const N = encoded_filename.length;
		const M = this.extra ? this.extra.length : 0;
		const K = this.comment ? this.comment.length : 0;
        const length = 46 + M + N + K;
		const buffer = new ArrayBuffer(length);
		const view = new DataView(buffer);
		const uintview = new Uint8Array(buffer);
		
		/*
		 *	4 bytes - Central directory header signature
		 *	2 bytes - Version made by
		 *	2 bytes - Minimum require version
		 *	2 bytes - Bit flag
		 *	2 bytes - Compression method
		 *  2 bytes - Last modified time
		 *  2 bytes - Last modified date
		 *  4 bytes - CRC
		 *  4 bytes - Compressed size
		 *  4 bytes - Uncompressed size
		 *  2 bytes - Filename length
		 *  2 bytes - Extra field length
		 *  2 bytes - File comment length
		 *  2 bytes - Disk number
		 *  2 bytes - Internal file attribute
		 *  4 bytes - External file attribute
		 *  4 bytes - Local position
		 *  N bytes - Filename
		 *  M bytes - Extra field
		 *  K bytes - File comment
		 */
		
		view.setUint32(0, HEADER_CD, true);
		view.setUint16(4, 0, true); // TODO set correct version made by
		view.setUint16(6, 0, true); // TODO set correct minimum required version
		view.setUint16(8, 0, true); // TODO add correct bit flag
		view.setUint16(10, this.compressed ? 8 : 0, true);
		view.setUint16(12, 0, true); // TODO add correct time
		view.setUint16(14, 0, true); // TODO add correct date
		view.setUint32(16, 0, true); // TODO add correct CRC
		view.setUint32(20, 0, true); // TODO add correct compressed size
		view.setUint32(24, 0, true); // TODO add correct uncompressed size
		view.setUint16(28, encoded_filename.length, true);
		view.setUint16(30, M, true);
		view.setUint16(32, K, true);
		view.setUint16(34, 0, true); // TODO set correct disk number
		view.setUint16(36, 0, true); // TODO set correct internal file attr
		view.setUint32(38, 0, true); // TODO set correct external file attr
		view.setUint32(42, local_position, true); // TODO set correct local position

        uintview.set(encoded_filename, 46);

		if (this.extra) {
			uintview.set(this.extra, 46 + N);
		}

        if (this.comment) {
			uintview.set(this.comment, 46 + N + M);
        }
        
        return buffer;
    }

    get_backing_object (): Blob {
        return this.blob;
    }
	
	async get_blob (): Promise<Blob> {
		if (this.compressed)
			return this.decompress();
		else
			return this.blob;
	}
}