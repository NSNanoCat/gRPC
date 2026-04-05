# gRPC

Pure JS gRPC encode/decode helpers for well-known iOS network tools.

## API

### decode(bytesBody)

Decode the existing raw gRPC binary frame used by this package and return protobuf body bytes.

### encode(body, encoding)

Encode protobuf body bytes into the existing raw gRPC binary frame used by this package.

### decodeWeb(bytesBody)

Decode a grpc-web binary unary response body and return:

```js
{
	header: {
		"grpc-status": "0"
	},
	bodyBytes: Uint8Array
}
```

`header` contains the key-value pairs parsed from the grpc-web trailer frame. `bodyBytes` contains the protobuf payload after optional gzip decompression.

## Limitations

- `decodeWeb` only supports grpc-web binary unary responses.
- `decodeWeb` does not support grpc-web-text.
- `decodeWeb` treats trailer metadata from the body trailer frame as `header`; it does not parse transport-level HTTP response headers.
