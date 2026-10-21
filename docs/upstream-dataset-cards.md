# Upstream Dataset cards

The Dataset card tab renders the original README from the same pinned raw archive as the source data. It does not maintain a second, hand-written copy of the publisher's description. The implementation is shared by all fifteen source Datasets; all fifteen archived READMEs were verified readable locally.

## Content and provenance

- Preview renders the archived Markdown with headings, lists, tables, links, code and citations. The complete original YAML and Markdown are available through Raw Markdown and Download README.
- Tasks, languages, size category, license and tags come from the upstream YAML. The entire YAML remains inspectable, including configurations and split file definitions.
- Source attribution identifies the repository, README filename, immutable revision, license, byte size and SHA-256. Each read validates the lock's size and SHA-256 or Git blob hash. A mismatch returns HTTP 409 rather than silently displaying modified content.
- The source document retains its original wording, authors and citation. Veritas-specific Testing notes appear after a separate attribution boundary.
- Source images that are raster files in the pinned archive are served locally after the same integrity checks. Other images appear as explicit upstream links, without automatic remote loading.

For Aegis, the archived card is the original **Nemotron Content Safety Dataset V2** README, including dataset description, annotation methods, safety taxonomy, limitations, ethical statement, citation and author contacts. The existing recommended Testing scope remains `default / test`.

## Reading and navigation

The card has Preview / Raw Markdown controls, download and refresh actions, a heading-based table of contents, source metadata and provenance. The card renderer is lazy-loaded and fetched through a separate TanStack Query key containing Dataset ID and revision. Metadata and complete source rows retain their existing queries.

`/#/datasets/aegis?tab=card` opens the card directly. A section can be linked with `section=upstream-citation`. Section navigation scrolls and focuses the corresponding heading without changing the app route. Relative source-file links retain the pinned repository revision; absolute external links retain their upstream destination. Unknown local fragments open on the original upstream README.

The renderer reuses `react-markdown`, `remark-gfm`, `yaml`, `github-slugger` and standard Markdown AST utilities. Raw HTML is not executed; presentational `<br>` tags are converted to line breaks in Preview. The original file stays untouched. Arbitrary scripts, unsafe URL protocols and automatic external image requests are excluded from the rendered document. Raw HTML-heavy upstream cards may have presentation differences; their source remains complete in Raw and the download.

## Updating an upstream version

1. Update the source's immutable revision and file hashes in `catalog/raw-datasets.lock.json`, and align its revision/scopes in `catalog/datasets.json`.
2. Download and verify that pinned source using `npm run veritas -- datasets download --dataset aegis`. Preserve the old revision directory for historical provenance. The generic downloader's exit status reports completeness across all fifteen sources; inspect its per-source manifest when resuming one source.
3. Refresh the Dataset registry/card and inspect the new source metadata. The card follows the new archived README automatically. No UI text needs to be recopied, and an ordinary card refresh does not fetch upstream HEAD or modify Testing mappings.
4. Run `npm test` and `npm run build`, then inspect the Dataset card and recommended Testing scope.

The card API reads local files only. Browsing the card or downloading its Markdown makes no Guard request and does not create a Run.

## API

| Method | Route | Response |
| --- | --- | --- |
| GET | `/api/datasets/{id}/card` | Original body/raw text, parsed YAML, headings, available archived images and source provenance |
| GET | `/api/datasets/{id}/card/raw` | Original Markdown attachment, byte-for-byte equivalent to the archived UTF-8 file |
| GET | `/api/datasets/{id}/card/asset?path=images/example.png` | A verified PNG/JPEG/GIF/WebP from the same lock-listed source archive |

Unknown sources/files and missing archives return 404. Integrity or revision-alignment failures return 409. README display is bounded to 2 MiB and raster images to 10 MiB. Caller-supplied filesystem paths, arbitrary file types and network image proxies are not accepted.

References: [upstream Aegis Dataset card](https://huggingface.co/datasets/nvidia/Aegis-AI-Content-Safety-Dataset-2.0), [react-markdown](https://github.com/remarkjs/react-markdown), [remark-gfm](https://github.com/remarkjs/remark-gfm), [YAML](https://eemeli.org/yaml/).
