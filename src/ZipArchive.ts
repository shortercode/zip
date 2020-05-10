import { ZipEntry } from "./ZipEntry";
import { HEADER_CD, HEADER_EOCDR, HEADER_LOCAL } from "./constants";
import { decode_utf8_string, encode_utf8_string } from "./string";
import { assert } from "./assert";
import { compress, set_compression_function, set_decompression_function } from "./compression";
import { date_from_dos_time } from "./dos_time";
import { crc32 } from "./crc32";
import { BlobSlice } from "./BlobSlice";

const MAX_TASK_TIME = 32;
const INTER_TASK_PAUSE = 16;

const support_performance = typeof performance === "object";
let last_system_time = 0;

function get_increasing_time () {
	if (support_performance) {
		return performance.now();
	}
	else {
		const system_time = Date.now();
		
		if (last_system_time <= system_time) {
			last_system_time += 0.1;
		}
		else {
			last_system_time = system_time;
		}
		return last_system_time;
	}
}

async function pause (duration: number) {
	return new Promise(resolve => setTimeout(resolve, duration))
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
	extra: Uint8Array,
	comment: Uint8Array,
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
	extra: Uint8Array,
	data_location: number
};

export class ZipArchive {
	private entries: Map < string, ZipEntry > = new Map
	private comment ? : Uint8Array
	
	has(file_name: string): boolean {
		const norm_name = this.normalise_file_name(file_name);
		const trimmed_name = norm_name.endsWith("/") ? norm_name.slice(0, -1) : norm_name;
		
		this.verify_path(trimmed_name);
		
		return this.entries.has(trimmed_name + "/") || this.entries.has(trimmed_name);
	}
	
	is_folder(file_name: string): boolean {
		const norm_name = this.normalise_file_name(file_name);
		const trimmed_name = norm_name.endsWith("/") ? norm_name.slice(0, -1) : norm_name;
		
		this.verify_path(trimmed_name);
		
		return this.entries.has(trimmed_name + "/");
	}
	
	get(file_name: string): ZipEntry | undefined {
		const norm_name = this.normalise_file_name(file_name);
		const trimmed_name = norm_name.endsWith("/") ? norm_name.slice(0, -1) : norm_name;

		this.verify_path(trimmed_name);
		
		return this.entries.get(trimmed_name) || this.entries.get(trimmed_name + "/");
	}
	
	delete(file_name: string): boolean {
		const norm_name = this.normalise_file_name(file_name);
		const trimmed_name = norm_name.endsWith("/") ? norm_name.slice(0, -1) : norm_name;
		
		this.verify_path(trimmed_name);
		
		if (this.entries.has(trimmed_name + "/")) {
			return this.entries.delete(trimmed_name + "/");
		}
		else {
			return this.entries.delete(trimmed_name);
		}
	}
	
	async set(file_name: string, file: Blob | string | ArrayBuffer): Promise<ZipEntry> {
		this.verify_path(file_name);
		
		const norm_name = this.normalise_file_name(file_name);
		
		assert(!norm_name.endsWith("/"), `Unable to create ZipEntry; target location "${file_name}" has a directory path.`);
		assert(!this.entries.has(norm_name + "/"), `Unable to create ZipEntry; a folder exists at "${file_name}".`);
		
		file = file instanceof Blob ? file : new Blob([file]);
		const crc = await this.calculate_crc(file);
		return this.set_internal(file_name, new BlobSlice(file), 0, file.size, crc);
	}
	
	set_folder(file_name: string): ZipEntry {
		const norm_name = this.normalise_file_name(file_name);
		const trimmed_name = norm_name.endsWith("/") ? norm_name.slice(0, -1) : norm_name;
		
		this.verify_path(trimmed_name);
		
		if (this.entries.has(trimmed_name)) {
			throw new Error(`Unable to create ZipEntry; entry already exists at "${trimmed_name}".`);
		}
		
		const existing_entry = this.entries.get(trimmed_name + "/")
		if (existing_entry) {
			return existing_entry;
		}
		
		const empty_file = new BlobSlice(new Blob([]));
		const crc = crc32(new Uint8Array(0));
		const entry = new ZipEntry(empty_file, 0, 0, crc);
		this.entries.set(trimmed_name + "/", entry);
		return entry;
	}
	
	copy(from: string, to: string): ZipEntry {
		const is_folder = this.is_folder(from);
		const source = this.get(from);

		assert(!!source, `Unable to copy ZipEntry; "${from}" doesn't exist in the archive.`);

		const copy = source!.clone();

		if (is_folder) {
			const norm_name = this.normalise_file_name(to);
			const trimmed_name = norm_name.endsWith("/") ? norm_name.slice(0, -1) : norm_name;
			
			this.verify_path(trimmed_name);

			assert(this.entries.has(trimmed_name) === false, `Unable to copy ZipEntry; entry already exists at "${trimmed_name}".`)
			assert(this.entries.has(trimmed_name + "/") === false, `Unable to copy ZipEntry; entry already exists at "${trimmed_name}/".`)
			
			this.entries.set(trimmed_name + "/", copy);
		}
		else {
			const norm_name = this.normalise_file_name(to);

			this.verify_path(norm_name);

			assert(!norm_name.endsWith("/"), `Unable to copy ZipEntry; target location "${to}" has a directory path.`);
			assert(!this.entries.has(norm_name + "/"), `Unable to copy ZipEntry; a folder exists at "${norm_name}/".`);
			assert(!this.entries.has(norm_name), `Unable to copy ZipEntry; a entry already exists at "${norm_name}".`);

			this.entries.set(norm_name, copy);
		}

		return copy;
	}
	
	move(from: string, to: string): ZipEntry {
		const is_folder = this.is_folder(from);
		const source = this.get(from);

		assert(!!source, `Unable to move ZipEntry; "${from}" doesn't exist in the archive.`);

		if (is_folder) {
			const norm_name = this.normalise_file_name(to);
			const trimmed_name = norm_name.endsWith("/") ? norm_name.slice(0, -1) : norm_name;
			
			this.verify_path(trimmed_name);

			assert(this.entries.has(trimmed_name) === false, `Unable to move ZipEntry; entry already exists at "${trimmed_name}".`)
			assert(this.entries.has(trimmed_name + "/") === false, `Unable to move ZipEntry; entry already exists at "${trimmed_name}/".`)
			
			this.entries.set(trimmed_name + "/", source!);
			this.delete(from);
		}
		else {
			const source = this.get(from);

			assert(!!source, `Unable to move ZipEntry; "${from}" doesn't exist in the archive.`);
			
			const norm_name = this.normalise_file_name(to);

			this.verify_path(norm_name);

			assert(!norm_name.endsWith("/"), `Unable to move ZipEntry; target location "${to}" has a directory path.`);
			assert(!this.entries.has(norm_name + "/"), `Unable to move ZipEntry; a folder exists at "${norm_name}/".`);
			assert(!this.entries.has(norm_name), `Unable to move ZipEntry; an entry exists at "${norm_name}".`);

			this.entries.set(norm_name, source!);
		}

		return source!;
	}
	
	async compress_entry(file_name: string): Promise<ZipEntry> {
		const entry = this.get(file_name);
		assert(!!entry, `Unable to compress ZipEntry; entry "${file_name}" does not exist.`);
		if (!entry!.is_compressed) {
			const blob = await entry!.get_blob();
			const original_size = blob.size;
			const deflated_blob = await this.compress_blob(blob);
			// NOTE crc is generated from the uncompressed buffer
			return this.set_internal(file_name, new BlobSlice(deflated_blob), 8, original_size, entry!.crc);
		}
		return entry!;
	}
	
	set_comment(str: string): void {
		const buffer = encode_utf8_string(str);
		assert(buffer.byteLength < 0xFFFF, `Unable to set commment; comment is ${buffer.byteLength} bytes which exceeds maximum size of ${0xFFFE}.`);
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
			
			// NOTE only generate data descriptor if bit 3 of the bit flag is set
			if (entry.bit_flag & 0b1000) {
				const data_descriptor = entry.generate_data_descriptor();
				parts.push(data_descriptor);
				offset += data_descriptor.byteLength;
			}
			
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
	
	files(): Iterator<[string, ZipEntry]> {
		const entries = Array.from(this.entries.entries());
		return entries.values();
	}
	
	static async from_blob(blob: Blob): Promise<ZipArchive> {
		const archive = new ZipArchive;
		const buffer = await new Response(blob).arrayBuffer();
		const view = new DataView(buffer);
		
		const eocdr_position = this.find_eocdr(view);
		const eocdr = this.read_eocdr(view, eocdr_position);
		
		let position = 0;
		const offset = eocdr.cd_offset
		const length = eocdr.cd_length;
		let task_start_time = get_increasing_time();
		
		while (position < length) {
			const signature = view.getUint32(position + offset, true);
			
			assert(signature === HEADER_CD, "Expected CD header");
			
			const entry = this.read_cd(view, position + offset);
			position += entry.size;
			
			if (entry.file_name.endsWith("/")) {
				archive.set_folder(entry.file_name);
			} else {
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
					crc,
					extra,
					comment
				} = entry;
				
				archive.verify_path(file_name);
				
				const blob_slice = new BlobSlice(blob, data_location, compressed_size);
				const zip_entry = archive.set_internal(file_name, blob_slice, compression, uncompressed_size, crc);
				
				zip_entry.bit_flag = flag;
				zip_entry.internal_file_attr = internal;
				zip_entry.external_file_attr = external;
				zip_entry.extra = extra;
				zip_entry.comment = comment;
				zip_entry.modified = date_from_dos_time(entry.date, entry.time);
				const current_time = get_increasing_time();
				const delta_time = current_time - task_start_time;
				
				if (delta_time > MAX_TASK_TIME) {
					await pause(INTER_TASK_PAUSE);
					task_start_time = get_increasing_time();
				}
			}
			
		}
		
		return archive;
	}
	
	static set_compression_function(fn: (input: Blob) => Promise<Blob> ): void {
		set_compression_function(fn);
	}
	
	static set_decompression_function(fn: (input: Blob) => Promise<Blob> ): void {
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
		const name_length = view.getUint16(position + 26, true);
		const extra_length = view.getUint16(position + 28, true);
		const file_name = decode_utf8_string(view.buffer, position + 30, name_length);
		const extra = new Uint8Array(view.buffer, position + 30 + name_length, extra_length);
		const data_location = position + 30 + name_length + extra_length;
		
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
			extra,
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
		const extra_length = view.getUint16(position + 30, true);
		const comment_length = view.getUint16(position + 32, true);
		const disk = view.getUint16(position + 34, true);
		const internal = view.getUint16(position + 36, true);
		const external = view.getUint32(position + 38, true);
		const local_position = view.getUint32(position + 42, true);
		const file_name = decode_utf8_string(view.buffer, position + 46, name_length);
		const extra = new Uint8Array(view.buffer, position + 46 + name_length, extra_length);
		const comment = new Uint8Array(view.buffer, position + 46 + name_length + extra_length, comment_length);
		
		const size = 46 + name_length + extra_length + comment_length;
		
		if (compression === 0) {
			assert(compressed_size === uncompressed_size, "ucsize != csize for STORED entry");
		}
		
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
			extra,
			comment,
			size
		};
	}
	
	private static find_eocdr(view: DataView): number {
		const length = view.byteLength;
		
		// NOTE min size of EOCDR is 22 bytes
		for (let i = 22; i < 0xFFFF; i++) {
			const position = length - i;
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
		const comment_length = view.getUint16(position + 20, true);
		
		assert(start_disk === 0, "Invalid start disk");
		assert(disk_entries === total_entries, "Multi-disk archives are not supported");
		assert(position + 22 + comment_length === view.byteLength, "Invalid comment length");	
		
		const comment = decode_utf8_string(view.buffer, position + 22, comment_length);
		
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
	
	private async calculate_crc(blob: Blob): Promise<number> {
		const buffer = await new Response(blob).arrayBuffer();
		const bytes = new Uint8Array(buffer);
		
		return crc32(bytes);
	}
	
	private set_internal(file_name: string, file: BlobSlice, compresion: number, size: number, crc: number): ZipEntry {
		const norm_file_name = this.normalise_file_name(file_name);
		const entry = new ZipEntry(file, compresion, size, crc);
		this.entries.set(norm_file_name, entry);
		return entry;
	}
	
	private normalise_file_name(file_name: string): string {
		const slash_regex = /[\\|/]/g;
		return file_name.replace(slash_regex, "/");
	}
	
	private verify_path(name: string): void {
		const slash_regex = /[\\|/]/g;
		const part_regex = /^[^/\0]+$/;
		const parts = name.split(slash_regex);
		
		// NOTE disallows absolute paths and ".."/"." path components
		for (const part of parts) {
			assert(part_regex.test(part) || part === ".." || part === ".", `Invalid path "${name}"`);
		}
	}
	
	private async compress_blob(file: Blob): Promise<Blob> {
		return await compress(file);
	}
}

export { ZipEntry };