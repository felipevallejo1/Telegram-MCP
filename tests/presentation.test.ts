import { describe, expect, it } from "vitest";
import { formatBuenosAires, modalityLabel } from "@/lib/presentation";
describe("presentation helpers", () => { it("formats UTC dates in Buenos Aires time", () => expect(formatBuenosAires("2026-08-10T15:00:00.000Z")).toContain("12:00")); it("labels supported modalities", () => { expect(modalityLabel("VIRTUAL")).toBe("Virtual"); expect(modalityLabel("IN_PERSON")).toBe("Presencial"); }); });
