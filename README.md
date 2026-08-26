<h1 align="center">Rome Apps</h1>

<p align="center">
  <strong>Official apps for Rome, the agentic OS for humans and agents.</strong>
</p>

<p align="center">
  <a href="https://github.com/rome-os/rome-apps/actions/workflows/ci.yml">
    <img alt="CI" src="https://github.com/rome-os/rome-apps/actions/workflows/ci.yml/badge.svg" />
  </a>
  <a href="LICENSE">
    <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg" />
  </a>
  <a href="https://x.com/RomeAILab">
    <img alt="Follow Rome on X" src="https://img.shields.io/badge/follow-%40RomeAILab-black?logo=x&amp;logoColor=white" />
  </a>
  <a href="https://discord.gg/g7EFmEtmqc">
    <img alt="Join the Rome Discord server" src="https://img.shields.io/badge/chat-Discord-5865F2?logo=discord&amp;logoColor=white" />
  </a>
</p>

<p align="center">
  <a href="https://romeos.cc/">Website</a>
  ·
  <a href="https://github.com/rome-os/rome">Rome</a>
  ·
  <a href="https://romeos.cc/docs/building-apps">Documentation</a>
  ·
  <a href="https://romeos.cc/store">App Store</a>
</p>

## What is this repository?

This monorepo contains Rome OS's first-party apps. A Rome App can combine typed actions, purpose-built agents, reusable skills, APIs, web interfaces, and persistent app-owned data in one installable package.

Each directory under [`apps/`](apps/) is an independent app package with an `app.yaml` manifest. Apps use the same public contracts available to community builders; the Rome runtime itself lives in the [`rome-os/rome`](https://github.com/rome-os/rome) repository.

## Apps

| App | What it does |
| --- | --- |
| [Brainstorm](apps/brainstorm/) | Turns rough ideas into approved design specifications before implementation |
| [Code Review](apps/code-review/) | Reviews GitHub pull requests, posts inline findings, and tracks review history |
| [Company Research](apps/company-research/) | Builds structured company, market, team, financing, and product research |
| [Discord Digest](apps/discord-digest/) | Periodically summarizes Discord channel activity |
| [Facebook](apps/facebook/) | Extracts public Facebook page data |
| [Learning](apps/learning/) | Provides learning and vocabulary actions |
| [LinkedIn](apps/linkedin/) | Automates LinkedIn research, messaging, and job workflows |
| [Memory](apps/memory/) | Adds reusable memory and relationship-management skills |
| [News](apps/news/) | Ingests news and Reddit sources into scheduled workflows |
| [Reddit Radar](apps/reddit/) | Monitors Reddit topics with scheduled ingestion and a web dashboard |
| [RomeTable](apps/rome-table/) | Browses Rome system and app database tables |
| [SEO](apps/seo/) | Provides SEO and GEO research, audit, content, schema, and reporting workflows |
| [Stock Daily](apps/stock-daily/) | Generates and stores daily US stock-market close reports |
| [Summary](apps/summary/) | Produces project summaries from Rome conversations, channels, and GitHub activity |
| [AI Survey Builder](apps/survey/) | Turns research goals into conversational AI-native surveys |
| [Utility](apps/utility/) | Adds licensed visual design, frontend, MCP, skill-authoring, artifact, and testing skills |
| [X Manager](apps/x-manager/) | Manages X content, replies, brand voice, and metrics |
| [Xiaohongshu](apps/xiaohongshu/) | Automates Xiaohongshu research, engagement, drafts, and publishing |

Browse installable releases in the [Rome App Store](https://romeos.cc/store).

## Develop an app

You need Node.js 24.11.1 or newer and pnpm 10.33.2 or newer.

```bash
git clone https://github.com/rome-os/rome-apps.git
cd rome-apps
corepack enable
pnpm install
pnpm typecheck
pnpm test
```

Build a single app with its workspace script:

```bash
pnpm --filter "./apps/<app-id>" run build
```

The exact local install and validation flow depends on the app surface. Read the [Rome App building guide](https://romeos.cc/docs/building-apps) and [`CONTRIBUTING.md`](CONTRIBUTING.md) before submitting a change.

## Repository map

| Path | Contents |
| --- | --- |
| [`apps/`](apps/) | Independent Rome App packages |
| `packages/` | Reserved shared packages |
| [`.github/workflows/`](.github/workflows/) | CI and App Store publishing workflows |
| [`AGENTS.md`](AGENTS.md) | Repository-specific development and verification instructions |

## Contributing and support

- Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening a pull request.
- Use [GitHub Issues](https://github.com/rome-os/rome-apps/issues) for reproducible bugs and scoped feature requests.
- Use the [Rome documentation](https://romeos.cc/docs/rome) or [Discord community](https://discord.gg/g7EFmEtmqc) for usage questions.
- Report security issues privately as described in [`SECURITY.md`](SECURITY.md).

## License

Original Rome Apps source code is available under the [MIT License](LICENSE). Third-party materials retain their original licenses; see [`NOTICES.md`](NOTICES.md) and license files next to those materials.
