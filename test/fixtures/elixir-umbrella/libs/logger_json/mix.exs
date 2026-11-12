defmodule LoggerJson.MixProject do
  use Mix.Project

  def project do
    [
      app: :logger_json,
      version: "0.1.0",
      elixir: "~> 1.15",
      deps: deps()
    ]
  end

  defp deps do
    [
      {:jason, "~> 1.2"}
    ]
  end
end
