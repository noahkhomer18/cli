defmodule Umbrella.MixProject do
  use Mix.Project

  def project do
    [
      description: "not apps_path: \"components\"",
      apps_path: "apps",
      version: "0.1.0",
      elixir: "~> 1.15",
      deps: deps()
    ]
  end

  defp deps do
    [
      {:decimal, "~> 2.0"}
    ]
  end
end
