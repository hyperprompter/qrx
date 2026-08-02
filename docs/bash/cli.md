# CLI

> these docs are still AI slop, i need to manually rewrite this but it's accurate in its representation

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

---

# Work in Progress

- **`x` is missing.** The browser kernel supports JavaScript execution, but the CLI silently ignores `?x=`. This is intentional for now as I'm unsure whether we should interpret JavaScript or shell commands
- **URL decoding isn’t quite equivalent to `URLSearchParams`.** `+` remains a literal plus instead of becoming a space, and the current decoding can interpret pre-existing backslash sequences as escapes
- **Default AI suffix has a literal `\n`.** The fallback `NO MARKDOWN...` prompt currently gets a backslash-and-`n`, not an actual newline
- **Exact kernel parity gaps:** no `boot/*` execution, no special `?c=src`, and no browser-style autoloading of unknown flags from files
- **Paths are unsanitized.** A key containing `../` can escape `./data`. Probably acceptable for a personal local CLI, but risky if AI-generated hyperlinks are ever executed automatically
- **Cache keys don’t match the browser/server format and can collide.** Replacing `/` with `_` means different URLs can map to the same cache file.
- **`DATA_DIR="./data"` is cwd-sensitive.** Running the script outside the repo root will use or create a different `./data`.
- Minor: interactive `read` should ideally use raw mode, `curl`/`jq` aren’t checked before use, and Bash command substitutions strip trailing newlines from file content.
