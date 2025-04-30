# Nerves Devtools

The Nerves Devtools VSCode extension is part of the [Nerves Devtools] ecosystem.
When paired with a [Nerves] device running [Nerves Dev Server], this extension
allows for monitoring of telemetry and remote code execution / module replacement.

## Setup and usage

After installing [Nerves Dev Server] on one or more Nerves devices, open the
Nerves Devtools pane in the VSCode activity bar or run `Nerves Devtools: Add Device`
from the command palette. You'll be prompted for the device's ip/hostname
and Nerves Dev Server port, a name/label for the device, and the auth token secret.

After adding a device, it will appear in the Nerves Devtools panel in the activity
bar. From there, you can connect to the device to view telemetry and other metadata.

To upload and compile an Elixir source file on a device, run
`Nerves Devtools: Run on device` from the command palette. Remember that `mix` is not
available on the device, so if the module body contains any calls to `Mix.env()`
or similar, the module will fail to compile.

[Nerves Devtools]: https://github.com/bjyoungblood/nerves_devtools_vscode
[Nerves]: https://nerves-project.org/
[Nerves Dev Server]: https://github.com/bjyoungblood/nerves_dev_server
