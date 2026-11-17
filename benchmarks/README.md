# ZIP64 benchmark records

The [25 GB](results/25.json), [50 GB](results/50.json) and [100 GB](results/100.json) records contain per-operation timings, request and byte counts, actual byte ranges, fixture hashes, browser version and machine details. Each file contains 20 runs. The overview in the [project README](../README.md#measured-performance) combines both nesting branches for index and log-preview medians. Nested operations keep the two branches separate.

The timing harness starts index and preview timers at browser input and ends on the animation frame that observes the expected DOM. Save timers end when the downloaded file is available on disk. Hash verification follows the timed operation.

## Index and log preview timings

Median elapsed time in milliseconds, measured on 15 November 2026

| Archive | Local index | Local log preview | HTTP index | HTTP log preview |
| ------- | ----------: | ----------------: | ---------: | ---------------: |
| 25 GB   |       104.8 |             81.05 |     140.45 |            107.2 |
| 50 GB   |        79.0 |             71.35 |      105.3 |             80.3 |
| 100 GB  |       51.15 |              55.7 |      67.55 |            52.75 |

## Measurement conditions

The 15 November 2026 benchmark used 60 fresh Chromium contexts across three sizes, two sources and two nesting methods, with five runs per combination. Each fixture had three top-level entries, an allocated text prefix, a sparse middle and real nested data beyond 99% of the outer archive. GB uses decimal bytes. The HTTP source ran on loopback on the same Linux machine with two available CPUs and 7.7 GiB RAM. Timings exclude browser startup, page load and file selection. OS caches were shared and machine load varied. These measurements describe selective reads on this setup. Mobile networks, full archive extraction and archives with many thousands of filenames were outside this benchmark.

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

The remote stored path used 197,425 bytes to reach the receipt. Opening the deflated parent used 34,624,638 bytes at that step. These numbers come from an earlier build and fixture. [Individual measurements](results/early-nesting.json)

In a separate cancellation check, an origin delayed its response by 850 ms. After the fix, aborting an in-flight prefix read settled in 12 ms, compared with 861 ms before the fix. This was a single comparison on loopback.

</details>

### Browser checks

A separate 100 GB local-file smoke test verified the text prefix and nested receipt on Chromium 158, Firefox 159 and WebKit 27.2. The interface also passed 16 Playwright states on five desktop, tablet and phone configurations, covering dialogs, file previews, downloads, nested links, empty archives and errors. The 25–100 GB timings above come from the earlier archive-engine benchmark. A [clean-build recheck](results/100-release-check.json) repeated the four 100 GB source and nesting combinations and matched the archive byte counts. Its four runs are recorded separately from the 60-run timings.

## Reproduce the historical measurements

The published runner exercised two nested levels and a separate HTTP origin. Current PeekZip permits one nested level and the viewer’s own origin. To reproduce the recorded workload, run both the app and the runner from the following historical checkout. For current release checks use [the Playwright suite](../CONTRIBUTING.md#before-opening-a-pull-request).

```sh
git worktree add --detach ../peekzip-benchmark 0d75c7e058bb50fd52875d2aa6a9cb21741f76fd
cd ../peekzip-benchmark
```

Use Linux with a sparse-file-capable filesystem, Python 3, Node.js 24 and pnpm. The three fixtures occupy about 0.45 GB on the original ext4 filesystem but represent 175 GB of logical data. Copying them to a filesystem without sparse support can allocate their full size.

From the repository root, build and serve the application in one terminal

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm run preview --host 127.0.0.1 --port 4421
```

In another terminal, also from the repository root, run the benchmark in an ignored directory. The benchmark starts its own range-capable HTTP origin for the fixtures

```sh
mkdir -p .local/zip64
cp benchmarks/bench.mjs benchmarks/generate.py .local/zip64/
cd .local/zip64
pnpm init
pnpm add -D playwright@1.65.0
pnpm exec playwright install chromium
python3 generate.py fixtures 25 50 100
for size in 25 50 100; do
  node bench.mjs http://127.0.0.1:4421 "fixtures/$size" "$size.json" 5 || break
done
```

The checked-in JSON is a historical record. Keep new output under `.local/` when comparing a change.
