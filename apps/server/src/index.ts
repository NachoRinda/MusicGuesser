import { createAppServer } from "./app.js";
import { loadRootEnv } from "./env.js";

loadRootEnv();

const port = Number(process.env.PORT ?? 3000);
const { httpServer } = createAppServer();

httpServer.listen(port, () => {
  console.log(`MusicGuesser server listening on http://localhost:${port}`);
});
