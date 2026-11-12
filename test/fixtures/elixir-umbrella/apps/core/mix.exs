defmodule Core.MixProject do
  use Mix.Project

  def project do
    [
      app: :core,
      version: "0.1.0",
      elixir: "~> 1.15",
      deps: deps()
    ]
  end

  defp deps do
    [
      {:plug, "~> 1.16"},
      {:logger_json, path: "../../libs/logger_json"},
      {:gone, path: "../gone"}
    ]
  end
end
