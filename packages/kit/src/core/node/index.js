/**
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<string | Uint8Array>}
 */
export function getRawBody(req) {
	return new Promise((fulfil, reject) => {
		const h = req.headers;

		if (!h['content-type']) {
			return fulfil(null);
		}

		req.on('error', reject);

		const length = Number(h['content-length']);

		/** @type {Uint8Array} */
		let data;

		if (!isNaN(length)) {
			data = new Uint8Array(length);

			let i = 0;

			req.on('data', (chunk) => {
				data.set(chunk, i);
				i += chunk.length;
			});
		} else {
			// https://github.com/jshttp/type-is/blob/c1f4388c71c8a01f79934e68f630ca4a15fffcd6/index.js#L81-L95
			if (h['transfer-encoding'] === undefined) {
				return fulfil(null);
			}

			data = new Uint8Array(0);

			req.on('data', (chunk) => {
				const new_data = new Uint8Array(data.length + chunk.length);
				new_data.set(data);
				new_data.set(chunk, data.length);
				data = new_data;
			});
		}

		req.on('end', () => {
			const [type] = h['content-type'].split(/;\s*/);

			if (type === 'application/octet-stream') {
				return fulfil(data);
			}

			const encoding = h['content-encoding'] || 'utf-8';
			fulfil(new TextDecoder(encoding).decode(data));
		});
	});
}
