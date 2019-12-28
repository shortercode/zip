const HEADER_CD = 0x02014b50;
const HEADER_LOCAL = 0x04034b50;
const HEADER_EOCDR = 0x06054b50;

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
        this.blob = blob;
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
        return this.blob.size;
    }
    async decompress() {
        const existing = inflated_entries.get(this.blob);
        if (existing)
            return existing;
        else {
            const result = await decompress(this.blob);
            inflated_entries.set(this.blob, result);
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
        view.setUint32(16, this.crc, true);
        view.setUint32(20, this.compressed_size, true);
        view.setUint32(24, this.uncompressed_size, true);
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
    get_backing_object() {
        return this.blob;
    }
    async get_blob() {
        if (this.compression === 8)
            return this.decompress();
        assert(this.compression === 0, "Incompatible compression type");
        return this.blob;
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
        this.verify_path(file_name);
        return this.entries.has(this.normalise_file_name(file_name));
    }
    get(file_name) {
        this.verify_path(file_name);
        return this.entries.get(this.normalise_file_name(file_name));
    }
    async set(file_name, file) {
        this.verify_path(file_name);
        file = file instanceof Blob ? file : new Blob([file]);
        const crc = await this.calculate_crc(file);
        return this.set_internal(file_name, file, 0, file.size, crc);
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
            return this.set_internal(file_name, deflated_blob, 8, original_size, entry.crc);
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
            }
            else {
                const { data_location } = this.read_local(view, entry.local_position);
                const { uncompressed_size, compressed_size, compression, flag, file_name, internal, external, crc } = entry;
                const subblob = blob.slice(data_location, data_location + compressed_size);
                const zip_entry = archive.set_internal(file_name, subblob, compression, uncompressed_size, crc);
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
        const nameLength = view.getUint16(position + 26, true);
        const fieldLength = view.getUint16(position + 28, true);
        const file_name = decode_utf8_string(view.buffer, position + 30, nameLength);
        const field = new Uint8Array(view.buffer, position + 30 + nameLength, fieldLength);
        const data_location = position + 30 + nameLength + fieldLength;
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
    static find_eocdr(view) {
        const length = view.byteLength;
        let position = length - 4;
        while (position--) {
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
        const part_regex = /^[\w\-. ]+$/;
        const parts = name.split(slash_regex);
        for (const part of parts) {
            assert(part_regex.test(part) || part === ".." || part === ".", `Invalid path "${name}"`);
        }
    }
    async compress_blob(file) {
        return await compress(file);
    }
}

export { ZipArchive, ZipEntry };
