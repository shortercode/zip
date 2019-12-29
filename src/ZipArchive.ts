import {
	ZipEntry
} from "./ZipEntry.js";
import {
	HEADER_CD,
	HEADER_EOCDR,
	HEADER_LOCAL
} from "./constants.js";
import {
	decode_utf8_string,
	encode_utf8_string
} from "./string.js";
import {
	assert
} from "./assert.js";
import {
	compress,
	set_compression_function,
	set_decompression_function
} from "./compression.js";
import {
	date_from_dos_time
} from "./dos_time.js";
import {
	crc32
} from "./crc32.js";
import { 
	BlobSlice
} from "./BlobSlice.js";

const MAX_TASK_TIME = 32;
const INTER_TASK_PAUSE = 16;

function NOT_IMPLEMENTED(name: string) {
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
	private entries: Map < string, ZipEntry > = new Map
	private comment ? : Uint8Array

	has(file_name: string): boolean {
		this.verify_path(file_name);
		return this.entries.has(this.normalise_file_name(file_name));
	}

	get(file_name: string): ZipEntry | undefined {
		this.verify_path(file_name);
		return this.entries.get(this.normalise_file_name(file_name));
	}

	async set(file_name: string, file: Blob | string | ArrayBuffer): Promise < ZipEntry > {
		this.verify_path(file_name);

		file = file instanceof Blob ? file : new Blob([file]);
		const crc = await this.calculate_crc(file);
		return this.set_internal(file_name, new BlobSlice(file), 0, file.size, crc);
	}

	copy(from: string, to: string) {
		this.verify_path(from);
		this.verify_path(to);
		NOT_IMPLEMENTED("ZipArchive.copy");
	}

	move(from: string, to: string) {
		this.verify_path(from);
		this.verify_path(to);
		NOT_IMPLEMENTED("ZipArchive.move");
	}

	async compress_entry(file_name: string) {
		const entry = this.get(file_name);
		if (!entry)
			throw new Error(`Entry ${file_name} does not exist`);
		if (!entry.is_compressed) {
			const blob = await entry.get_blob();
			const original_size = blob.size;
			const deflated_blob = await this.compress_blob(blob);
			// NOTE crc is generated from the uncompressed buffer
			return this.set_internal(file_name, new BlobSlice(deflated_blob), 8, original_size, entry.crc);
		}
		return entry;
	}

	set_comment(str: string) {
		const buffer = encode_utf8_string(str);
		assert(buffer.length < 0xFFFF, "Comment exceeds maximum size");
		this.comment = buffer;
	}

	to_blob(): Blob {
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

		const cd_offset = offset;
		let cd_length = 0;

		for (const cd of directories) {
			parts.push(cd);
			cd_length += cd.byteLength;
		}

		const eocdr = this.generate_eocdr(cd_offset, cd_length, directories.length);
		parts.push(eocdr);
		return new Blob(parts);
	}

	files(): Iterator < [string, ZipEntry] > {
		return this.entries.entries();
	}

	static async from_blob(blob: Blob): Promise < ZipArchive > {
		const archive = new ZipArchive;
		const buffer = await new Response(blob).arrayBuffer();
		const view = new DataView(buffer);

		const eocdr_position = this.find_eocdr(view);
		const eocdr = this.read_eocdr(view, eocdr_position);

		let position = 0;
		const offset = eocdr.cd_offset
		const length = eocdr.cd_length;
		let task_start_time = Date.now();

		async function pause (duration: number) {
			return new Promise(resolve => setTimeout(resolve, duration))
		}

		while (position < length) {
			const signature = view.getUint32(position + offset, true);

			assert(signature === HEADER_CD, "Expected CD header");

			const entry = this.read_cd(view, position + offset);
			position += entry.size;

			if (entry.file_name.endsWith("/")) {
				// folder
				// TODO we currently ignore folders, as they are optional in the ZIP spec
			} else {
				// file
				// NOTE local data is often invalid, so only use the data position value from it
				// ( everything else can come from the CD entry )

				const {
					data_location
				} = this.read_local(view, entry.local_position);
				const {
					uncompressed_size,
					compressed_size,
					compression,
					flag,
					file_name,
					internal,
					external,
					crc
				} = entry;

				const blob_slice = new BlobSlice(blob, data_location, compressed_size);
				const zip_entry = archive.set_internal(file_name, blob_slice, compression, uncompressed_size, crc);

				zip_entry.bit_flag = flag;
				zip_entry.internal_file_attr = internal;
				zip_entry.external_file_attr = external;
				zip_entry.modified = date_from_dos_time(entry.date, entry.time);
				const current_time = Date.now();
				const delta_time = current_time - task_start_time;

				if (delta_time > MAX_TASK_TIME) {
					await pause(INTER_TASK_PAUSE);
					task_start_time = Date.now();
				}
			}

		}

		return archive;
	}

	static set_compression_function(fn: (input: Blob) => Promise < Blob > ) {
		set_compression_function(fn);
	}

	static set_decompression_function(fn: (input: Blob) => Promise < Blob > ) {
		set_decompression_function(fn);
	}

	private static read_local(view: DataView, position: number): LD_Block {
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

	private static read_cd(view: DataView, position: number): CD_Block {
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
		const field = new Uint8Array(view.buffer, position + 46 + name_length, field_length);
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

	private static find_eocdr(view: DataView): number {
		const length = view.byteLength;
		let position = length - 4;

		while (position--) {
			if (view.getUint32(position, true) == HEADER_EOCDR) {
				return position;
			}
		}

		throw new Error("No end of central directory record found");
	}

	private static read_eocdr(view: DataView, position: number): EOCDR_Block {
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

	private generate_eocdr(cd_location: number, cd_size: number, records: number): ArrayBuffer {

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
		view.setUint16(4, 0, true);
		view.setUint16(6, 0, true);
		view.setUint16(8, records, true);
		view.setUint16(10, records, true);
		view.setUint32(12, cd_size, true);
		view.setUint32(16, cd_location, true);
		view.setUint16(20, N, true);

		if (this.comment) {
			uintview.set(this.comment, 22);
		}

		return buffer;
	}

	private async calculate_crc(blob: Blob): Promise < number > {
		const buffer = await new Response(blob).arrayBuffer();
		const bytes = new Uint8Array(buffer);

		return crc32(bytes);
	}

	private set_internal(file_name: string, file: BlobSlice, compresion: number, size: number, crc: number) {
		const norm_file_name = this.normalise_file_name(file_name);
		const entry = new ZipEntry(file, compresion, size, crc);
		this.entries.set(norm_file_name, entry);
		return entry;
	}

	private normalise_file_name(file_name: string): string {
		const slash_regex = /[\\|/]/g;
		return file_name.replace(slash_regex, "/");
	}

	private verify_path(name: string) {
		const slash_regex = /[\\|/]/g;
		const part_regex = /^[\w\-. ]+$/;
		const parts = name.split(slash_regex);

		// NOTE disallows absolute paths and ".."/"." path components
		for (const part of parts) {
			assert(part_regex.test(part) || part === ".." || part === ".", `Invalid path "${name}"`);
		}
	}

	private async compress_blob(file: Blob): Promise < Blob > {
		return await compress(file);
	}
}

export {
	ZipEntry
};