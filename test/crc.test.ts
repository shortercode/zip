import {expect, test} from '@jest/globals';

import { crc32 } from "../src/crc32";

describe('crc module', () => {
	test('crc for a simple string is correct', async () => {
		const something = "something";
		var blob = new Blob([something], {
			type: 'text/plain'
		});

		const buffer = await new Response(blob).arrayBuffer();
		const bytes = new Uint8Array(buffer);

		expect(crc32(bytes)).toBe(0x9DA31FB);
	});
});
