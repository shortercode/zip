import { ZipEntry } from "./ZipEntry";
import { HEADER_CD } from "./constants";
import { encode_utf8_string } from "./utils/string";
import { assert } from "./utils/assert";
import { date_from_dos_time } from "./utils/dos_time";
import { crc32 } from "./utils/crc32";
import { BlobSlice, NULL_SLICE } from "./utils/Slice";
import { normalise_file_name, verify_path } from "./utils/filepath";

const MAX_TASK_TIME = 32;
const INTER_TASK_PAUSE = 16;

export class ZipArchive {
	private entries = new Map<string, ZipEntry>();
	comment?: Uint8Array
	
	has(file_name: string): boolean {
		const norm_name = normalise_file_name(file_name);
		const trimmed_name = norm_name.endsWith("/") ? norm_name.slice(0, -1) : norm_name;
		
		verify_path(trimmed_name);
		
		return this.entries.has(trimmed_name + "/") || this.entries.has(trimmed_name);
	}
	
	is_folder(file_name: string): boolean {
		const norm_name = normalise_file_name(file_name);
		const trimmed_name = norm_name.endsWith("/") ? norm_name.slice(0, -1) : norm_name;
		
		verify_path(trimmed_name);
		
		return this.entries.has(trimmed_name + "/");
	}
	
	get(file_name: string): ZipEntry | undefined {
		const norm_name = normalise_file_name(file_name);
		const trimmed_name = norm_name.endsWith("/") ? norm_name.slice(0, -1) : norm_name;

		verify_path(trimmed_name);
		
		return this.entries.get(trimmed_name) || this.entries.get(trimmed_name + "/");
	}
	
	delete(file_name: string): boolean {
		const norm_name = normalise_file_name(file_name);
		const trimmed_name = norm_name.endsWith("/") ? norm_name.slice(0, -1) : norm_name;
		
		verify_path(trimmed_name);
		
		if (this.entries.has(trimmed_name + "/")) {
			return this.entries.delete(trimmed_name + "/");
		}
		else {
			return this.entries.delete(trimmed_name);
		}
	}
	
	async set(file_name: string, file: Blob | string | ArrayBuffer): Promise<ZipEntry> {
		verify_path(file_name);
		
		const norm_name = normalise_file_name(file_name);
		
		assert(!norm_name.endsWith("/"), `Unable to create ZipEntry; target location "${file_name}" has a directory path.`);
		assert(!this.entries.has(norm_name + "/"), `Unable to create ZipEntry; a folder exists at "${file_name}".`);
		
		file = file instanceof Blob ? file : new Blob([file]);

		const crc = await crc32(file);
		return this.set_internal(file_name, new BlobSlice(file), 0, file.size, crc);
	}
	
	set_folder(file_name: string): ZipEntry {
		const norm_name = normalise_file_name(file_name);
		const trimmed_name = norm_name.endsWith("/") ? norm_name.slice(0, -1) : norm_name;
		
		verify_path(trimmed_name);
		
		if (this.entries.has(trimmed_name)) {
			throw new Error(`Unable to create ZipEntry; entry already exists at "${trimmed_name}".`);
		}
		
		const existing_entry = this.entries.get(trimmed_name + "/")
		if (existing_entry) {
			return existing_entry;
		}
		
		const entry = new ZipEntry(NULL_SLICE, 0, 0, 0);
		this.entries.set(trimmed_name + "/", entry);
		return entry;
	}
	
	copy(from: string, to: string): ZipEntry {
		const is_folder = this.is_folder(from);
		const source = this.get(from);

		assert(!!source, `Unable to copy ZipEntry; "${from}" doesn't exist in the archive.`);

		const copy = source!.clone();

		if (is_folder) {
			const norm_name = normalise_file_name(to);
			const trimmed_name = norm_name.endsWith("/") ? norm_name.slice(0, -1) : norm_name;
			
			verify_path(trimmed_name);

			assert(this.entries.has(trimmed_name) === false, `Unable to copy ZipEntry; entry already exists at "${trimmed_name}".`)
			assert(this.entries.has(trimmed_name + "/") === false, `Unable to copy ZipEntry; entry already exists at "${trimmed_name}/".`)
			
			this.entries.set(trimmed_name + "/", copy);
		}
		else {
			const norm_name = normalise_file_name(to);

			verify_path(norm_name);

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
			const norm_name = normalise_file_name(to);
			const trimmed_name = norm_name.endsWith("/") ? norm_name.slice(0, -1) : norm_name;
			
			verify_path(trimmed_name);

			assert(this.entries.has(trimmed_name) === false, `Unable to move ZipEntry; entry already exists at "${trimmed_name}".`)
			assert(this.entries.has(trimmed_name + "/") === false, `Unable to move ZipEntry; entry already exists at "${trimmed_name}/".`)
			
			this.entries.set(trimmed_name + "/", source!);
			this.delete(from);
		}
		else {
			const source = this.get(from);

			assert(!!source, `Unable to move ZipEntry; "${from}" doesn't exist in the archive.`);
			
			const norm_name = normalise_file_name(to);

			verify_path(norm_name);

			assert(!norm_name.endsWith("/"), `Unable to move ZipEntry; target location "${to}" has a directory path.`);
			assert(!this.entries.has(norm_name + "/"), `Unable to move ZipEntry; a folder exists at "${norm_name}/".`);
			assert(!this.entries.has(norm_name), `Unable to move ZipEntry; an entry exists at "${norm_name}".`);

			this.entries.set(norm_name, source!);
		}

		return source!;
	}

	files(): Iterator<[string, ZipEntry]> {
		const entries = Array.from(this.entries.entries());
		return entries.values();
	}
	
	/**
	 * @deprecated use `entry.compress()` instead
	 */
	async compress_entry(file_name: string): Promise<ZipEntry> {
		const entry = this.get(file_name);
		assert(!!entry, `Unable to compress ZipEntry; entry "${file_name}" does not exist.`);
		await entry.compress();
		return entry;
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
	
	// TODO workize reading/writing the zip file?
	static From(source: Blob | ArrayBuffer): Promise<ZipArchive> {
		const 
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
}