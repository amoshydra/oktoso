# Changelog

## [0.1.25](https://github.com/amoshydra/oktoso/compare/v0.1.24...v0.1.25) (2026-11-08)


### Bug Fixes

* **web:** stop long session titles overflowing the mobile composer ([82cabad](https://github.com/amoshydra/oktoso/commit/82cabad1d217ef548df19075f26e2b1351a0baef))

## [0.1.24](https://github.com/amoshydra/oktoso/compare/v0.1.23...v0.1.24) (2026-11-08)


### Features

* **web:** group model options by provider ([aa57eb6](https://github.com/amoshydra/oktoso/commit/aa57eb68a13a8ecf8ccbb33eb151a5a593b1ac3f))

## [0.1.23](https://github.com/amoshydra/oktoso/compare/v0.1.22...v0.1.23) (2026-11-07)


### Bug Fixes

* **hub:** cap unknown-provider operations and health checks ([b886082](https://github.com/amoshydra/oktoso/commit/b88608280df95724de009122917ef798e9b61f97))

## [0.1.22](https://github.com/amoshydra/oktoso/compare/v0.1.21...v0.1.22) (2026-11-07)


### Bug Fixes

* **hub:** keep slow providers from blocking reads ([7fb9368](https://github.com/amoshydra/oktoso/commit/7fb9368ab514d396689a004de83dc4911530c7ab))
* **web:** align page chrome, icons, and control sizing ([f4420ea](https://github.com/amoshydra/oktoso/commit/f4420ea1ea863e8fc8b756e1c9d4f0bfb69c16e5))

## [0.1.21](https://github.com/amoshydra/oktoso/compare/v0.1.20...v0.1.21) (2026-11-07)


### Bug Fixes

* **g2:** recover unsent messages after a reload ([da9abae](https://github.com/amoshydra/oktoso/commit/da9abae8169164f6e8c44beadc28ddce2888b974))
* **hub:** dedupe concurrent sends with the same key ([2a13559](https://github.com/amoshydra/oktoso/commit/2a13559a10a086566f7b393e42519e92ceadc857))
* **web:** keep a failed prompt as the session draft ([cb06a5f](https://github.com/amoshydra/oktoso/commit/cb06a5fb510c9900f0860691c59feb2f0d491e06))

## [0.1.20](https://github.com/amoshydra/oktoso/compare/v0.1.19...v0.1.20) (2026-11-07)


### Bug Fixes

* **g2:** make every send visible, bounded, and idempotent ([53dc480](https://github.com/amoshydra/oktoso/commit/53dc4801cef96eacb0980fad85612d0ce8b726bd))

## [0.1.19](https://github.com/amoshydra/oktoso/compare/v0.1.18...v0.1.19) (2026-11-07)


### Bug Fixes

* **hub:** extend idempotency retention and guard key reuse ([b8b34aa](https://github.com/amoshydra/oktoso/commit/b8b34aa6d025acd0368d6b48e3daaf7ec368431a))

## [0.1.18](https://github.com/amoshydra/oktoso/compare/v0.1.17...v0.1.18) (2026-11-07)


### Bug Fixes

* **web:** surface send failures before the optimistic message ([0666aeb](https://github.com/amoshydra/oktoso/commit/0666aeb74e3f32633881c576cb1f592d2c6e1377))

## [0.1.17](https://github.com/amoshydra/oktoso/compare/v0.1.16...v0.1.17) (2026-11-07)


### Bug Fixes

* **web:** generate IDs without secure-context APIs ([eae569c](https://github.com/amoshydra/oktoso/commit/eae569c6d4f6c1fe18e82dbd95fa334fa101d5cf))

## [0.1.16](https://github.com/amoshydra/oktoso/compare/v0.1.15...v0.1.16) (2026-11-04)


### Bug Fixes

* **opencode:** detect running sessions from time.busy ([c30b0bc](https://github.com/amoshydra/oktoso/commit/c30b0bce3b58fdbaf4f09b89f3353d955932c7cf))

## [0.1.15](https://github.com/amoshydra/oktoso/compare/v0.1.14...v0.1.15) (2026-11-04)


### Features

* **chat:** add optimistic sends, retry, and edit-and-fork ([1802c5a](https://github.com/amoshydra/oktoso/commit/1802c5a60462ac5fd3d270a42a7825efd7ab01c2))
* **g2:** add gated voice replies through hub transcription ([6e552ee](https://github.com/amoshydra/oktoso/commit/6e552ee621e1e5dc37ed18ba2bab523ec19aab38))
* **openwebui:** send attachments and map folders ([3474454](https://github.com/amoshydra/oktoso/commit/3474454dfc23d70ff1ebaff959c67080627df922))
* **search:** query provider history for sessions ([d48de20](https://github.com/amoshydra/oktoso/commit/d48de20858798050bf9bff255c3c03cf3f20bf09))
* **web:** add URL routing and history navigation ([0a444bb](https://github.com/amoshydra/oktoso/commit/0a444bbc173ff676dc629e898aec37f27b6ab772))


### Bug Fixes

* **openwebui:** resolve folders from folder chat lists ([732e5f9](https://github.com/amoshydra/oktoso/commit/732e5f98a07ca3b7e01f075790ef8e9ba16f4cd9))

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
