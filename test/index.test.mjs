import test from "node:test";
import assert from "node:assert/strict";
import pako from "pako";

import gRPC from "../index.mjs";

const textEncoder = new TextEncoder();

const makeFrame = (flag, payload) => {
	const frame = new Uint8Array(5 + payload.length);
	frame[0] = flag;
	new DataView(frame.buffer).setUint32(1, payload.length, false);
	frame.set(payload, 5);
	return frame;
};

const concatBytes = (...chunks) => {
	const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
	const bytes = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.length;
	}
	return bytes;
};

test("decode keeps existing grpc identity behavior", () => {
	const body = new Uint8Array([10, 20, 30, 40]);
	const encoded = gRPC.encode(body);
	assert.deepEqual(Array.from(gRPC.decode(encoded)), Array.from(body));
});

test("decode keeps existing grpc gzip behavior", () => {
	const body = new Uint8Array([1, 2, 3, 4, 5, 6]);
	const encoded = gRPC.encode(body, "gzip");
	assert.deepEqual(Array.from(gRPC.decode(encoded)), Array.from(body));
});

test("decodeWeb returns bodyBytes and header for grpc-web unary response", () => {
	const body = new Uint8Array([8, 1, 18, 3, 102, 111, 111]);
	const trailer = textEncoder.encode("grpc-status: 0\r\ngrpc-message: ok\r\n");
	const response = concatBytes(makeFrame(0x00, body), makeFrame(0x80, trailer));
	const decoded = gRPC.decodeWeb(response);
	assert.deepEqual(Array.from(decoded.bodyBytes), Array.from(body));
	assert.deepEqual(decoded.header, {
		"grpc-status": "0",
		"grpc-message": "ok",
	});
});

test("decodeWeb ungzips compressed grpc-web data frame", () => {
	const body = new Uint8Array([18, 5, 104, 101, 108, 108, 111]);
	const trailer = textEncoder.encode("grpc-status: 0\r\n");
	const response = concatBytes(makeFrame(0x01, pako.gzip(body)), makeFrame(0x80, trailer));
	const decoded = gRPC.decodeWeb(response);
	assert.deepEqual(Array.from(decoded.bodyBytes), Array.from(body));
	assert.equal(decoded.header["grpc-status"], "0");
});

test("decodeWeb supports trailers-only grpc-web response", () => {
	const trailer = textEncoder.encode("grpc-status: 0\r\n");
	const decoded = gRPC.decodeWeb(makeFrame(0x80, trailer));
	assert.deepEqual(Array.from(decoded.bodyBytes), []);
	assert.deepEqual(decoded.header, { "grpc-status": "0" });
});

test("decodeWeb rejects invalid grpc-web frame length", () => {
	const invalid = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x02, 0x01]);
	assert.throws(() => gRPC.decodeWeb(invalid), /Invalid gRPC-Web frame length/);
});

test("decodeWeb rejects multiple data frames in unary mode", () => {
	const first = makeFrame(0x00, new Uint8Array([1]));
	const second = makeFrame(0x00, new Uint8Array([2]));
	assert.throws(() => gRPC.decodeWeb(concatBytes(first, second)), /multiple data frames/);
});
