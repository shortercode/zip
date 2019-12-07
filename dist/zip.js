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
function compress(buffer) {
    assert(compression_function !== null, "Compression function not specified");
    return compression_function(buffer);
}
function decompress(buffer) {
    assert(decompression_function !== null, "Decompression function not specified");
    return decompression_function(buffer);
}

function read_blob(blob) {
    return new Promise((resolve, reject) => {
        const fileReader = new FileReader();
        fileReader.onload = () => resolve(fileReader.result);
        fileReader.onerror = () => reject(fileReader.error);
        fileReader.readAsArrayBuffer(blob);
    });
}

const ZIP_VERSION = 20;
const inflated_entries = new WeakMap;
class ZipEntry {
    constructor(blob, isCompressed, size) {
        this.compressed = isCompressed;
        this.blob = blob;
        this.uncompressed_size = size;
    }
    get compressed_size() {
        return this.blob.size;
    }
    async decompress() {
        const existing = inflated_entries.get(this.blob);
        if (existing)
            return existing;
        else {
            const result = await decompress(await read_blob(this.blob));
            const new_blob = new Blob([result]);
            inflated_entries.set(this.blob, new_blob);
            return new_blob;
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
        view.setUint32(0, HEADER_LOCAL, true);
        view.setUint16(4, ZIP_VERSION, true);
        view.setUint16(6, 0, true);
        view.setUint16(8, this.compressed ? 8 : 0, true);
        view.setUint16(10, 0, true);
        view.setUint16(12, 0, true);
        view.setUint32(16, 0, true);
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
        view.setUint32(0, HEADER_CD, true);
        view.setUint16(4, ZIP_VERSION, true);
        view.setUint16(6, ZIP_VERSION, true);
        view.setUint16(8, 0, true);
        view.setUint16(10, this.compressed ? 8 : 0, true);
        view.setUint16(12, 0, true);
        view.setUint16(14, 0, true);
        view.setUint32(16, 0, true);
        view.setUint32(20, this.compressed_size, true);
        view.setUint32(24, this.uncompressed_size, true);
        view.setUint16(28, encoded_filename.length, true);
        view.setUint16(30, M, true);
        view.setUint16(32, K, true);
        view.setUint16(34, 0, true);
        view.setUint16(36, 0, true);
        view.setUint32(38, 0, true);
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
        if (this.compressed)
            return this.decompress();
        else
            return this.blob;
    }
}

function NOT_IMPLEMENTED(name) {
    throw new Error(`${name} is not implemented`);
}
class ZipArchive {
    constructor() {
        this.entries = new Map;
    }
    has(name) {
        this.verify_path(name);
    }
    get(name) {
        this.verify_path(name);
        return this.entries.get(name);
    }
    set(name, file) {
        this.verify_path(name);
        const entry = new ZipEntry(file, false, file.size);
        this.entries.set(name, entry);
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
    async compress_entry(name) {
        const entry = this.get(name);
        if (!entry)
            throw new Error(`Entry ${name} does not exist`);
        if (!entry.compressed) {
            const blob = await entry.get_blob();
            const original_size = blob.size;
            const deflated_blob = await this.compress_blob(blob);
            const new_entry = new ZipEntry(deflated_blob, true, original_size);
            this.entries.set(name, new_entry);
            return new_entry;
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
        const buffer = await read_blob(blob);
        const view = new DataView(buffer);
        const eocdr_position = this.find_eocdr(view);
        const eocdr = this.read_eocdr(view, eocdr_position);
        let position = 0;
        const offset = eocdr.cd_offset;
        const length = eocdr.cd_length;
        while (position < length) {
            const signature = view.getUint32(position + offset, true);
            assert(signature === HEADER_CD, "");
            const entry = this.read_cd(view, position + offset);
            position += entry.size;
            if (entry.file_name.endsWith("/")) ;
            else {
                const { data_location } = this.read_local(view, entry.local_position);
                const { uncompressed_size, compressed_size, compression, file_name } = entry;
                const subblob = blob.slice(data_location, data_location + compressed_size);
                const is_compressed = compression == 8;
                if (is_compressed) {
                    archive.set_compressed(file_name, subblob, uncompressed_size);
                }
                else {
                    archive.set(file_name, subblob);
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
    set_compressed(name, file, uncompressed_size) {
        const entry = new ZipEntry(file, true, uncompressed_size);
        this.entries.set(name, entry);
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
        const buffer = await read_blob(file);
        const result = await compress(buffer);
        const new_blob = new Blob([result]);
        return new_blob;
    }
}

export { ZipArchive };
