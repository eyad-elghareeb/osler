---
id: art-image-support-demo
title: Using Images in Library Articles
specialty: Demos
system: Content Authoring
readTimeMin: 3
tags:
  - demo
  - images
  - authoring
---

# Using Images in Library Articles

This article demonstrates how Library markdown references images stored in an
`images/` folder next to the `.md` file — the same convention used by the
QBank and Flashcard engines.

## How it works

Place image files in an `images/` subfolder beside your markdown file, then
reference them with a relative path:

```md
![Alt text](images/ecg-lead-ii.svg)
```

Bare filenames are also supported and resolve to the `images/` folder
automatically:

```md
![Alt text](ecg-lead-ii.svg)
```

## Example

Below is an ECG tracing stored at `images/ecg-lead-ii.svg` and referenced as
`images/ecg-lead-ii.svg`:

![Example ECG lead II with ST elevation](images/ecg-lead-ii.svg)

Absolute URLs, `data:` URIs, and `/`-rooted paths are left untouched and used
verbatim. Tap any image in the reader to open it in the lightbox.
