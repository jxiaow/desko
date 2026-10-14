# tiny_http 0.12.0 local patch

Upstream: https://github.com/tiny-http/tiny-http, crates.io tiny_http 0.12.0.
Published crate SHA256: `389915df6413a2e74fb181895f933386023c71110878cd0825588928e64cdc82`. Source copied from the Cargo registry.
License: MIT OR Apache-2.0; both upstream licenses are included.

Desko's only patch adds explicit TCP read/write idle timeouts, bounded HTTP headers,
a Request body deadline wrapper, and bounded unread-body drain buffers. No TLS or request framing behavior is changed. Headers and initial body reads
have a 30-second total deadline; the app extends uploads to four hours. The
shared body deadline also covers eager buffering and the unread-body drain.
`Server::http_with_timeout` opts in at socket accept; `Request::set_body_timeout`
bounds small forms even when a client keeps trickling bytes. A blocking read may
overrun its deadline by at most the socket idle timeout. These APIs are used by
fileshare-core; its loopback tests verify stalled request slots are released.
