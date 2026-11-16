<p align="center"><img src="public/mark.svg" width="72" height="72" alt="peekzip logo"></p>

# peekzip

Open a ZIP, see what’s inside, and download the file you came for. Choose a ZIP from your device or paste a direct link. For remote archives, peekzip reads the file list first and fetches the bytes needed for the entry you select.

**[Open the live dashboard](https://peekzip.vercel.app)** and choose **Try a sample** to explore a real archive with a map, a CSV, and two nested ZIPs.

## What you can do

- Search filenames and paths, preview text, images, or CSV tables, and save individual entries
- Open a ZIP inside another ZIP and return to the parent archive
- Share a link to a specific entry, even inside a nested ZIP. Hosted archives open directly. Local archives open when the recipient chooses their copy
- On phones, switch between **Files** and **Preview** without losing your search. With a keyboard, use the arrow keys, Home, or End in the index, Enter to preview, and Escape to return or cancel a read

## What leaves your device

Local archives stay in the browser. Opening a remote ZIP connects your browser directly to its host. The host sees those requests. The viewer bundles its fonts and scripts and uses no analytics, upload service, or archive storage.

The remote host must return HTTP 206 responses to byte-range requests. Cross-origin hosts must allow the viewer origin through CORS and expose the `Content-Range` header. If the host only offers a full download, peekzip stops.

A hosted archive link includes the original archive URL and selected path in the URL fragment. A recipient can see both and can access whatever the original URL allows, including other entries. Hosted links are available for remote URLs without query strings or fragments. For a local ZIP, **Share file** creates a link containing the archive name, byte size and selected path. Send the archive separately if needed. The recipient chooses their matching local copy and peekzip opens the selected entry.

## Measured performance

In the **100 GB ZIP64 test**, listing the remote archive transferred **65,857 bytes**. Previewing the first **192 KiB** of a stored log transferred another **196,676 bytes** including header reads. Local opens generated **zero archive network requests**.

Median elapsed time in milliseconds, measured on 15 November 2026

| Archive | Local index | Local log preview | HTTP index | HTTP log preview |
| ------- | ----------: | ----------------: | ---------: | ---------------: |
| 25 GB   |       104.8 |              81.0 |      140.4 |            107.2 |
| 50 GB   |        79.0 |              71.3 |      105.3 |             80.3 |
| 100 GB  |        51.1 |              55.7 |       67.5 |             52.8 |

**Method** · 60 fresh Chromium contexts across three sizes, two sources and two nesting methods, with five runs per combination. Each fixture had three top-level entries, an allocated text prefix, a sparse middle and real nested data beyond 99% of the outer archive. GB uses decimal bytes. The HTTP source ran on loopback on the same Linux machine with two available CPUs and 7.7 GiB RAM. Timings exclude browser startup, page load and file selection. OS caches were shared and machine load varied. These measurements describe selective reads on this setup. Mobile networks, full archive extraction and archives with many thousands of filenames were outside this benchmark.

All 60 preview prefixes and 120 downloaded files matched independent SHA-256 references. The stored nested path in the 100 GB remote fixture needed **197,421 bytes** to reach its receipt, compared with **34,690,490 bytes** for the deflated path. Saving the cached receipt generated zero additional archive requests.

<details>
<summary>Nested ZIP timings and transferred bytes for all sizes</summary>

Each timing is a median in milliseconds over five runs. The last column includes the outer index, both inner indexes and the receipt preview. It excludes the separate log preview and binary download.

| archive (GB) | source | inner ZIP methods | inner 1 | inner 2 | receipt preview | save cached receipt | save 32 MiB binary | HTTP bytes for index + nested receipt path |
| -----------: | ------ | ----------------- | ------: | ------: | --------------: | ------------------: | -----------------: | -----------------------------------------: |
|           25 | local  | stored            |    37.5 |    30.1 |           115.7 |                57.3 |              914.9 |                                          0 |
|           25 | local  | deflated          |   529.2 |   415.7 |            30.3 |                61.1 |              865.6 |                                          0 |
|           25 | remote | stored            |    66.1 |    55.2 |           156.7 |                48.6 |             1142.5 |                                    197,420 |
|           25 | remote | deflated          |   646.6 |   362.6 |            27.5 |                35.3 |              853.7 |                                 34,690,489 |
|           50 | local  | stored            |    30.1 |    30.4 |            95.2 |                32.1 |              768.1 |                                          0 |
|           50 | local  | deflated          |   427.4 |   279.6 |            30.2 |                54.4 |              771.8 |                                          0 |
|           50 | remote | stored            |    47.1 |    47.0 |            95.3 |                30.2 |              835.5 |                                    197,420 |
|           50 | remote | deflated          |   626.6 |   411.7 |            29.8 |                28.7 |              782.3 |                                 34,690,489 |
|          100 | local  | stored            |    30.0 |    30.1 |            63.9 |                22.6 |              642.4 |                                          0 |
|          100 | local  | deflated          |   296.9 |   247.8 |            30.2 |                25.9 |              622.8 |                                          0 |
|          100 | remote | stored            |    46.9 |    31.6 |            80.6 |                26.4 |              721.0 |                                    197,421 |
|          100 | remote | deflated          |   446.7 |   230.0 |            30.2 |                28.0 |              519.1 |                                 34,690,490 |

</details>

<details>
<summary>Earlier nesting benchmark and cancellation check</summary>

A separate 20-run test used a 5,511,338,131-byte sparse ZIP64 archive. Each row is the median of five fresh Chromium contexts, in milliseconds.

| Source and nesting | Open ZIP | Open level 1 | Open level 2 | Preview text | Save preview | Save 32 MiB |
| ------------------ | -------: | -----------: | -----------: | -----------: | -----------: | ----------: |
| local-stored       |     47.5 |           30 |         30.3 |         64.4 |         23.6 |       480.3 |
| local-deflated     |     48.3 |        280.7 |        246.2 |         30.1 |         25.7 |       498.1 |
| remote-stored      |     63.1 |         46.6 |         30.3 |         81.2 |         24.2 |       645.7 |
| remote-deflated    |     67.8 |        479.3 |        230.1 |         30.1 |         25.6 |       498.2 |

The remote stored path used 197,425 bytes to reach the receipt. Opening the deflated parent used 34,624,638 bytes at that step. These numbers come from an earlier build and fixture. [Individual measurements](benchmarks/results/early-nesting.json)

In a separate cancellation check, an origin delayed its response by 850 ms. After the fix, aborting an in-flight prefix read settled in 12 ms, compared with 861 ms before the fix. This was a single comparison on loopback.

</details>

**Browser checks** · A separate 100 GB local-file smoke test verified the text prefix and nested receipt on Chromium 158, Firefox 159 and WebKit 27.2. The interface also passed 16 Playwright states on five desktop, tablet and phone configurations, covering dialogs, file previews, downloads, nested links, empty archives and errors. The 25–100 GB timings above come from the earlier archive-engine benchmark. A [clean-build recheck](benchmarks/results/100-release-check.json) repeated the four 100 GB source and nesting combinations and matched the archive byte counts. Its four runs are recorded separately from the 60-run timings.

[Recorded measurements and reproduction steps](benchmarks/README.md)

## Limits

| Operation                 | Current limit                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Archive index             | 100,000 entries and 32 MiB per index read                                                                                                        |
| Full preview input        | 16 MiB, with at most 192 KiB rendered as text and up to 100 rows by 24 columns for CSV                                                           |
| Larger stored text or CSV | First 192 KiB, with a partial-preview label and no whole-file checksum verification                                                              |
| Save one complete file    | 256 MiB                                                                                                                                          |
| Nested ZIPs               | Four levels. Stored children use slices of their parent. Compressed children expand in memory, up to 64 MiB each and 128 MiB along the open path |
| Encrypted entries         | Password-protected entries cannot be opened                                                                                                      |

## Run locally

Use Node.js 24 and pnpm 12

```sh
pnpm install --frozen-lockfile
pnpm run dev
```

To build and serve the static site locally

```sh
pnpm run build
pnpm run preview
```

## Project

Built with Astro, TypeScript and zip.js. See [contributing](CONTRIBUTING.md) for development checks and [security](SECURITY.md) for private reporting.

Code is [MIT licensed](LICENSE). The bundled [Instrument Sans](public/fonts/InstrumentSans-LICENSE.txt), [Instrument Serif](public/fonts/InstrumentSerif-LICENSE.txt) and [Phosphor icons](public/phosphor-license.txt) retain their respective notices.
