import { assert } from "../utils/assert"
import { HEADER_CD, ZIP_VERSION } from "../constants"
import { decode_utf8_string, encode_utf8_string } from "../utils/string"

interface CD_Block {
  version: number
  min_version: number
  flag: number
  compression: number
  time: number
  date: number
  crc: number
  compressed_size: number
  uncompressed_size: number
  disk: number
  internal: number
  external: number
  local_position: number
  file_name: string
  extra: Uint8Array
  comment: Uint8Array
}
/**
 * 4 bytes - Central directory header signature
 * 2 bytes - Version made by
 * 2 bytes - Minimum require version
 * 2 bytes - Bit flag
 * 2 bytes - Compression method
 * 2 bytes - Last modified time
 * 2 bytes - Last modified date
 * 4 bytes - CRC
 * 4 bytes - Compressed size
 * 4 bytes - Uncompressed size
 * 2 bytes - Filename length
 * 2 bytes - Extra field length
 * 2 bytes - File comment length
 * 2 bytes - Disk number
 * 2 bytes - Internal file attribute
 * 4 bytes - External file attribute
 * 4 bytes - Local position
 * N bytes - Filename
 * M bytes - Extra field
 * K bytes - File comment
 */

export function read_cd(view: DataView, position: number): CD_Block {
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
    comment
  }
}

export function write_cd(cd: CD_Block): ArrayBuffer {
  const encoded_filename = encode_utf8_string(cd.file_name);

  const N = encoded_filename.length;
  const M = cd.extra.length;
  const K = cd.comment.length;
  const length = 46 + M + N + K;

  const buffer = new ArrayBuffer(length);
  const view = new DataView(buffer);
  const uintview = new Uint8Array(buffer);
  
  view.setUint32(0, HEADER_CD, true);
  view.setUint16(4, ZIP_VERSION, true);
  view.setUint16(6, ZIP_VERSION, true);
  view.setUint16(8, cd.flag & 0xFFFF, true);
  view.setUint16(10, cd.compression, true);
  view.setUint16(12, cd.time, true);
  view.setUint16(14, cd.date, true);
  view.setUint32(16, cd.crc, true);
  view.setUint32(20, cd.compressed_size, true);
  view.setUint32(24, cd.uncompressed_size, true);
  view.setUint16(28, N, true);
  view.setUint16(30, M, true);
  view.setUint16(32, K, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, cd.internal & 0xFFFF, true);
  view.setUint32(38, cd.external & 0xFFFFFFFF, true);
  view.setUint32(42, cd.local_position, true);
  
  uintview.set(encoded_filename, 46);
  uintview.set(cd.extra, 46 + N);
  uintview.set(cd.comment, 46 + N + M);
  
  return buffer;
}