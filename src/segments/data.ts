import { HEADER_DATA_DESCRIPTOR } from "../constants";

export function write_data(crc: number, size: number, compressed_size: number) {
  const length = 16;
  const buffer = new ArrayBuffer(length);
  const view = new DataView(buffer);
  
  view.setUint32(0, HEADER_DATA_DESCRIPTOR, true);
  view.setUint32(4, crc, true);
  view.setUint32(8, compressed_size, true);
  view.setUint32(12, size, true);
  
  return buffer;
}

export function read_data(view: DataView, position: number) {
  // TODO
}