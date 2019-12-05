import { ZipEntry } from "./ZipEntry.js";
import { HEADER_CD, HEADER_EOCDR } from "./constants.js";

const decoder = new TextDecoder();

function decodeString (buffer: ArrayBuffer, position: number, length: number): string
{
    const childView = new Uint8Array(buffer, position, length)
    return decoder.decode(childView);
}

function ReadBlob (blob: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) =>
    {
        const fileReader = new FileReader();
        fileReader.onload = () => resolve(<ArrayBuffer>fileReader.result);
        fileReader.onerror = () => reject(fileReader.error);
        fileReader.readAsArrayBuffer(blob);
    });
}

function NOT_IMPLEMENTED (name: string) {
    throw new Error(`${name} is not implemented`);
}

export class ZipArchive {
	private entries: Map<string, ZipEntry> = new Map
	
	has (name: string) {
		this.verifyPath(name);
	}
	
	get (name: string): ZipEntry|undefined {
		this.verifyPath(name);
		return this.entries.get(name);
	}
	
	set (name: string, file: Blob): ZipEntry {
		this.verifyPath(name);
		const entry = new ZipEntry(file, false);
		this.entries.set(name, entry);
		return entry;
	}
	
	copy (from: string, to: string) {
		this.verifyPath(from);
        this.verifyPath(to);
        NOT_IMPLEMENTED("ZipArchive.copy");
	}
	
	move (from: string, to: string) {
		this.verifyPath(from);
        this.verifyPath(to);
        NOT_IMPLEMENTED("ZipArchive.move");
	}
	
	async compressEntry (name: string) {
		const entry = this.get(name);
		if (!entry)
			throw new Error(`Entry ${name} does not exist`);
		if (!entry.compressed) {
			const blob = await entry.getBlob();
			const deflatedBlob = await this.compressBlob(blob);
			const newEntry = new ZipEntry(deflatedBlob, true);
			return newEntry;
		}
		return entry;
	}
	
	toBlob (): Blob {
        const parts: BlobPart[] = [];

        let offset = 0;

        const directories = [];

        for (const [name, entry] of this.entries) {
            const location = offset;
            const local = entry.generateLocalHeader(name);
            const file = entry.getBackingObject();

            offset += local.byteLength + file.size;
            parts.push(local, file);

            // TODO pass in location
            const cd = entry.generateCentralHeader(name);
            directories.push(cd);
        }

        const CDOffset = offset;

        for (const cd of directories) {
            parts.push(cd);
        }

        const EOCDR = this.generateEOCDR(CDOffset, directories.length);
        return new Blob(parts);
    }
    
    files (): IterableIterator<[string, ZipEntry]> {
        return this.entries.entries();
    }

    private static readLocal (view: DataView, position: number)
	{
		let offset = position;
		
		// [0, 4] Local file header signature
		const signature = view.getUint32(offset, true);
		offset += 4;
		
		// [4, 2] minimum required version
		const version = view.getUint16(offset, true);
		offset += 2;
		
		// [6, 2] bit flag
		const flag = view.getUint16(offset, true);
		offset += 2;
		
		// [8, 2] compression method
		const compression = view.getUint16(offset, true);
		offset += 2;
		
		// [10, 2] last modified time
		const time = view.getUint16(offset, true);
		offset += 2;
		
		// [12, 2] last modified date
		const date = view.getUint16(offset, true);
		offset += 2;
		
		// [14, 4] CRC 32
		const crc = view.getUint32(offset, true);
		offset += 4;
		
		// [18, 4] compressed size
		const compressedSize = view.getUint32(offset, true);
		offset += 4;
		
		// [22, 4] uncompressed size
		const uncompressedSize = view.getUint32(offset, true);
		offset += 4;
		
		// [26, 2] file name length (n)
		const nameLength = view.getUint16(offset, true);
		offset += 2;
		
		// [28, 2] extra field length (m)
		const fieldLength = view.getUint16(offset, true);
		offset += 2;
		
		// [30, n] file name
		const fileName = decodeString(view.buffer, offset, nameLength);
		offset += nameLength;
		
		// [30 + n, m] extra field
		const field = new Uint8Array(view.buffer, offset, fieldLength);
        offset += fieldLength;
        
        // const data = new Blob([view.buffer.slice(offset, offset + compressedSize)]);
        const dataLocation = offset;

		offset += compressedSize;
		
		// might be a 12 - 16 byte footer here, depending on the value of flag
        
		return {
			type: "LOCAL",
			signature,
			version,
			flag,
			compression,
			time,
			date,
			crc,
			compressedSize,
			uncompressedSize,
			nameLength,
			fieldLength,
			fileName,
            field,
            dataLocation
		};
	}

    private static readCD (view: DataView, position: number) {
        let offset = position;
		
		// [0, 4] CD signature
		const signature = view.getUint32(offset, true);
		offset += 4;
		
		// [4, 2] version made by
		const version = view.getUint16(offset, true);
		offset += 2;
		
		// [6, 2] minimum required version
		const minVersion = view.getUint16(offset, true);
		offset += 2;
		
		// [8, 2] bit flag
		const flag = view.getUint16(offset, true);
		offset += 2;
		
		// [10, 2] compression method ( 0 = none / 8 = deflate )
		const compression = view.getUint16(offset, true);
		offset += 2;
		
		// [12, 2] last modified time
		const time = view.getUint16(offset, true);
		offset += 2;
		
		// [14, 2] last modified date
		const date = view.getUint16(offset, true);
		offset += 2;
		
		// [16, 4] CRC 32
		const crc = view.getUint32(offset, true);
		offset += 4;
		
		// [20, 4] compressed size
		const compressedSize = view.getUint32(offset, true);
		offset += 4;
		
		// [24, 4] uncompressed size
		const uncompressedSize = view.getUint32(offset, true);
		offset += 4;
		
		// [28, 2] file name length (n)
		const nameLength = view.getUint16(offset, true);
		offset += 2;
		
		// [30, 2] extra field length (m)
		const fieldLength = view.getUint16(offset, true);
		offset += 2;
		
		// [32, 2] file comment length (k)
		const commentLength = view.getUint16(offset, true);
		offset += 2;
		
		// [34, 2] disk number where file starts
		const disk = view.getUint16(offset, true);
		offset += 2;
		
		// [36, 2] internal file attributes
		const internal = view.getUint16(offset, true);
		offset += 2;
		
		// [38, 4] external file attributes
		const external = view.getUint32(offset, true);
		offset += 4;
		
		// [42, 4] offset of local file header, relative to start of archive
		const localPosition = view.getUint32(offset, true);
		offset += 4;
		
		// [46, n] file name
		const fileName = decodeString(view.buffer, offset, nameLength);
		offset += nameLength;
		
		// [46 + n, m] extra field
		const field = new Uint8Array(view.buffer, offset, fieldLength);
		offset += fieldLength;
		
		// [46 + n + m, k] file comment
		const comment = decodeString(view.buffer, offset, commentLength);
        offset += commentLength;
        
        const size = offset - position;
		
		return {
			type: "CD",
			signature,
			version,
			minVersion,
			flag,
			compression,
			time,
			date,
			crc,
			compressedSize,
			uncompressedSize,
			nameLength,
			fieldLength,
			commentLength,
			disk,
			internal,
			external,
			localPosition,
			fileName,
			field,
            comment,
            size
		};
    }

    private static findEOCDR (view: DataView): number {
        const length = view.byteLength;
		let position = length - 4;
		
		while (position--)
		{
			if (view.getUint32(position, true) == HEADER_EOCDR)
			{
				return position;
			}
		}
		
		throw new Error("No end of central directory record found");
    }

    private static readEOCDR (view: DataView, position: number) {
        let offset = position;
		
		// [0, 4] EOCDR signature
		const signature = view.getUint32(offset, true);
		offset += 4;
		
		// [4, 2] Number of disk
		const disk = view.getUint16(offset, true);
		offset += 2;
		
		// [6, 2] Disk where CD starts
		const startDisk = view.getUint16(offset, true);
		offset += 2;
		
		// [8, 2] Number of CD records on this disk
		const diskEntries = view.getUint16(offset, true);
		offset += 2;
		
		// [10, 2] Total number of CD records
		const totalEntries = view.getUint16(offset, true);
		offset += 2;
		
		// [12, 4] Size of CD
		const CDLength = view.getUint32(offset, true);
		offset += 4;
		
		// [16, 4] Offset of CD, relative to start of archive
		const CDOffset = view.getUint32(offset, true);
		offset += 4;
		
		// [20, 2] Comment length (n)
		const commentLength = view.getUint16(offset, true);
		offset += 2;
		
		// [22, n] Comment
		const comment = decodeString(view.buffer, offset, commentLength);
		offset += commentLength;
		
		return {
			type: "END",
			signature,
			disk,
			startDisk,
			diskEntries,
			totalEntries,
			CDLength,
			CDOffset,
			commentLength,
			comment
		};
    }

	static async fromBlob (blob: Blob) {
        const archive = new ZipArchive;
        const buffer = await ReadBlob(blob);
        const view = new DataView(buffer);

        const EOCDRPosition = this.findEOCDR(view);
		const EOCDR = this.readEOCDR(view, EOCDRPosition);
		
		let position = 0;
		const offset = EOCDR.CDOffset
		const length = EOCDR.CDLength;
		while (position < length)
		{
			const SIG = view.getUint32(position + offset, true);
			
			switch(SIG)
			{
				case HEADER_CD:
                    const entry = this.readCD(view, position + offset);
                    position += entry.size;

                    if (entry.fileName.endsWith("/")) {
                        // folder
                    }
                    else {
                        // file
                        const local = this.readLocal(view, entry.localPosition);
                        const subblob = blob.slice(local.dataLocation, local.dataLocation + local.compressedSize);

                        const isCompressed = local.compression == 8;
                        if (isCompressed) {
                            archive.setCompressed(local.fileName, subblob);
                        }
                        else {
                            archive.set(local.fileName, subblob);
                        }
                    }
					break;
				default:
					throw new Error("UNKNOWN");
			}
			
		}
		
		return archive;
    }

    private generateEOCDR (CDOffset: number, records: number) {
        let offset = position;
		
		// [0, 4] EOCDR signature
		const signature = view.getUint32(offset, true);
		offset += 4;
		
		// [4, 2] Number of disk
		const disk = view.getUint16(offset, true);
		offset += 2;
		
		// [6, 2] Disk where CD starts
		const startDisk = view.getUint16(offset, true);
		offset += 2;
		
		// [8, 2] Number of CD records on this disk
		const diskEntries = view.getUint16(offset, true);
		offset += 2;
		
		// [10, 2] Total number of CD records
		const totalEntries = view.getUint16(offset, true);
		offset += 2;
		
		// [12, 4] Size of CD
		const CDLength = view.getUint32(offset, true);
		offset += 4;
		
		// [16, 4] Offset of CD, relative to start of archive
		const CDOffset = view.getUint32(offset, true);
		offset += 4;
		
		// [20, 2] Comment length (n)
		const commentLength = view.getUint16(offset, true);
		offset += 2;
		
		// [22, n] Comment
		const comment = decodeString(view.buffer, offset, commentLength);
		offset += commentLength;
    }
	
	private setCompressed (name: string, file: Blob) {
		const entry = new ZipEntry(file, true);
		this.entries.set(name, entry);
	}
	
	private verifyPath (name: string) {
		// TODO verify file paths
	}
	
	private async compressBlob (file: Blob): Promise<Blob> {
        NOT_IMPLEMENTED("ZipArchive.compressBlob");
        // TODO add compression code
        return file;
	}
}