# Changelog

## [0.2.2](https://github.com/amoshydra/oktoso/compare/v0.2.1...v0.2.2) (2026-11-15)


### Features

* **backup:** snapshot and restore the hub data directory ([2631531](https://github.com/amoshydra/oktoso/commit/2631531ebd89e59aff0e598fc9454b8a9af5e223))
* **hardening:** metrics, log redaction, and packaging ([40619e9](https://github.com/amoshydra/oktoso/commit/40619e93d9d09b26aa8bf7aa3f2d53686c336a4e))
* **local-data:** export sessions and own every local store ([984437e](https://github.com/amoshydra/oktoso/commit/984437e135a64f1fa166f0ba86ba107b1d6a116e))
* **overview:** report usage on the renamed dashboard ([879c968](https://github.com/amoshydra/oktoso/commit/879c9688cc61d53b90f6c7ab0e8543ae9973e071))
* **recall:** cache transcripts locally behind an opt-in ([c69af78](https://github.com/amoshydra/oktoso/commit/c69af784af01c8b7f17165e872838de031b415c2))
* **recall:** index cached transcripts for search ([1aa8dc1](https://github.com/amoshydra/oktoso/commit/1aa8dc1d05679564bdeede3cbcadeb7d82e0f380))
* **search:** add the messages scope with highlighted snippets ([51b77ac](https://github.com/amoshydra/oktoso/commit/51b77ac13f7962f66387f2842dcb0b8d729db142))
* **search:** expose the transcript index over HTTP ([8302580](https://github.com/amoshydra/oktoso/commit/830258091769309332dafca7799367d616da5d62))
* **sessions:** resolve and show a session's lineage ([f7d4881](https://github.com/amoshydra/oktoso/commit/f7d488198ea1a2943f27a59d4426749cdc9d4a50))
* **web:** use the wide field on list pages ([2de7fdf](https://github.com/amoshydra/oktoso/commit/2de7fdfc214d6bb84c6ad790ade17606cbb5931b))


### Bug Fixes

* **auth:** throttle pairing attempts ([1247db5](https://github.com/amoshydra/oktoso/commit/1247db500902ee0e2a8aabfa3b9b7c0c5081e811))
* **automation:** do not fake success on a form that cannot be answered ([5cfc080](https://github.com/amoshydra/oktoso/commit/5cfc080ca6758b69d157eeccf3d12852adc9e016))
* **backup:** keep restores inside the data directory ([ed4b8f8](https://github.com/amoshydra/oktoso/commit/ed4b8f8be3c5004c27e4287e44bdb5bab08f82b3))
* **logs:** keep diagnostics while masking secrets ([c0f3257](https://github.com/amoshydra/oktoso/commit/c0f3257444f775d33ae2bd87356f0dd129d52571))
* **metrics:** require the owner token and keep series stable ([02a6455](https://github.com/amoshydra/oktoso/commit/02a64557c71e7278b64234e5c8ffb5b2ab207272))
* **recall:** make the index survive compaction, reload, and opt-out ([1a1fde5](https://github.com/amoshydra/oktoso/commit/1a1fde52afa980a657c2fb5cc9a784d98c63d5d3))
* **recall:** make the transcript cache safe under concurrency ([22590b7](https://github.com/amoshydra/oktoso/commit/22590b734f4482372179f7ed27ab481d34645df9))
* **sessions:** keep the real error code when the first prompt fails ([4c79801](https://github.com/amoshydra/oktoso/commit/4c79801776a6dd21909c72f0c0223b0eb08f2245))
* **sessions:** send the first prompt when creating with text ([1a9ed31](https://github.com/amoshydra/oktoso/commit/1a9ed31199bf91e52199e43e9ca3f3abf77e2a2f))
* **web:** align the chat panel to the reading column ([d1a0747](https://github.com/amoshydra/oktoso/commit/d1a0747291ff59c01bfe50d220fc8f1422f0a53b))
* **web:** consolidate icons and type roles ([962c6b1](https://github.com/amoshydra/oktoso/commit/962c6b13ec7b6af7aeeca88debf5e3014270421b))
* **web:** resolve the first audit batch ([9d19144](https://github.com/amoshydra/oktoso/commit/9d191446dea7eab9e58507cf84302682e4685436))

## [0.2.1](https://github.com/amoshydra/oktoso/compare/v0.2.0...v0.2.1) (2026-11-15)


### Features

* **web:** float scroll-to-latest and fade transcript edges ([16237fb](https://github.com/amoshydra/oktoso/commit/16237fb251f490591508553a10869cdf9f34de53))


### Bug Fixes

* **automation:** answer provider forms through the form action ([871cfae](https://github.com/amoshydra/oktoso/commit/871cfae4f4dfa8823dbe81ec320e227815001bab))

## [0.2.0](https://github.com/amoshydra/oktoso/compare/v0.1.31...v0.2.0) (2026-11-15)


### Features

* **automation:** abort in-flight actions on pause ([321a687](https://github.com/amoshydra/oktoso/commit/321a687b69c53c970491b1665d5fbc485ace6696))
* **automation:** add MCP tools and CLI controls ([f12bc4c](https://github.com/amoshydra/oktoso/commit/f12bc4c1754837968863ac48c5f9d6c8c192a59c))
* **automation:** add session, schedule, notify, and retry ([5c9c414](https://github.com/amoshydra/oktoso/commit/5c9c4140c607ebf40676917fd263e215d6b8297c))
* **automation:** add the supervisor slice ([01c700d](https://github.com/amoshydra/oktoso/commit/01c700d8b9c3e9d6248d87e639cfb59bdcd5f01b))
* **automation:** remember approved shapes ([4a7e7fd](https://github.com/amoshydra/oktoso/commit/4a7e7fd69f4abf6a5e659f76b883fe9a3cbe5d16))
* **automation:** start sessions from templates ([2a03936](https://github.com/amoshydra/oktoso/commit/2a03936f85a4b7f7925eecaf2f515e9c3730afb4))
* **g2:** show automation approvals in the inbox ([02284fc](https://github.com/amoshydra/oktoso/commit/02284fc0e6dc52bf28b9b17311700b3784425ec9))
* **mcp:** expose oktoso://automation with subscriptions ([cf5a688](https://github.com/amoshydra/oktoso/commit/cf5a688dd0a06b4172fb68186a008c6b3c991239))
* **notifications:** add contracts and config ([f5e2dce](https://github.com/amoshydra/oktoso/commit/f5e2dce2abc399560fbb26fbddba686118031201))
* **notifications:** add subscription and settings routes ([1c401bb](https://github.com/amoshydra/oktoso/commit/1c401bbc15077c9265d9ddf546bed8dddd75b783))
* **notifications:** deliver through Web Push ([6fe7506](https://github.com/amoshydra/oktoso/commit/6fe7506bb182bf018318f672412f33a102355f7e))
* **notifications:** route attention events to channels ([a707371](https://github.com/amoshydra/oktoso/commit/a7073712f47953bd31824c57f26c74adb3fe308e))
* **settings:** add the notification panel ([8bea9ce](https://github.com/amoshydra/oktoso/commit/8bea9ce297daad149e7584f3e4fb75aecb46567c))
* **web:** add the notification service worker and deep links ([cd031d2](https://github.com/amoshydra/oktoso/commit/cd031d20071d7ce47c3c0d81512b66a0ae8ee629))
* **web:** queue sends while offline and cache the last session list ([329a2a2](https://github.com/amoshydra/oktoso/commit/329a2a290fe05a4b21dd60c86ce06efec2992ea5))


### Bug Fixes

* **automation:** make approvals actionable without exposing the plan ([b387545](https://github.com/amoshydra/oktoso/commit/b387545f4026affb30fa542a69f16929ffb7822c))
* **mcp:** bound and scope automation_list ([4cca8b4](https://github.com/amoshydra/oktoso/commit/4cca8b446cea358cfa4d44b2f72400307689773a))
* **web:** keep the offline note outside the composer status branch ([17f9f98](https://github.com/amoshydra/oktoso/commit/17f9f98b5d01c2350838316bc25b7ef367b6a59f))


### Miscellaneous Chores

* release 0.2.0 ([8c886cb](https://github.com/amoshydra/oktoso/commit/8c886cb712c855a5f1e7f4f333902b7d15fe2f91))

## [0.1.31](https://github.com/amoshydra/oktoso/compare/v0.1.30...v0.1.31) (2026-11-15)


### Features

* **web:** render mermaid diagrams in the transcript ([5330245](https://github.com/amoshydra/oktoso/commit/53302451e32bec409d07406899b654edf3f465ca))

## [0.1.30](https://github.com/amoshydra/oktoso/compare/v0.1.29...v0.1.30) (2026-11-14)


### Features

* **chat:** collapse the mobile composer to one row ([360cb27](https://github.com/amoshydra/oktoso/commit/360cb27ed5b0cf1f1c3df568bf433a46b23535c6))
* **chat:** keep steer as the send default and disclose queue ([cd1788a](https://github.com/amoshydra/oktoso/commit/cd1788af009e93af30923df1c3d0d2d4e7e92a39))
* **reply:** warm suggestions for the visible session ([4fe80de](https://github.com/amoshydra/oktoso/commit/4fe80deb72faa4d15d13aedf649e969e757335df))


### Bug Fixes

* **reply:** ground suggestions in the current request ([d6bb7ba](https://github.com/amoshydra/oktoso/commit/d6bb7bacfdc7a14d9c9be800022e005e90de9d3a))
* **web:** align the mobile composer controls ([44eba19](https://github.com/amoshydra/oktoso/commit/44eba19e2f3bacb5238844e5a57829f833c17218))


### Performance Improvements

* **reply:** share in-flight generations and unblock the G2 reply screen ([805733c](https://github.com/amoshydra/oktoso/commit/805733cf7118183cc7f49f30d31bba7b8f505153))

## [0.1.29](https://github.com/amoshydra/oktoso/compare/v0.1.28...v0.1.29) (2026-11-14)


### Features

* **attention:** show question choice detail and custom answers ([0e42cd4](https://github.com/amoshydra/oktoso/commit/0e42cd4114dc25b9396460566c25b3d9b1269a64))
* **chat:** preview files and redesign agent activity as tiles ([e0ccab4](https://github.com/amoshydra/oktoso/commit/e0ccab4f9d96f6a8983546632474e172ad46732b))
* **chat:** queue OpenCode messages while the agent runs ([ed8ce4a](https://github.com/amoshydra/oktoso/commit/ed8ce4a7b396a49c30483af50d80e1a75c71c70e))
* **chat:** show background shells and running subagents ([4ae6301](https://github.com/amoshydra/oktoso/commit/4ae630178823c09e8d8e8329bfbafce34daf1f33))
* **files:** render HTML previews in a sandboxed frame ([6d4d70a](https://github.com/amoshydra/oktoso/commit/6d4d70a43a64006d3b3de3a2997e9fd171286f4b))
* **reply:** always suggest a way forward ([b64bcd3](https://github.com/amoshydra/oktoso/commit/b64bcd3df7c4f617ed3edf82d211f34051a9d8ef))
* **sessions:** retry the latest OpenCode turn on another model ([8ea86b1](https://github.com/amoshydra/oktoso/commit/8ea86b1d9f2eef1e74377c812b5a5b1bd666cde3))
* **ui:** nest subagents under their parent ([ff62464](https://github.com/amoshydra/oktoso/commit/ff6246497634afe4f0b9e56c74c1ccc421efd593))
* **web:** add a subagent scope to the sessions list ([96d1ab3](https://github.com/amoshydra/oktoso/commit/96d1ab30dc067df3e3de93fd66f7895ff4541896))


### Bug Fixes

* **chat:** keep the provider's part order in a message ([a2c7426](https://github.com/amoshydra/oktoso/commit/a2c74267323a268f9c5fcdabebe432d4a2a0701e))
* **chat:** make the running send mode truthful ([a6235cf](https://github.com/amoshydra/oktoso/commit/a6235cfa2a58fd8398b3846af709e9875b38d15e))
* **chat:** render embedded images in a read step ([a1d487e](https://github.com/amoshydra/oktoso/commit/a1d487e802b239c2af56f12a12000db7c51de291))
* **chat:** track subagent liveness from the child session ([199624a](https://github.com/amoshydra/oktoso/commit/199624ad4d37cfcecf0fb12707cbb407b85d3f1e))
* **opencode:** request steer explicitly ([bc0d0b9](https://github.com/amoshydra/oktoso/commit/bc0d0b98b13d9aa4f55e8b97f45d01fd7519bdf6))
* **web:** restore the mobile chat width ([d035f80](https://github.com/amoshydra/oktoso/commit/d035f80969735f6008b14f40067bf7c2db931f23))

## [0.1.28](https://github.com/amoshydra/oktoso/compare/v0.1.27...v0.1.28) (2026-11-09)


### Features

* **web:** paste files and images into the composer ([b0b0d68](https://github.com/amoshydra/oktoso/commit/b0b0d68ad61a9c5f3c1f3315f63d2f6b51c806e9))

## [0.1.27](https://github.com/amoshydra/oktoso/compare/v0.1.26...v0.1.27) (2026-11-09)


### Features

* **g2:** implement glass UX audit fixes ([72ec0b1](https://github.com/amoshydra/oktoso/commit/72ec0b1186ffa840f988f2714e6fc7938ff79f20))


### Bug Fixes

* **reply:** classify direct corrections as challenges ([3ff48aa](https://github.com/amoshydra/oktoso/commit/3ff48aa5f696bfd7c75007c27cb8ac344cb77778))

## [0.1.26](https://github.com/amoshydra/oktoso/compare/v0.1.25...v0.1.26) (2026-11-09)


### Features

* add reply audit and decision-state suggestions ([cac09ed](https://github.com/amoshydra/oktoso/commit/cac09ed99443165628e58b4c3fd69c858eb4ecc4))

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
