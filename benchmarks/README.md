# ZIP64 benchmark records

The [25 GB](results/25.json), [50 GB](results/50.json) and [100 GB](results/100.json) records contain per-operation timings, request and byte counts, actual byte ranges, fixture hashes, browser version and machine details. Each file contains 20 runs. The overview in the [project README](../README.md#measured-performance) combines both nesting branches for index and log-preview medians. Nested operations keep the two branches separate.

The timing harness starts index and preview timers at browser input and ends on the animation frame that observes the expected DOM. Save timers end when the downloaded file is available on disk. Hash verification follows the timed operation.

## Reproduce

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
