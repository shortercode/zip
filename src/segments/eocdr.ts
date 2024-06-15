import { assert } from "../utils/assert"
import { HEADER_EOCDR } from "../constants";

interface EOCDR {
  disk: number
  start_disk: number
  disk_entries: number
  total_entries: number
  cd_length: number
  cd_offset: number
  comment: Uint8Array
}
/**
 * 4 bytes - End of Central directory header signature
 * 2 bytes - Number of disk
 * 2 bytes - Disk where Central directory starts
 * 2 bytes - Number of Central directory records on this disk
 * 2 bytes - Total number of Central Directory records
 * 4 bytes - Size of Central Directory
 * 4 bytes - Location of Central Directory
 * 2 bytes - Comment length
 * N bytes - Comment
 */

export function write_eocdr(eocdr: EOCDR) {		
  const length = 22 + eocdr.comment.length;
  const buffer = new ArrayBuffer(length);
  const view = new DataView(buffer);
  const uintview = new Uint8Array(buffer);
      
  view.setUint32(0, HEADER_EOCDR, true);
  view.setUint16(4, eocdr.disk, true);
  view.setUint16(6, eocdr.start_disk, true);
  view.setUint16(8, eocdr.disk_entries, true);
  view.setUint16(10, eocdr.total_entries, true);
  view.setUint32(12, eocdr.cd_length, true);
  view.setUint32(16, eocdr.cd_offset, true);
  view.setUint16(20, eocdr.comment.length, true);
  
  uintview.set(eocdr.comment, 22);
  
  return buffer;
}

export function read_eocdr(view: DataView, position: number): EOCDR {
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

  const comment = new Uint8Array(view.buffer, position + 22, comment_length);

  return {
    disk,
    start_disk,
    disk_entries,
    total_entries,
    cd_length,
    cd_offset,
    comment
  }
}

export function find_eocdr(view: DataView) {
  const length = view.byteLength;
		
  // NOTE min size of EOCDR is 22 bytes
  for (let i = 22; i < 0xFFFF; i++) {
    // NOTE we read backwards until we find the header
    const position = length - i;
    if (view.getUint32(position, true) == HEADER_EOCDR) {
      return position;
    }
  }
  
  throw new Error("No end of central directory record found");
}