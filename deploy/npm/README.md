# SivitaCode npm launcher

English | [中文](README.zh.md)

This is the small official discovery launcher for [SivitaCode](https://github.com/Maggotxy/sivitacode), a Web-first self-hosted coding agent. It downloads the version-pinned GitHub Release bootstrap, verifies its SHA-256 digest, installs the matching checksum-verified server artifact through the same atomic installer used by other deployment routes, and then runs the installed command.

```sh
npx sivitacode
```

With no arguments the launcher starts `sivitacode web`. Arguments are forwarded unchanged:

```sh
npx sivitacode --version
npx sivitacode run "inspect this repository and run its tests"
```

For a persistent command, use `npm install --global sivitacode`. The core installation remains under `~/.local/share/sivitacode`, and the stable command is `~/.local/bin/sivitacode`. Rerunning the launcher skips the download when that command already reports the pinned core version.

The current preview provides a Linux x64 server artifact and requires Node.js 22.19 or newer, `sh`, `curl`, and `tar`. Use the repository's Docker Compose definitions for persistent public servers. npm is only the lightweight launcher; immutable GitHub Release assets remain the product-byte source and rollback boundary.
