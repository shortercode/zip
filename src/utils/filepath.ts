import { assert } from "./assert"

/**
 * 
 * @param {string} file_name 
 * @returns {string}
 */
export function normalise_file_name(file_name: string) {
  const slash_regex = /[\\|/]/g
  return file_name.replace(slash_regex, "/")
}

/**
 * 
 * @param {string} name
 */
export function verify_path(name: string) {
  const slash_regex = /[\\|/]/g
  const part_regex = /^[^/\0]+$/
  const parts = name.split(slash_regex)
  
  // NOTE disallows absolute paths and ".."/"." path components
  for (const part of parts) {
    assert(part_regex.test(part) || part === ".." || part === ".", `Invalid path "${name}"`)
  }
}