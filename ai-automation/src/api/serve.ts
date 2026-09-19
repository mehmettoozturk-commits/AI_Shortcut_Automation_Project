/** `npm run serve` giriş noktası — bkz. server.ts. */
import { createPlanServer } from "./server.js";

const port = Number(process.env.PORT ?? 3000);
createPlanServer().listen(port, () => {
  console.log(`POST /plan dinleniyor: http://localhost:${port}/plan`);
});
