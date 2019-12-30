# ZIP
A modern TypeScript library for creating, reading and editing ZIP archives in a client side environment. 

## Installing
The latest builds can be found in the "dist" folder. 2 versions are available: "zip_default.js" which includes support for compression/decompression, and "zip_store_only.js" which can only read/write uncompressed files within a zip archive.

The code required for compression is quite substantial, hence why an alternative version is available without it.

A version with typings will be published to NPM soon.

## Usage

The library is based on 2 classes ZipArchive and ZipEntry. ZipArchive is the primary interface, with ZipEntry instances being created and manipulated via the ZipArchive instance.

### Checking the existance of an entry in an archive
`ZipArchive.prototype.has(file_name: string): boolean`

The `has()` method returns a boolean indicating whether a ZipEntry with the specified file name exists or not.

```javascript
import { ZipArchive } from "./zip.js";

const archive = new ZipArchive;
await archive.set("hello.txt", "hello world");

console.log(archive.has("hello.txt"));
// expected output: true
console.log(archive.has("avatar.png"));
// expected output: false
```

### Getting an entry from an archive for an existing file 
`ZipArchive.prototype.get(file_name: string): ZipEntry | undefined`

The `get()` method returns a ZipEntry if one with a matching file name is present, otherwise it will return undefined.

```javascript
import { ZipArchive } from "./zip.js";

const archive = new ZipArchive;
await archive.set("hello.txt", "hello world");

console.log(archive.get("hello.txt"));
// expected output: ZipEntry
console.log(archive.get("avatar.png"));
// expected output: undefined
```

### Creating or updating an entry within an archive
`ZipArchive.prototype.set(file_name: string, file: Blob): Promise<ZipEntry>`

The `set()` method adds or replaces a ZipEntry with a new entry created from a specific file name and a Blob. It is asyncronous, and returns a Promise that resolves to the new ZipEntry object.

```javascript
import { ZipArchive } from "./zip.js";

const archive = new ZipArchive;
await archive.set("hello.txt", "hello world");

console.log(await archive.get("hello.txt").get_string());
// expected output: "hello world"
```

### Deleting an entry within an archive
`ZipArchive.prototype.delete(file_name: string): boolean`

The `delete()` method deletes a ZipEntry within an archive. If used on a folder this will delete the folder entry, but not the contents of the folder as the actual folder entry is optional. If an entry is deleted then this method will return true, otherwise it will return false.

```javascript
import { ZipArchive } from "./zip.js";

const archive = new ZipArchive;
await archive.set("hello.txt", "hello world");

console.log(archive.has("hello.txt"));
// expected output: true
archive.delete("hello.txt");
console.log(archive.has("hello.txt"));
// expected output: false
```

### Create a folder
`ZipArchive.prototype.set_folder(file_name: string): ZipEntry`

The `set_folder()` method creates a new empty ZipEntry representing a folder and returns the ZipEntry instance. If a folder already exists no new entry will be created, and the existing one will be returned. If a file entry exists in the location this will throw an error. 

Creating entries for folders is optional. Entries are relative to the root of the archive, hence filepaths can imply the existence of a folder.

```javascript
import { ZipArchive } from "./zip.js";

const archive = new ZipArchive;
archive.set_folder("folder");
console.log(archive.has("folder"));
// expected output: true
```

### Compress an existing entry in an archive
`ZipArchive.prototype.compress_entry(file_name: string): Promise<ZipEntry>`

The `compress_entry()` method replaces an existing ZipEntry with a promise that resolves to a new ZipEntry containing the contents of the old entry compressed using the deflate algorithm.

```javascript
import { ZipArchive } from "./zip.js";

const archive = new ZipArchive;
await archive.set("hello.txt", "hello world");

await archive.compress_entry("hello.txt");
// expected output: ZipEntry
```

### Serialising an archive
`ZipArchive.prototype.to_blob(): Blob`

The `to_blob()` method serializes the ZipArchive in the Zip format and returns the result as a blob.

```javascript
import { ZipArchive } from "./zip.js";

const archive = new ZipArchive;
await archive.set("hello.txt", "hello world");

const blob = archive.to_blob();
// expected output: Blob
```

### List the entries of an archive
`ZipArchive.prototype.files(): Iterator<[file_name: string, entry: ZipEntry]>`

The `files()` method returns a new iterator object that contains `[file_name, entry]` pairs for each ZipEntry in the archive in insertion order. 

```javascript
import { ZipArchive } from "./zip.js";

const archive = new ZipArchive;
await archive.set("hello.txt", "hello world");
await archive.set("data.bin", new Uint8Array(1024));

console.log(iterator1.next().value);
// expected output: ["hello.txt", ZipEntry]

console.log(iterator1.next().value);
// expected output: ["data.bin", ZipEntry]
```

### Reading an archive
`ZipArchive.from_blob(zip_file: Blob): Promise<ZipArchive>`

The `from_blob()` method returns a new promise that resolves to a ZipArchive created from a Zip file passed in as a blob.

```javascript
import { ZipArchive } from "./zip.js";

const input_element = document.querySelector("input[type=file]");

input_element.addEventListener("change", async e => {
  const archive = await ZipArchive.from_blob(e.files[0]);
  // expected output: ZipArchive
});
```

### Properties of a ZipEntry

`ZipEntry.prototype.compressed_size: number`
The **readonly** size of the entry in bytes, if the entry is not compressed then it will be the same as the uncompressed_size.

`ZipEntry.prototype.uncompressed_size: number`
The **readonly** full size of the entry in bytes ( as if it was decompressed ), if the entry is not compressed then it will be the same as the compressed_size.

`ZipEntry.prototype.size: number`

An alias for uncompressed_size.

`ZipEntry.prototype.is_compressed: boolean`

A **readonly** boolean value denoting if the entry is compressed or not.

`ZipEntry.prototype.compression: number`

A **readonly** numerical value denoting the type of compression used by the entry. 0 being no compression and 8 being DEFLATE which is the standard compression type for entries within a zip file. The library does not support compressing an entry with anything other than DEFLATE, or reading the contents of a entry that is compressed with something other than DEFLATE. However, you read and modify the properties of the entry with other compression types.

`ZipEntry.prototype.modified: Date`

The last modified date of the entry, as a JS Date object. This value is mutable, and will be written to the output when serialising a ZipArchive to a blob.

`ZipEntry.prototype.internal_file_attr: number`
`ZipEntry.prototype.external_file_attr: number`

The internal/external file attributes flags for the entry. These values are mutable, and preserved when reading/writing.

```javascript
import { ZipArchive } from "./zip.js";

const archive = new ZipArchive;
await archive.set("hello.txt", "hello world");

const compressed_entry = await archive.compress_entry("hello.txt");

console.log(compressed_entry.compressed_size);
// expected output: 11
console.log(compressed_entry.uncompressed_size);
// expected output: 13
console.log(compressed_entry.size);
// expected output: 13
console.log(compressed_entry.is_compressed);
// expected output: true
console.log(compressed_entry.compression);
// expected output: 8
console.log(compressed_entry.modified);
// expected output: Date
console.log(compressed_entry.internal_file_attr);
// expected output: 0
console.log(compressed_entry.external_file_attr);
// expected output: 0
```

### Reading the contents of a ZipEntry

`ZipEntry.prototype.get_blob(): Promise<Blob>`

The `get_blob()` method return a Promise that resolves to a Blob containing the uncompressed contents of the ZipEntry. If the entry is not DEFLATE or STORE then this method will throw an error.

`ZipEntry.prototype.get_array_buffer(): Promise<ArrayBuffer>`

The `get_array_buffer()` method return a Promise that resolves to a ArrayBuffer containing the uncompressed contents of the ZipEntry. If the entry is not DEFLATE or STORE then this method will throw an error.

`ZipEntry.prototype.get_string(): Promise<string>`

The `get_string()` method return a Promise that resolves to a string of the uncompressed contents of the ZipEntry decoded as UTF-8 text. If the entry is not DEFLATE or STORE then this method will throw an error.
