import { ZipEntry } from "./ZipEntry.js";
import { HEADER_CD, HEADER_EOCDR, HEADER_LOCAL } from "./constants.js";
import { decode_utf8_string } from "./string.js";
import { assert } from "./assert.js";

function read_blob (blob: Blob): Promise<ArrayBuffer> {
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

type EOCDR_Block = {
	disk: number,
	start_disk: number,
	disk_entries: number,
	total_entries: number,
	cd_length: number,
	cd_offset: number,
	comment: string
};

type CD_Block = {
	version: number,
	min_version: number,
	flag: number,
	compression: number,
	time: number,
	date: number,
	crc: number,
	compressed_size: number,
	uncompressed_size: number,
	disk: number,
	internal: number,
	external: number,
	local_position: number,
	file_name: string,
	field: Uint8Array,
	comment: string,
	size: number
};

type LD_Block = {
	version: number,
	flag: number,
	compression: number,
	time: number,
	date: number,
	crc: number,
	compressed_size: number,
	uncompressed_size: number,
	file_name: string,
	field: Uint8Array,
	data_location: number
};

export class ZipArchive {
	private entries: Map<string, ZipEntry> = new Map
	private comment?: Uint8Array
	
	has (name: string) {
		this.verify_path(name);
	}
	
	get (name: string): ZipEntry|undefined {
		this.verify_path(name);
		return this.entries.get(name);
	}
	
	set (name: string, file: Blob): ZipEntry {
		this.verify_path(name);
		const entry = new ZipEntry(file, false);
		this.entries.set(name, entry);
		return entry;
	}
	
	copy (from: string, to: string) {
		this.verify_path(from);
        this.verify_path(to);
        NOT_IMPLEMENTED("ZipArchive.copy");
	}
	
	move (from: string, to: string) {
		this.verify_path(from);
        this.verify_path(to);
        NOT_IMPLEMENTED("ZipArchive.move");
	}
	
	async compress_entry (name: string) {
		const entry = this.get(name);
		if (!entry)
			throw new Error(`Entry ${name} does not exist`);
		if (!entry.compressed) {
			const blob = await entry.get_blob();
			const deflated_blob = await this.compress_blob(blob);
			const new_entry = new ZipEntry(deflated_blob, true);
			// TODO is this correct?
			return new_entry;
		}
		return entry;
	}

	set_comment (str: string) {
		NOT_IMPLEMENTED("set_comment");
		// TODO implement set comment
		// TODO implement comment length limit
	}
	
	to_blob (): Blob {
        const parts: BlobPart[] = [];

        let offset = 0;

        const directories = [];

        for (const [name, entry] of this.entries) {
            const location = offset;
            const local = entry.generate_local(name);
            const file = entry.get_backing_object();

            offset += local.byteLength + file.size;
            parts.push(local, file);

            const cd = entry.generate_cd(name, location);
            directories.push(cd);
        }

        const CDOffset = offset;

        for (const cd of directories) {
            parts.push(cd);
        }

		const EOCDR = this.generate_eocdr(CDOffset, directories.length);
		
		parts.push(EOCDR);
        return new Blob(parts);
    }
    
    files (): IterableIterator<[string, ZipEntry]> {
        return this.entries.entries();
    }

    private static read_local (view: DataView, position: number): LD_Block
	{
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
		
		const signature = view.getUint32(position, true);

		assert(signature === HEADER_LOCAL, "Expected Local Directory Record signature");

		const version = view.getUint16(position + 4, true);
		const flag = view.getUint16(position + 6, true);
		const compression = view.getUint16(position + 8, true);
		const time = view.getUint16(position + 10, true);
		const date = view.getUint16(position + 12, true);
		const crc = view.getUint32(position + 14, true);
		const compressed_size = view.getUint32(position + 18, true);
		const uncompressed_size = view.getUint32(position + 22, true);
		const nameLength = view.getUint16(position + 26, true);
		const fieldLength = view.getUint16(position + 28, true);
		const file_name = decode_utf8_string(view.buffer, position + 30, nameLength);
		const field = new Uint8Array(view.buffer, position + 30 + nameLength, fieldLength);
        const data_location = position + 30 + nameLength + fieldLength;
		
		// might be a 12 - 16 byte footer here, depending on the value of flag
        
		return {
			version,
			flag,
			compression,
			time,
			date,
			crc,
			compressed_size,
			uncompressed_size,
			file_name,
            field,
            data_location
		};
	}

    private static read_cd (view: DataView, position: number): CD_Block {
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
		
		const signature = view.getUint32(position, true);

		assert(signature === HEADER_CD, "Expected Central Directory Record signature");

		const version = view.getUint16(position + 4, true);
		const min_version = view.getUint16(position + 6, true);
		const flag = view.getUint16(position + 8, true);
		const compression = view.getUint16(position + 10, true);
		const time = view.getUint16(position + 12, true);
		const date = view.getUint16(position + 14, true);
		const crc = view.getUint32(position + 16, true);
		const compressed_size = view.getUint32(position + 20, true);
		const uncompressed_size = view.getUint32(position + 24, true);
		const name_length = view.getUint16(position + 28, true);
		const field_length = view.getUint16(position + 30, true);
		const comment_length = view.getUint16(position + 32, true);
		const disk = view.getUint16(position + 34, true);
		const internal = view.getUint16(position + 36, true);
		const external = view.getUint32(position + 38, true);
		const local_position = view.getUint32(position + 42, true);
		const file_name = decode_utf8_string(view.buffer, position + 46, name_length);
		const field = new Uint8Array(view.buffer, position + 46 + name_length, name_length);
		const comment = decode_utf8_string(view.buffer, position + 46 + name_length + field_length, comment_length);
        
        const size = 46 + name_length + field_length + comment_length;
		
		return {
			version,
			min_version,
			flag,
			compression,
			time,
			date,
			crc,
			compressed_size,
			uncompressed_size,
			disk,
			internal,
			external,
			local_position,
			file_name,
			field,
            comment,
            size
		};
    }

    private static find_eocdr (view: DataView): number {
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

    private static read_eocdr (view: DataView, position: number): EOCDR_Block {
		/*
		 * 	4 bytes - End of Central directory header signature
		 *	2 bytes - Number of disk
		 *  2 bytes - Disk where Central directory starts
		 *  2 bytes - Number of Central directory records on this disk
		 *  2 bytes - Total number of Central Directory records
		 *  4 bytes - Size of Central Directory
		 *  4 bytes - Location of Central Directory
		 *  2 bytes - Comment length
		 *  N bytes - Comment
		 */

		const signature = view.getUint32(position, true);

		assert(signature === HEADER_EOCDR, "Expected End of Central Directory Record signature");

		const disk = view.getUint16(position + 4, true);
		const start_disk = view.getUint16(position + 6, true);
		const disk_entries = view.getUint16(position + 8, true);
		const total_entries = view.getUint16(position + 10, true);
		const cd_length = view.getUint32(position + 12, true);
		const cd_offset = view.getUint32(position + 16, true);
		const commentLength = view.getUint16(position + 20, true);
		const comment = decode_utf8_string(view.buffer, position + 22, commentLength);
		
		return {
			disk,
			start_disk,
			disk_entries,
			total_entries,
			cd_length,
			cd_offset,
			comment
		};
    }

	static async from_blob (blob: Blob): Promise<ZipArchive> {
        const archive = new ZipArchive;
        const buffer = await read_blob(blob);
        const view = new DataView(buffer);

        const eocdr_position = this.find_eocdr(view);
		const eocdr = this.read_eocdr(view, eocdr_position);
		
		let position = 0;
		const offset = eocdr.cd_offset
		const length = eocdr.cd_length;
		while (position < length)
		{
			const signature = view.getUint32(position + offset, true);
			
			assert(signature === HEADER_CD, "")

			const entry = this.read_cd(view, position + offset);
			position += entry.size;

			if (entry.file_name.endsWith("/")) {
				// folder
				// TODO we currently ignore folders, as they are optional in the ZIP spec
			}
			else {
				// file
				const local = this.read_local(view, entry.local_position);
				const subblob = blob.slice(local.data_location, local.data_location + local.compressed_size);

				const is_compressed = local.compression == 8;
				if (is_compressed) {
					archive.set_compressed(local.file_name, subblob);
				}
				else {
					archive.set(local.file_name, subblob);
				}
			}
			
		}
		
		return archive;
    }

    private generate_eocdr (cd_location: number, records: number): ArrayBuffer {
		
		const N = this.comment ? this.comment.length : 0;
		const length = 22 + N;
		const buffer = new ArrayBuffer(length);
		const view = new DataView(buffer);
		const uintview = new Uint8Array(buffer);

		/*
		 * 	4 bytes - End of Central directory header signature
		 *	2 bytes - Number of disk
		 *  2 bytes - Disk where Central directory starts
		 *  2 bytes - Number of Central directory records on this disk
		 *  2 bytes - Total number of Central Directory records
		 *  4 bytes - Size of Central Directory
		 *  4 bytes - Location of Central Directory
		 *  2 bytes - Comment length
		 *  N bytes - Comment
		 */

		view.setUint32(0, HEADER_EOCDR, true);
		view.setUint16(4, 0, true); // TODO
		view.setUint16(6, 0, true); // TODO
		view.setUint16(8, 0, true); // TODO
		view.setUint16(10, 0, true); // TODO
		view.setUint32(12, 0, true); // TODO
		view.setUint32(16, cd_location, true);
		view.setUint16(20, N, true);

		if (this.comment) {
			uintview.set(this.comment, 22);
		}

		return buffer;
    }
	
	private set_compressed (name: string, file: Blob) {
		const entry = new ZipEntry(file, true);
		this.entries.set(name, entry);
	}
	
	private verify_path (name: string) {
		// TODO verify file paths
	}
	
	private async compress_blob (file: Blob): Promise<Blob> {
        NOT_IMPLEMENTED("ZipArchive.compressBlob");
        // TODO add compression code
        return file;
	}
}