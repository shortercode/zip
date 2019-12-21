# Web Helper
This is an experimental helper that uses the CompressionStream proposal. At the moment this is quite theoretical as the API is only supported in Chrome canary, and it doesn't implement "deflate-raw". Which is unfortunately the compression format commonly used with the Zip format.

However, if/once it's supported it should be performant and make the library very small compared to similar libraries.