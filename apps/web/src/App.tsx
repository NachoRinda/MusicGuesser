import { HostPage } from "./pages/HostPage.js";
import { PlayPage } from "./pages/PlayPage.js";
import { navigate, usePathname } from "./router.js";

export function App() {
  const path = usePathname();

  if (path === "/host") return <HostPage />;
  const play = /^\/play(?:\/([^/]+))?\/?$/.exec(path);
  if (play) return <PlayPage key={play[1] ?? ""} code={play[1]?.toUpperCase()} />;

  return (
    <main className="center">
      <h1>MusicGuesser</h1>
      <button onClick={() => navigate("/host")}>Crear sala (TV)</button>
      <button onClick={() => navigate("/play")}>Unirme (celular)</button>
    </main>
  );
}
