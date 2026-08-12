import { $app, Console } from "@nsnanocat/util";
import pako from "pako";

const TEXT_DECODER = new TextDecoder();

/**
 * 用于编码与解码二进制 gRPC 和 gRPC-Web 帧的辅助工具。
 *
 * Helpers for encoding and decoding binary gRPC and gRPC-Web frames.
 *
 * @see https://grpc.io/
 */
export default class gRPC {
	/**
	 * 解码单个二进制 gRPC 帧，并在压缩标志要求时解压 gzip 负载。
	 *
	 * Decodes a single binary gRPC frame and decompresses a gzip payload when
	 * required by the compression flag.
	 *
	 * @param {Uint8Array} [bytesBody=new Uint8Array()] 带帧结构的 gRPC 消息。 The framed gRPC message.
	 * @returns {Uint8Array} 去除帧结构后的 protobuf 负载。 The unframed protobuf payload.
	 */
	static decode(bytesBody = new Uint8Array([])) {
		Console.log("☑️ gRPC.decode");
		// 先拆分gRPC校验头和protobuf数据体
		const Header = bytesBody.slice(0, 5);
		let body = bytesBody.slice(5);
		switch (Header[0]) {
			case 0: // unGzip
			default:
				break;
			case 1: // Gzip
				body = gRPC.#ungzip(body); // 解压缩protobuf数据体
				Header[0] = 0; // unGzip
				break;
		}
		Console.log("✅ gRPC.decode");
		return body;
	}

	/**
	 * 解码包含一个数据帧和可选末尾 trailer 帧的二进制一元 gRPC-Web 响应。
	 *
	 * Decodes a binary unary gRPC-Web response containing one data frame and an
	 * optional final trailer frame.
	 *
	 * @param {Uint8Array} [bytesBody=new Uint8Array()] 完整的 gRPC-Web 响应体。 The complete gRPC-Web response body.
	 * @returns {{header: Record<string, string>, bodyBytes: Uint8Array}} 解析后的 trailer 标头与 protobuf 负载。 The parsed trailer headers and protobuf payload.
	 * @throws {Error} 当帧格式错误、使用不支持的标志、包含多个数据帧，或 trailer 不在末尾时抛出。 Thrown when a frame is malformed, uses an unsupported flag, contains multiple data frames, or places a trailer before the end.
	 */
	static decodeWeb(bytesBody = new Uint8Array([])) {
		Console.log("☑️ gRPC.decodeWeb");
		// 解析 grpc-web binary unary 响应，返回 trailer header 和 protobuf bodyBytes
		const header = {};
		let bodyBytes = new Uint8Array([]);
		let dataFrameCount = 0;
		let offset = 0;
		while (offset < bytesBody.length) {
			// grpc-web frame: 1 byte flag + 4 bytes big-endian length + frame payload
			if (offset + 5 > bytesBody.length) throw new Error("Invalid gRPC-Web frame header");
			const frameFlag = bytesBody[offset];
			const frameLength = gRPC.#ReadUInt32(bytesBody, offset + 1);
			offset += 5;
			if (offset + frameLength > bytesBody.length) throw new Error("Invalid gRPC-Web frame length");
			let frameBody = bytesBody.slice(offset, offset + frameLength);
			offset += frameLength;
			const isTrailer = (frameFlag & 0x80) === 0x80;
			const isCompressed = (frameFlag & 0x01) === 0x01;
			if ((frameFlag & 0x7e) !== 0) throw new Error(`Unsupported gRPC-Web frame flag: ${frameFlag}`);
			if (isTrailer) {
				// unary 响应里 trailer frame 必须是最后一帧，内部是 CRLF 分隔的 header block
				if (offset !== bytesBody.length) throw new Error("Invalid gRPC-Web response: trailer frame must be last");
				if (isCompressed) frameBody = gRPC.#ungzip(frameBody);
				Object.assign(header, gRPC.#parseHeaderBlock(frameBody));
				continue;
			}
			// 当前只支持 unary，因此只接受一个 data frame，并把它解成 protobuf body
			if (dataFrameCount > 0) throw new Error("Invalid gRPC-Web unary response: multiple data frames");
			dataFrameCount += 1;
			bodyBytes = isCompressed ? gRPC.#ungzip(frameBody) : frameBody;
		}
		Console.log("✅ gRPC.decodeWeb");
		return { header, bodyBytes };
	}

	/**
	 * 将 protobuf 负载编码为单个二进制 gRPC 帧。
	 *
	 * Encodes a protobuf payload as a single binary gRPC frame.
	 *
	 * @param {Uint8Array} [body=new Uint8Array()] protobuf 负载。 The protobuf payload.
	 * @param {"identity" | "gzip"} [encoding="identity"] 负载编码方式。 The payload encoding.
	 * @returns {Uint8Array} 带帧结构的 gRPC 消息。 The framed gRPC message.
	 */
	static encode(body = new Uint8Array([]), encoding = "identity") {
		Console.log("☑️ gRPC.encode");
		// Header: 1位：是否校验数据 （0或者1） + 4位:校验值（数据长度）
		const Header = new Uint8Array(5);
		const Checksum = gRPC.#Checksum(body.length); // 校验值为未压缩情况下的数据长度, 不是压缩后的长度
		Header.set(Checksum, 1); // 1-4位： 校验值(4位)
		switch (encoding) {
			case "gzip":
				Header.set([1], 0); // 0位：Encoding类型，当为1的时候, app会校验1-4位的校验值是否正确
				body = pako.gzip(body);
				break;
			case "identity":
			case undefined:
			default:
				Header.set([0], 0); // 0位：Encoding类型，当为1的时候, app会校验1-4位的校验值是否正确
				break;
		}
		const BytesBody = new Uint8Array(Header.length + body.length);
		BytesBody.set(Header, 0); // 0-4位：gRPC校验头
		BytesBody.set(body, 5); // 5-end位：protobuf数据
		Console.log("✅ gRPC.encode");
		return BytesBody;
	}

	static #ungzip = (body = new Uint8Array([])) => {
		switch ($app) {
			case "Loon":
			case "Surge":
			case "Egern":
				return $utils.ungzip(body);
			default:
				return pako.ungzip(body);
		}
	};

	static #ReadUInt32 = (bytes = new Uint8Array([]), offset = 0) => {
		const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
		return view.getUint32(0, false);
	};

	static #parseHeaderBlock = (bytes = new Uint8Array([])) => {
		const text = TEXT_DECODER.decode(bytes);
		const header = {};
		for (const line of text.split("\r\n")) {
			if (!line) continue;
			const separatorIndex = line.indexOf(":");
			if (separatorIndex <= 0) continue;
			const key = line.slice(0, separatorIndex).trim().toLowerCase();
			const value = line.slice(separatorIndex + 1).trim();
			if (!key) continue;
			header[key] = key in header ? `${header[key]}, ${value}` : value;
		}
		return header;
	};

	// 计算校验和 (B站为数据本体字节数)
	static #Checksum = (num = 0) => {
		const array = new ArrayBuffer(4); // an Int32 takes 4 bytes
		const view = new DataView(array);
		// 首位填充计算过的新数据长度
		view.setUint32(0, num, false); // byteOffset = 0; litteEndian = false
		return new Uint8Array(array);
	};
}
