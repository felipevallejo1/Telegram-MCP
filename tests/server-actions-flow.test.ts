import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const source = readFileSync(resolve(process.cwd(), "src/app/actions.ts"), "utf8");
describe("server action redirect flow", () => {
  it("keeps successful reservation redirects outside the mutation catch", () => { const mutation = source.indexOf("appointment = await reserveAppointment"); const catchBlock = source.indexOf("catch (error)", mutation); const success = source.indexOf("redirect(`/reserva-confirmada", catchBlock); expect(success).toBeGreaterThan(catchBlock); });
  it("keeps successful cancellation redirects outside the mutation catch", () => { const mutation = source.indexOf("await cancelAppointment"); const catchBlock = source.indexOf("catch (error)", mutation); const success = source.indexOf("redirect(\"/mis-turnos?success", catchBlock); expect(success).toBeGreaterThan(catchBlock); });
});
