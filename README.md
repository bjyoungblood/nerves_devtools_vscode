# Nerves Devtools

The Nerves Devtools VS Code extension provides monitoring of telemetry and remote
code execution / module replacement on [Nerves] devices.

## Requirements

- A Nerves device with `:nerves_ssh` v1.1.0 or later

## Setup and usage

Before adding a device, navigate to the Nerves Devtools section of your VS Code
Settings and ensure the path to the SSH private key is valid. If you're using an
SSH Agent, it will be used for authentication before an explicit private key is
attempted.

Next, open the Nerves Devtools pane in the VSCode activity bar or run
`Nerves Devtools: Add Device` from the command palette. You'll be prompted for the
device's ip/hostname and a name/label for the device.

After adding a device, it will appear in the Nerves Devtools panel in the activity
bar. From there, you can connect to the device to view telemetry and other metadata.

When connecting to a device for the first time, an SSH subsystem will be installed
to provide an API for the extension. This subsystem will only persist until the
device's next reboot.

To upload and compile an Elixir source file on a device, run
`Nerves Devtools: Run on device` from the command palette or click the run icon
in the title bar. Remember that `mix` is not available on the device, so if the
module body contains any calls to `Mix.env()` or similar, the module will fail
to compile. Compiler diagnostic messages will be available in the Output pane.

[Nerves]: https://nerves-project.org/
