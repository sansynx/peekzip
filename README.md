<p align="center"><img src="public/mark.svg" width="72" height="72" alt="peekzip logo"></p>

# peekzip

Look inside a ZIP and download just the file you need. Open a local archive or paste a direct ZIP URL from the viewer’s own origin. For a remote ZIP, peekzip reads the index first and fetches the bytes needed for your selection.

[Open the sample map in PeekZip](https://peekzip.vercel.app/#v=1&src=https%3A%2F%2Fpeekzip.vercel.app%2Fsample%2Ffield-notes.zip&file=maps%2Fcontour-study.png) or [download the sample ZIP](https://peekzip.vercel.app/sample/field-notes.zip). The small diagram on the [home page](https://peekzip.vercel.app/) shows the read sequence and is rendered at build time with [Pele](https://pele.run/).

## Browse an archive

- Search by filename or path. Preview text, images and CSV tables, then choose **Save file** to download an entry.
- Open one ZIP inside the root archive. A ZIP inside that child stays closed. On phones, switch between **Files** and **Preview**.
- Press `/` to search. After opening a file, use `↑` and `↓` for adjacent previews or `?` for the shortcut guide.

## Privacy and sharing

The viewer bundles its scripts and fonts and has no analytics or archive storage.

- **Local ZIPs** stay in your browser. **Share file** creates a link containing the archive name, size and selected path. The recipient needs their own copy of the ZIP.
- **Hosted ZIPs** are read directly from the source. A share link includes the source URL and selected path. Recipients with access can browse other entries. Sharing is disabled for source URLs containing a query string or fragment.
- **Hosting a ZIP?** Serve a direct absolute HTTP(S) URL with the same scheme, hostname and port as the viewer and a path ending in `.zip`. On production this means `https://peekzip.vercel.app`. The server must respond to byte ranges with HTTP `206` and a valid `Content-Range`. Redirects and credentialed requests are blocked. To inspect a ZIP from another site, download it and choose the local file.

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
| Nested ZIPs              | One child deep. Stored children use ranges. Compressed children can expand to at most 64 MiB |

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
