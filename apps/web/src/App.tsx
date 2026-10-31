import { useEffect, useState } from "react";
import type { HealthResponse } from "@mg/shared";

export function App() {
  const [health, setHealth] = useState<HealthResponse["status"] | "error" | "loading">("loading");

  useEffect(() => {
    fetch("/health")
      .then((res) => res.json() as Promise<HealthResponse>)
      .then((body) => setHealth(body.status))
      .catch(() => setHealth("error"));
  }, []);

  return (
    <main>
      <h1>MusicGuesser</h1>
      <p>Servidor: {health}</p>
    </main>
  );
}
