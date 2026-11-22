# Changelog

## [0.2.8](https://github.com/amoshydra/oktoso/compare/v0.2.7...v0.2.8) (2026-11-22)


### Features

* **assistant:** add read-only project and global scopes ([3050fce](https://github.com/amoshydra/oktoso/commit/3050fce05d59fffbeaf9caa77efe87c7520b9fa3))
* **assistant:** ask a session read-only with one model call ([183ead1](https://github.com/amoshydra/oktoso/commit/183ead1faed2d2855752261a4288c291b58b2811))
* **assistant:** ask one session, read-only, in a hub-owned thread ([4244b07](https://github.com/amoshydra/oktoso/commit/4244b07b6b4818da5f5abd99f259a9fb32d29b5f))
* **assistant:** backfill the session as-of stamp for earlier turns ([6ac99b6](https://github.com/amoshydra/oktoso/commit/6ac99b689936e3937ae1a9c458e35e23ccddf4de))
* **assistant:** expire stale actions and mark interrupted runs ([f9b8f66](https://github.com/amoshydra/oktoso/commit/f9b8f66a888747e9ead2e59f5f27b708cac130dc))
* **assistant:** find sessions and send to them from project and global ([4834eb7](https://github.com/amoshydra/oktoso/commit/4834eb7e192cd1ffc8522112cf9d34d56339870e))
* **assistant:** give the prompt a goal, a work state, and its failures ([38b65ad](https://github.com/amoshydra/oktoso/commit/38b65ad2d751e98e742c129124a7a4d8f2b51124))
* **assistant:** keep permission prompts in the inbox ([70888c9](https://github.com/amoshydra/oktoso/commit/70888c9bf66adcf326c898f2e996d66f27611440))
* **assistant:** let the session answer read its own transcript ([79e7e99](https://github.com/amoshydra/oktoso/commit/79e7e991f4dff3a42682233278f5f0a15b2be22f))
* **assistant:** make the agent endpoint a runtime setting ([1050ceb](https://github.com/amoshydra/oktoso/commit/1050ceb0265ba03b8b7726e579c1157c25bca791))
* **assistant:** page cross-session search instead of cutting at ten ([bd891cb](https://github.com/amoshydra/oktoso/commit/bd891cb0266e8c255597193069da401270355e73))
* **assistant:** page the transcript back to the start of a long session ([617b849](https://github.com/amoshydra/oktoso/commit/617b84979cf13731e2658cc4bf398a85cdd76f56))
* **assistant:** pick the model at the composer and show the work ([cd1f316](https://github.com/amoshydra/oktoso/commit/cd1f316fe2cdb2199992d6032cebf0ee59380fc8))
* **assistant:** read across sessions from the overview thread ([1478cb6](https://github.com/amoshydra/oktoso/commit/1478cb6a44cfe3ae3e242a4079f024b5280cb425))
* **assistant:** read older turns on demand instead of stopping at the cap ([da71421](https://github.com/amoshydra/oktoso/commit/da714219d03536aa7e7fd27f4b743e7e4c139590))
* **assistant:** render answers like a chat message ([7c89821](https://github.com/amoshydra/oktoso/commit/7c898213ec4498572fe86d63d05c6ca4ebb7d723))
* **assistant:** require a human to confirm any write ([408bf8b](https://github.com/amoshydra/oktoso/commit/408bf8bb0054e9e699417001390c9f94d3d038ec))
* **assistant:** say how much of the session an answer read ([9003f97](https://github.com/amoshydra/oktoso/commit/9003f9781bee919e261326bf86b7842b1f257805))
* **assistant:** search every session from any thread ([42c46d5](https://github.com/amoshydra/oktoso/commit/42c46d51a0a7eb5d9a1f33cfe92c195829949ac3))
* **assistant:** show when a turn happened and how old the session was ([6fbbdc0](https://github.com/amoshydra/oktoso/commit/6fbbdc0c0ff2210c519269a53cd95f78a8851a57))
* **events:** let a wearable ask for a slower keepalive ([2a940e0](https://github.com/amoshydra/oktoso/commit/2a940e0fdcf332d7733134086cb5c0c078fc0752))
* **g2:** answer a batch question by question on the glass ([2b8493b](https://github.com/amoshydra/oktoso/commit/2b8493bb3ad5fde9f46ca169d0314bf113a705e5))
* **g2:** make the answer screen a complete response surface ([742c209](https://github.com/amoshydra/oktoso/commit/742c209eac928e1b344e917394be72b64edbe544))
* **g2:** number answers and mark actions with a chevron ([1c1d7d0](https://github.com/amoshydra/oktoso/commit/1c1d7d0fe3f4528e0409f61d9d29dc34173abd77))
* **g2:** review a single answer before sending ([fcc5429](https://github.com/amoshydra/oktoso/commit/fcc54291e492c7a417a2d1b57dffcb18a844555d))
* **g2:** suggest answers per batch question ([4877ec0](https://github.com/amoshydra/oktoso/commit/4877ec01450d2cf1bdb892d647fe86a418941df0))
* **media:** play videos in the preview sheet instead of downloading ([2535138](https://github.com/amoshydra/oktoso/commit/25351388d3d67c08ab9d243ae1a31f28fe3e6876))
* **media:** stream file-part video through a preview ticket ([fd0f270](https://github.com/amoshydra/oktoso/commit/fd0f270b5c5f194f8895ee59ce7ba196a4937e30))
* **search:** name the providers that could not answer ([21d5b7c](https://github.com/amoshydra/oktoso/commit/21d5b7c73de25bcea2315c975a77b42058e6fdbd))


### Bug Fixes

* **assistant:** bound the history read and show the compaction in the evidence line ([0d87273](https://github.com/amoshydra/oktoso/commit/0d872738ff47c19ead1133b92a4dc5801cd7edea))
* **assistant:** cap activity before the turn is stored ([ebbeb90](https://github.com/amoshydra/oktoso/commit/ebbeb905b6b4acda9ee4ed931dc1d41632e237df))
* **assistant:** give the session assistant the evidence, not a summary ([6a1c64f](https://github.com/amoshydra/oktoso/commit/6a1c64f708f3a9deb6e39f08a37f1dd5d3c4373d))
* **assistant:** keep the end of long messages and drop old turns first ([2a98dad](https://github.com/amoshydra/oktoso/commit/2a98dad078105f2631cfa0bc7ce49cbd5577421c))
* **assistant:** make a decision atomic and a cancel unconditional ([ce59f45](https://github.com/amoshydra/oktoso/commit/ce59f45c49704db2909c23fa6f4566d8495c2461))
* **assistant:** put activity before the answer and match the chat tiles ([dcff28b](https://github.com/amoshydra/oktoso/commit/dcff28ba2a3ba89ad393aaa684b2ec794fa1236c))
* **assistant:** redact tool output and skip unchanged history scans ([e52b676](https://github.com/amoshydra/oktoso/commit/e52b67622cb277d728c637a4cba566877755dc40))
* **g2:** keep the chat's pending question live ([1c774db](https://github.com/amoshydra/oktoso/commit/1c774dbbaa9086f5e7cb96e3394649bada826c14))
* **g2:** name the batch handoff and drop redundant answer rows ([19844e1](https://github.com/amoshydra/oktoso/commit/19844e139ef894e24b79408dcd199fc6014eef97))
* **g2:** only treat an exact free-answer sentinel as free text ([076372e](https://github.com/amoshydra/oktoso/commit/076372e3ecc4ff01f3020f5f9ccde0300f5c43b6))
* **media:** show and stream video attachments in messages ([7e2fcec](https://github.com/amoshydra/oktoso/commit/7e2fcec308148cd865ecb93e86821f406469cff0))
* **opencode:** name the missing file when a project read 404s ([70360f7](https://github.com/amoshydra/oktoso/commit/70360f73334862085920f678ab8a825da18ac8d8))


### Performance Improvements

* **g2:** batch live updates and poll only as a fallback ([f324200](https://github.com/amoshydra/oktoso/commit/f324200fea1ed20035504081b36807caabe4ca41))
* **g2:** resume the event stream and back off polling when it drops ([595ea4d](https://github.com/amoshydra/oktoso/commit/595ea4de6a7f873fb1b394fc9bf64e1ebaad3ad2))
* **media:** stream provider files and forward seeks upstream ([091a6d4](https://github.com/amoshydra/oktoso/commit/091a6d4c51bb39422ebf54422d8d1b9feaffdbaa))

## [0.2.7](https://github.com/amoshydra/oktoso/compare/v0.2.6...v0.2.7) (2026-11-19)


### Features

* **g2:** always offer Stop in the chat menu ([394b97e](https://github.com/amoshydra/oktoso/commit/394b97e2a8c970acaa008e6b37614a5b46d79786))


### Bug Fixes

* **g2:** redeclare the menu when a turn starts reasoning ([702e73d](https://github.com/amoshydra/oktoso/commit/702e73d3c9561e0126a2bc846b0ef4f3afd80b70))
* **g2:** repaint when only the menu changed ([38da1d7](https://github.com/amoshydra/oktoso/commit/38da1d750180fb053264b1deec86d715f5a1cca8))

## [0.2.6](https://github.com/amoshydra/oktoso/compare/v0.2.5...v0.2.6) (2026-11-19)


### Features

* **g2:** add the contextual menu shortcuts ([60918fc](https://github.com/amoshydra/oktoso/commit/60918fc3ee67e73bb7337a10d959d41cbef2baea))
* **g2:** land from the launch source, and sleep with the wearer ([43af007](https://github.com/amoshydra/oktoso/commit/43af0073402c0ec3cfe03b026ae648181c14aa39))
* **g2:** name the provider on error rows ([423172a](https://github.com/amoshydra/oktoso/commit/423172a2de392800a891b1a5e1effa11b7afdab6))
* **g2:** stop from the long-press menu, and never strand the screen ([480e634](https://github.com/amoshydra/oktoso/commit/480e634e0da7590b2c65b0bc2c7809a51fb67bb2))
* **g2:** surface provider state and failed turns ([c7d6135](https://github.com/amoshydra/oktoso/commit/c7d613536242ddac51c2d3c05e69a90fd603b28e))


### Bug Fixes

* **g2:** never gate painting on the wear sensor ([7428d94](https://github.com/amoshydra/oktoso/commit/7428d9431bc49196f6110e91e9359bd2ce51e216))
* **g2:** redeclare the menu when the turn starts or ends ([a220c15](https://github.com/amoshydra/oktoso/commit/a220c15b025b0791c56577922f66610ea34598b3))

## [0.2.5](https://github.com/amoshydra/oktoso/compare/v0.2.4...v0.2.5) (2026-11-19)


### Features

* **g2:** make an empty inbox point at the work ([172b246](https://github.com/amoshydra/oktoso/commit/172b246c43e63100b6e1e7c1bb2533f1fae4fc3b))
* **g2:** make voice reply the first row ([f64c9ec](https://github.com/amoshydra/oktoso/commit/f64c9ec3edefe7ec6c86a3ac946fbe63ace82239))
* **g2:** one line for an empty inbox ([7611b40](https://github.com/amoshydra/oktoso/commit/7611b40c2b9227e4df68e752cdbba2ae05f523ab))
* **g2:** page through recent sessions ([5479237](https://github.com/amoshydra/oktoso/commit/54792372d89d9bb9e7c957ef1e7f882fa084da12))
* **g2:** send a voice reply from the glasses ([eb2b235](https://github.com/amoshydra/oktoso/commit/eb2b2356eb53f1fb6898a4d5821f77b2cdeb2342))
* **templates:** list and start configured templates ([195a6f3](https://github.com/amoshydra/oktoso/commit/195a6f3a7f2acf0ffc173dd2584c1e19a34528a4))
* **web:** start automation templates from Settings ([91da8fc](https://github.com/amoshydra/oktoso/commit/91da8fc992dbeb8ac10f864457b34ee2da2b4d36))


### Bug Fixes

* **g2:** keep the voice reply on the glasses, and say what failed ([e03271a](https://github.com/amoshydra/oktoso/commit/e03271acc02e078f30bbfd8b72c5a119a5bcdf8f))
* **g2:** land on the reply that was just sent ([4b9a6ce](https://github.com/amoshydra/oktoso/commit/4b9a6cefa5a56d486bf1ca378898c2cd60aa8c81))
* **g2:** repaint the chat after a voice reply ([6442c52](https://github.com/amoshydra/oktoso/commit/6442c52d503ebf7410516d33b3baf18450a1eb6c))
* **templates:** close the review findings on the start surface ([24e756f](https://github.com/amoshydra/oktoso/commit/24e756f38701ff20d12c78ffeb22a2ae0d45201c))

## [0.2.4](https://github.com/amoshydra/oktoso/compare/v0.2.3...v0.2.4) (2026-11-18)


### Bug Fixes

* **chat:** stop showing a false empty transcript while loading ([55a0f30](https://github.com/amoshydra/oktoso/commit/55a0f30aa412f7b0ded14cf7be30c68d14561907))

## [0.2.3](https://github.com/amoshydra/oktoso/compare/v0.2.2...v0.2.3) (2026-11-16)


### Features

* **g2:** request compact replies and show Tap reply ([0df482c](https://github.com/amoshydra/oktoso/commit/0df482c9b2270784caf696adaab88d5b9f565483))
* **reply:** improve suggestion content for failure and challenge ([bee2d76](https://github.com/amoshydra/oktoso/commit/bee2d7618054bfa38c3889ef929ec20ba5b14da0))
* **sessions:** rename sessions across providers ([dca6da6](https://github.com/amoshydra/oktoso/commit/dca6da6a80203f3ef88d8e9371646760125c2606))


### Bug Fixes

* **hub:** ground reply suggestions in the latest turn ([5f601d4](https://github.com/amoshydra/oktoso/commit/5f601d4750e79c5250c4a0adfbe5c3b352675c16))
* **reply:** keep G2 suggestions usable without a keyboard ([98ca499](https://github.com/amoshydra/oktoso/commit/98ca499a7b33ec90e868b8fb5794ee5cbd0fd75d))
* **sessions:** expire a stale busy run after any prior idle ([a522643](https://github.com/amoshydra/oktoso/commit/a522643f7ebd8ec96564e8c21c5907ad03bb793e))
* **sessions:** stop stale running state and deleted session cache ([6bcd0b5](https://github.com/amoshydra/oktoso/commit/6bcd0b5aa0d8f0be3012cc461fea694a855b7737))
* settle the rebase review findings ([d15a3f1](https://github.com/amoshydra/oktoso/commit/d15a3f149956dcb7bd32ad7b078ff630a83af851))
* **web:** close accessibility follow-ups for overlays and panels ([d3a4862](https://github.com/amoshydra/oktoso/commit/d3a4862161629c8336554084e24defab657c2413))
* **web:** improve accessibility semantics and focus handling ([6d1ac43](https://github.com/amoshydra/oktoso/commit/6d1ac43252d52ea7a3cd3e630d92dd867be08793))
* **web:** restore Escape for the desktop details column ([f9d17c8](https://github.com/amoshydra/oktoso/commit/f9d17c8617a348a88fce0a7a1f6bcf640336b8b2))
* **web:** stop mobile headers from colliding ([c8fb407](https://github.com/amoshydra/oktoso/commit/c8fb407f5c73d67c9086423aaad80d5d043be0ca))

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
