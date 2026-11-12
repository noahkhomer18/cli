defmodule Web.MixProject do
  use Mix.Project

  def project do
    [
      app: :web,
      version: "0.1.0",
      elixir: "~> 1.15",
      deps: deps()
    ]
  end

  defp deps do
    [
      {:core, in_umbrella: true},
      {:ghost, in_umbrella: true},
      {:not_here, path: "../not_here"},
      {:web, "~> 1.0", in_umbrella: false},
      {:jason, "~> 1.4"}
    ]
  end
end
