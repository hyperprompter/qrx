# CLI

`cli.sh` is a Bash port of the QRx kernel. It reimplements the browser’s hyperlink-as-tape protocol as an interactive terminal prompt, letting you navigate namespaces, mutate the accumulator, chain operations, and persist results to the local `data/` directory without IndexedDB.

Run it with no arguments to enter the REPL:

```sh
./cli.sh
```

Or execute a tape directly:

```sh
./cli.sh 'main#hello?e=world&w'
```

The CLI addresses files as `namespace#path`, falls back to `main` when a key is not found, and stores AI configuration in `~/.config/qrx`. Its flag behavior follows the Core flags section above.
