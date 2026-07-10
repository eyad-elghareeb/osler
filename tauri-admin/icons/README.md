# Icons

Tauri requires platform-specific icons in this folder. Before building, run:

```bash
cd tauri-admin
cargo tauri icon path/to/your-icon.png
```

This generates all required sizes from a single source PNG (recommended
1024×1024). For quick local testing you can copy any 32×32 / 128×128 PNG
here as `32x32.png` and `128x128.png` respectively, plus an `icon.ico`
on Windows.

If you skip this step, `cargo tauri dev` will still work but
`cargo tauri build` will fail at the bundling step.
