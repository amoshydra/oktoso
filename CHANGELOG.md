# Changelog

## [0.1.14](https://github.com/amoshydra/oktoso/compare/v0.1.13...v0.1.14) (2026-11-03)


### Bug Fixes

* **hub:** scope attention sync to the owning provider ([9b2741f](https://github.com/amoshydra/oktoso/commit/9b2741f30e43ca405cc459b3124d16faa62db120))

## [0.1.13](https://github.com/amoshydra/oktoso/compare/v0.1.12...v0.1.13) (2026-11-03)


### Features

* **hub:** support remote providers with health backoff ([a4ab06d](https://github.com/amoshydra/oktoso/commit/a4ab06d1a1bc4ac4043462cf2e76c4c0046da39f))

## [0.1.12](https://github.com/amoshydra/oktoso/compare/v0.1.11...v0.1.12) (2026-11-02)


### Features

* **mcp:** add a stdio bridge for OpenCode ([88c773a](https://github.com/amoshydra/oktoso/commit/88c773a428bc75fc21cd68044c2d95c284c4ab34))
* **mcp:** expose attention and session resources ([660324b](https://github.com/amoshydra/oktoso/commit/660324b939a3f1205ae976adc515c130c1b83238))
* **mcp:** host the tool surface over streamable HTTP ([00b4941](https://github.com/amoshydra/oktoso/commit/00b49412ba5366feb14d05d83bfba24ee7c496e9))

## [0.1.11](https://github.com/amoshydra/oktoso/compare/v0.1.10...v0.1.11) (2026-11-02)


### Features

* **chat:** add attachments, branches, and retry ([7b54736](https://github.com/amoshydra/oktoso/commit/7b547361dca91d33b96c895195c226d207993d81))
* **chat:** add message copy and hub-backed dictation ([8d531be](https://github.com/amoshydra/oktoso/commit/8d531befe93700048c3600566010206d0339ea99))


### Bug Fixes

* **chat:** preserve provider message order on refresh ([ab3a91d](https://github.com/amoshydra/oktoso/commit/ab3a91dd7d0db9fab940425288234f4e89524720))

## [0.1.10](https://github.com/amoshydra/oktoso/compare/v0.1.9...v0.1.10) (2026-11-02)


### Features

* **chat:** add the desktop session sidebar ([4e066c2](https://github.com/amoshydra/oktoso/commit/4e066c268aeba6c2a087093006c8462a11c91289))
* **chat:** rebuild the chat surface ([40b0d15](https://github.com/amoshydra/oktoso/commit/40b0d1541cf440dd8c9de925943d5b73e939c961))


### Bug Fixes

* **chat:** compact the mobile selection picker ([76484f9](https://github.com/amoshydra/oktoso/commit/76484f91a67b298d60767bedb7064bded9bcfea9))
* **chat:** move the mobile picker inline with a compact send ([d2f5574](https://github.com/amoshydra/oktoso/commit/d2f5574b6a404690e43db27facfba51611036acb))
* **chat:** resolve OpenCode file links through the provider filesystem ([f785dd3](https://github.com/amoshydra/oktoso/commit/f785dd3c3d7eb4029ee2045646d2ceb6ed4f6ebc))

## [0.1.9](https://github.com/amoshydra/oktoso/compare/v0.1.8...v0.1.9) (2026-11-01)


### Features

* **brand:** add Oktoso mark, app icons, and README visuals ([a8479c3](https://github.com/amoshydra/oktoso/commit/a8479c32afe80c0649c65a064c065fe68b8d1743))


### Bug Fixes

* **hub:** polish pairing page and terminal flow ([5ca6b27](https://github.com/amoshydra/oktoso/commit/5ca6b2787f903884ea787286c723cd441706ecea))

## [0.1.8](https://github.com/amoshydra/oktoso/compare/v0.1.7...v0.1.8) (2026-11-01)


### Features

* **hub:** store the config in the platform config directory ([17482ed](https://github.com/amoshydra/oktoso/commit/17482edd715abd41a663c0c302a7165bf1ea505e))
* **ui:** use Inter and IBM Plex Mono ([b918844](https://github.com/amoshydra/oktoso/commit/b91884487414c379c2b1e18c704aec0ff76659bf))

## [0.1.7](https://github.com/amoshydra/oktoso/compare/v0.1.6...v0.1.7) (2026-11-01)


### Features

* **providers:** add provider management from the web UI ([fa106d9](https://github.com/amoshydra/oktoso/commit/fa106d9d243e9323f988ff4ddbe69966c8520e05))

## [0.1.6](https://github.com/amoshydra/oktoso/compare/v0.1.5...v0.1.6) (2026-11-01)


### Bug Fixes

* **hub:** accept pairing confirmations from embedded webviews ([9f8aadb](https://github.com/amoshydra/oktoso/commit/9f8aadb3602fc7015e4235083a41b3e31314119c))
* **hub:** accept proxy and webview pairing confirmations ([da3e0aa](https://github.com/amoshydra/oktoso/commit/da3e0aaf1d21bb833a2aff5363d9669279ff16c7))

## [0.1.5](https://github.com/amoshydra/oktoso/compare/v0.1.4...v0.1.5) (2026-11-01)


### Features

* **g2:** add a persistent symbol legend ([1546b38](https://github.com/amoshydra/oktoso/commit/1546b3882850dd68f2a2c7f2abe3be45d0fa8598))
* **g2:** add classified failure and reconnect states ([ded5ecf](https://github.com/amoshydra/oktoso/commit/ded5ecfed0797e98c85bf183e2ed3159139d0e03))
* **g2:** suppress subagent attention noise and use status glyphs ([f73715b](https://github.com/amoshydra/oktoso/commit/f73715bcbac6993684ab1d5bb33743544631979c))

## [0.1.4](https://github.com/amoshydra/oktoso/compare/v0.1.3...v0.1.4) (2026-10-31)


### Features

* **g2:** add pairing, question discovery, and batch answers ([4fdf073](https://github.com/amoshydra/oktoso/commit/4fdf073dd27e874b59c9b527676e74147dd82f2c))

## [0.1.3](https://github.com/amoshydra/oktoso/compare/v0.1.2...v0.1.3) (2026-10-31)


### Bug Fixes

* replace the hardcoded default assistant model ([9e336c8](https://github.com/amoshydra/oktoso/commit/9e336c8981b4adf7818e7c96961a7d88aa393329))

## [0.1.2](https://github.com/amoshydra/oktoso/compare/v0.1.1...v0.1.2) (2026-10-31)


### Bug Fixes

* derive the CLI version from package.json ([b52db0a](https://github.com/amoshydra/oktoso/commit/b52db0ac4493ecf8169579c364571eb5f133aa8f))

## [0.1.1](https://github.com/amoshydra/oktoso/compare/v0.1.0...v0.1.1) (2026-10-31)


### Bug Fixes

* **ci:** align release workflow with npm trusted publisher ([e465905](https://github.com/amoshydra/oktoso/commit/e4659059179ba124eee3dfb0d9c0b516318b1265))
