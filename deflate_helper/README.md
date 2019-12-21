# Deflate Helper
This is used in the default build. It's a simple wrapper around the flate2 crate compiled to WASM. 

Encoding using DEFLATE is quite computationally expensive, hence this is done in a worker so as not to block the main thread. For ease of use the worker is embedded into the file as a string, which is then loaded via a blob URL. The WASM binary is stored as a data URI within the worker string. These 2 measures remove the need for loading 2 additional files at runtime, which can be awkward to embed in builds. Storing the binary as a base64 string does increase the size of the library by about 25KB unfortunately.

It would appear that flate2 is based on another crate called miniz_oxide, further reductions in size could be gained by using that instead.