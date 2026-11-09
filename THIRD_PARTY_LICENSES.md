# Third-party licenses and data rights

Reviewed 2026-11-08. This is a source-backed inventory, not a blanket redistribution clearance. The project's MIT license applies to its original code; it does not relicense game data, third-party software, trademarks, or model weights. Keep the applicable upstream copyright notices and license texts when distributing their material.

## Albion data: attribution and permission are different

| Material used | Source | What is established |
|---|---|---|
| Market prices, history and downloadable market archives | [Albion Online Data Project](https://www.albion-online-data.com/), [API documentation](https://www.albion-online-data.com/api/) | The project expressly provides data for apps and integrations. No explicit MIT license covering the returned data or database archives was established by this review. The MIT license of its client software must not be presented as a license for all data. |
| Item catalog, names, item values, world coordinates and connections | [ao-data/ao-bin-dumps](https://github.com/ao-data/ao-bin-dumps) | No explicit redistribution license found in the repository material reviewed; GitHub license metadata was also empty. This is an unresolved permission question, not a finding that every factual field is necessarily protected. |
| Albion name and game material | [Sandbox Interactive terms](https://albiononline.com/terms_and_conditions) | Albion Online and associated game material belong to their respective rightsholders. This independent tool is not affiliated with or endorsed by Sandbox Interactive. Attribution is not permission. |
| Map silhouettes and textures | `lib/worldMapSketch.ts`, `assets/map/terrain-original.png`; [visual reference](https://allthingsalbion.com/en/zones/map) | The source records hand-authored simplified silhouettes and original textures, not imported reference pixels. This does not resolve rights in underlying game geography or the reference. |

See [Data rights review](docs/data-rights.md) for affected files, provenance, and remaining publication blockers. No permission request was sent and no approval from Sandbox Interactive or AODP was obtained during this review.

## Android model downloads

Weights are downloaded at runtime, not committed as part of the intended source publication. The following labels were checked against the exact pinned model-card revisions in `lib/models.ts`:

| Model artifact repository | Declared license | Evidence |
|---|---|---|
| Qwen3.5-0.8B | `apache-2.0` | [Pinned model card](https://huggingface.co/litert-community/Qwen3.5-0.8B/raw/10243c0a01d24e6b122a0e814f8c4d984c9c92d6/README.md) |
| Qwen2.5-1.5B-Instruct | `apache-2.0` | [Pinned model card](https://huggingface.co/litert-community/Qwen2.5-1.5B-Instruct/raw/19edb84c69a0212f29a6ef17ba0d6f278b6a1614/README.md) |
| DeepSeek-R1-Distill-Qwen-1.5B | `mit` | [Pinned model card](https://huggingface.co/litert-community/DeepSeek-R1-Distill-Qwen-1.5B/raw/9fd875541bb0f277e4b3cefe7d9622c4c1de2fb5/README.md) |
| gemma-4-E2B-it-litert-lm | `apache-2.0` | [Pinned model card](https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/raw/c658da437244f072bf2f1cabc916b60d66d97663/README.md) |
| gemma-4-E4B-it-litert-lm | `apache-2.0` | [Pinned model card](https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/raw/e6a3892a8c22cf87ff99583996149cf3cb32452b/README.md) |

Gemma 4 uses [Apache 2.0](https://ai.google.dev/gemma/apache_2), unlike earlier Gemma families. The previous description applying older Gemma restrictions to Gemma 4 was incorrect. Apache 2.0 and MIT still impose applicable notice/license conditions; neither should be summarized as “no restrictions.” Model-card metadata is evidence, not a substitute for preserving the actual license and any additional artifact notices.

## Browser model choices

The browser can load different models than Android. In particular the Gemma 4 E2B entry maps to **Gemma 2 2B** on the web, which remains subject to the [Gemma terms](https://ai.google.dev/gemma/terms) and its [model card](https://huggingface.co/google/gemma-2-2b-it). Do not apply Gemma 4's Apache license to that fallback.

- [Qwen2.5 7B](https://huggingface.co/Qwen/Qwen2.5-7B-Instruct): Apache 2.0.
- [Phi-3.5 Mini](https://huggingface.co/microsoft/Phi-3.5-mini-instruct): MIT.
- [Llama 3.2 3B](https://huggingface.co/meta-llama/Llama-3.2-3B-Instruct/blob/main/LICENSE.txt): Llama 3.2 Community License, with its own conditions. Not MIT or Apache 2.0. Distribution/use-policy and attribution requirements need to be checked for the final web deployment.

## Software dependencies

- [LiteRT-LM](https://github.com/google-ai-edge/LiteRT-LM/blob/main/LICENSE): Apache 2.0; native Android dependency currently `0.17.0`.
- [Nimbus JOSE+JWT 10.10](https://repo.maven.apache.org/maven2/com/nimbusds/nimbus-jose-jwt/10.10/): Apache 2.0; used for token signature/claim validation.
- React, React Native, Expo, react-native-svg, react-native-chart-kit and react-native-paper: MIT declarations in the installed package metadata.
- WebLLM: Apache 2.0 declaration in package metadata. Its software license does not replace the licenses of downloaded models.
- `node-forge` declares `(BSD-3-Clause OR GPL-2.0)`: the BSD-3-Clause alternative is the intended distribution basis; retain its BSD notice. This is not a GPL-only dependency.

[The npm inventory](docs/licenses/npm-inventory.json) records exact lockfile versions and license declarations, including development dependencies. The separate [Android runtime corpus](docs/licenses/README.md) preserves full upstream texts for the selected JavaScript and native dependencies, including embedded LiteRT notices and native supplements. The app exposes it offline in Settings. CI checks its coverage against the release runtime; it is not a blanket legal certification. In particular desugar_jdk_libs uses GPL-2.0 with the Classpath Exception (its upstream source archive is provided), while Install Referrer declares Android SDK terms. These are not MIT dependencies.

## Optional OpenAI connection

OpenAI is an external service, not a model distributed under this repository's MIT license. The experimental OAuth integration and account-specific service access are not endorsed or authorized merely by including these notices. No credentials belong in the source repository. See [integration behavior and limitations](docs/siwc-integration.md).
