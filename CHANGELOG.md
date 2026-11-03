# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [0.6.3] - 2026-11-03

### Fixed

- start hold-to-talk on the first key repeat ([cfc3aaa](https://github.com/sqwxl/pi-push-to-talk/commit/cfc3aaa7f2d8d77e0db0dcfaa8a9afc520993482))

## [0.6.2] - 2026-11-03

### Fixed

- stop arming hold-to-talk without a space release ([2ea5a02](https://github.com/sqwxl/pi-push-to-talk/commit/2ea5a02e3055b8d4222e749f5186e84e0e034339))

## [0.6.1] - 2026-10-31

### Fixed

- leave space alone in terminals without key releases ([756aa4d](https://github.com/sqwxl/pi-push-to-talk/commit/756aa4dcf231f247303b50271260e03c80ee5d99))

## [0.6.0] - 2026-10-31

### Added

- replace a refused port forward at connect time ([a7e70f9](https://github.com/sqwxl/pi-push-to-talk/commit/a7e70f9c7ac8e34768b9344fbdd194a2860c6a76))

## [0.5.0] - 2026-10-29

### Added

- choose the machine by how far speech rises above its own noise floor ([820948e](https://github.com/sqwxl/pi-push-to-talk/commit/820948e47b4d84a88fbb6e18dacdad56560a90d0))
- check tools and prove the helper answers before setup ends ([6a43c53](https://github.com/sqwxl/pi-push-to-talk/commit/6a43c539c1edb172466fe74afec906eedba74df6))
- give each client its own port and name the recording machine ([990bb41](https://github.com/sqwxl/pi-push-to-talk/commit/990bb4191cbcc15d300005ce13388a8022dde366))

### Fixed

- make the setup failures say what is missing on stderr ([35c0753](https://github.com/sqwxl/pi-push-to-talk/commit/35c07537d21585ca74e44325243635bf18deb7d1))
- compare speech against the middle of each stream, not its quietest moment ([597fb13](https://github.com/sqwxl/pi-push-to-talk/commit/597fb13b7fc8c6154de4370090710723e743d39a))
- require speech to rise above the stream's own floor ([859cae7](https://github.com/sqwxl/pi-push-to-talk/commit/859cae7c20e5e1268fe17f07465bbe97e2f9617c))
- name the pi host in the setup prompt ([8b9748b](https://github.com/sqwxl/pi-push-to-talk/commit/8b9748b1568cf9b3d88e3ff936a1ac3129cd364a))
- pin the helper's local port ([7e370ea](https://github.com/sqwxl/pi-push-to-talk/commit/7e370eaaba99afeb038f83f644db50be059cfb8a))
- keep the helper on its local port ([8c0b55c](https://github.com/sqwxl/pi-push-to-talk/commit/8c0b55c3786f7bc8e5c2bc4945a5342d5ad74e88))

## [0.3.0] - 2026-10-27

### Added

- add /dictation-setup to install the remote microphone helper ([e8a4c50](https://github.com/sqwxl/pi-push-to-talk/commit/e8a4c504bd490527182053af6aa7285ec9947b86))
- find a forwarded microphone by default ([fa83e0c](https://github.com/sqwxl/pi-push-to-talk/commit/fa83e0c3070264cff8b6fbc85eeda0d8d5e37740))
- dictate from a remote host's microphone over SSH ([79104cc](https://github.com/sqwxl/pi-push-to-talk/commit/79104cc2f14a6132a0ea3cb7aa53a22512abe2c8))

### Fixed

- name the host argument in the no-microphone message ([9ddb8c6](https://github.com/sqwxl/pi-push-to-talk/commit/9ddb8c6de0a3150ffd63a5584833f759848c45b7))
- silence the repeated forward warning in the ssh entry ([7d0c5f1](https://github.com/sqwxl/pi-push-to-talk/commit/7d0c5f12211617f2492bbdee2893269af91c7df6))
- show one actionable message when no microphone exists ([f6a272d](https://github.com/sqwxl/pi-push-to-talk/commit/f6a272d861251de8dc421dc1b6d6b01c26388304))
- name the setup command when no source can record ([21dff80](https://github.com/sqwxl/pi-push-to-talk/commit/21dff802b78afac15df97da6f1cc057672cbf4ab))
- treat a forward that sends no audio as unavailable ([9ed4ed3](https://github.com/sqwxl/pi-push-to-talk/commit/9ed4ed3efaae9b7b7bfd8836d4419998ee41b228))

## [0.2.0] - 2026-10-25

### Added

- blink a red listening indicator and show model loading ([9f5f921](https://github.com/sqwxl/pi-push-to-talk/commit/9f5f921102e50e495058c94250254ca156bf0f44))
- hold space to dictate into pi's prompt ([e280d9f](https://github.com/sqwxl/pi-push-to-talk/commit/e280d9f86c6285ada751b93e6bcc9d42bd9a7e73))

### Fixed

- keep whisper punctuation at mid-session commits ([5a61c59](https://github.com/sqwxl/pi-push-to-talk/commit/5a61c5990b802db980860e432f695e198f09791f))
- stop losing dictation on stop races, repeated phrases, and first use ([56db179](https://github.com/sqwxl/pi-push-to-talk/commit/56db1799acade9b19b5997e2db47155f814f88d9))

[0.6.3]: https://github.com/sqwxl/pi-push-to-talk/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/sqwxl/pi-push-to-talk/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/sqwxl/pi-push-to-talk/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/sqwxl/pi-push-to-talk/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/sqwxl/pi-push-to-talk/compare/v0.3.0...v0.5.0
[0.3.0]: https://github.com/sqwxl/pi-push-to-talk/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/sqwxl/pi-push-to-talk/releases/tag/v0.2.0
