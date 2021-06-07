import fs from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import compression from 'compression';
import compressible from 'compressible';
import polka from 'polka';
import sirv from 'sirv';
import { getRawBody } from '@sveltejs/kit/node'; // eslint-disable-line import/no-unresolved
import '@sveltejs/kit/install-fetch'; // eslint-disable-line import/no-unresolved

// App is a dynamic file built from the application layer.

const __dirname = dirname(fileURLToPath(import.meta.url));
const noop_handler = (_req, _res, next) => next();
const paths = {
	assets: join(__dirname, '/assets'),
	prerendered: join(__dirname, '/prerendered')
};

export function createServer({ render }) {
	const mutable = (dir) =>
		sirv(dir, {
			etag: true,
			maxAge: 0
		});

	const prerendered_handler = fs.existsSync(paths.prerendered)
		? mutable(paths.prerendered)
		: noop_handler;

	const assets_handler = fs.existsSync(paths.assets)
		? sirv(paths.assets, {
				maxAge: 31536000,
				immutable: true
		  })
		: noop_handler;

	const server = polka().use(
		compression({ threshold: 0 }),
		assets_handler,
		prerendered_handler,
		async (req, res) => {
			const parsed = new URL(req.url || '', 'http://localhost');
			const rendered = await render({
				method: req.method,
				headers: req.headers, // TODO: what about repeated headers, i.e. string[]
				path: parsed.pathname,
				rawBody: await getRawBody(req),
				query: parsed.searchParams
			});

			if (rendered) {
				res.writeHead(rendered.status, rendered.headers);
				if (
					rendered.body &&
					typeof rendered.body === 'object' &&
					typeof rendered.body[Symbol.asyncIterator] === 'function'
				) {
					const flush = compressible(rendered.headers['content-type']) ? res.flush : null;
					const drainers = [];
					const writer = (event) =>
						new Promise((resolve) => {
							if (!res.write(event)) {
								drainers.push(resolve);
							} else {
								resolve();
							}
						});
					// FIXME: upstream bug in compression prevents usage
					// of res.once('drain', resolve) in writer's curry.
					// https://github.com/expressjs/compression/pull/153
					res.on('drain', () => {
						drainers.splice(0, drainers.length).forEach((resolve) => resolve());
					});
					for await (const event of rendered.body) {
						if (res.connection.destroyed) break;
						await writer(event);
						flush?.();
					}
					res.end();
				} else {
					res.end(rendered.body);
				}
			} else {
				res.statusCode = 404;
				res.end('Not found');
			}
		}
	);

	return server;
}
