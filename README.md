# Auto-Relate

A Zotero 7 plugin that automatically adds **Related Items** based on citation data from [OpenAlex](https://openalex.org/).

When you add a new paper to your library, Auto-Relate queries OpenAlex to find its references and citing papers, then links any that already exist in your library as Zotero Related Items. These relations flow into tools like Obsidian (via Better BibTeX), automatically forming a citation knowledge graph.

## Features

- **Automatic**: Runs in the background when new items are added
- **Manual**: Right-click selected items → "Find Related Items (OpenAlex)"
- **Bidirectional**: Links both references (papers it cites) and citing papers (papers that cite it)
- **Library-only**: Only creates relations between papers already in your library

## Install

1. Download the latest `.xpi` from [Releases](../../releases)
2. In Zotero: Tools → Plugins → gear icon → Install Plugin From File
3. Select the `.xpi` file

## Configuration

Set your email for the [OpenAlex polite pool](https://docs.openalex.org/how-to-use-the-api/rate-limits-and-authentication#the-polite-pool) (faster rate limits):

1. Zotero → Settings → Advanced → Config Editor
2. Search for `extensions.autorelate.email`
3. Set to your email address

## How it works

1. Listens for new items added to your library
2. Waits a few seconds for metadata to populate
3. Queries OpenAlex for the paper's references and citing papers
4. Matches DOIs against your library
5. Adds bidirectional Related Item links in Zotero

## Requirements

- Zotero 7.0+
- Papers must have DOIs for matching to work

## Build from source

```bash
./build.sh
```

Produces `auto-relate@shae.dev.xpi` in the parent directory.

## License

MIT
