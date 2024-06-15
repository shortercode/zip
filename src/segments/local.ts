import { assert } from "../utils/assert"
import { HEADER_LOCAL, ZIP_VERSION } from "../constants"

interface Local {
  signature: number
  version: number
  flag: number
  compression: number
  time: number
  date: number
  crc: number
  compressed_size: number
  uncompressed_size: number
  filename_length: number
  extra_length: number
  filename: Uint8Array
  extra: Uint8Array
}

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

export function write_local(local: Local) {
  const N = local.filename.length;
  const M = local.extra.length;
  const length = 30 + N + M;

  const buffer = new ArrayBuffer(length);
  const view = new DataView(buffer);
  const uintview = new Uint8Array(buffer);

  view.setUint32(0, HEADER_LOCAL, true);
  view.setUint16(4, ZIP_VERSION, true);
  view.setUint16(6, local.flag, true);
  view.setUint16(8, local.compression, true);
  view.setUint16(10, local.time, true);
  view.setUint16(12, local.date, true);

  // NOTE set CRC, CSIZE & UCSIZE to 0 if the 3rd bit of the bit flag is set
  // as the information is included in the data descriptor instead
  if (!(local.flag & 0b1000)) {
    view.setUint32(16, local.crc, true);
    view.setUint32(20, local.compressed_size, true);
    view.setUint32(24, local.uncompressed_size, true);
  }

  view.setUint16(26, local.filename.length, true);
  view.setUint16(28, M, true);

  uintview.set(local.filename, 30);
  uintview.set(local.extra, 30 + N);

  // might be a 12 - 16 byte footer here, depending on the value of flag

  return buffer;
}

export function read_local(view: DataView, position: number): Local {
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
  const filename = new Uint8Array(view.buffer, position + 30, name_length);
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
    filename,
    extra,
    data_location
  };
}