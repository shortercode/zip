import { HEADER_CD, HEADER_LOCAL } from "./constants.js";


const inflatedEntries: WeakMap<Blob, Blob> = new WeakMap
const encoder = new TextEncoder();

function encodeString (str: string): Uint8Array {
	return encoder.encode(str);
}

export class ZipEntry {
	private readonly blob: Blob
	readonly compressed: boolean
	
	constructor (blob: Blob, isCompressed: boolean) {
		this.compressed = isCompressed;
		this.blob = blob;
	}
	
    private async decompress(): Promise<Blob> {
        const existing = inflatedEntries.get(this.blob);
		if (existing)
			return existing;
		else {
			// TODO decompression logic here
            return this.blob;
		}
    }
    
    generateLocalHeader (filename: string, extra?: Uint8Array) {
		let offset = 0;
		const encodedFilename = encodeString(filename);
		const length = 30 + encodedFilename.length + (extra ? extra.length : 0);
		const buffer = new ArrayBuffer(length);
		const view = new DataView(buffer);
		const uintview = new Uint8Array(buffer);

		// [0, 4] Local file header signature
		view.setUint32(offset, HEADER_LOCAL, true);
		offset += 4;
		
		// TODO add correct minimum required version
		// [4, 2] minimum required version
		view.setUint16(offset, 0, true);
		offset += 2;
		
		// TODO add correct bit flag
		// [6, 2] bit flag
		view.setUint16(offset, 0, true);
		offset += 2;
		
		// [8, 2] compression method
		view.setUint16(offset, this.compressed ? 8 : 0, true);
		offset += 2;
		
		// TODO add correct time
		// [10, 2] last modified time
		view.setUint16(offset, 0, true);
		offset += 2;
		
		// TODO add correct date
		// [12, 2] last modified date
		view.setUint16(offset, 0, true);
		offset += 2;
		
		// TODO add correct CRC
		// [14, 4] CRC 32
		view.setUint32(offset, 0, true);
		offset += 4;
		
		// TODO add correct compressed size
		// [18, 4] compressed size
		view.setUint32(offset, 0, true);
		offset += 4;
		
		// TODO add correct uncompressed size
		// [22, 4] uncompressed size
		view.setUint32(offset, 0, true);
		offset += 4;
		
		// [26, 2] file name length (n)
		view.setUint16(offset, encodedFilename.length, true);
		offset += 2;
		
		// [28, 2] extra field length (m)
		view.setUint16(offset, extra ? extra.length : 0, true);
		offset += 2;
		
		// [30, n] file name
		uintview.set(encodedFilename, offset);
		offset += encodedFilename.length;
		
		// [30 + n, m] extra field
		if (extra) {
			uintview.set(extra, offset);
			offset += extra.length;
		}

		// might be a 12 - 16 byte footer here, depending on the value of flag

		return view;
    }

    generateCentralHeader (filename: string, extra?: Uint8Array, comment?: string) {
        let offset = 0;
        const encodedFilename = encodeString(filename);
        const encodedComment = comment ? encodeString(comment) : null;
        const length = 30 + encodedFilename.length + (extra ? extra.length : 0) + (encodedComment ? encodedComment.length : 0);
        
		const buffer = new ArrayBuffer(length);
		const view = new DataView(buffer);
        const uintview = new Uint8Array(buffer);
		
		// [0, 4] CD signature
		view.setUint32(offset, HEADER_CD, true);
		offset += 4;
        
        // TODO set correct version made by
		// [4, 2] version made by
		view.setUint16(offset, 0, true);
		offset += 2;
        
        // TODO set correct minimum required version
		// [6, 2] minimum required version
		view.setUint16(offset, 0, true);
		offset += 2;
        
        // TODO add correct bit flag
		// [8, 2] bit flag
		view.setUint16(offset, 0, true);
		offset += 2;
		
		// [10, 2] compression method ( 0 = none / 8 = deflate )
		view.setUint16(offset, this.compressed ? 8 : 0, true);
		offset += 2;
        
        // TODO add correct time
		// [12, 2] last modified time
		view.setUint16(offset, 0, true);
		offset += 2;
        
        // TODO add correct date
		// [14, 2] last modified date
		view.setUint16(offset, 0, true);
		offset += 2;
        
        // TODO add correct CRC
		// [16, 4] CRC 32
		view.setUint32(offset, 0, true);
		offset += 4;
        
        // TODO add correct compressed size
		// [20, 4] compressed size
		view.setUint32(offset, 0, true);
		offset += 4;
        
        // TODO add correct uncompressed size
		// [24, 4] uncompressed size
		view.setUint32(offset, 0, true);
		offset += 4;
		
		// [28, 2] file name length (n)
		view.setUint16(offset, encodedFilename.length, true);
		offset += 2;
		
		// [30, 2] extra field length (m)
		view.setUint16(offset, extra ? extra.length : 0, true);
		offset += 2;
		
		// [32, 2] file comment length (k)
		view.setUint16(offset, encodedComment ? encodedComment.length : 0, true);
		offset += 2;
        
        // TODO set correct disk number
		// [34, 2] disk number where file starts
		view.setUint16(offset, 0, true);
		offset += 2;
        
        // TODO set correct internal file attr
		// [36, 2] internal file attributes
		view.setUint16(offset, 0, true);
		offset += 2;
        
        // TODO set correct external file attr
		// [38, 4] external file attributes
		view.setUint32(offset, 0, true);
		offset += 4;
        
        // TODO set correct local position
		// [42, 4] offset of local file header, relative to start of archive
		view.setUint32(offset, localPosition, true);
		offset += 4;
        
        // [46, n] file name
        uintview.set(encodedFilename, offset);
        offset += encodedFilename.length;
		
		// [46 + n, m] extra field
		if (extra) {
			uintview.set(extra, offset);
			offset += extra.length;
		}
		
        // [46 + n + m, k] file comment
        if (encodedComment) {
			uintview.set(encodedComment, offset);
			offset += encodedComment.length;
        }
        
        return view;
    }

    getBackingObject () {
        return this.blob;
    }
	
	async getBlob () {
		if (this.compressed)
			return this.decompress();
		else
			return this.blob;
	}
}