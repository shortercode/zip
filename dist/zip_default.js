const HEADER_CD = 0x02014b50;
const HEADER_LOCAL = 0x04034b50;
const HEADER_EOCDR = 0x06054b50;
const HEADER_DATA_DESCRIPTOR = 0x08074b50;

const encoder = new TextEncoder();
const decoder = new TextDecoder();
function encode_utf8_string(str) {
    return encoder.encode(str);
}
function decode_utf8_string(buffer, offset, length) {
    const view = new Uint8Array(buffer, offset, length);
    return decoder.decode(view);
}

class AssertionError extends Error {
}
function assert(test, msg) {
    if (test === false)
        throw new AssertionError(msg);
}

let compression_function;
let decompression_function;
function set_compression_function(fn) {
    compression_function = fn;
}
function set_decompression_function(fn) {
    decompression_function = fn;
}
function compress(input) {
    assert(compression_function !== null, "Compression function not specified");
    return compression_function(input);
}
function decompress(input) {
    assert(decompression_function !== null, "Decompression function not specified");
    return decompression_function(input);
}

function date_from_dos_time(date, time) {
    const hours = ((time >> 11) & 0b11111);
    const minutes = (time >> 5) & 0b111111;
    const seconds = (time & 0b11111) << 1;
    const year = ((date >> 9) & 0b1111111) + 1980;
    const month = ((date >> 5) & 0b1111) - 1;
    const day = (date & 0b11111);
    return new Date(year, month, day, hours, minutes, seconds);
}
function dos_time_from_date(input) {
    const hours = input.getHours();
    const minutes = input.getMinutes();
    const seconds = input.getSeconds();
    const year = input.getFullYear() - 1980;
    const month = input.getMonth() + 1;
    const day = input.getDate();
    const time = ((hours & 0b11111) << 11) | ((minutes & 0b111111) << 5) | ((seconds >> 1) & 0b11111);
    const date = ((year & 0b1111111) << 9) | ((month & 0b1111) << 5) | (day & 0b11111);
    return [date, time];
}

const ZIP_VERSION = 20;
const inflated_entries = new WeakMap;
class ZipEntry {
    constructor(blob, compression_type, size, crc) {
        this.internal_file_attr = 0;
        this.external_file_attr = 0;
        this.bit_flag = 0;
        this.modified = new Date;
        this.compression = compression_type;
        this.blob_slice = blob;
        this.uncompressed_size = size;
        this.crc = crc;
    }
    get is_compressed() {
        return this.compression !== 0;
    }
    get size() {
        return this.uncompressed_size;
    }
    get compressed_size() {
        return this.blob_slice.size;
    }
    async decompress() {
        const existing = inflated_entries.get(this.blob_slice);
        if (existing)
            return existing;
        else {
            const result = await decompress(this.blob_slice.get_blob());
            inflated_entries.set(this.blob_slice, result);
            return result;
        }
    }
    generate_local(filename) {
        const encoded_filename = encode_utf8_string(filename);
        const N = encoded_filename.length;
        const M = this.extra ? this.extra.length : 0;
        const length = 30 + N + M;
        const buffer = new ArrayBuffer(length);
        const view = new DataView(buffer);
        const uintview = new Uint8Array(buffer);
        const [date, time] = dos_time_from_date(this.modified);
        view.setUint32(0, HEADER_LOCAL, true);
        view.setUint16(4, ZIP_VERSION, true);
        view.setUint16(6, this.bit_flag, true);
        view.setUint16(8, this.compression, true);
        view.setUint16(10, time, true);
        view.setUint16(12, date, true);
        if (!(this.bit_flag & 0b1000)) {
            view.setUint32(16, this.crc, true);
            view.setUint32(20, this.compressed_size, true);
            view.setUint32(24, this.uncompressed_size, true);
        }
        view.setUint16(26, encoded_filename.length, true);
        view.setUint16(28, M, true);
        uintview.set(encoded_filename, 30);
        if (this.extra) {
            uintview.set(this.extra, 30 + N);
        }
        return buffer;
    }
    generate_cd(filename, local_position) {
        const encoded_filename = encode_utf8_string(filename);
        const N = encoded_filename.length;
        const M = this.extra ? this.extra.length : 0;
        const K = this.comment ? this.comment.length : 0;
        const length = 46 + M + N + K;
        const buffer = new ArrayBuffer(length);
        const view = new DataView(buffer);
        const uintview = new Uint8Array(buffer);
        const [date, time] = dos_time_from_date(this.modified);
        view.setUint32(0, HEADER_CD, true);
        view.setUint16(4, ZIP_VERSION, true);
        view.setUint16(6, ZIP_VERSION, true);
        view.setUint16(8, this.bit_flag & 0xFFFF, true);
        view.setUint16(10, this.compression, true);
        view.setUint16(12, time, true);
        view.setUint16(14, date, true);
        view.setUint32(16, this.crc, true);
        view.setUint32(20, this.compressed_size, true);
        view.setUint32(24, this.uncompressed_size, true);
        view.setUint16(28, encoded_filename.length, true);
        view.setUint16(30, M, true);
        view.setUint16(32, K, true);
        view.setUint16(34, 0, true);
        view.setUint16(36, this.internal_file_attr & 0xFFFF, true);
        view.setUint32(38, this.external_file_attr & 0xFFFFFFFF, true);
        view.setUint32(42, local_position, true);
        uintview.set(encoded_filename, 46);
        if (this.extra) {
            uintview.set(this.extra, 46 + N);
        }
        if (this.comment) {
            uintview.set(this.comment, 46 + N + M);
        }
        return buffer;
    }
    generate_data_descriptor() {
        const length = 16;
        const buffer = new ArrayBuffer(length);
        const view = new DataView(buffer);
        view.setUint32(0, HEADER_DATA_DESCRIPTOR, true);
        view.setUint32(4, this.crc, true);
        view.setUint32(8, this.compressed_size, true);
        view.setUint32(12, this.uncompressed_size, true);
        return buffer;
    }
    get_backing_object() {
        return this.blob_slice.get_blob();
    }
    async get_blob() {
        if (this.compression === 8)
            return this.decompress();
        assert(this.compression === 0, "Incompatible compression type");
        return this.blob_slice.get_blob();
    }
    async get_array_buffer() {
        const blob = await this.get_blob();
        return await new Response(blob).arrayBuffer();
    }
    async get_string() {
        const blob = await this.get_blob();
        return await new Response(blob).text();
    }
}

const CRC_LOOKUP = new Uint32Array([
    0x00000000, 0x77073096, 0xEE0E612C, 0x990951BA, 0x076DC419, 0x706AF48F,
    0xE963A535, 0x9E6495A3, 0x0EDB8832, 0x79DCB8A4, 0xE0D5E91E, 0x97D2D988,
    0x09B64C2B, 0x7EB17CBD, 0xE7B82D07, 0x90BF1D91, 0x1DB71064, 0x6AB020F2,
    0xF3B97148, 0x84BE41DE, 0x1ADAD47D, 0x6DDDE4EB, 0xF4D4B551, 0x83D385C7,
    0x136C9856, 0x646BA8C0, 0xFD62F97A, 0x8A65C9EC, 0x14015C4F, 0x63066CD9,
    0xFA0F3D63, 0x8D080DF5, 0x3B6E20C8, 0x4C69105E, 0xD56041E4, 0xA2677172,
    0x3C03E4D1, 0x4B04D447, 0xD20D85FD, 0xA50AB56B, 0x35B5A8FA, 0x42B2986C,
    0xDBBBC9D6, 0xACBCF940, 0x32D86CE3, 0x45DF5C75, 0xDCD60DCF, 0xABD13D59,
    0x26D930AC, 0x51DE003A, 0xC8D75180, 0xBFD06116, 0x21B4F4B5, 0x56B3C423,
    0xCFBA9599, 0xB8BDA50F, 0x2802B89E, 0x5F058808, 0xC60CD9B2, 0xB10BE924,
    0x2F6F7C87, 0x58684C11, 0xC1611DAB, 0xB6662D3D, 0x76DC4190, 0x01DB7106,
    0x98D220BC, 0xEFD5102A, 0x71B18589, 0x06B6B51F, 0x9FBFE4A5, 0xE8B8D433,
    0x7807C9A2, 0x0F00F934, 0x9609A88E, 0xE10E9818, 0x7F6A0DBB, 0x086D3D2D,
    0x91646C97, 0xE6635C01, 0x6B6B51F4, 0x1C6C6162, 0x856530D8, 0xF262004E,
    0x6C0695ED, 0x1B01A57B, 0x8208F4C1, 0xF50FC457, 0x65B0D9C6, 0x12B7E950,
    0x8BBEB8EA, 0xFCB9887C, 0x62DD1DDF, 0x15DA2D49, 0x8CD37CF3, 0xFBD44C65,
    0x4DB26158, 0x3AB551CE, 0xA3BC0074, 0xD4BB30E2, 0x4ADFA541, 0x3DD895D7,
    0xA4D1C46D, 0xD3D6F4FB, 0x4369E96A, 0x346ED9FC, 0xAD678846, 0xDA60B8D0,
    0x44042D73, 0x33031DE5, 0xAA0A4C5F, 0xDD0D7CC9, 0x5005713C, 0x270241AA,
    0xBE0B1010, 0xC90C2086, 0x5768B525, 0x206F85B3, 0xB966D409, 0xCE61E49F,
    0x5EDEF90E, 0x29D9C998, 0xB0D09822, 0xC7D7A8B4, 0x59B33D17, 0x2EB40D81,
    0xB7BD5C3B, 0xC0BA6CAD, 0xEDB88320, 0x9ABFB3B6, 0x03B6E20C, 0x74B1D29A,
    0xEAD54739, 0x9DD277AF, 0x04DB2615, 0x73DC1683, 0xE3630B12, 0x94643B84,
    0x0D6D6A3E, 0x7A6A5AA8, 0xE40ECF0B, 0x9309FF9D, 0x0A00AE27, 0x7D079EB1,
    0xF00F9344, 0x8708A3D2, 0x1E01F268, 0x6906C2FE, 0xF762575D, 0x806567CB,
    0x196C3671, 0x6E6B06E7, 0xFED41B76, 0x89D32BE0, 0x10DA7A5A, 0x67DD4ACC,
    0xF9B9DF6F, 0x8EBEEFF9, 0x17B7BE43, 0x60B08ED5, 0xD6D6A3E8, 0xA1D1937E,
    0x38D8C2C4, 0x4FDFF252, 0xD1BB67F1, 0xA6BC5767, 0x3FB506DD, 0x48B2364B,
    0xD80D2BDA, 0xAF0A1B4C, 0x36034AF6, 0x41047A60, 0xDF60EFC3, 0xA867DF55,
    0x316E8EEF, 0x4669BE79, 0xCB61B38C, 0xBC66831A, 0x256FD2A0, 0x5268E236,
    0xCC0C7795, 0xBB0B4703, 0x220216B9, 0x5505262F, 0xC5BA3BBE, 0xB2BD0B28,
    0x2BB45A92, 0x5CB36A04, 0xC2D7FFA7, 0xB5D0CF31, 0x2CD99E8B, 0x5BDEAE1D,
    0x9B64C2B0, 0xEC63F226, 0x756AA39C, 0x026D930A, 0x9C0906A9, 0xEB0E363F,
    0x72076785, 0x05005713, 0x95BF4A82, 0xE2B87A14, 0x7BB12BAE, 0x0CB61B38,
    0x92D28E9B, 0xE5D5BE0D, 0x7CDCEFB7, 0x0BDBDF21, 0x86D3D2D4, 0xF1D4E242,
    0x68DDB3F8, 0x1FDA836E, 0x81BE16CD, 0xF6B9265B, 0x6FB077E1, 0x18B74777,
    0x88085AE6, 0xFF0F6A70, 0x66063BCA, 0x11010B5C, 0x8F659EFF, 0xF862AE69,
    0x616BFFD3, 0x166CCF45, 0xA00AE278, 0xD70DD2EE, 0x4E048354, 0x3903B3C2,
    0xA7672661, 0xD06016F7, 0x4969474D, 0x3E6E77DB, 0xAED16A4A, 0xD9D65ADC,
    0x40DF0B66, 0x37D83BF0, 0xA9BCAE53, 0xDEBB9EC5, 0x47B2CF7F, 0x30B5FFE9,
    0xBDBDF21C, 0xCABAC28A, 0x53B39330, 0x24B4A3A6, 0xBAD03605, 0xCDD70693,
    0x54DE5729, 0x23D967BF, 0xB3667A2E, 0xC4614AB8, 0x5D681B02, 0x2A6F2B94,
    0xB40BBE37, 0xC30C8EA1, 0x5A05DF1B, 0x2D02EF8D
]);
function crc32(bytes, crc = 0) {
    return (~bytes.reduce((crc, v) => CRC_LOOKUP[(crc ^ v) & 0xFF] ^ (crc >>> 8), ~crc)) >>> 0;
}

class BlobSlice {
    constructor(blob, offset = 0, length = blob.size) {
        this.start = offset;
        this.end = offset + length;
        this.blob = blob;
        this.is_whole = offset === 0 && length === blob.size;
    }
    get size() {
        return this.end - this.start;
    }
    get_blob() {
        if (this.is_whole)
            return this.blob;
        return this.blob.slice(this.start, this.end);
    }
}

const MAX_TASK_TIME = 32;
const INTER_TASK_PAUSE = 16;
function NOT_IMPLEMENTED(name) {
    throw new Error(`${name} is not implemented`);
}
class ZipArchive {
    constructor() {
        this.entries = new Map;
    }
    has(file_name) {
        const norm_name = this.normalise_file_name(file_name);
        const trimmed_name = norm_name.endsWith("/") ? norm_name.slice(0, -1) : norm_name;
        this.verify_path(trimmed_name);
        return this.entries.has(trimmed_name + "/") || this.entries.has(trimmed_name);
    }
    is_folder(file_name) {
        const norm_name = this.normalise_file_name(file_name);
        const trimmed_name = norm_name.endsWith("/") ? norm_name.slice(0, -1) : norm_name;
        this.verify_path(trimmed_name);
        return this.entries.has(trimmed_name + "/");
    }
    get(file_name) {
        this.verify_path(file_name);
        return this.entries.get(this.normalise_file_name(file_name));
    }
    delete(file_name) {
        const norm_name = this.normalise_file_name(file_name);
        const trimmed_name = norm_name.endsWith("/") ? norm_name.slice(0, -1) : norm_name;
        this.verify_path(trimmed_name);
        if (this.entries.has(trimmed_name + "/"))
            return this.entries.delete(trimmed_name + "/");
        else
            return this.entries.delete(trimmed_name);
    }
    async set(file_name, file) {
        this.verify_path(file_name);
        const norm_name = this.normalise_file_name(file_name);
        if (this.entries.has(norm_name + "/"))
            throw new Error(`Unable to create ZipEntry; a folder exists at ${norm_name}`);
        file = file instanceof Blob ? file : new Blob([file]);
        const crc = await this.calculate_crc(file);
        return this.set_internal(file_name, new BlobSlice(file), 0, file.size, crc);
    }
    set_folder(file_name) {
        const norm_name = this.normalise_file_name(file_name);
        const trimmed_name = norm_name.endsWith("/") ? norm_name.slice(0, -1) : norm_name;
        this.verify_path(trimmed_name);
        if (this.entries.has(trimmed_name))
            throw new Error(`Unable to create folder; entry already exists at ${trimmed_name}`);
        const existing_entry = this.entries.get(trimmed_name + "/");
        if (existing_entry)
            return existing_entry;
        const empty_file = new BlobSlice(new Blob([]));
        const crc = crc32(new Uint8Array(0));
        const entry = new ZipEntry(empty_file, 0, 0, crc);
        this.entries.set(trimmed_name + "/", entry);
        return entry;
    }
    copy(from, to) {
        this.verify_path(from);
        this.verify_path(to);
        NOT_IMPLEMENTED("ZipArchive.copy");
    }
    move(from, to) {
        this.verify_path(from);
        this.verify_path(to);
        NOT_IMPLEMENTED("ZipArchive.move");
    }
    async compress_entry(file_name) {
        const entry = this.get(file_name);
        if (!entry)
            throw new Error(`Entry ${file_name} does not exist`);
        if (!entry.is_compressed) {
            const blob = await entry.get_blob();
            const original_size = blob.size;
            const deflated_blob = await this.compress_blob(blob);
            return this.set_internal(file_name, new BlobSlice(deflated_blob), 8, original_size, entry.crc);
        }
        return entry;
    }
    set_comment(str) {
        const buffer = encode_utf8_string(str);
        assert(buffer.length < 0xFFFF, "Comment exceeds maximum size");
        this.comment = buffer;
    }
    to_blob() {
        const parts = [];
        let offset = 0;
        const directories = [];
        for (const [name, entry] of this.entries) {
            const location = offset;
            const local = entry.generate_local(name);
            const file = entry.get_backing_object();
            offset += local.byteLength + file.size;
            parts.push(local, file);
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
    files() {
        return this.entries.entries();
    }
    static async from_blob(blob) {
        const archive = new ZipArchive;
        const buffer = await new Response(blob).arrayBuffer();
        const view = new DataView(buffer);
        const eocdr_position = this.find_eocdr(view);
        const eocdr = this.read_eocdr(view, eocdr_position);
        let position = 0;
        const offset = eocdr.cd_offset;
        const length = eocdr.cd_length;
        let task_start_time = Date.now();
        async function pause(duration) {
            return new Promise(resolve => setTimeout(resolve, duration));
        }
        while (position < length) {
            const signature = view.getUint32(position + offset, true);
            assert(signature === HEADER_CD, "Expected CD header");
            const entry = this.read_cd(view, position + offset);
            position += entry.size;
            if (entry.file_name.endsWith("/")) {
                archive.set_folder(entry.file_name);
            }
            else {
                const { data_location } = this.read_local(view, entry.local_position);
                const { uncompressed_size, compressed_size, compression, flag, file_name, internal, external, crc, extra, comment } = entry;
                archive.verify_path(file_name);
                const blob_slice = new BlobSlice(blob, data_location, compressed_size);
                const zip_entry = archive.set_internal(file_name, blob_slice, compression, uncompressed_size, crc);
                zip_entry.bit_flag = flag;
                zip_entry.internal_file_attr = internal;
                zip_entry.external_file_attr = external;
                zip_entry.extra = extra;
                zip_entry.comment = comment;
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
    static set_compression_function(fn) {
        set_compression_function(fn);
    }
    static set_decompression_function(fn) {
        set_decompression_function(fn);
    }
    static read_local(view, position) {
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
    static read_cd(view, position) {
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
        if (compression === 0)
            assert(compressed_size === uncompressed_size, "ucsize != csize for STORED entry");
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
    static find_eocdr(view) {
        const length = view.byteLength;
        for (let i = 22; i < 0xFFFF; i++) {
            const position = length - i;
            if (view.getUint32(position, true) == HEADER_EOCDR) {
                return position;
            }
        }
        throw new Error("No end of central directory record found");
    }
    static read_eocdr(view, position) {
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
    generate_eocdr(cd_location, cd_size, records) {
        const N = this.comment ? this.comment.length : 0;
        const length = 22 + N;
        const buffer = new ArrayBuffer(length);
        const view = new DataView(buffer);
        const uintview = new Uint8Array(buffer);
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
    async calculate_crc(blob) {
        const buffer = await new Response(blob).arrayBuffer();
        const bytes = new Uint8Array(buffer);
        return crc32(bytes);
    }
    set_internal(file_name, file, compresion, size, crc) {
        const norm_file_name = this.normalise_file_name(file_name);
        const entry = new ZipEntry(file, compresion, size, crc);
        this.entries.set(norm_file_name, entry);
        return entry;
    }
    normalise_file_name(file_name) {
        const slash_regex = /[\\|/]/g;
        return file_name.replace(slash_regex, "/");
    }
    verify_path(name) {
        const slash_regex = /[\\|/]/g;
        const part_regex = /^[^/\0]+$/;
        const parts = name.split(slash_regex);
        for (const part of parts) {
            assert(part_regex.test(part) || part === ".." || part === ".", `Invalid path "${name}"`);
        }
    }
    async compress_blob(file) {
        return await compress(file);
    }
}

const worker_string = `
	const wasm_binary_string = "data:application/wasm;base64,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IgokACABQayABGpCADcCACABQcaABGoiBC0AACEFIAQgAzoAAAJAAkAgAUG0gARqKAIADQAgA0H/AXFBBEcEQCAFQf8BcUEERg0BCyABQZCABGohFwJAIAFBpIAEaigCAA0AIAFBx4AEai0AAA0AAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkAgFygCAEH/ny1xQYGAAUcEQCACKAIAIhpFDQwgAUHMgARqIR8gAUGcgARqKAIAIQ8gAUGYgARqKAIAIRggAUHFgARqLQAAIRUgAUHggARqKAIAIREgAUHcgARqKAIAIQwgAigCBCETIAFB1IAEaiEDAkACQAJAA0ACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQCATIA1NBEAgDEUNASABLQDGgARFDQELAkACQAJAAkACQAJAAkBBggIgDGsiBCATIA1rIgUgBSAESxsiCARAIAEoAuSABCAMakEBSw0BCyAIIA1qIg4gCEkNAiATIA5JDQMgCARAIBogDWohCSAMIBFqIQtBACEEA0AgAygCACALIARqIgdB//8BcSIFakGAgAhqIAkgBGotAAAiBjoAACAFQYACTQRAIAVBgIACciIFQYGCAksNBCADKAIAIAVqQYCACGogBjoAAAsgDCAEaiABKALkgARqQQFqQQNPBEAgAygCACIFIAdBfmoiDUH//wFxIhBBAXRqIAUgBUGAgAhqIhIgB0F/akH//wFxai0AAEEFdCAGcyASIBBqLQAAQQp0QYD4AXFzQQF0IgdqQYCABGovAQA7AQAgAygCACAHakGAgARqIA07AQALIAggBEEBaiIERw0ACyAMIARqIQwLIA4hDQwGCyAIIA1qIhAgCEkNAyATIBBJDQQgAygCACIJQYCACGoiByAMIBFqIgVBfmoiBEH//wFxai0AAEEFdCAHIAVBf2pB//8BcWotAABzIQsgCCAMaiEMIAhBf2ohBiAaIA1qIQcCQANAIAkgBUH//wFxIgVqQYCACGogBy0AACIJOgAAIAVBgAJNBEAgBUGAgAJyIghBgYICSw0CIAMoAgAgCGpBgIAIaiAJOgAACyADKAIAIgggBEH//wFxQQF0aiAIIAtBBXRB4P8BcSAJcyILQQF0IglqQYCABGovAQA7AQAgAygCACAJakGAgARqIAQ7AQAgBgRAIAdBAWohByAGQX9qIQYgBUEBaiEFIARBAWohBCADKAIAIQkMAQUgECENDAgLAAsAC0H4ocAAIAhBgoICEEwAC0GIosAAIAVBgoICEEwACyANIA4QTgALIA4gExBNAAsgDSAQEE4ACyAQIBMQTQALIAEgASgC5IAEIgRBgIACIAxrIgUgBSAESxsiEjYC5IAEIAxBgQJNBEAgAS0AxoAERQ0BCyARQf//AXEhDiAPQQIgDxshBSABKAKQgAQiGUGAgCRxRQRAQQAhECAMQYICIAxBggJJGyIbIAVBASAFQQFLGyIFTQ0QIAUgDmoiBEF/aiIHQYGCAksNAiAEQYKCAk8NAyAfIAVBH0tBAnRqKAIAQX9qIhxFDRAgAygCACIUIA5qIh1BgIAIai8AACEgIBRBgIAIaiILIARqLQAAQQh0IAsgB2otAAByIR4gFEGCgAhqISFBgIICIA5rQfj/A3EhIiAOIQQDQEEEIQkCQAJAA0AgCUF/aiIJRQ0BIARB//8BSw0CIBQgBEEBdGovAQAiB0UNFCARIAdrQf//A3EiFiASSw0UIAdB//8BcSIEIAVqIgZBf2oiCEGBggJLDQggBkGCggJPDQkgCyAGai0AAEEIdCALIAhqLQAAciAeRw0ACyAWRQ0TIBQgBGpBgIAIai8AACAgRw0AIAQgIWohI0GAggIgBGtB+P8DcUEIaiEkQQAhBgNAIAZBgAJGDRMgIiAGRg0KICQgBkEIaiIJRg0LICMgBmohCCAdIAZqISUgCSEGIAgpAAAgJUGCgAhqKQAAhSImUA0ACyAmeqciCEEDdiIGIAlqQXpqIgcgBU0NACAbIAdNDRIgDiAGaiAJaiIFQXlqQYGCAksNCyAFQXpqQYKCAk8NDCAdIAZqIAlqQfn/B2ovAAAhHiAHIQUgFiEQCyAcQX9qIhxFDRIMAQsLQYyOwAAgBEGAgAIQTAALQQAhECASRSAZQYCAIHFyDQ8gDCAOaiIIIAxJDQkgCEGCggJLDQogAygCACIQIBFBf2pB//8BcWpBgIAIai0AACEGIBAgDmoiEkGAgAhqIgUgDGohCUEAIQQgDEEESQ0MIBJBgIAIaiELA0AgCyAEaiIFLQAAIAZB/wFxIgdHDQ4gBUEBai0AACAHRwRAIARBAWohBAwPCyAFQQJqLQAAIAdHBEAgBEECaiEEDA8LIAVBA2otAAAgB0YEQCAEQQRqIQQgCSAFa0F8akEDTQ0NDAELCyAEQQNqIQQMDQsgASARNgLggAQgASAMNgLcgAQgASANNgKsgAQgASAVOgDFgAQgASAPNgKcgAQgASAYNgKYgAQMHgtBtIjAACAHQYKCAhBMAAtBxIjAACAEQYKCAhBMAAtBtIjAACAIQYKCAhBMAAtBxIjAACAGQYKCAhBMAAsgEUH//wFxIAZqQQpqQYKCAhBNAAsgB0H//wFxIAZqQQpqQYKCAhBNAAtBtIjAACARQf//AXEgCEEDdmogCWpBeWpBgoICEEwAC0HEiMAAIBFB//8BcSAIQQN2aiAJakF6akGCggIQTAALIA4gCBBOAAsgCEGCggIQTQALIBIgBGpBgIAIaiEFCyAFIAlGDQAgBUGAgHhqIQUgECAIaiEHA0AgBUGAgAhqLQAAIAZB/wFxRw0BIARBAWohBCAHIAVBAWoiBUcNAAsLQQAgBCAEQQNJGyEFIARBAkshEAwBCyAbIQUgFiEQC0EAIBAgDiAQRiAZQRF2IAVBBklxIAVBA0YgEEH/P0txcnIiBBshB0EAIAUgBBshBQJ/An8CQAJAAkACQCAPRQRAIAdFDQMgAS0AxIAEIBlBgIAEcXJFBEAgBUGAAUkNBQsMAQsgASgCyIAEIQQgBSAPTQRAIAQgASAPIBgQGSAPQX9qIQRBAAwGCyABIAEoAghBAWo2AgggASgCACIGQYCABE8NByABIAZqQRBqIBU6AAAgASABKAIAQQFqNgIAIAEoAgQiBkGAgARPDR0gASAGakEQaiIGIAYtAABBAXY6AAAgASABKAIMQX9qIgY2AgwgBkUEQCABQQg2AgwgASABKAIAIgY2AgQgASAGQQFqNgIACyAEIBVBAXRqIgQgBC8BAEEBajsBACAFQYABSQ0BCyABKALIgAQgASAFIAcQGSAFIQRBAAwECyADKAIAIA5qQYCACGotAAAMAgsgAygCACAOakGAgAhqLQAAIQUgASABKAIIQQFqNgIIIAEoAgAiBEGAgARPDRkgASgCyIAEIQcgASAEakEQaiAFOgAAIAEgASgCAEEBajYCACABKAIEIgRBgIAETw0YIAEgBGpBEGoiBCAELQAAQQF2OgAAIAEgASgCDEF/aiIENgIMIARFBEAgAUEINgIMIAEgASgCACIENgIEIAEgBEEBajYCAAtBASEEIAcgBUEBdGoiBSAFLwEAQQFqOwEAQQAMAgsgAygCACAOakGAgAhqLQAACyEVQQEhBCAHIRggBQshDyAMIARJDQMgBCARaiERIAEgASgC5IAEIARqIgVBgIACIAVBgIACSRs2AuSABCAMIARrIQwgASgCACEEAkAgASgCCCIFQYD4AUsEQCAEQfj/A0sgBEHzAGxBB3YgBU9yDQEgASgCkIAEQYCAIHFFDQIMAQsgBEH5/wNJDQELIAEgETYC4IAEIAEgDDYC3IAEIAEgDTYCrIAEIApBEGogASACQQAQA0F/IAooAhQiByAKKAIQIgRBAUYbIQUgBEUgB0H/AXFBAklyRQRAIAooAhgiBCgCACAEKAIEKAIAEQIAIAQoAgQiBygCBCIGBEAgBCgCACAGIAcoAggQggELIARBDEEEEIIBCyAFRQ0ACyABIA82ApyABCABIBg2ApiABCABIBU6AMWABCAFQQBKDQ4MBAtBnI7AACAGQYCABBBMAAALAAtBqKLAAEEvQZiiwAAQagALIAIoAgAiFEUNCyABQeCABGooAgAiCEH//wFxIQUgAigCBCERIAEoAtyABCEPIAFB1IAEaiEMAkACQAJAAkADQAJAAkAgESAJTQRAIA9FDQEgAS0AxoAERQ0BC0GAICAPayIDIBEgCWsiBCAEIANLGyIOBEAgDyAIaiELIAkhBiAOIQcDQCAHQYCAAiALQf//AXEiBGsiAyADIAdLGyIDIARqIgtBg4ICTw0SIAMgBmoiCSADSQ0RIBEgCUkNECAMKAIAIARqQYCACGogFCAGaiIQIAMQYRogBEGAAk0EQEGBAiAEayINIAMgAyANSxsiDSAEQYCAAnIiBGoiEkGDggJPDRAgDSAGaiISIA1JDQ8gESASSQ0OIAwoAgAgBGpBgIAIaiAQIA0QYRoLIAkhBiAHIANrIgcNAAsLIAEgASgC5IAEIgNBgIACIA4gD2oiC2siBCAEIANLGzYC5IAEIAtB/x9LDQEgAS0AxoAEDQEgCyEPCyABIAg2AuCABCABIA82AtyABCABIAk2AqyABAwQCwJAIAtBBE8EQANAIAwoAgAiAyADIAVB//8BcWpBgIAIaigAACIPQf///wdxIgRBEXYgD0H/H3FzQQF0akGAgARqIgMvAQAhDiADIAg7AQACQCABKALkgAQgCCAOayIWQf//A3EiE0kNAAJAAkACQAJAAkACQAJAAkAgBCAMKAIAIgcgDkH//wFxIgNqQYCACGooAABB////B3FHBEAgASgCACIDQYCABE8NAiABIANqQRBqIA86AAAgASABKAIAQQFqNgIAIAEoAgQiBEGAgARJDQEMIgsgB0GDgAhqIgQgA2ohDSAEIAVqIRBB/4ECIANrQfj/A3FBCGohEkEAIQMCQANAIANBgAJGBEBBggIhAyATDQkMAgsgBSADaiIEQQNqQXdLDQQgBEELakGCggJLDQUgEiADQQhqIgRGDQYgECADaiEHIA0gA2ohBiAEIQMgBikAACAHKQAAhSImUA0ACyAmeqdBA3YgBGoiBEF7aiIDQQNJDQAgE0GAwABJIARBeGpyDQcLIAEoAgAiA0GAgARPDQUgASADakEQaiAPOgAAIAEgASgCAEEBajYCACABKAIEIgRBgIAESQ0ADCELQQEhAyABIARqQRBqIgQgBC0AAEEBdjoAACAPQf8BcSEEDAYLQZyOwAAgA0GAgAQQTAALIARBA2ogBEELahBOAAsgBEELakGCggIQTQALIA5B//8BcSADakELakGCggIQTQALQZyOwAAgA0GAgAQQTAALIAEoAgAiBEGAgARPDRsgASAEakEQaiALIAMgAyALSxsiA0F9aiIHOgAAIAEgASgCAEEBaiIENgIAIARBgIAETw0bIAEgBGpBEGogFkF/aiIEOgAAIAEgASgCAEEBaiIGNgIAIAZBgIAETw0MIAEgBmpBEGogBEGA/gNxQQh2Ig06AAAgASABKAIAQQFqNgIAIAEoAgQiBkGAgARPDRwgASAGakEQaiIGIAYtAABBAXY6AAAgASgCBCIGQYCABE8NHCABIAZqQRBqIgYgBi0AAEGAAXI6AAACfyAEQf//A3EiBkGABEkEQCAGQbCVwABqDAELIARBEHRBEHVBAEgNBSANQbCdwABqCyEEIAEoAsiABCAELQAAQQF0akHABGoiBCAELwEAQQFqOwEAIAdB/wFLDQYgB0EBdEHMjsAAai8BACIEQaACSQ0AQfiiwAAgBEGgAhBMAAsgASgCyIAEIARBAXRqIgQgBC8BAEEBajsBACABIAEoAgxBf2oiBDYCDAJAIAQEQCABKAIAIQQMAQsgAUEINgIMIAEgASgCACIENgIEIAEgBEEBaiIENgIACyABIAEoAgggA2o2AgggASABKALkgAQgA2oiB0GAgAIgB0GAgAJJGzYC5IAEIAsgA2shCyADIAhqIQggAyAFakH//wFxIQUgBEH5/wNJDQAgASAINgLggAQgASALNgLcgAQgCkEQaiABIAJBABADIAooAhBBAUYEQCABQX82ArSABCABIAk2AqyABCAKLQAUQQJJDQogCkEYaigCACIDKAIAIAMoAgQoAgARAgAgAygCBCIEKAIEIgUEQCADKAIAIAUgBCgCCBCCAQsgA0EMQQQQggEMCgsgCigCFCIDDQcgASgC4IAEIQggASgC3IAEIQsLIAtBA0sNAAsLQQAhDyALRQ0BA0AgBUGBggJLDQQgDCgCACAFakGAgAhqLQAAIQMgASABKAIIQQFqNgIIIAEoAgAiBEGAgARPDRggASAEakEQaiADOgAAIAEgASgCAEEBajYCACABKAIEIgRBgIAETw0XIAEgBGpBEGoiBCAELQAAQQF2OgAAIAEgASgCDEF/aiIENgIMIARFBEAgAUEINgIMIAEgASgCACIENgIEIAEgBEEBajYCAAsgASgCyIAEIANBAXRqIgMgAy8BAEEBajsBACABIAEoAuSABEEBaiIDQYCAAiADQYCAAkkbNgLkgAQgC0F/aiELIAhBAWohCCABKAIAQfn/A08EQCABIAg2AuCABCABIAs2AtyABCAKQRBqIAEgAkEAEAMgCigCEEEBRgRAIAEgCTYCrIAEIAFBfzYCtIAEIAotABRBAkkNCSAKQRhqKAIAIgMoAgAgAygCBCgCABECACADKAIEIgQoAgQiBQRAIAMoAgAgBSAEKAIIEIIBCyADQQxBBBCCAQwJCyAKKAIUIgMNByABKALggAQhCCABKALcgAQhCwsgBUEBakH//wFxIQUgCw0ACwwBCwtB2KLAACANQYABEEwAC0HoosAAIAdBgAIQTAALQYijwAAgBUGCggIQTAALIAEgCTYCrIAEIANBAUgNAQwLCyABIAk2AqyABCADQQBKDQoLIAAgASgCsIAENgIIIAAgASgCrIAENgIEIAAgASgCtIAENgIADA4ACwALQZyOwAAgBkGAgAQQTAAACwALIBIgERBNAAsgBiASEE4ACyASQYKCAhBNAAsgCSAREE0ACyAGIAkQTgALIAtBgoICEE0ACyACKAIAIgNFDQAgF0EBai0AAEEwcUUNACACKAIEIgUgASgCrIAEIgRJDQEgCkEIaiABKAKogAQQciAKIAopAwg3AxAgCkEQaiADIAQQCCABIApBEGoQeDYCqIAECwJAIAEtAMaABCIDRQ0AIAIoAgRBACACKAIAGyABKAKsgARHDQAgAUHcgARqKAIAIAEoAqSABHINACAKQRBqIAEgAiADEAMgCigCEEEBRgRAIAFBfzYCtIAEIABBfzYCACAAIAEpAqyABDcCBCAKLQAUQQJJDQUgCkEYaigCACIBKAIAIAEoAgQoAgARAgAgASgCBCIDKAIEIgQEQCABKAIAIAQgAygCCBCCAQsgAUEMQQQQggEMBQsgCigCFEF/TARAIAAgASgCsIAENgIIIAAgASgCrIAENgIEIAAgASgCtIAENgIADAULIAEgAS0AxoAEIgNBBEY6AMeABCADQQNHDQAgAUHUgARqIgMoAgBBgIAEakEAQYCABBBpGiADKAIAQQBBgIAEEGkaIAFB5IAEakEANgIACyAKQRBqIAIgFxAvIAEgCigCEDYCtIAEIAAgCikDEDcCACAAQQhqIApBGGooAgA2AgAMAwsgBCAFEE0ACyAKQRBqIAIgFxAvIAEgCigCEDYCtIAEIAAgCikDEDcCACAAQQhqIApBGGooAgA2AgAMAQsgAEEANgIIIABC/v///w83AgAgAUF+NgK0gAQLIApBIGokAA8LQayOwAAgBEGAgAQQTAALQZyOwAAgBEGAgAQQTAALQayOwAAgBkGAgAQQTAAL/BwCCX8CfgJAAkAjAEEwayIEJABBASEFIAFBwIAEaigCACEGAkACQAJAAkACQCACKAIQQQFHDQAgAkEYaigCACIIIAFBsIAEaigCACIHa0HMmQVJDQAgB0G8mQVqIQUgB0HD5npLDQEgCCAFSQ0CIAJBFGooAgAgB2ohBkEAIQULIARBDGpBvJkFNgIAIAQgBjYCCCAEIAU6ABggBEIANwMAIAQgAUG4gARqKAIAIgg2AhAgBCABQbyABGooAgAiBjYCFCABQZKABGotAABBCHFFDQJBASEJIAFB4IAEaigCACABQdiABGooAgBrIAFB5IAEaigCAEsNAgwDCyAHIAUQTgALIAUgCBBNAAtBACEJCwJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAAkACQAJAIAFBpIAE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AABqIgsgA0EEai0AAGoiDCADQQVqLQAAaiINIANBBmotAABqIg4gA0EHai0AAGoiDyADQQhqLQAAaiIQIANBCWotAABqIhEgA0EKai0AAGoiEiADQQtqLQAAaiITIANBDGotAABqIhQgA0ENai0AAGoiFSADQQ5qLQAAaiIWIANBD2otAABqIgU2AgAgACAGIAhqIAlqIApqIAtqIAxqIA1qIA5qIA9qIBBqIBFqIBJqIBNqIBRqIBVqIBZqIAVqIgY2AgQgBCIDIAdJDQALDAELIAAoAgQhBiAAKAIAIQULIAAgBkHx/wNwNgIEIAAgBUHx/wNwNgIAIARBsCtqIgcgAk0NAAsLIAQgAk8NCCACIARrQRBJBEAgBCEFDAULQQAgBGshBgNAIARBb0sNAyAEQRBqIgUgAksNBCAAKAIEIQggACAAKAIAIAEgBGoiAy0AAGoiBCADQQFqLQAAaiIJIANBAmotAABqIgogA0EDai0AAGoiCyADQQRqLQAAaiIMIANBBWotAABqIg0gA0EGai0AAGoiDiADQQdqLQAAaiIPIANBCGotAABqIhAgA0EJai0AAGoiESADQQpqLQAAaiISIANBC2otAABqIhMgA0EMai0AAGoiFCADQQ1qLQAAaiIVIANBDmotAABqIhYgA0EPai0AAGoiAzYCACAAIAggBGogCWogCmogC2ogDGogDWogDmogD2ogEGogEWogEmogE2ogFGogFWogFmogA2o2AgQgBSEEIAIgBkFwaiIGakEPSw0ACwwECyADIANBEGoQTgALIANBEGogAhBNAAsgBCAEQRBqEE4ACyAEQRBqIAIQTQALAkACQCAFIAJHBEADQCAFIAJPDQIgACAAKAIAIAEgBWotAABqIgM2AgAgACAAKAIEIANqIgQ2AgQgAiAFQQFqIgVHDQAMAwsACyAAKAIEIQQgACgCACEDDAELQZiuwAAgBSACEEwACyAAIANB8f8DcDYCACAAQQRqDAILAkAgAkUNAANAIAJFDQEgACAAKAIAIAEtAABqIgM2AgAgACAAKAIEIANqNgIEIAFBAWohASACQX9qIgINAAsLIAAoAgAiA0Hw/wNLBEAgACADQY+AfGo2AgALIAAoAgQhBCAAQQRqDAELIAAgACgCACABLQAAakHx/wNwIgQ2AgAgACgCBCAEaiEEIABBBGoL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AEEsQaCgwAAQagALQeygwABBIUHcoMAAEGoAAAsAC0GsjsAAIARBgIAEEEwAC0GsjsAAIARBgIAEEEwAC0GgocAAQTVBkKHAABBqAAtBnI7AACAFQYCABBBMAAurBAIEfwF+QQEhBSABKAIYQScgAUEcaigCACgCEBEGAEUEQEECIQICQAJAAkAgACgCACIAQXdqIgNBHksEQCAAQdwARw0BDAILQfQAIQQCQAJAIANBAWsOHgECAgACAgICAgICAgICAgICAgICAgICAgMCAgICAwQLQfIAIQQMAwtB7gAhBAwCCwJ+AkBB+NLAACAAECxFBEAgABA7RQ0BQQEhAgwDCyAAQQFyZ0ECdkEHc61CgICAgNAAhAwBCyAAQQFyZ0ECdkEHc61CgICAgNAAhAshBkEDIQILIAAhBAsDQCACIQNB3AAhAEEBIQICQAJAAkACQCADQQFrDgMCAwABCwJAAkACQAJAAkAgBkIgiKdB/wFxQQFrDgUEAwIBAAULIAZC/////49gg0KAgICAwACEIQZBAyECDAYLIAZC/////49gg0KAgICAMIQhBkH1ACEAQQMhAgwFCyAGQv////+PYINCgICAgCCEIQZB+wAhAEEDIQIMBAsgBCAGpyIDQQJ0QRxxdkEPcSICQTByIAJB1wBqIAJBCkkbIQAgAwRAIAZCf3xC/////w+DIAZCgICAgHCDhCEGQQMhAgwECyAGQv////+PYINCgICAgBCEIQZBAyECDAMLIAZC/////49ggyEGQf0AIQBBAyECDAILIAEoAhhBJyABKAIcKAIQEQYADwtBACECIAQhAAsgASgCGCAAIAEoAhwoAhARBgBFDQALCyAFC7gDAQZ/IwBBIGsiAyQAIAMgAkEIaigCACIGNgIMIAMgAjYCCCABQRhqIQcgA0EQakEEciEIIAYiBSEEAkADQAJAAkACQAJAIAQgBUYEQCACIAVBIBBBIAMoAggiBCAEQQRqKAIAIgU2AgggBSADKAIMIgJJDQEgBCgCACACakEAIAUgAmsQaRogAygCCCICKAIIIQUgAygCDCEECyAFIARJDQEgA0EQaiAHIAEgAigCACAEaiAFIARrEBQgAygCEEEBRwRAIAMoAhQiBQ0DIAQgBmshBEEAIQUMBgsgCBBtQf8BcUEPRwRAQQEhBSADKAIYIQIgAygCFCEE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akGQgAQQYSIBIAI2AsiABCABQcCABGogAEHIgARqKQMANwIAIAFBuIAEaiAAQcCABGopAwA3AgAgAUGwgARqIABBuIAEaikDADcCACABQaiABGogAEGwgARqKQMANwIAIAFBoIAEaiAAQaiABGopAwA3AgAgAUGYgARqIABBoIAEaikDADcCACABIAApA5iABDcCkIAEIAEgACkD0IAENwLMgAQgAUHUgARqIABB2IAEaikDADcCACABQdyABGogAEHggARqKQMANwIAIAFB5IAEaiAAQeiABGooAgA2AgAgAEHwgARqJAAgAQ8LQeiABEEEEIkBAAtB4CFBAhCJAQALuQIBBX8jAEFAaiICJAAgASgCBCIERQRAIAFBBGohBCABKAIAIQMgAkEANgIgIAJCATcDGCACIAJBGGo2AiQgAkE4aiADQRBqKQIANwMAIAJBMGogA0EIaikCADcDACACIAMpAgA3AyggAkEkakGorsAAIAJBKGoQCxogAkEQaiIDIAIoAiA2AgAgAiACKQMYNwMIAkAgASgCBCIFRQ0AIAFBCGooAgAiBkUNACAFIAZBARCCAQsgBCACKQMINwIAIARBCGogAygCADYCACAEKAIAIQQLIAFBATYCBCABQQxqKAIAIQMgAUEIaiIBKAIAIQUgAUIANwIAQQxBBBB7IgFFBEBBDEEEEIkBAAsgASADNgIIIAEgBTYCBCABIAQ2AgAgAEGssMAANgIEIAAgATYCACACQUBrJAALrQIBBX8gASgCGCEFAkACQCABKAIMIgIgAUYEQCABQRRBECABQRRqIgIoAgAiBBtqKAIAIgMNAUEAIQIMAgsgASgCCCIDIAI2AgwgAiADNgIIDAELIAIgAUEQaiAEGyEEA0AgBCEGIAMiAkEUaiIEKAIAIgNFBEAgAkEQaiEEIAIoAhAhAwsgAw0ACyAGQQA2AgALAkAgBUUNAAJAIAAgASgCHEECdGpBkAJqIgMoAgAgAUYEQCADIAI2AgAgAg0BIAAgACgCBEF+IAEoAhx3cTYCBA8LIAVBEEEUIAUoAhAgAUYbaiACNgIAIAJFDQELIAIgBTYCGCABKAIQIgMEQCACIAM2AhAgAyACNgIYCyABQRRqKAIAIgNFDQAgAkEUaiADNgIAIAMgAjYCGAsLqQICBX8CfiMAQSBrIgYkACABQQhqIggp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AhBOAAsgASACNgIUIAEgBiACazYCBCABIAMgAmo2AgBBACEDIAFBADYCECABKAIMIQQgASgCCCEFCyAEIAJPBEAgAEEANgIAIABBCGogAiADazYCACAAIAUgA2o2AgQPCyACIAQQTQAL4wEBBH8jAEFAaiICJAAgAUEEaiEEIAEoAgRFBEAgASgCACEDIAJBADYCICACQgE3AxggAiACQRhqNgIkIAJBOGogA0EQaikCADcDACACQTBqIANBCGopAgA3AwAgAiADKQIANwMoIAJBJGpBqK7AACACQShqEAsaIAJBEGoiAyACKAIgNgIAIAIgAikDGDcDCAJAIAEoAgQiBUUNACABQQhqKAIAIgFFDQAgBSABQQEQggELIAQgAikDCDcCACAEQQhqIAMoAgA2AgALIABBrLDAADYCBCAAIAQ2AgAgAkFAayQAC/ABAQR/IwBBEGsiAiQAAkAgACgCGEUNACACQQhqIAAQLiACLQAIQQJGBEAgAigCDCIBKAIAIAEoAgQoAgARAgAgASgCBCIDKAIEIgQEQCABKAIAIAQgAygCCBCCAQsgAUEMQQQQggELIAAoAhgiAUUNACAAQRxqKAIAIgNFDQAgASADQQEQggELIAAoAhAiAUHAgARqKAIAQcyZBUEBEIIBIAEoAsiABEHgIUECEIIBIAFB1IAEaigCAEGCggpBAhCCASAAKAIQQeiABEEEEIIBIABBKGooAgAiAQRAIAAoAiQgAUEBEIIBCyACQRBqJAAL2gECBH8BfiMAQRBrIgQkACAEQQhqIAEQLiAEKAIMIQICQAJAIAQoAggiA0H/AXFBA0YEQCADQQNxQQJGBEAgAigCACACKAIEKAIAEQIAIAIoAgQiAygCBCIFBEAgAigCACAFIAMoAggQggELIAJBDEEEEIIBCyABKAIYIQNBACECIAFBADYCGCADRQ0CIAFBHGopAgAhBiAAIAM2AgQgAEEIaiAGNwIADAELIAAgAq1CIIYgA62ENwIEQQEhAgsgACACNgIAIAEQNiAEQRBqJAAPC0GUgcAAEFYAC88BAQF/IwBB4ABrIgQkACAEIAE2AgggBCADNgIMIAEgA0YEQCAAIAIgARBhGiAEQeAAaiQADwsgBEE8akEBNgIAIARBNGpBAjYCACAEQSRqQQM2AgAgBEIDNwIUIARB4ILAADYCECAE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ADcgAEEAOwA1IAAgATYCACAAQgA3AgQgAEEMakIANwIAIABCADcCHCAAQRRqQoCAgIAQNwIAIABBJGpCADcCACAAQSxqQQA2AgAgACACNgIwIAAgAUEOdkEBcToANAt8AQF/AkACQCACQX9KBEACQCACRQRAQQEhAwwBCyACQQEQeyIDRQ0CCyADIAEgAhBhIQNBDEEEEHsiAUUNAiABIAI2AgggASACNgIEIAEgAzYCACAAQaivwAA2AgQgACABNgIADwsQjgEACyACQQEQiQEAC0EMQQQQiQEAC4ABAQF/IwBBQGoiBCQAIAQgATYCDCAEIAA2AgggBCADNgIUIAQgAjYCECAEQSxqQQI2AgAgBEE8akE5NgIAIARCAjcCHCAEQcy0wAA2AhggBEE1NgI0IAQgBEEwajYCKCAEIARBEGo2AjggBCAEQQhqNgIwIARBGGpB9LTAABBdAAtvAQF/AkAgASAATwRAIAJFDQEgACEDA0AgAyABLQAAOgAAIAFBAWohASADQQFqIQMgAkF/aiICDQALDAELIAJFDQAgAUF/aiEBIABBf2ohAwNAIAMgAmogASACai0AADoAACACQX9qIgINAAsLIAALegEDfyAALQAEIQEgAC0ABQRAIAFB/wFxIQIgAAJ/QQEiASACDQAaIAAoAgAiAUEcaigCACgCDCECIAEoAhghAyABLQAAQQRxRQRAIANBw7rAAEECIAIRCAAMAQsgA0HCusAAQQEgAhEIAAsiAToABAsgAUH/AXFBAEcLagEBf0GCggpBAhB7IgJFBEBBgoIKQQIQiQEACyACQQBBgoIKEGkhAiAAQgA3AgwgACACNgIIIABBFGpCADcCACAAIAFB/x9xIgFBAnZBAmpBA25BAWqtQiCGIAFBAmpBA25BAWqthDcCAAt5AgR/AX4jAEEwayIBJAAgAEEMahB5IQIgACgCCBB5IQMgAUEIaiACKQIANwIAIAEpAwghBSACKAIIIQQgASACKAIMNgIcIAEgBDYCGCABIAU3AxAgAUEANgIkIAEgAzYCICABQSBqQZiwwAAgACgCCCABQRBqEDAAC2wBA38jAEEgayICJAACQCAAIAEQJw0AIAFBHGooAgAhAyABKAIYIQQgAkIENwMYIAJCATcCDCACQZSzwAA2AgggBCADIAJBCGoQCw0AIABBBGogARAnIQEgAkEgaiQAIAEPCyACQSBqJABBAQtsAQF/IwBBMGsiAyQAIAMgAjYCBCADIAE2AgAgA0EcakECNgIAIANBLGpBNDYCACADQgI3AgwgA0Hgs8AANgIIIANBNDYCJCADIANBIGo2AhggAyADNgIoIAMgA0EEajYCICADQQhqIAAQXQALbwEBfyMAQTBrIgIkACACIAE2AgQgAiAANgIAIAJBHGpBAjYCACACQSxqQTQ2AgAgAkICNwIMIAJBxLXAADYCCCACQTQ2AiQgAiACQSBqNgIYIAIgAkEEajYCKCACIAI2AiAgAkEIakHUtcAAEF0AC28BAX8jAEEwayICJAAgAiABNgIEIAIgADYCACACQRxqQQI2AgAgAkEsakE0NgIAIAJCAjcCDCACQYi2wAA2AgggAkE0NgIkIAIgAkEgajYCGCACIAJBBGo2AiggAiACNgIgIAJBCGpBmLbAABBdAAteAQJ/IwBBIGsiAiQAIAFBHGooAgAhAyABKAIYIQEgAkEYaiAAQRBqKQIANwMAIAJBEGogAEEIaikCADcDACACIAApAgA3AwggASADIAJBCGoQCyEAIAJBIGokACAAC10BAX8jAEEgayICJAAgAiAAKAIANgIEIAJBGGogAUEQaikCADcDACACQRBqIAFBCGopAgA3AwAgAiABKQIANwMIIAJBBGpBqK7AACACQQhqEAshASACQSBqJAAgAQteAAJAQQggAkkEQAJ/QQggAkkEQEGc38AAIAIgAxAdDAELQZzfwAAgAxAECyICDQFBAA8LQZzfwAAgACADEBEPCyACIAAgAyABIAEgA0sbEGEhAkGc38AAIAAQDSACC10BAX8jAEEgayICJAAgAiAAKAIANgIEIAJBGGogAUEQaikCADcDACACQRBqIAFBCGopAgA3AwAgAiABKQIANwMIIAJBBGpBzLrAACACQQhqEAshASACQSBqJAAgAQtaAQF/IwBBIGsiAiQAIAIgADYCBCACQRhqIAFBEGopAgA3AwAgAkEQaiABQQhqKQIANwMAIAIgASkCADcDCCACQQRqQcy6wAAgAkEIahALIQEgAkEgaiQAIAELZAEBfyMAQRBrIgIkAAJAIAAoAgAiACgCAEEBRwRAIAIgAUGsh8AAQQQQZQwBCyACIAFBqIfAAEEEEGUgAiAAQQRqNgIMIAIgAkEM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YXZlIGRpZmZlcmVudCBsZW5ndGhzeAEQADQAAAAMARAAGAAAAFoIAAAJAAAAZmFpbGVkIHRvIHdyaXRlIHdob2xlIGJ1ZmZlcmNhbGxlZCBgUmVzdWx0Ojp1bndyYXAoKWAgb24gYW4gYEVycmAgdmFsdWUAAwAAAAgAAAAEAAAABAAAAAAAAAAvcnVzdGMvNDU2MGVhNzg4Y2I3NjBmMGEzNDEyNzE1NmM3OGUyNTUyOTQ5ZjczNC9zcmMvbGlic3RkL2lvL2ltcGxzLnJzAAAgAhAARgAAAMgAAAANAAAAY2FsbGVkIGBSZXN1bHQ6OnVud3JhcCgpYCBvbiBhbiBgRXJyYCB2YWx1ZQAFAAAAAAAAAAEAAAAGAAAAZGVmbGF0ZSBkZWNvbXByZXNzaW9uIGVycm9yRGVjb21wcmVzc0Vycm9ySW5uZXJuZWVkc19kaWN0aW9uYXJ5AAcAAAAEAAAABAAAAAgAAABEZWNvbXByZXNzRXJyb3IABwAAAAQAAAAEAAAACQAAAENvbXByZXNzRXJyb3IAAAAHAAAABAAAAAQAAAAKAAAACwAAAAgAAAAEAAAADAAAAA0AAAANAAAADgAAAA8AAAAQAAAAEQAAAGNhbGxlZCBgUmVzdWx0Ojp1bndyYXAoKWAgb24gYW4gYEVycmAgdmFsdWUAEgAAAAQAAAAEAAAAEwAAAFNvbWVOb25lFAAAAAQAAAAEAAAAFQAAACgpAEHQh8AAC84LQzpcVXNlcnNcaWFpblwuY2FyZ29ccmVnaXN0cnlcc3JjXGdpdGh1Yi5jb20tMWVjYzYyOTlkYjllYzgyM1xtaW5pel9veGlkZS0wLjMuNVxzcmNcZGVmbGF0ZVxjb3JlLnJzANADEABjAAAAKwEAAAUAAADQAxAAYwAAACsBAAAbAAAAQzpcVXNlcnNcaWFpblwuY2FyZ29ccmVnaXN0cnlcc3JjXGdpdGh1Yi5jb20tMWVjYzYyOTlkYjllYzgyM1xtaW5pel9veGlkZS0wLjMuNVxzcmNcZGVmbGF0ZVxjb3JlLnJzAFQEEABjAAAAPwIAAAkAAABhc3NlcnRpb24gZmFpbGVkOiBiaXRzIDw9ICgoMXUzMiA8PCBsZW4pIC0gMXUzMinQAxAAYwAAAEQCAAANAAAAAAAAANADEABjAAAA9AIAABsAAADQAxAAYwAAAPkCAAARAAAA0AMQAGMAAAAMAwAAKAAAANADEABjAAAADQMAAC0AAADQAxAAYwAAAA0DAAAZAAAA0AMQAGMAAAARAwAAGQAAANADEABjAAAAFQMAADcAAADQAxAAYwAAABYDAAAtAAAA0AMQAGMAAAAWAwAATAAAANADEABjAAAAGgMAAC0AAADQAxAAYwAAACEDAAAxAAAA0AMQAGMAAAAhAwAAKQAAANADEABjAAAAKgMAACsAAADQAxAAYwAAAC8DAAAZAAAA0AMQAGMAAABKAwAAFAAAANADEABjAAAATAMAABUAAADQAxAAYwAAAF8DAAARAAAA0AMQAGMAAABtAwAAFAAAANADEABjAAAAbgMAABUAAADQAxAAYwAAAH0DAAARAAAA0AMQAGMAAACHAwAAJAAAANADEABjAAAAiQMAABUAAADQAxAAYwAAAJMDAAANAAAA0AMQAGMAAACfAwAAHAAAABAREgAIBwkGCgULBAwDDQIOAQ8A0AMQAGMAAAAZBAAAGAAAAFQEEABjAAAAGwQAAA0AAABhc3NlcnRpb24gZmFpbGVkOiBjb2RlIDwgTUFYX0hVRkZfU1lNQk9MU18yANADEABjAAAAIgQAAB8AAADQAxAAYwAAACMEAAAVAAAA0AMQAGMAAACmBAAANAAAANADEABjAAAASgUAAAkAAADQAxAAYwAAAFgFAAAOAAAA0AMQAGMAAACCBQAAHQAAAAEBAgEDAQQBBQEGAQcBCAEJAQkBCgEKAQsBCwEMAQwBDQENAQ0BDQEOAQ4BDgEOAQ8BDwEPAQ8BEAEQARABEAERAREBEQERAREBEQERAREBEgESARIBEgESARIBEgESARMBEwETARMBEwETARMBEwEUARQBFAEUARQBFAEUARQBFQEVARUBFQEVARUBFQEVARUBFQEVARUBFQEVARUBFQEWARYBFgEWARYBFgEWARYBFgEWARYBFgEWARYBFgEWARcBFwEXARcBFwEXARcBFwEXARcBFwEXARcBFwEXARcBGAEYARgBGAEYARgBGAEYARgBGAEYARgBGAEYARgBGAEZARkBGQEZARkBGQEZARkBGQEZARkBGQEZARkBGQEZARkBGQEZARkBGQEZARkBGQEZARkBGQEZARkBGQEZARkBGgEaARoBGgEaARoBGgEaARoBGgEaARoBGgEaARoBGgEaARoBGgEaARoBGgEaARoBGgEaARoBGgEaARoBGgEaARsBGwEbARsBGwEbARsBGwEbARsBGwEbARsBGwEbARsBGwEbARsBGwEbARsBGwEbARsBGwEbARsBGwEbARsBGwEcARwBHAEcARwBHAEcARwBHAEcARwBHAEcARwBHAEcARwBHAEcARwBHAEcARwBHAEcARwBHAEcARwBHAEcAR0B0AMQAGMAAACKBQAAGwAAAAAAAAABAAAAAwAAAAcAAAAPAAAAHwAAAD8AAAB/AAAA/wAAAP8BAAD/AwAA/wcAAP8PAAD/HwAA/z8AAP9/AAD//wBBqJPAAAuaEAEBAQEBAQEBAgICAgICAgICAgICAgICAgMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUA0AMQAGMAAACOBQAALgAAAAABAgMEBAUFBgYGBgcHBwcICAgICAgICAkJCQkJCQkJCgoKCgoKCgoKCgoKCgoKCgsLCwsLCwsLCwsLCwsLCwsMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg4ODg8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8QEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERAAAAAAEBAQECAgICAgICAgMDAwMDAwMDAwMDAwMDAwMEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcAABITFBQVFRYWFhYXFxcXGBgYGBgYGBgZGRkZGRkZGRoaGhoaGhoaGhoaGhoaGhobGxsbGxsbGxsbGxsbGxsbHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwdHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHdADEABjAAAAlgUAABcAAAAAAAgICQkJCQoKCgoKCgoKCwsLCwsLCwsLCwsLCwsLCwwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0N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oQ1DOlxVc2Vyc1xpYWluXC5jYXJnb1xyZWdpc3RyeVxzcmNcZ2l0aHViLmNvbS0xZWNjNjI5OWRiOWVjODIzXGFkbGVyMzItMS4wLjRcc3JjXGxpYi5ycwAAwBYQAFYAAAC3AAAAJQAAAB0AAAAEAAAABAAAAB4AAAAfAAAAIAAAACEAAAAAAAAAAQAAACIAAABjYWxsZWQgYE9wdGlvbjo6dW53cmFwKClgIG9uIGEgYE5vbmVgIHZhbHVlc3JjL2xpYmNvcmUvb3B0aW9uLnJzUBcQACsAAAB7FxAAFQAAAHoBAAAVAAAAIwAAAAwAAAAEAAAAJAAAACUAAAAlAAAAJgAAACcAAAAoAAAAKQAAAEtpbmQqAAAAAQAAAAEAAAArAAAAT3Njb2RlAAAdAAAABAAAAAQAAAAsAAAAa2luZG1lc3NhZ2UAIwAAAAwAAAAEAAAALQAAAC4AAAAQAAAABAAAAC8AAAAwAAAAIwAAAAwAAAAEAAAAMQAAAGVycm9yQ3VzdG9tAB0AAAAEAAAABAAAADIAAAAdAAAABAAAAAQAAAAzAAAAVW5leHBlY3RlZEVvZk90aGVySW50ZXJydXB0ZWRXcml0ZVplcm9UaW1lZE91dEludmFsaWREYXRhSW52YWxpZElucHV0V291bGRCbG9ja0FscmVhZHlFeGlzdHNCcm9rZW5QaXBlQWRkck5vdEF2YWlsYWJsZUFkZHJJblVzZU5vdENvbm5lY3RlZENvbm5lY3Rpb25BYm9ydGVkQ29ubmVjdGlvblJlc2V0Q29ubmVjdGlvblJlZnVzZWRQZXJtaXNzaW9uRGVuaWVkTm90Rm91bmRvcGVyYXRpb24gc3VjY2Vzc2Z1bHNyYy9saWJhbGxvYy9yYXdfdmVjLnJzY2FwYWNpdHkgb3ZlcmZsb3dnGRAAEQAAAFAZEAAXAAAACQMAAAUAAABgLi4AkRkQAAIAAAA6AAAAAAAAAAEAAAA7AAAAaW5kZXggb3V0IG9mIGJvdW5kczogdGhlIGxlbiBpcyAgYnV0IHRoZSBpbmRleCBpcyAAAKwZEAAgAAAAzBkQABIAAABjYWxsZWQgYE9wdGlvbjo6dW53cmFwKClgIG9uIGEgYE5vbmVgIHZhbHVlc3JjL2xpYmNvcmUvb3B0aW9uLnJz8BkQACsAAAAbGhAAFQAAAHoB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EAP/////////+wAQAEH6ycAACw3/////AQAAAAAAAIADAEGPysAACxWAAAAAAP////8AAAAAAPwAAAAAAAYAQa3KwAALB4D3PwAAAMAAQb7KwAALLwMARAgAAGAAAAAwAAAA//8DgAAAAADAPwAAgP8DAAAAAAAHAAAAAADIMwAAAAAgAEH1ysAACzF+ZgAIEAAAAAAAEAAAAAAAAJ3BAgAAAAAwQAAAAAAAICEAAAAAAEAAAAAA//8AAP//AEGvy8AACwcBAAAAAgADAEHQy8AACwQEAAAFAEHcy8AACwEGAEHly8AACz8HAAAICQoACwwNDg8AABAREgAAExQVFgAAFxgZGhsAHAAAAB0AAAAAAAAeHyAhAAAAAAAiACMAJCUmAAAAACcAQZPNwAALAigpAEGlzcAACwIqKwBB2s3AAAsBLABB7c3AAAsFLS4AAC8AQZDOwAALAzAxMgBBqM7AAAsMMwAAACkAAAAAAAA0AEHLzsAACwM1ADYAQejOwAALCDc4AAA4ODg5AEG3z8AACwYgAAAAAAEAQcbPwAALVMAHbvAAAAAAAIcAAAAAYAAAAAAAAADwAAAAwP8BAAAAAAACAAAAAAAA/38AAAAAAACAAwAAAAAAeAYHAAAAgO8fAAAAAAAAAAgAAwAAAAAAwH8AHgBBpdDAAAsagNNAAAAAgPgHAAADAAAAAAAAWAEAgADAHx8AQcfQwAALBf9cAABAAEHW0MAACwP5pQ0AQeXQwAALB4A8sAEAADAAQfbQwAALA/inAQBBhdHAAAsvKL8AAAAA4LwPAAAAAAAAAID/BgAA8AwBAAAA/gcAAAAA+HmAAH4OAAAAAAD8fwMAQb7RwAALE3+/AAD8///8bQAAAAAAAAB+tL8AQdrRwAALAaMAQebRwAALHRgAAAAAAAAAHwAAAAAAAAB/AACAAAAAAAAAAIAHAEGL0sAACwFgAEGU0sAAC0agwwf45w8AAAA8AAAcAAAAAAAAAP///////3/4//////8fIAAQAAD4/v8AAH////nbBwAAAAAAAADwAAAAAH8AAAAAAPAHAEHk0sAACxL///////////////////////8AQdjTwAALDv//////////////////AEGI1MAACwL4AwBBqtTAAAsH/v////+/tgBButTAAAsN/wcAAAAAAPj//wAAAQBB0tTAAAsQwJ+fPQAAAAACAAAA////BwBB7NTAAAuECsD/AQAAAAAAAPgPIFgjEABKAAAAqCUQAAACAACoJxAAOgAAAAABAgMEBQYHCAkICgsMDQ4PEBESExQCFRYXGBkaGxwdHh8gAgICAgICAgICAiECAgICAgICAgICAgICAiIjJCUmAicCKAICAikqKwIsLS4vMAICMQICAjICAgICAgICAjMCAjQCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAjUCNgI3AgICAgICAgI4AjkCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAjo7PAICAgI9AgI+P0BBQkNERUYCAgJHAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAkgCAgICAgICAgICAkkCAgICAjsCAAECAgICAwICAgIEAgUGAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgB7CXByb2R1Y2VycwIIbGFuZ3VhZ2UBBFJ1c3QADHByb2Nlc3NlZC1ieQMFcnVzdGMdMS4zOS4wICg0NTYwZWE3ODggMjAxOS0xMS0wNCkGd2FscnVzBjAuMTMuMAx3YXNtLWJpbmRnZW4SMC4yLjU1IChkYjlkNjAzYzgp";
	
	const wasm_instance_promise = (async () => {
		const { instance } = await WebAssembly.instantiateStreaming(fetch(wasm_binary_string));
		return instance.exports;
	})();
	
	addEventListener("message", async message_event => {
		const { data } = message_event; 
		const inst = await wasm_instance_promise;

		const { operation, blob } = data;
		const buffer = await new Response(blob).arrayBuffer();
		const uint_array = new Uint8Array(buffer);

		let result;
		switch (operation) {
			case "encode":
				result = deflate_encode(inst, uint_array);
				break;
			case "decode":
				result = deflate_decode(inst, uint_array);
				break;
		}

		postMessage(new Blob([result]));
	});

	let cachegetUint8Memory = null;
	function getUint8Memory(wasm) {
			if (cachegetUint8Memory === null || cachegetUint8Memory.buffer !== wasm.memory.buffer) {
					cachegetUint8Memory = new Uint8Array(wasm.memory.buffer);
			}
			return cachegetUint8Memory;
	}

	let WASM_VECTOR_LEN = 0;

	function passArray8ToWasm(wasm, arg) {
			const ptr = wasm.__wbindgen_malloc(arg.length * 1);
			getUint8Memory(wasm).set(arg, ptr / 1);
			WASM_VECTOR_LEN = arg.length;
			return ptr;
	}

	let cachegetInt32Memory = null;
	function getInt32Memory(wasm) {
			if (cachegetInt32Memory === null || cachegetInt32Memory.buffer !== wasm.memory.buffer) {
					cachegetInt32Memory = new Int32Array(wasm.memory.buffer);
			}
			return cachegetInt32Memory;
	}

	function getArrayU8FromWasm(wasm, ptr, len) {
			return getUint8Memory(wasm).subarray(ptr / 1, ptr / 1 + len);
	}

	function deflate_decode(wasm, base_compressed) {
			const retptr = 8;
			const ret = wasm.deflate_decode(retptr, passArray8ToWasm(wasm, base_compressed), WASM_VECTOR_LEN);
			const memi32 = getInt32Memory(wasm);
			const v0 = getArrayU8FromWasm(wasm, memi32[retptr / 4 + 0], memi32[retptr / 4 + 1]).slice();
			wasm.__wbindgen_free(memi32[retptr / 4 + 0], memi32[retptr / 4 + 1] * 1);
			return v0;
	}

	function deflate_encode(wasm, base_raw) {
			const retptr = 8;
			const ret = wasm.deflate_encode(retptr, passArray8ToWasm(wasm, base_raw), WASM_VECTOR_LEN);
			const memi32 = getInt32Memory(wasm);
			const v0 = getArrayU8FromWasm(wasm, memi32[retptr / 4 + 0], memi32[retptr / 4 + 1]).slice();
			wasm.__wbindgen_free(memi32[retptr / 4 + 0], memi32[retptr / 4 + 1] * 1);
			return v0;
	}
`;
const queue = [];
let cached_worker;
function create_worker() {
    const blob = new Blob([worker_string], {
        type: "application/wasm"
    });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);
    worker.addEventListener("message", e => {
        const blob = e.data;
        const resolver = queue.shift();
        resolver(blob);
    });
    return worker;
}
function get_worker() {
    if (!cached_worker)
        cached_worker = create_worker();
    return cached_worker;
}
async function compress$1(input) {
    return new Promise((resolve) => {
        const worker = get_worker();
        worker.postMessage({
            blob: input,
            operation: "encode"
        });
        queue.push(resolve);
    });
}
async function decompress$1(input) {
    return new Promise((resolve) => {
        const worker = get_worker();
        worker.postMessage({
            blob: input,
            operation: "decode"
        });
        queue.push(resolve);
    });
}
ZipArchive.set_compression_function(compress$1);
ZipArchive.set_decompression_function(decompress$1);

export { ZipArchive, ZipEntry };
