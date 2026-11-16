<p align="center"><img src="public/mark.svg" width="72" height="72" alt="peekzip logo"></p>

# peekzip

Look inside a ZIP and download just the file you need. Open a local archive or paste a direct ZIP URL. For a remote ZIP, peekzip reads the index first and fetches the bytes needed for your selection.

**[Try peekzip](https://peekzip.vercel.app)** → **Try a sample** → open the map, the CSV or a nested ZIP

## Browse an archive

- Search by filename or path. Preview text, images and CSV tables, then choose **Save file** to download an entry.
- Open a nested ZIP to browse its contents. On phones, switch between **Files** and **Preview**.
- Press `/` to search. After opening a file, use `↑` and `↓` for adjacent previews or `?` for the shortcut guide.

## Privacy and sharing

The viewer bundles its scripts and fonts and has no analytics or archive storage.

- **Local ZIPs** stay in your browser. **Share file** creates a link containing the archive name, size and selected path. The recipient needs their own copy of the ZIP.
- **Hosted ZIPs** are read directly from the source. A share link includes the source URL and selected path. Recipients with access can browse other entries. Sharing is disabled for source URLs containing a query string or fragment.
- **Hosting a ZIP?** Serve byte ranges with HTTP `206`. For cross-origin access, allow the viewer origin through CORS and expose `Content-Range`. If the host serves only full downloads, peekzip stops.

## Measured performance

Opening the **100 GB** remote test ZIP transferred **65,857 bytes** for the index. Previewing the first **192 KiB** of a stored log transferred another **196,676 bytes**.

| ZIP size | Local index | Remote index |
| -------- | ----------: | -----------: |
| 25 GB    |      105 ms |       140 ms |
| 50 GB    |       79 ms |       105 ms |
| 100 GB   |       51 ms |        68 ms |

Medians rounded to the nearest millisecond from 60 Chromium runs with three-entry ZIP64 fixtures on one machine. Remote reads used loopback HTTP. [Preview timings, raw results and reproduction steps](benchmarks/README.md)

## Limits

| Operation                | Limit                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------- |
| Index                    | 100,000 entries and 32 MiB per index read                                                           |
| Preview                  | 16 MiB per file. Text renders up to 192 KiB and CSV renders up to 100 rows × 24 columns             |
| Large stored text or CSV | First 192 KiB only. Prefix previews skip whole-file checksum verification                           |
| Save                     | 256 MiB per file                                                                                    |
| Nested ZIPs              | Four levels. Compressed children expand in memory up to 64 MiB each and 128 MiB along the open path |

Password-protected entries cannot be opened.

## Run locally

Use Node.js 24 and pnpm 12

```sh
pnpm install --frozen-lockfile
pnpm run dev
```

[Contributing and build checks](CONTRIBUTING.md) · [Report a security issue](SECURITY.md)

## License

peekzip is [MIT licensed](LICENSE). Bundled assets have their own notices for [Instrument Sans](public/fonts/InstrumentSans-LICENSE.txt), [Instrument Serif](public/fonts/InstrumentSerif-LICENSE.txt) and [Phosphor icons](public/phosphor-license.txt).
