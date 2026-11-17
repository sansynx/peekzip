# PeekZip

Browse a ZIP in your browser and download individual files. Local ZIPs stay on your device. Hosted ZIPs use HTTP byte ranges.

[Live demo](https://peekzip.vercel.app/) · [Try the sample map](https://peekzip.vercel.app/#v=1&src=https%3A%2F%2Fpeekzip.vercel.app%2Fsample%2Ffield-notes.zip&file=maps%2Fcontour-study.png)

## Features

- Search by filename or path. Preview text, images, and CSV tables.
- Browse one nested ZIP. Share a selected file for 24 hours without sending the rest of your ZIP.
- Open local files or direct ZIP URLs hosted on the viewer’s own origin.

## How it works

```mermaid
flowchart LR
    accTitle: How PeekZip reads a ZIP
    accDescr: PeekZip reads the archive index, lets you select an entry, then reads that file for preview or download.
    subgraph browser["In your browser"]
        direction LR
        index["Read ZIP index"] --> pick["Pick a file"] --> view["Preview or save"]
    end
    style browser fill:#000,stroke:#666,color:#fff
    classDef step fill:#191919,stroke:#aaa,color:#fff
    class index,pick,view step
    linkStyle default stroke:#ffdb83
```

## Run locally

Requires Node.js 24 and pnpm 12.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

## Measured performance

**65,857 bytes** transferred to read the index of a 100 GB, three-entry ZIP64 fixture over loopback HTTP. [Benchmark results](https://github.com/sansynx/peekzip/blob/0d75c7e058bb50fd52875d2aa6a9cb21741f76fd/benchmarks/README.md)

[Contributing](CONTRIBUTING.md) · [Security and limits](SECURITY.md) · [MIT license](LICENSE)
