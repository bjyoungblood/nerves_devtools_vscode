defmodule NervesDevtools.Subsystem do
  alias Nerves.Runtime.KV
  require Logger

  @default_telemetry_interval :timer.seconds(5)

  @behaviour :ssh_client_channel

  @impl :ssh_client_channel
  @spec init(any()) :: {:ok, %{cm: nil, id: nil, telemetry_interval: pos_integer()}}
  def init(version) do
    Logger.debug("Client connected")

    {:ok, %{id: nil, cm: nil, telemetry_interval: @default_telemetry_interval, version: version}}
  end

  @impl :ssh_client_channel
  def handle_msg({:ssh_channel_up, channel_id, cm}, state) do
    state = %{state | id: channel_id, cm: cm}
    after_connect(state)
    {:ok, state}
  end

  def handle_msg(:telemetry, state) do
    send_telemetry(state)
    {:ok, state}
  end

  def handle_msg(message, state) do
    Logger.debug("Ignoring message #{inspect(message)}")

    {:ok, state}
  end

  @impl :ssh_client_channel
  def handle_ssh_msg({:ssh_cm, _cm, {:data, _channel_id, 0, data}}, state) do
    Logger.info("Incoming: #{inspect(data)}")

    case decode_command(data) do
      {:ok, request_id, cmd, payload} ->
        {status, result} = handle_command(cmd, payload)
        send_data(state, %{"status" => status, "result" => result, "requestId" => request_id})
        {:ok, state}

      {:error, reason, maybe_request_id} ->
        send_data(state, %{
          "status" => :error,
          "result" => "Invalid command or JSON",
          "requestId" => maybe_request_id
        })

        {:ok, state}
    end
  rescue
    err ->
      Logger.error("Failed to handle command: #{inspect(err)}")
      send_data(state, %{"status" => :error, "result" => "Internal error"})
      {:ok, state}
  end

  def handle_ssh_msg({:ssh_cm, _cm, {:data, _channel_id, 1, data}}, state) do
    # Ignore stderr
    Logger.info("stderr: #{inspect(data)}")
    {:ok, state}
  end

  def handle_ssh_msg({:ssh_cm, _cm, {:eof, _channel_id}}, state) do
    {:ok, state}
  end

  def handle_ssh_msg({:ssh_cm, _cm, {:signal, _, _}}, state) do
    # Ignore signals
    {:ok, state}
  end

  def handle_ssh_msg({:ssh_cm, _cm, {:exit_signal, _channel_id, _, _error, _}} = msg, state) do
    Logger.info("handle_ssh_msg: #{inspect(msg, pretty: true)}")
    {:stop, :normal, state}
  end

  def handle_ssh_msg({:ssh_cm, _cm, {:exit_status, _channel_id, _status}} = msg, state) do
    Logger.info("handle_ssh_msg: #{inspect(msg, pretty: true)}")
    {:stop, :normal, state}
  end

  def handle_ssh_msg({:ssh_cm, _cm, message}, state) do
    Logger.debug("Ignoring handle_ssh_msg #{inspect(message)}")
    {:ok, state}
  end

  @impl :ssh_client_channel
  def handle_call(_request, _from, state) do
    {:reply, :error, state}
  end

  @impl :ssh_client_channel
  def handle_cast(_message, state) do
    {:noreply, state}
  end

  @impl :ssh_client_channel
  def terminate(_reason, _state) do
    Logger.debug("Client disconnected")
    :ok
  end

  @impl :ssh_client_channel
  def code_change(_old, state, _extra) do
    {:ok, state}
  end

  defp decode_command(data) do
    case json_module().decode(data) do
      {:ok, %{"requestId" => request_id, "cmd" => cmd, "payload" => payload}} ->
        {:ok, request_id, cmd, payload}

      {:ok, v} ->
        Logger.warning("Invalid request: #{inspect(v)}")
        {:error, :invalid_command, Map.get(v, "requestId", nil)}

      {:error, _} ->
        Logger.warning("Failed to decode command: #{inspect(data)}")
        {:error, :invalid_json, nil}
    end
  end

  defp handle_command("version", _payload) do
  end

  defp handle_command("compile_code", %{"code" => code_to_compile} = payload) do
    file = Map.get(payload, "file", "nofile")

    {result, diagnostics} =
      Code.with_diagnostics(fn ->
        try do
          Code.compile_string(code_to_compile, file)
          Code.purge_compiler_modules()
          :ok
        rescue
          err -> {:error, err}
        end
      end)

    cond do
      result == :ok and diagnostics == [] ->
        {:ok, ["Compilation successful"]}

      result != :ok or Enum.any?(diagnostics, &(&1.severity == :error)) ->
        {:error, format_diagnostics(diagnostics)}

      true ->
        {:ok, format_diagnostics(diagnostics)}
    end
  end

  defp handle_command("get_alarms", %{}) do
    {:ok, [:alarm_handler.get_alarms()]}
  end

  defp handle_command(cmd, payload) do
    Logger.warning("Unknown command or invalid payload: #{inspect(cmd)}, #{inspect(payload)}")
    {:error, :unknown_command}
  end

  defp format_diagnostics(diagnostics) do
    Enum.map(diagnostics, &format_diagnostic/1)
    |> Enum.intersperse("\n")
  end

  defp format_diagnostic(%{severity: s, position: p, file: f, message: m} = diagnostic) do
    :elixir_errors.format_snippet(s, p, f, m, nil, diagnostic)
  end

  defp after_connect(state) do
    send_device_metadata(state)
    send_telemetry(state)
  end

  defp send_device_metadata(state) do
    active_partition =
      case KV.get("nerves_fw_active") do
        nil -> nil
        partition -> String.upcase(partition)
      end

    send_data(state, %{
      "event" => "device_metadata",
      "data" => %{
        "fwValid" => Nerves.Runtime.firmware_valid?(),
        "activePartition" => active_partition,
        "fwArchitecture" => KV.get_active("nerves_fw_architecture"),
        "fwPlatform" => KV.get_active("nerves_fw_platform"),
        "fwProduct" => KV.get_active("nerves_fw_product"),
        "fwVersion" => KV.get_active("nerves_fw_version"),
        "fwUuid" => KV.get_active("nerves_fw_uuid")
      }
    })
  end

  defp send_telemetry(state) do
    memory_stats = memory_stats()

    send_data(state, %{
      "event" => "telemetry",
      "data" => %{
        "uptime" => uptime(),
        "loadAverage" => load_average(),
        "cpuTemperature" => cpu_temperature(),
        "memory" =>
          if(memory_stats != nil,
            do: %{"usedMb" => memory_stats.used_mb, "totalMb" => memory_stats.size_mb}
          )
      }
    })

    Process.send_after(self(), :telemetry, state.telemetry_interval)

    :ok
  end

  defp send_data(state, map) when is_map(map) do
    Logger.info("Sending response: #{inspect(map)}")
    :ssh_connection.send(state.cm, state.id, json_module().encode_to_iodata!(map))
  end

  defp json_module() do
    cond do
      Code.ensure_loaded?(JSON) -> JSON
      Code.ensure_loaded?(Jason) -> Jason
      Code.ensure_loaded?(Poison) -> Poison
    end
  end

  # https://github.com/nerves-project/nerves_motd/blob/a93b91a35c4bbb88c755d558776a314b2811e5d2/lib/nerves_motd.ex#L243
  # https://github.com/erlang/otp/blob/1c63b200a677ec7ac12202ddbcf7710884b16ff2/lib/stdlib/src/c.erl#L1118
  @spec uptime() :: IO.chardata()
  defp uptime() do
    {uptime, _} = :erlang.statistics(:wall_clock)
    {d, {h, m, s}} = :calendar.seconds_to_daystime(div(uptime, 1000))
    days = if d > 0, do: :io_lib.format("~b days, ", [d]), else: []
    hours = if d + h > 0, do: :io_lib.format("~b hours, ", [h]), else: []
    minutes = if d + h + m > 0, do: :io_lib.format("~b minutes and ", [m]), else: []
    seconds = :io_lib.format("~b", [s])
    millis = if d + h + m == 0, do: :io_lib.format(".~3..0b", [rem(uptime, 1000)]), else: []

    [days, hours, minutes, seconds, millis, " seconds"] |> IO.iodata_to_binary()
  end

  # From NervesMOTD
  defp cpu_temperature() do
    # Read the file /sys/class/thermal/thermal_zone0/temp. The file content is
    # an integer in millidegree Celsius, which looks like:
    #
    #     39008\n

    with {:ok, content} <- File.read("/sys/class/thermal/thermal_zone0/temp"),
         {millidegree_c, _} <- Integer.parse(content) do
      millidegree_c
    else
      _error -> nil
    end
  end

  # From NervesMOTD
  defp load_average() do
    case File.read("/proc/loadavg") do
      {:ok, data_str} -> data_str |> String.split(" ") |> Enum.take(3) |> Enum.join(" / ")
      _ -> nil
    end
  end

  # From NervesMOTD
  defp memory_stats() do
    # Use free to determine memory statistics. free's output looks like:
    #
    #                   total        used        free      shared  buff/cache   available
    #     Mem:         316664       65184      196736          16       54744      253472
    #     Swap:             0           0           0

    {free_output, 0} = System.cmd("free", [])
    [_title_row, memory_row | _] = String.split(free_output, "\n")
    [_title_column | memory_columns] = String.split(memory_row)
    [size_kb, used_kb, _, _, _, _] = Enum.map(memory_columns, &String.to_integer/1)
    size_mb = round(size_kb / 1000)
    used_mb = round(used_kb / 1000)

    %{size_mb: size_mb, used_mb: used_mb}
  rescue
    # In case the `free` command is not available or any of the out parses incorrectly
    _error -> nil
  end
end
