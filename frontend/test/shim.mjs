/**
 * The smallest possible browser for the tests.
 *
 * PixiJS reaches for `navigator` and `document` while it is being imported,
 * even though the renderer never runs. This gives it just enough to load, so
 * the character system can be tested in plain Node.
 */

globalThis.navigator = globalThis.navigator || {
  userAgent: 'node',
  platform: 'linux',
};

globalThis.document = globalThis.document || {
  createElement: () => ({
    getContext: () => null,
    style: {},
    width: 0,
    height: 0,
  }),
  addEventListener() {},
  removeEventListener() {},
  body: {},
  documentElement: { style: {} },
};
